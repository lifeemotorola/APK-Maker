#!/usr/bin/env bash
# ============================================================================
# KeyFinder Player — Android APK build (fully offline toolchain).
#
# Advanced multimedia song player that finds the musical key of any song,
# fully on-device: bundled demo library + user-picked audio files, WebAudio
# playback (seek/rate/volume/A-B loop/waveform) and an in-page chroma +
# Krumhansl-Schmuckler key analysis (bundled from ../src/lib via esbuild).
#
# Pipeline:
#   1. Validate the web shell (node web/test_web.mjs), bundle the analyzer
#      (esbuild web/keyfinder.ts -> assets/www/keyfinder.js), stage the web
#      app + demo songs into app/src/main/assets/www; emoji gate
#   2. ecj Java -> .class            (against android.jar)
#   3. d8 .class -> classes.dex
#   4. aapt2 compile/link resources + manifest -> unsigned APK (+ assets)
#   5. python pack_apk.py: align + add classes.dex
#   6. apksigner: v1+v2 sign with the debug keystore
#
# The WebView shell serves the app from a real loopback HTTP server
# (LocalServer on http://127.0.0.1:<port>/) — see MainActivity.java.
#
# Output: android-keyfinder/app/build/KeyFinder-Player-1.0.apk
#         (also copied to the repo root as KeyFinder-Player.apk)
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
WWW="$APP/src/main/assets/www"
VENV="${APK_VENV:-$HOME/apk-venv}"

# --- node deps (esbuild) ----------------------------------------------------
if [ ! -d "$ROOT/node_modules" ]; then
    (cd "$ROOT" && npm install --no-audit --no-fund)
fi

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

echo "==> [1/6] Validating web shell + staging web app & demos into APK assets"
node "$WEB/test_web.mjs"

rm -rf "$WWW"
mkdir -p "$WWW/demos"
cp "$WEB/index.html" "$WEB/styles.css" "$WEB/app.js" "$WWW/"
(cd "$ROOT" && npx esbuild "$WEB/keyfinder.ts" --bundle --platform=browser --format=iife --outfile="$WWW/keyfinder.js")
cp "$ROOT/demos/"*.wav "$ROOT/demos/manifest.json" "$WWW/demos/"

# UI must use text/SVG icons, not emoji: fail the build if any glyphs remain
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
rm -f "$BUILD/res.zip" "$BUILD/unsigned.apk" "$BUILD/aligned.apk" "$BUILD"/KeyFinder-Player-*.apk
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
    --out "$BUILD/KeyFinder-Player-1.0.apk" \
    "$BUILD/aligned.apk"

echo "==> Verifying signature"
"$JAVA" -jar "$TOOLS/apksigner.jar" verify --print-certs "$BUILD/KeyFinder-Player-1.0.apk"

echo "==> APK badging"
"$TOOLS/aapt2" dump badging "$BUILD/KeyFinder-Player-1.0.apk" > "$BUILD/badging.txt" || true
head -25 "$BUILD/badging.txt"

cp "$BUILD/KeyFinder-Player-1.0.apk" "$ROOT/KeyFinder-Player.apk"
echo
echo "DONE: $BUILD/KeyFinder-Player-1.0.apk"
echo "      (also copied to $ROOT/KeyFinder-Player.apk)"
