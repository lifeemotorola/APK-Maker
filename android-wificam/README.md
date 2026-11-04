# WiFi Cam (Android APK) + computer driver

Turns an Android phone into a **webcam for your computer over WiFi**.

- **APK** (`com.wificam.app`, built by `android-wificam/build.sh`): a LAN HTTP
  server on `0.0.0.0:8080` serves a control page and streams the phone camera
  as **MJPEG** at `http://<phone-ip>:8080/stream`. Capture uses Camera2 with a
  JPEG `ImageReader` (no YUV conversion), FPS/resolution/camera (back/front)
  and torch are controllable, and a foreground service keeps streaming with
  the screen off. Runtime permissions: CAMERA (+ POST_NOTIFICATIONS on 33+).
- **Computer driver** (`../wificam-driver/wificam_driver.py`): connects to the
  stream from your PC — live viewer (`--view`), **virtual camera** via
  v4l2loopback (`--virtual-cam /dev/video0`, Linux), recording (`--record`),
  snapshots, and phone status (`--list`).

## Use

1. Install `Wificam.apk` on the phone, connect both devices to the same WiFi.
2. Open the app, press **Start streaming** (grant camera), note the stream URL.
3. On the computer:

   ```bash
   cd wificam-driver
   pip install -r requirements.txt        # only for --view
   python3 wificam_driver.py --host <phone-ip> --list
   python3 wificam_driver.py --host <phone-ip> --view                 # live window
   sudo modprobe v4l2loopback exclusive_caps=1
   python3 wificam_driver.py --host <phone-ip> --virtual-cam /dev/video0   # real webcam
   ```

## Layout

```
android-wificam/
  build.sh                  # offline APK build pipeline (6 steps)
  app/src/main/AndroidManifest.xml   # CAMERA/INTERNET/FOREGROUND_SERVICE_CAMERA...
  app/src/main/java/com/wificam/app/
    MainActivity.java       # WebView shell + runtime camera permission
    LanServer.java          # 0.0.0.0:8080 HTTP: www UI + /stream MJPEG + /status
    CameraController.java   # Camera2 JPEG capture loop -> FrameBus
    FrameBus.java           # latest-frame bus (wait/notify)
    CameraService.java      # foreground "streaming" notification service
    NativeBridge.java       # window.WifiCam: getStreamUrl/startCamera/stop/torch
  web/                      # control page (preview, URL, start/stop, res/fps/torch)
wificam-driver/
  wificam_driver.py         # computer driver: view / virtual-cam / record / snapshot
  test_driver.py            # stdlib MJPEG parser test (runs in CI)
  requirements.txt          # opencv+numpy for --view
```
