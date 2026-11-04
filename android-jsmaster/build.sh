#!/usr/bin/env bash
# ============================================================================
# JS Mastery — Android APK build (fully offline toolchain).
#
# Interactive JavaScript course (beginner -> advanced): 50 topics, 5,250
# runnable practice problems, per-topic quizzes, a 50-question final exam and
# a printable certificate. All course data is generated at build time into
# assets/www/data by web/gen_course.js and validated by web/test_course.js
# (which executes every practice solution + test in a VM).
#
# Pipeline:
#   1. Generate + validate the course, stage web app into assets/www; emoji gate
#   2. ecj Java -> .class            (against android.jar)
#   3. d8 .class -> classes.dex
#   4. aapt2 compile/link resources + manifest -> unsigned APK (+ assets)
#   5. python pack_apk.py: align + add classes.dex
#   6. apksigner: v1+v2 sign with the debug keystore
#
# The WebView shell serves the app from a real loopback HTTP server
# (LocalServer on http://127.0.0.1:<port>/). Hardware BACK drives the in-app
# nav stack; the certificate screen calls Android.printPage() -> system print.
#
# Output: android-jsmaster/app/build/JS-Master-1.1.apk
#         (also copied to the repo root as JS-Master.apk)
#
# The Java toolchain is SHARED with the other APK projects in ../android/tools
# — see ../android/fetch-tools.sh.
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

echo "==> [1/6] Generating + validating the course, staging web app into APK assets"
rm -rf "$WWW"
mkdir -p "$WWW/img" "$WWW/fonts"
cp "$WEB/index.html" "$WEB/styles.css" "$WEB/app.js" "$WEB/icons.js" "$WWW/"
cp "$WEB/img/"*.jpg "$WWW/img/"

# generated course data (50 topics / 5,250 practices + quizzes)
node "$WEB/gen_course.js" "$WWW/data"
# executes every practice solution + test in a VM — fails the build if any break
node "$WEB/test_course.js" "$WWW/data"
# proves the shipped in-app sandboxed-iframe runner (srcdoc + postMessage) works
node "$WEB/test_runner.js"

# fonts (extracted from the repo's obs-news-desk.zip)
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
find "$WWW" -name '.DS_Store' -delete 2>/dev/null || true

# UI must use SVG icons, not emoji: fail the build if any glyphs remain
python3 "$ROOT/scripts/check_no_emoji.py" "$WEB" "$WWW" "$APP/src/main"

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
rm -f "$BUILD/res.zip" "$BUILD/unsigned.apk" "$BUILD/aligned.apk" "$BUILD"/JS-Master-*.apk
"$TOOLS/aapt2" compile --dir "$APP/src/main/res" -o "$BUILD/res.zip"
"$TOOLS/aapt2" link -o "$BUILD/unsigned.apk" \
    -I "$TOOLS/android.jar" \
    --manifest "$APP/src/main/AndroidManifest.xml" \
    --min-sdk-version 23 --target-sdk-version 34 \
    --version-code 2 --version-name 1.1 \
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
    --out "$BUILD/JS-Master-1.1.apk" \
    "$BUILD/aligned.apk"

echo "==> Verifying signature"
"$JAVA" -jar "$TOOLS/apksigner.jar" verify --print-certs "$BUILD/JS-Master-1.1.apk"

echo "==> APK badging"
"$TOOLS/aapt2" dump badging "$BUILD/JS-Master-1.1.apk" > "$BUILD/badging.txt" || true
head -25 "$BUILD/badging.txt"

cp "$BUILD/JS-Master-1.1.apk" "$ROOT/JS-Master.apk"
echo
echo "DONE: $BUILD/JS-Master-1.1.apk"
echo "      (also copied to $ROOT/JS-Master.apk)"
