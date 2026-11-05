# WiFi Cam — computer driver (Python CLI + standalone `WificamDriver.exe`)

Computer-side client for the **WiFi Cam** Android APK (`android-wificam/`).
The phone streams its camera as MJPEG over HTTP at `http://<phone-ip>:8080/stream`;
this driver consumes that stream on your computer.

## Option 1 — standalone executable (recommended)

Build (or grab) **`WificamDriver.exe`** — a single double-clickable file, no
Python install needed on the computer:

- **On Windows**: run `build_exe.bat` once on that computer (needs Python 3.11+
  from python.org; it pip-installs PyInstaller + Pillow and builds
  `dist\WificamDriver.exe`). CI also publishes the exe as the
  `WificamDriver-exe` artifact of the `build-wificam-driver-exe` workflow job.
- **Linux/macOS**: `./build_exe.sh` builds `dist/WificamDriver` the same way.

Then:

```
WificamDriver.exe                                   <- double-click: finds the phone on the WiFi and shows the live feed
WificamDriver.exe --auto                            <- same, explicit
WificamDriver.exe --host 192.168.1.50 --obs         <- OBS Studio setup steps
WificamDriver.exe --host 192.168.1.50 --list        <- phone status JSON
WificamDriver.exe --host 192.168.1.50 --record out.mp4
WificamDriver.exe --host 192.168.1.50 --snapshot frame.jpg
```

The viewer inside the exe uses Pillow + tkinter (bundled). With
`opencv-python` installed it uses OpenCV instead.

## Option 2 — run from source

```bash
pip install -r requirements.txt      # Pillow for the bundled viewer
# optional, heavier viewer: pip install opencv-python numpy
# --record / --virtual-cam also need ffmpeg on the PATH
python3 wificam_driver.py --host 192.168.1.50 --list
python3 wificam_driver.py --host 192.168.1.50 --view
python3 wificam_driver.py --host 192.168.1.50 --record call.mp4
python3 wificam_driver.py --host 192.168.1.50 --snapshot frame.jpg
```

The phone IP is shown on the phone's screen (bottom bar) while the app runs.
Both devices must be on the same WiFi network. `--auto` scans the LAN for a
device answering on port 8080.

## Using the phone camera in OBS Studio

The phone app opens like a normal camera (live preview on the phone) and
streams at `http://<phone-ip>:8080/stream`. In OBS pick one:

- **Browser source** (any OS, easiest): Sources -> + -> Browser, URL =
  `http://<phone-ip>:8080/stream` (MJPEG renders live in OBS).
- **Video Capture Device** (real webcam, Linux): `sudo modprobe v4l2loopback
  exclusive_caps=1`, then `python3 wificam_driver.py --host <phone-ip>
  --virtual-cam /dev/video0`, then in OBS add a Video Capture Device on
  `/dev/video0`.
- **Window Capture**: run the driver with `--view` and capture the "WiFi Cam"
  window.

`--obs` prints these steps from the driver itself.

## Test

```bash
python3 test_driver.py     # stdlib-only: synthetic MJPEG stream -> parser, discovery, packaging checks
python3 -m py_compile wificam_driver.py test_driver.py
```
