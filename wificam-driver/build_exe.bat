@echo off
rem ==========================================================================
rem  WiFi Cam computer driver - build the standalone WificamDriver.exe
rem  Run this on the Windows computer (Python 3.11+ from python.org):
rem
rem      build_exe.bat
rem
rem  Produces:  dist\WificamDriver.exe  (GUI app: window icon + version info,
rem             live camera feed, menus, OBS help, auto-find phone on WiFi)
rem
rem  Use it:
rem      dist\WificamDriver.exe                          (double-click: GUI, auto-find phone)
rem      dist\WificamDriver.exe --obs                   (OBS Studio setup, console)
rem      dist\WificamDriver.exe --host 192.168.1.50 --list
rem      dist\WificamDriver.exe --host 192.168.1.50 --record out.mp4
rem ==========================================================================
setlocal
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher "py" not found. Install Python 3.11+ from python.org and re-run.
  exit /b 1
)
py -m pip install --upgrade pip
py -m pip install -r requirements.txt pyinstaller
py -m PyInstaller --clean --noconfirm wificam_driver.spec
if errorlevel 1 exit /b 1
echo.
echo DONE: dist\WificamDriver.exe   (double-click it to open the app)
endlocal
pause
