# WiFi Cam — computer driver

Computer-side client for the **WiFi Cam** Android APK (`android-wificam/`).
The phone streams its camera as MJPEG over HTTP at `http://<phone-ip>:8080/stream`;
this driver consumes that stream on your computer.

## Install

```bash
pip install -r requirements.txt   # only needed for --view (opencv + numpy)
# --record / --virtual-cam also need ffmpeg on the PATH
```

## Use

```bash
# 1. see the phone status
python3 wificam_driver.py --host 192.168.1.50 --list

# 2a. live viewer window on the computer (what OBS can capture, or just watch)
python3 wificam_driver.py --host 192.168.1.50 --view

# 2b. real virtual webcam on Linux (v4l2loopback): every app then sees /dev/video0
sudo modprobe v4l2loopback exclusive_caps=1     # creates /dev/video0
python3 wificam_driver.py --host 192.168.1.50 --virtual-cam /dev/video0

# 2c. record / snapshot
python3 wificam_driver.py --host 192.168.1.50 --record call.mp4
python3 wificam_driver.py --host 192.168.1.50 --snapshot frame.jpg

# 3. print the OBS Studio setup steps
python3 wificam_driver.py --host 192.168.1.50 --obs
```

The phone IP is shown on the phone's screen (bottom bar) while the app runs.
Both devices must be on the same WiFi network.

## Using the phone camera in OBS Studio

The phone app opens like a normal camera (live preview on the phone) and
streams at `http://<phone-ip>:8080/stream`. In OBS pick one:

- **Browser source**: Sources -> + -> Browser, URL = `http://<phone-ip>:8080/stream`
  (MJPEG renders live in OBS).
- **Video Capture Device** (real webcam, Linux): `sudo modprobe v4l2loopback
  exclusive_caps=1`, then `python3 wificam_driver.py --host <phone-ip>
  --virtual-cam /dev/video0`, then in OBS add a Video Capture Device on
  `/dev/video0`.
- **Window Capture**: run `--view` and capture the "WiFi Cam" window.

## Test

```bash
python3 test_driver.py     # stdlib-only: synthetic MJPEG stream -> parser checks
python3 -m py_compile wificam_driver.py test_driver.py
```
