#!/usr/bin/env bash
# ============================================================================
# Bible Quiz — Android APK build (fully offline toolchain).
#
# Pipeline:
#   1. Stage the web app (web/index.html, styles.css, app.js), the bundled
#      fonts (from obs-news-desk.zip), the repo's bibles/ translations
#      (bibles/<id>/<id>.js + generated manifest.json) and the GENERATED
#      question bank (node web/gen_questions.js -> questions.js + books.js)
#      into app/src/main/assets/www
#   2. ecj (Eclipse compiler) Java -> .class   (compiled against android.jar)
#   3. d8 (R8) .class -> classes.dex
#   4. aapt2 compile/link resources + manifest -> unsigned APK (+ assets)
#   5. python pack_apk.py: align + add classes.dex
#   6. apksigner: v1+v2 sign with the debug keystore
#
# The WebView shell serves the app from a real loopback HTTP server
# (LocalServer on http://127.0.0.1:<port>/) — see MainActivity.java.
#
# Output: android-biblequiz/app/build/Bible-Quiz-1.0.apk
#         (also copied to the repo root as Bible-Quiz.apk)
#
# The Java toolchain (d8.jar, ecj.jar, apksigner.jar, android.jar, aapt2,
# debug.keystore) is SHARED with the other APK projects in ../android/tools —
# see ../android/fetch-tools.sh.
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TOOLS="$ROOT/android/tools"
APP="$HERE/app"
BUILD="$APP/build"
WEB="$HERE/web"
ZIP="$ROOT/obs-news-desk.zip"
WWW="$APP/src/main/assets/www"
VENV="${APK_VENV:-$HOME/apk-venv}"

# --- Java runtime for the Java tools (d8 / ecj / apksigner) ----------------
if command -v java >/dev/null 2>&1; then
    JAVA="$(command -v java)"
else
    if [ ! -x "$VENV/bin/python" ]; then
        python3 -m venv "$VENV"
        "$VENV/bin/pip" install --quiet jdk4py
    fi
    JAVA="$("$VENV/bin/python" -c 'import jdk4py, os; print(os.path.join(jdk4py.JAVA_HOME, "bin", "java"))')"
fi
echo "Using Java: $JAVA ($("$JAVA" -version 2>&1 | head -1))"

# --- shared toolchain -------------------------------------------------------
if [ ! -f "$TOOLS/d8.jar" ] || [ ! -x "$TOOLS/aapt2" ]; then
    "$ROOT/android/fetch-tools.sh"
fi

echo "==> [1/6] Staging quiz web app + generated question bank + bibles into APK assets"
rm -rf "$WWW"
mkdir -p "$WWW/fonts"
cp "$WEB/index.html" "$WEB/styles.css" "$WEB/app.js" "$WWW/"

# fonts for the typography (extracted from the repo's obs-news-desk.zip)
python3 - "$ZIP" "$WWW/fonts" <<'PY'
import sys, zipfile, os
zsrc, out = sys.argv[1], sys.argv[2]
WANT = {
    'obs-news-desk/assets/fonts/PlayfairDisplay-Bold.ttf': 'PlayfairDisplay-Bold.ttf',
    'obs-news-desk/assets/fonts/Barlow-Medium.ttf': 'Barlow-Medium.ttf',
    'obs-news-desk/assets/fonts/Barlow-SemiBold.ttf': 'Barlow-SemiBold.ttf',
    'obs-news-desk/assets/fonts/Barlow-Bold.ttf': 'Barlow-Bold.ttf',
}
z = zipfile.ZipFile(zsrc)
for arc, name in WANT.items():
    with z.open(arc) as fh, open(os.path.join(out, name), 'wb') as oh:
        oh.write(fh.read())
    print('  font:', name, os.path.getsize(os.path.join(out, name)), 'bytes')
PY

# generated question bank (2,500+ questions from bibles/kjv/kjv.js + curated.json)
node "$WEB/gen_questions.js" "$WWW"

# the repo-level bibles/ folder (bibles/<id>/<id>.js, one JS file per translation)
if [ -d "$ROOT/bibles" ]; then
    cp -r "$ROOT/bibles" "$WWW/bibles"
else
    echo "ERROR: $ROOT/bibles not found — the APK needs the bible translations" >&2
    exit 1
fi
find "$WWW" -name '.DS_Store' -delete 2>/dev/null || true
# manifest of the bundled translations (drives the in-app translation picker)
python3 - "$ROOT/bibles" "$WWW/bibles/manifest.json" <<'PY'
import json, os, sys
src, out = sys.argv[1], sys.argv[2]
LABELS = {
    'kjv': 'KING JAMES VERSION',
    'nkjv': 'NEW KING JAMES VERSION',
    'esv': 'ENGLISH STANDARD VERSION',
    'niv': 'NEW INTERNATIONAL VERSION',
    'amplified': 'AMPLIFIED BIBLE',
    'es_rvr': 'REINA-VALERA 1909 (ESPA\u00d1OL)',
}
translations = []
for name in sorted(os.listdir(src)):
    d = os.path.join(src, name)
    js = os.path.join(d, name + '.js')
    if not os.path.isdir(d) or not os.path.isfile(js):
        continue
    translations.append({
        'id': name,
        'file': name + '.js',
        'label': LABELS.get(name, name.upper()),
        'short': name.upper(),
        'bytes': os.path.getsize(js),
    })
with open(out, 'w') as fh:
    json.dump({'translations': translations}, fh, indent=1, ensure_ascii=False)
print('  bible translations:', ', '.join(t['id'] for t in translations))
PY

# UI must use SVG icons, not emoji: fail the build if any glyphs remain
python3 "$ROOT/scripts/check_no_emoji.py" "$WEB" "$WWW"

echo "==> [2/6] Compiling Java sources (ecj, against android.jar API 34)"
rm -rf "$BUILD/classes"
mkdir -p "$BUILD/classes"
# shellcheck disable=SC2046
"$JAVA" -jar "$TOOLS/ecj.jar" -nowarn -proc:none -encoding UTF-8 \
    -source 1.8 -target 1.8 \
    -bootclasspath "$TOOLS/android.jar" \
    -cp "$TOOLS/android.jar" \
    -d "$BUILD/classes" \
    $(find "$APP/src/main/java" -name '*.java')

echo "==> [3/6] Dexing with d8 (min-api 23)"
rm -rf "$BUILD/dex"
mkdir -p "$BUILD/dex"
# shellcheck disable=SC2046
"$JAVA" -cp "$TOOLS/d8.jar" com.android.tools.r8.D8 \
    --release --min-api 23 --lib "$TOOLS/android.jar" \
    --output "$BUILD/dex" \
    $(find "$BUILD/classes" -name '*.class')

echo "==> [4/6] Packaging resources/manifest (aapt2)"
rm -f "$BUILD/res.zip" "$BUILD/unsigned.apk" "$BUILD/aligned.apk" "$BUILD"/Bible-Quiz-*.apk
"$TOOLS/aapt2" compile --dir "$APP/src/main/res" -o "$BUILD/res.zip"
"$TOOLS/aapt2" link -o "$BUILD/unsigned.apk" \
    -I "$TOOLS/android.jar" \
    --manifest "$APP/src/main/AndroidManifest.xml" \
    --min-sdk-version 23 --target-sdk-version 34 \
    --version-code 1 --version-name 1.0 \
    "$BUILD/res.zip" \
    -A "$APP/src/main/assets"

echo "==> [5/6] Aligning + adding classes.dex (pack_apk.py)"
python3 "$TOOLS/pack_apk.py" "$BUILD/unsigned.apk" "$BUILD/dex/classes.dex" "$BUILD/aligned.apk"

echo "==> [6/6] Signing (apksigner, v1+v2, debug key)"
"$JAVA" -jar "$TOOLS/apksigner.jar" sign \
    --ks "$TOOLS/debug.keystore" \
    --ks-key-alias androiddebugkey \
    --ks-pass pass:android \
    --key-pass pass:android \
    --out "$BUILD/Bible-Quiz-1.0.apk" \
    "$BUILD/aligned.apk"

echo "==> Verifying signature"
"$JAVA" -jar "$TOOLS/apksigner.jar" verify --print-certs "$BUILD/Bible-Quiz-1.0.apk"

echo "==> APK badging"
"$TOOLS/aapt2" dump badging "$BUILD/Bible-Quiz-1.0.apk" > "$BUILD/badging.txt" || true
head -25 "$BUILD/badging.txt"

cp "$BUILD/Bible-Quiz-1.0.apk" "$ROOT/Bible-Quiz.apk"
echo
echo "DONE: $BUILD/Bible-Quiz-1.0.apk"
echo "      (also copied to $ROOT/Bible-Quiz.apk)"
