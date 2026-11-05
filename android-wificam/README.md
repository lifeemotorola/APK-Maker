# WiFi Cam (Android APK) + computer driver

Turns an Android phone into a **webcam for your computer over WiFi**, ready for
**OBS Studio**.

- **APK** (`com.wificam.app`, built by `android-wificam/build.sh`): opens like a
  normal camera app — full-screen live preview starts automatically. At the
  same time a LAN HTTP server on `0.0.0.0:8080` streams the camera as
  **MJPEG** at `http://<phone-ip>:8080/stream`. Capture uses Camera2 with a
  JPEG `ImageReader` (the preview surface is a second capture target), with
  flip-camera and torch buttons, a foreground service (screen off), and
  runtime CAMERA permission. The server also exposes `/status` (JSON) and
  `/api/start|stop|torch` (remote control from any browser on the LAN) plus a
  small bundled control page at `/`.
- **Computer driver** (`../wificam-driver/wificam_driver.py`): connects to the
  stream from your PC — `--list` status, `--view` live viewer window,
  `--virtual-cam /dev/video0` (v4l2loopback, Linux webcam), `--record`,
  `--snapshot`, and `--obs` (prints OBS Studio setup steps).

## Use

1. Install `Wificam.apk` on the phone, connect both devices to the same WiFi.
2. Open the app — grant camera — the preview starts and the screen shows the
   stream URL, e.g. `http://192.168.1.50:8080/stream`.
3. In **OBS Studio** on the computer, pick one:
   - **Browser source**: URL = the stream URL (MJPEG renders live), or
   - **Video Capture Device**: first run
     `python3 wificam_driver.py --host 192.168.1.50 --virtual-cam /dev/video0`
     (after `sudo modprobe v4l2loopback exclusive_caps=1`), then pick
     `/dev/video0` in OBS, or
   - **Window Capture**: run `python3 wificam_driver.py --host 192.168.1.50 --view`
     and capture the "WiFi Cam" window.
   `python3 wificam_driver.py --host 192.168.1.50 --obs` prints these steps.

## Not connecting from the PC?

- Both devices must be on the **same WiFi**; if the router blocks
  device-to-device traffic (guest WiFi / AP isolation), connect the PC to the
  **phone's hotspot** instead.
- The URL shown on the phone uses the phone's **WiFi IP** (not the hotspot IP);
  `http://<phone-ip>:8080/status` returns all phone IPs in `"ips"`.
- From the PC browser, `http://<phone-ip>:8080/status` must print JSON and
  `http://<phone-ip>:8080/stream` must show the moving preview.
- On the PC: `WificamDriver.exe --diag <phone-ip>` (or Help -> Diagnose...) runs
  a step-by-step connection check.

## Layout

```
android-wificam/
  build.sh                  # offline APK build pipeline (6 steps)
  app/src/main/AndroidManifest.xml   # CAMERA/INTERNET/FOREGROUND_SERVICE_CAMERA...
  app/src/main/java/com/wificam/app/
    MainActivity.java       # native full-screen camera preview + overlay controls (auto-start)
    LanServer.java          # 0.0.0.0:8080 HTTP: www UI + /stream MJPEG + /status + /api/*
    CameraController.java   # Camera2: preview surface + JPEG ImageReader -> FrameBus
    FrameBus.java           # latest-frame bus (wait/notify)
    CameraHolder.java       # shared start/stop helpers (activity + /api + service)
    CameraService.java      # foreground "streaming" notification service
  web/                      # optional browser control page (preview, URL, start/stop, torch)
wificam-driver/
  wificam_driver.py         # computer driver: list/obs/view/virtual-cam/record/snapshot
  test_driver.py            # stdlib MJPEG parser test (runs in CI)
  requirements.txt          # opencv+numpy for --view
```
