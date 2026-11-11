#!/usr/bin/env bash
# ============================================================================
# Choir Tune Finder — Android APK build (offline toolchain).
#
# Upload any song (mp3/wav/m4a/ogg/flac/webm) and the app extracts the lead
# melody — "the choir's tune" — fully on-device: piano roll + timed tune
# sheet, detected key & BPM, synth playback of the tune, transpose, save to
# a library, share as text, export as .mid (Downloads/ChoirTune).
# Package com.choirtune.app, versionName 1.0 / versionCode 1.
#
# Pipeline (same as the other APKs in this repo):
#   1. Validate the web shell (node web/test_web.mjs — incl. a functional
#      DSP test), stage web app + icon into app/src/main/assets/www;
#      emoji gate
#   2. ecj Java -> .class            (against android.jar)
#   3. d8 .class -> classes.dex
#   4. aapt2 compile/link resources + manifest -> unsigned APK (+ assets)
#   5. python pack_apk.py: align + add classes.dex
#   6. apksigner: v1+v2 sign with the debug keystore
#
# Output: android-choirtune/app/build/ChoirTune-1.0.apk
#         (also copied to the repo root as ChoirTune.apk)
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TOOLS="$ROOT/android/tools"
APP="$HERE/app"
BUILD="$APP/build"
WEB="$HERE/web"
WWW="$APP/src/main/assets/www"
VENV="${APK_VENV:-$HOME/apk-venv}"

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

if [ ! -f "$TOOLS/d8.jar" ] || [ ! -x "$TOOLS/aapt2" ]; then
    "$ROOT/android/fetch-tools.sh"
fi

echo "==> [1/6] Validating web shell (incl. DSP extraction test) + staging web app into APK assets"
node "$WEB/test_web.mjs"
node "$WEB/test_app.mjs"

rm -rf "$WWW"
mkdir -p "$WWW/img"
cp "$WEB/index.html" "$WEB/styles.css" "$WEB/app.js" "$WEB/melody.js" "$WWW/"
cp "$WEB/img/"*.png "$WWW/img/"

python3 "$ROOT/scripts/check_no_emoji.py" "$WEB" "$APP/src/main"

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
rm -f "$BUILD/res.zip" "$BUILD/unsigned.apk" "$BUILD/aligned.apk" "$BUILD"/ChoirTune-*.apk
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
    --out "$BUILD/ChoirTune-1.0.apk" \
    "$BUILD/aligned.apk"

echo "==> Verifying signature"
"$JAVA" -jar "$TOOLS/apksigner.jar" verify --print-certs "$BUILD/ChoirTune-1.0.apk"

echo "==> APK badging"
"$TOOLS/aapt2" dump badging "$BUILD/ChoirTune-1.0.apk" > "$BUILD/badging.txt" || true
head -25 "$BUILD/badging.txt"

cp "$BUILD/ChoirTune-1.0.apk" "$ROOT/ChoirTune.apk"
echo
echo "DONE: $BUILD/ChoirTune-1.0.apk"
echo "      (also copied to $ROOT/ChoirTune.apk)"
