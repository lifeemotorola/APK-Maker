#!/usr/bin/env bash
# ============================================================================
# WiFi Cam computer driver — build the standalone binary with PyInstaller.
# On Windows use build_exe.bat instead (produces WificamDriver.exe).
# This script produces a native binary (Linux/macOS), e.g. for CI smoke tests.
#
#   PYTHON=/path/to/python ./build_exe.sh     (default: python3)
#   -> dist/WificamDriver
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-python3}"
"$PY" -m pip install -r requirements.txt pyinstaller
"$PY" -m PyInstaller --clean --noconfirm wificam_driver.spec
echo
echo "DONE: dist/WificamDriver"
echo "  ./dist/WificamDriver            (auto-find the phone on WiFi, live view)"
echo "  ./dist/WificamDriver --obs      (OBS Studio setup)"
