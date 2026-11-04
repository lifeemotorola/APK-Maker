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

# 2a. live viewer window (pick "WiFi Cam" as camera in apps that support screen capture)
python3 wificam_driver.py --host 192.168.1.50 --view

# 2b. real virtual webcam on Linux (v4l2loopback): every app then sees /dev/video0
sudo modprobe v4l2loopback exclusive_caps=1     # creates /dev/video0
python3 wificam_driver.py --host 192.168.1.50 --virtual-cam /dev/video0

# 2c. record / snapshot
python3 wificam_driver.py --host 192.168.1.50 --record call.mp4
python3 wificam_driver.py --host 192.168.1.50 --snapshot frame.jpg
```

The phone IP is shown in the app (Stream URL card). Both devices must be on
the same WiFi network.

## Test

```bash
python3 test_driver.py     # stdlib-only: synthetic MJPEG stream -> parser checks
python3 -m py_compile wificam_driver.py test_driver.py
```
