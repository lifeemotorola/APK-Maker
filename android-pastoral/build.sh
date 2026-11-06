#!/usr/bin/env bash
# ============================================================================
# Pastoral — Android APK build (offline toolchain).
#
# A sermon studio for pastors (com.pastoral.app): sermon CRUD with outline
# builder, bundled KJV scripture browser (repo bibles/kjv/kjv.js), series,
# dashboard, share/export + JSON backup. Fully offline — the page is loaded
# from file:///android_asset/www/ and state lives in the app-private files
# dir via the window.Pastoral bridge.
#
# Pipeline (same as the other APKs in this repo):
#   1. Validate the web shell (node web/test_web.mjs), stage web app + icon
#      + the KJV bible into app/src/main/assets/www; emoji gate
#   2. ecj Java -> .class            (against android.jar)
#   3. d8 .class -> classes.dex
#   4. aapt2 compile/link resources + manifest -> unsigned APK (+ assets)
#   5. python pack_apk.py: align + add classes.dex
#   6. apksigner: v1+v2 sign with the debug keystore
#
# Output: android-pastoral/app/build/Pastoral-1.0.apk
#         (also copied to the repo root as Pastoral.apk)
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

echo "==> [1/6] Validating web shell + staging web app + KJV bible into APK assets"
node "$WEB/test_web.mjs"

if [ ! -f "$ROOT/bibles/kjv/kjv.js" ]; then
    echo "ERROR: $ROOT/bibles/kjv/kjv.js not found — the APK needs the KJV bible" >&2
    exit 1
fi

rm -rf "$WWW"
mkdir -p "$WWW/img" "$WWW/bibles"
cp "$WEB/index.html" "$WEB/styles.css" "$WEB/app.js" "$WWW/"
cp "$WEB/img/"*.png "$WWW/img/"
cp "$ROOT/bibles/kjv/kjv.js" "$WWW/bibles/kjv.js"

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
rm -f "$BUILD/res.zip" "$BUILD/unsigned.apk" "$BUILD/aligned.apk" "$BUILD"/Pastoral-*.apk
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
    --out "$BUILD/Pastoral-1.0.apk" \
    "$BUILD/aligned.apk"

echo "==> Verifying signature"
"$JAVA" -jar "$TOOLS/apksigner.jar" verify --print-certs "$BUILD/Pastoral-1.0.apk"

echo "==> APK badging"
"$TOOLS/aapt2" dump badging "$BUILD/Pastoral-1.0.apk" > "$BUILD/badging.txt" || true
head -25 "$BUILD/badging.txt"

cp "$BUILD/Pastoral-1.0.apk" "$ROOT/Pastoral.apk"
echo
echo "DONE: $BUILD/Pastoral-1.0.apk"
echo "      (also copied to $ROOT/Pastoral.apk)"
