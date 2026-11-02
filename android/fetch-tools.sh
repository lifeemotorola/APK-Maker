#!/usr/bin/env bash
# Downloads the offline Android APK build toolchain into android/tools/.
#
# Everything comes from the sandbox-allowed hosts only:
#   - registry.npmjs.org  (@drxiaozhi/minapk bundle: d8.jar, ecj, apksigner,
#                          android.jar (API 34), debug.keystore; aaptjs3: aapt2)
#   - pypi.org            (jdk4py: a JRE to run the Java-based tools)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$HERE/tools"
VENV="${APK_VENV:-$HOME/apk-venv}"
mkdir -p "$TOOLS"

# --- Python venv with a JRE (jdk4py) to run d8/ecj/apksigner -------------
if [ ! -x "$VENV/bin/python" ]; then
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --quiet jdk4py
fi

# --- minapk npm bundle: d8.jar (R8/D8), ecj compiler, apksigner, ---------
# --- android.jar (API 34), debug.keystore --------------------------------
if [ ! -f "$TOOLS/d8.jar" ] || [ ! -f "$TOOLS/android.jar" ]; then
    tmp="$(mktemp -d)"
    echo "Fetching @drxiaozhi/minapk tool bundle from npm..."
    npm pack @drxiaozhi/minapk@0.5.1 --pack-destination "$tmp" >/dev/null
    tgz="$(ls "$tmp"/*.tgz | head -1)"
    tar xzf "$tgz" -C "$tmp"
    cp "$tmp/package/tools/d8.jar" "$TOOLS/d8.jar"
    cp "$tmp/package/tools/ecj-3.45.0.jar" "$TOOLS/ecj.jar"
    cp "$tmp/package/tools/apksigner.jar" "$TOOLS/apksigner.jar"
    cp "$tmp/package/tools/android.jar" "$TOOLS/android.jar"
    cp "$tmp/package/tools/debug.keystore" "$TOOLS/debug.keystore"
    rm -rf "$tmp"
fi

# --- aapt2 (linux x64) from the aaptjs3 npm bundle -----------------------
if [ ! -x "$TOOLS/aapt2" ]; then
    tmp="$(mktemp -d)"
    echo "Fetching aapt2 from npm (aaptjs3)..."
    npm pack aaptjs3 --pack-destination "$tmp" >/dev/null
    tgz="$(ls "$tmp"/aaptjs3-*.tgz | head -1)"
    tar xzf "$tgz" -C "$tmp" package/bin/x64/linux/aapt2
    cp "$tmp/package/bin/x64/linux/aapt2" "$TOOLS/aapt2"
    chmod +x "$TOOLS/aapt2"
    rm -rf "$tmp"
fi

echo "Toolchain ready in $TOOLS:"
ls -la "$TOOLS"
