#!/usr/bin/env bash
# ============================================================================
# NewsDesk Studio — Android APK build (fully offline toolchain).
#
# Pipeline:
#   0. Unzip obs-news-desk.zip if the sources are not extracted yet
#   1. Stage the web app (control / overlay / demo / camera / assets /
#      scripture / bible / uploads / presets.json / state.json), the repo's
#      bibles/ translations (bibles/<id>/<id>.js + generated manifest.json)
#      and the in-page backend shim into app/src/main/assets/www
#   2. ecj (Eclipse compiler) Java -> .class   (compiled against android.jar)
#   3. d8 (R8) .class -> classes.dex
#   4. aapt2 compile/link resources + manifest -> unsigned APK (+ assets)
#   5. python pack_apk.py: align + add classes.dex
#   6. apksigner: v1+v2 sign with the debug keystore
#
# The WebView shell serves everything from the fake origin
# https://newsdesk.local/ (intercepted), and shim.js implements the whole
# server.py backend (/api/* + /ws) inside the page — see shim/shim.js.
#
# Output: android-newsdesk/app/build/NewsDesk-Studio-1.5.apk
#         (also copied to the repo root as NewsDesk-Studio.apk)
#
# The Java toolchain (d8.jar, ecj.jar, apksigner.jar, android.jar, aapt2,
# debug.keystore) is SHARED with the KeySense project in ../android/tools —
# see ../android/fetch-tools.sh.
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TOOLS="$ROOT/android/tools"
APP="$HERE/app"
BUILD="$APP/build"
SRC="$ROOT/obs-news-desk"
ZIP="$ROOT/obs-news-desk.zip"
WWW="$APP/src/main/assets/www"
VENV="${APK_VENV:-$HOME/apk-venv}"

# --- Java runtime for the Java tools (d8 / ecj / apksigner) ----------------
# Prefer a system JDK (GitHub Actions runners ship one); otherwise fall back
# to the JRE bundled in the jdk4py Python package.
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

# --- web app sources ---------------------------------------------------------
if [ ! -d "$SRC" ]; then
    if [ ! -f "$ZIP" ]; then
        echo "ERROR: neither $SRC nor $ZIP exists" >&2
        exit 1
    fi
    echo "Extracting $ZIP ..."
    unzip -q "$ZIP" -d "$ROOT"
fi

echo "==> [1/6] Staging NewsDesk web app + shim + bibles into APK assets"
rm -rf "$WWW"
mkdir -p "$WWW"
cp -r "$SRC/control" "$SRC/overlay" "$SRC/demo" "$SRC/camera" \
      "$SRC/assets" "$SRC/scripture" "$SRC/bible" "$SRC/uploads" "$WWW/"
cp "$SRC/presets.json" "$SRC/state.json" "$WWW/"
# the repo-level bibles/ folder (bibles/<id>/<id>.js, one JS file per translation)
if [ -d "$ROOT/bibles" ]; then
    cp -r "$ROOT/bibles" "$WWW/bibles"
else
    echo "WARNING: $ROOT/bibles not found — the APK will only have the bundled KJV"
fi
# python-only files have no place in the APK
rm -f "$WWW/camera/camera.py" "$WWW/bible/bible.py" "$WWW/"*/.DS_Store 2>/dev/null || true
find "$WWW" -name '.DS_Store' -delete 2>/dev/null || true
# the in-page backend (implements /api/* + /ws of server.py in JS)
cp "$HERE/shim/shim.js" "$WWW/__shim.js"
cp "$HERE/shim/shell.html" "$WWW/shell.html"
# index of the bundled demo media for the native library (name/size/mtime/sha1)
python3 - "$SRC/uploads" "$WWW/bundled-uploads.json" <<'PY'
import hashlib, json, os, sys
src, out = sys.argv[1], sys.argv[2]
VIDEO = ('.mp4', '.webm', '.m4v', '.mov', '.ogv')
IMG = ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg')
def human(n):
    for unit in ('B', 'KB', 'MB'):
        if n < 1024 or unit == 'MB':
            return ('%d %s' % (n, unit)) if unit == 'B' else ('%.1f %s' % (n, unit))
        n /= 1024.0
    return '%d B' % n
files = []
for name in sorted(os.listdir(src)):
    p = os.path.join(src, name)
    if not os.path.isfile(p):
        continue
    ext = os.path.splitext(name)[1].lower()
    if ext not in IMG + VIDEO:
        continue
    st = os.stat(p)
    with open(p, 'rb') as fh:
        digest = hashlib.sha1(fh.read()).hexdigest()[:16]
    files.append({'name': name, 'url': '/uploads/' + name, 'size': st.st_size,
                  'pretty': human(st.st_size), 'mtime': int(st.st_mtime),
                  'video': ext in VIDEO, 'digest': digest})
files.sort(key=lambda f: f['mtime'], reverse=True)
with open(out, 'w') as fh:
    json.dump(files, fh, indent=1)
PY
# manifest of the bundled bible translations (drives /api/bible/translations +
# the in-panel translation picker in shim.js)
if [ -d "$ROOT/bibles" ]; then
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
fi

# The UI uses SVG icons, not emoji: patch the staged web app and fail the
# build if any emoji/symbol glyphs remain anywhere in the APK assets.
python3 "$HERE/tools/deemoji.py" "$WWW"
python3 "$ROOT/scripts/check_no_emoji.py" "$WWW" "$HERE/shim" "$APP/src/main"

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
rm -f "$BUILD/res.zip" "$BUILD/unsigned.apk" "$BUILD/aligned.apk" "$BUILD"/NewsDesk-Studio-*.apk
"$TOOLS/aapt2" compile --dir "$APP/src/main/res" -o "$BUILD/res.zip"
"$TOOLS/aapt2" link -o "$BUILD/unsigned.apk" \
    -I "$TOOLS/android.jar" \
    --manifest "$APP/src/main/AndroidManifest.xml" \
    --min-sdk-version 23 --target-sdk-version 34 \
    --version-code 1 --version-name 1.5 \
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
    --out "$BUILD/NewsDesk-Studio-1.5.apk" \
    "$BUILD/aligned.apk"

echo "==> Verifying signature"
"$JAVA" -jar "$TOOLS/apksigner.jar" verify --print-certs "$BUILD/NewsDesk-Studio-1.5.apk"

echo "==> APK badging"
"$TOOLS/aapt2" dump badging "$BUILD/NewsDesk-Studio-1.5.apk" > "$BUILD/badging.txt" || true
head -25 "$BUILD/badging.txt"

cp "$BUILD/NewsDesk-Studio-1.5.apk" "$ROOT/NewsDesk-Studio.apk"
echo
echo "DONE: $BUILD/NewsDesk-Studio-1.5.apk"
echo "      (also copied to $ROOT/NewsDesk-Studio.apk)"
