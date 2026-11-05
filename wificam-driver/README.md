# WiFi Cam — computer driver (GUI app `WificamDriver.exe` + CLI)

Computer-side client for the **WiFi Cam** Android APK (`android-wificam/`).
The phone streams its camera as MJPEG over HTTP at `http://<phone-ip>:8080/stream`;
this driver consumes that stream on your computer.

## Option 1 — standalone executable (recommended)

**`WificamDriver.exe`** is a real Windows app, not a script window:

- **Window icon** (embedded `.ico` in the exe + title bar), Windows **version
  info** in Properties -> Details (`wificam_driver.version.txt`)
- **GUI window** (tkinter/ttk): live camera feed, host/port fields,
  **Auto-find** (scans the LAN), Connect/Disconnect, torch toggle, phone info,
  stream URL + Copy button, snapshot and record buttons, FPS + status bar
- **Menus**: File (auto-find / connect / snapshot / record / exit),
  Camera (torch, refresh status), Help (**OBS Studio setup...**, **About...**)
- Double-clicking the exe opens the GUI and auto-finds the phone; from a
  terminal the CLI flags still work (`--obs`, `--list`, `--record`, ...)

Build it (or grab the CI artifact):

- **On Windows**: run `build_exe.bat` once on that computer (Python 3.11+ from
  python.org; it pip-installs PyInstaller + Pillow and builds
  `dist\WificamDriver.exe`). CI also publishes the exe as the
  `WificamDriver-exe` artifact of the `build-wificam-driver-exe` workflow job
  (windows-latest runner).
- **Linux/macOS**: `./build_exe.sh` builds `dist/WificamDriver`.

```
WificamDriver.exe                                   <- GUI: find phone on WiFi, live feed
WificamDriver.exe --auto                            <- CLI auto-discovery + viewer
WificamDriver.exe --host 192.168.1.50 --obs         <- OBS Studio setup steps
WificamDriver.exe --host 192.168.1.50 --list        <- phone status JSON
WificamDriver.exe --host 192.168.1.50 --record out.mp4
WificamDriver.exe --host 192.168.1.50 --snapshot frame.jpg
WificamDriver.exe --version
```

The viewer inside the exe uses Pillow + tkinter (bundled). With
`opencv-python` installed it uses OpenCV instead.

## Option 2 — run from source

```bash
pip install -r requirements.txt      # Pillow for the bundled viewer
# optional, heavier viewer: pip install opencv-python numpy
# --record / --virtual-cam also need ffmpeg on the PATH
python3 wificam_driver.py            # GUI (same window as the exe)
python3 wificam_driver.py --host 192.168.1.50 --list
python3 wificam_driver.py --host 192.168.1.50 --view
python3 wificam_driver.py --host 192.168.1.50 --record call.mp4
```

The phone IP is shown on the phone's screen (bottom bar) while the app runs.
Both devices must be on the same WiFi network. `--auto` scans the LAN for a
device answering on port 8080.

## Not connecting? (troubleshooting)

Run the built-in diagnosis first:

```
WificamDriver.exe --diag 192.168.1.50        (or: Help -> Diagnose connection... in the GUI)
```

It checks, step by step: is `http://<phone-ip>:8080/status` reachable, is the
camera streaming, does `/stream` answer with MJPEG. Common causes:

1. **Different networks** — phone and PC must be on the same WiFi. The IP to
   use is the one shown on the phone screen (the app prefers the WiFi IP;
   `/status` also returns all phone IPs in `"ips"`).
2. **Router "AP isolation" / guest WiFi** blocks device-to-device traffic.
   Fix: enable the **phone's hotspot** and connect the PC to it (then the phone
   is usually 192.168.43.1 — auto-discovery covers that subnet), or use a
   normal home WiFi.
3. **Camera permission not granted on the phone** — `/status` answers but
   `streaming:false`. Open the WiFi Cam app and allow the camera.
4. **Wrong/stale IP** (DHCP changed) — press **Auto-find** in the GUI.
5. Quick manual check from a PC browser: `http://<phone-ip>:8080/status` should
   print JSON, and `http://<phone-ip>:8080/stream` should show a moving image.
6. **Timeout (not refused) to the phone's IP** usually means the app is closed on
   the phone, the IP is stale, or the router drops device-to-device traffic.
   `--diag` then runs a LAN scan and lists any WiFi Cam server it finds (use that
   IP), and reports whether a USB fallback is available.
7. **USB fallback that always works** (no WiFi needed): connect the phone by USB,
   enable USB debugging, install platform-tools on the PC, then:
   `WificamDriver.exe --adb` (or the **Connect via USB (adb)** button in the GUI)
   — it runs `adb forward tcp:8080 tcp:8080` and talks to the phone via 127.0.0.1.

## Using the phone camera in OBS Studio

The phone app opens like a normal camera (live preview on the phone) and
streams at `http://<phone-ip>:8080/stream`. In OBS pick one (also shown by
Help -> OBS Studio setup in the app, or `--obs`):

- **Browser source** (any OS, easiest): Sources -> + -> Browser, URL =
  `http://<phone-ip>:8080/stream` (MJPEG renders live in OBS).
- **Video Capture Device** (real webcam, Linux): `sudo modprobe v4l2loopback
  exclusive_caps=1`, then `python3 wificam_driver.py --host <phone-ip>
  --virtual-cam /dev/video0`, then in OBS add a Video Capture Device on
  `/dev/video0`.
- **Window Capture**: run the driver (GUI or `--view`) and capture the
  "WiFi Cam Driver" window.

## Files

```
wificam_driver.py            # GUI app (WifiCamApp) + CLI modes
app.ico                      # Windows icon (exe resource + window icon)
wificam_driver.spec          # PyInstaller spec (icon, version resource, datas)
wificam_driver.version.txt   # Windows version resource (exe Properties)
build_exe.bat                # Windows build script -> dist\WificamDriver.exe
build_exe.sh                 # Linux/macOS build script -> dist/WificamDriver
requirements.txt             # Pillow (cv2 optional)
test_driver.py               # stdlib tests: MJPEG parser, discovery, GUI/packaging checks
```

## Test

```bash
python3 test_driver.py     # stdlib-only: synthetic MJPEG stream -> parser, /status, discovery, packaging checks
python3 -m py_compile wificam_driver.py test_driver.py wificam_driver.spec
```
