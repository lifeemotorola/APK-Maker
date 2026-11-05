@echo off
rem ==========================================================================
rem  WiFi Cam computer driver - build the standalone WificamDriver.exe
rem  Run this on the Windows computer (Python 3.11+ from python.org):
rem
rem      build_exe.bat
rem
rem  Produces:  dist\WificamDriver.exe
rem
rem  Use it:
rem      dist\WificamDriver.exe                          (find phone, live view)
rem      dist\WificamDriver.exe --host 192.168.1.50 --obs
rem      dist\WificamDriver.exe --host 192.168.1.50 --record out.mp4
rem      dist\WificamDriver.exe --host 192.168.1.50 --snapshot frame.jpg
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
echo DONE: dist\WificamDriver.exe
echo   dist\WificamDriver.exe            (auto-find the phone on WiFi, live view)
echo   dist\WificamDriver.exe --obs      (OBS Studio setup)
endlocal
pause
