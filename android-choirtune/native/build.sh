#!/usr/bin/env bash
# Dependencies are pinned by fetch.py. Use an installed official Android NDK.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PYTHON="${APK_PYTHON:-${APK_VENV:-$HOME/apk-venv}/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
  python3 -m venv "${APK_VENV:-$HOME/apk-venv}"
fi
"$PYTHON" -c 'import py7zr, cmake, ninja' 2>/dev/null || "$PYTHON" -m pip install -r "$HERE/requirements-build.txt"
export PATH="$(dirname "$PYTHON"):$PATH"
"$PYTHON" "$HERE/fetch.py"
NDK="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
if [[ ! -f "$NDK/build/cmake/android.toolchain.cmake" ]]; then
  echo 'Set ANDROID_NDK_HOME to an installed Android NDK (r27 recommended).' >&2
  exit 1
fi
cmake -S "$HERE" -B "$ROOT/.cache/demucs-native/arm64" -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-23 -DANDROID_STL=c++_static \
  -DCMAKE_BUILD_TYPE=Release
cmake --build "$ROOT/.cache/demucs-native/arm64" -j "${NATIVE_JOBS:-2}"
"$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip" --strip-unneeded "$ROOT/.cache/demucs-native/arm64/libchoirdemucs.so"
DEST="$ROOT/android-choirtune/app/src/main/assets/demucs"
mkdir -p "$DEST"
cp "$ROOT/.cache/demucs-native/ggml-model-htdemucs-4s-f16.bin" "$DEST/"
"$PYTHON" "$HERE/notices.py" "$DEST/THIRD-PARTY-NOTICES.txt"
