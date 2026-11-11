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
# Output: android/app/build/KeySense-Studio-1.2.0.apk (also copied to the
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

echo "==> [1/6] Testing offline analyzer + live-mic shell (Node)"
cd "$ROOT"
if [ ! -d node_modules ]; then
    npm install --no-audit --no-fund
fi
mkdir -p "$BUILD"
npx esbuild scripts/test_offline_analyze.ts --bundle --platform=node --format=esm --outfile="$BUILD/test_offline.mjs"
node "$BUILD/test_offline.mjs"
npx esbuild scripts/test_progression.ts --bundle --platform=node --format=esm --outfile="$BUILD/test_progression.mjs"
node "$BUILD/test_progression.mjs"
npx esbuild scripts/test_chord_tracker.ts --bundle --platform=node --format=esm --outfile="$BUILD/test_chord_tracker.mjs"
node "$BUILD/test_chord_tracker.mjs"
npx esbuild scripts/test_practice_layout.ts --bundle --platform=node --format=esm --outfile="$BUILD/test_practice_layout.mjs"
node "$BUILD/test_practice_layout.mjs"
node scripts/test_livemic_shell.mjs

echo "==> [2/6] Building web UI (Vite)"
npx vite build --outDir "$APP/src/main/assets/www" --emptyOutDir

# UI must use SVG icons, not emoji: fail the build if any glyphs remain
python3 "$ROOT/scripts/check_no_emoji.py" "$ROOT/src" "$ROOT/static_ui" "$ROOT/index.html" "$APP/src/main/assets/www" "$APP/src/main"

echo "==> [3/6] Bundling demo audio + analyses into APK assets"
mkdir -p "$APP/src/main/assets/demos"
cp "$ROOT"/demos/* "$APP/src/main/assets/demos/"

echo "==> [4/6] Compiling Java sources (ecj, against android.jar API 34)"
rm -rf "$BUILD/classes"
mkdir -p "$BUILD/classes"
# shellcheck disable=SC2046
"$JAVA" -jar "$TOOLS/ecj.jar" -nowarn -proc:none -encoding UTF-8 \
    -source 1.8 -target 1.8 \
    -bootclasspath "$TOOLS/android.jar" \
    -cp "$TOOLS/android.jar" \
    -d "$BUILD/classes" \
    $(find "$APP/src/main/java" -name '*.java')

echo "==> [5/6] Dexing with d8 (min-api 23)"
rm -rf "$BUILD/dex"
mkdir -p "$BUILD/dex"
# shellcheck disable=SC2046
"$JAVA" -cp "$TOOLS/d8.jar" com.android.tools.r8.D8 \
    --release --min-api 23 --lib "$TOOLS/android.jar" \
    --output "$BUILD/dex" \
    $(find "$BUILD/classes" -name '*.class')

echo "==> [6/6] Packaging resources/manifest (aapt2) + signing (apksigner)"
rm -f "$BUILD/res.zip" "$BUILD/unsigned.apk" "$BUILD/aligned.apk" "$BUILD"/KeySense-Studio-*.apk
"$TOOLS/aapt2" compile --dir "$APP/src/main/res" -o "$BUILD/res.zip"
"$TOOLS/aapt2" link -o "$BUILD/unsigned.apk" \
    -I "$TOOLS/android.jar" \
    --manifest "$APP/src/main/AndroidManifest.xml" \
    --min-sdk-version 23 --target-sdk-version 34 \
    --version-code 4 --version-name 1.2.0 \
    "$BUILD/res.zip" \
    -A "$APP/src/main/assets"

python3 "$HERE/tools/pack_apk.py" "$BUILD/unsigned.apk" "$BUILD/dex/classes.dex" "$BUILD/aligned.apk"

"$JAVA" -jar "$TOOLS/apksigner.jar" sign \
    --ks "$TOOLS/debug.keystore" \
    --ks-key-alias androiddebugkey \
    --ks-pass pass:android \
    --key-pass pass:android \
    --out "$BUILD/KeySense-Studio-1.2.0.apk" \
    "$BUILD/aligned.apk"

echo "==> Verifying signature"
"$JAVA" -jar "$TOOLS/apksigner.jar" verify --print-certs "$BUILD/KeySense-Studio-1.2.0.apk"

echo "==> APK badging"
"$TOOLS/aapt2" dump badging "$BUILD/KeySense-Studio-1.2.0.apk" > "$BUILD/badging.txt" || true
head -25 "$BUILD/badging.txt"

cp "$BUILD/KeySense-Studio-1.2.0.apk" "$ROOT/KeySense-Studio.apk"
echo
echo "DONE: $BUILD/KeySense-Studio-1.2.0.apk"
echo "      (also copied to $ROOT/KeySense-Studio.apk)"
