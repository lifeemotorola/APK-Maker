#!/usr/bin/env bash
# ============================================================================
# KeySense Studio — Android APK build (fully offline toolchain).
#
# Pipeline:
#   1. Vite build of the React studio UI        -> app/src/main/assets/www
#   2. Bundle demo WAVs + precomputed analyses  -> app/src/main/assets/demos
#   3. ecj (Eclipse compiler) Java -> .class    (compiled against android.jar)
#   4. d8 (R8) .class -> classes.dex
#   5. aapt2 compile/link resources + manifest  -> unsigned APK (+ assets)
#   6. python pack_apk.py: align + add classes.dex
#   7. apksigner: v1+v2 sign with the debug keystore
#
# Output: android/app/build/KeySense-Studio-1.0.0.apk (also copied to the
#         repo root as KeySense-Studio.apk)
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TOOLS="$HERE/tools"
APP="$HERE/app"
BUILD="$APP/build"
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

"$HERE/fetch-tools.sh"

echo "==> [1/5] Building web UI (Vite)"
cd "$ROOT"
if [ ! -d node_modules ]; then
    npm install --no-audit --no-fund
fi
npx vite build --outDir "$APP/src/main/assets/www" --emptyOutDir

echo "==> [2/5] Bundling demo audio + analyses into APK assets"
mkdir -p "$APP/src/main/assets/demos"
cp "$ROOT"/demos/* "$APP/src/main/assets/demos/"

echo "==> [3/5] Compiling Java sources (ecj, against android.jar API 34)"
rm -rf "$BUILD/classes"
mkdir -p "$BUILD/classes"
# shellcheck disable=SC2046
"$JAVA" -jar "$TOOLS/ecj.jar" -nowarn -proc:none -encoding UTF-8 \
    -source 1.8 -target 1.8 \
    -bootclasspath "$TOOLS/android.jar" \
    -cp "$TOOLS/android.jar" \
    -d "$BUILD/classes" \
    $(find "$APP/src/main/java" -name '*.java')

echo "==> [4/5] Dexing with d8 (min-api 23)"
rm -rf "$BUILD/dex"
mkdir -p "$BUILD/dex"
# shellcheck disable=SC2046
"$JAVA" -cp "$TOOLS/d8.jar" com.android.tools.r8.D8 \
    --release --min-api 23 --lib "$TOOLS/android.jar" \
    --output "$BUILD/dex" \
    $(find "$BUILD/classes" -name '*.class')

echo "==> [5/5] Packaging resources/manifest (aapt2) + signing (apksigner)"
rm -f "$BUILD/res.zip" "$BUILD/unsigned.apk" "$BUILD/aligned.apk" "$BUILD"/KeySense-Studio-*.apk
"$TOOLS/aapt2" compile --dir "$APP/src/main/res" -o "$BUILD/res.zip"
"$TOOLS/aapt2" link -o "$BUILD/unsigned.apk" \
    -I "$TOOLS/android.jar" \
    --manifest "$APP/src/main/AndroidManifest.xml" \
    --min-sdk-version 23 --target-sdk-version 34 \
    --version-code 1 --version-name 1.0.0 \
    "$BUILD/res.zip" \
    -A "$APP/src/main/assets"

python3 "$HERE/tools/pack_apk.py" "$BUILD/unsigned.apk" "$BUILD/dex/classes.dex" "$BUILD/aligned.apk"

"$JAVA" -jar "$TOOLS/apksigner.jar" sign \
    --ks "$TOOLS/debug.keystore" \
    --ks-key-alias androiddebugkey \
    --ks-pass pass:android \
    --key-pass pass:android \
    --out "$BUILD/KeySense-Studio-1.0.0.apk" \
    "$BUILD/aligned.apk"

echo "==> Verifying signature"
"$JAVA" -jar "$TOOLS/apksigner.jar" verify --print-certs "$BUILD/KeySense-Studio-1.0.0.apk"

echo "==> APK badging"
"$TOOLS/aapt2" dump badging "$BUILD/KeySense-Studio-1.0.0.apk" > "$BUILD/badging.txt" || true
head -25 "$BUILD/badging.txt"

cp "$BUILD/KeySense-Studio-1.0.0.apk" "$ROOT/KeySense-Studio.apk"
echo
echo "DONE: $BUILD/KeySense-Studio-1.0.0.apk"
echo "      (also copied to $ROOT/KeySense-Studio.apk)"
