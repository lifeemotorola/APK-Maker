#!/usr/bin/env bash
# ============================================================================
# WiFi Cam — Android APK build (offline toolchain).
#
# The APK turns the phone camera into a WiFi webcam: a LAN HTTP server
# (0.0.0.0:8080) serves the control page and streams MJPEG (Camera2 JPEG
# frames) at /stream. The computer driver lives in ../wificam-driver/.
#
# Pipeline:
#   1. Validate the web shell (node web/test_web.mjs), stage web app + icon
#      into app/src/main/assets/www; emoji gate
#   2. ecj Java -> .class            (against android.jar)
#   3. d8 .class -> classes.dex
#   4. aapt2 compile/link resources + manifest -> unsigned APK (+ assets)
#   5. python pack_apk.py: align + add classes.dex
#   6. apksigner: v1+v2 sign with the debug keystore
#
# Output: android-wificam/app/build/Wificam-1.3.apk
#         (also copied to the repo root as Wificam.apk)
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

echo "==> [1/6] Validating web shell + staging web app into APK assets"
node "$WEB/test_web.mjs"

rm -rf "$WWW"
mkdir -p "$WWW/img"
cp "$WEB/index.html" "$WEB/styles.css" "$WEB/app.js" "$WWW/"
cp "$WEB/img/"*.png "$WWW/img/"

# UI must use text/PNG icons, not emoji: fail the build if any glyphs remain
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
rm -f "$BUILD/res.zip" "$BUILD/unsigned.apk" "$BUILD/aligned.apk" "$BUILD"/Wificam-*.apk
"$TOOLS/aapt2" compile --dir "$APP/src/main/res" -o "$BUILD/res.zip"
"$TOOLS/aapt2" link -o "$BUILD/unsigned.apk" \
    -I "$TOOLS/android.jar" \
    --manifest "$APP/src/main/AndroidManifest.xml" \
    --min-sdk-version 23 --target-sdk-version 34 \
    --version-code 4 --version-name 1.3 \
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
    --out "$BUILD/Wificam-1.3.apk" \
    "$BUILD/aligned.apk"

echo "==> Verifying signature"
"$JAVA" -jar "$TOOLS/apksigner.jar" verify --print-certs "$BUILD/Wificam-1.3.apk"

echo "==> APK badging"
"$TOOLS/aapt2" dump badging "$BUILD/Wificam-1.3.apk" > "$BUILD/badging.txt" || true
head -25 "$BUILD/badging.txt"

cp "$BUILD/Wificam-1.3.apk" "$ROOT/Wificam.apk"
echo
echo "DONE: $BUILD/Wificam-1.3.apk"
echo "      (also copied to $ROOT/Wificam.apk)"
