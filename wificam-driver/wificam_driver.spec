# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for the standalone WiFi Cam computer driver.
# Build:  python -m PyInstaller --clean --noconfirm wificam_driver.spec
# Output: dist/WificamDriver.exe   (Windows, via build_exe.bat)
#         dist/WificamDriver      (Linux/macOS, via build_exe.sh — smoke test)
#
# One-file, console app (so --obs / --list / errors print visibly).
# cv2/numpy are excluded on purpose: the bundled viewer falls back to
# Pillow + tkinter, which keeps the .exe small and double-click friendly.
a = Analysis(
    ['wificam_driver.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=['PIL', 'PIL.Image', 'PIL.ImageTk'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['cv2', 'numpy'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='WificamDriver',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
