#!/usr/bin/env python3
"""
wificam_driver.py — computer-side driver for the WiFi Cam Android APK.

Connects to the phone's MJPEG-over-HTTP stream (http://<phone-ip>:8080/stream)
and can:
  --view            show a live OpenCV window (needs opencv-python)
  --virtual-cam DEV pipe the stream into a v4l2loopback virtual camera
                    (e.g. /dev/video0) via ffmpeg — then any app (Zoom, Meet,
                    OBS) can use the phone as a webcam
  --record FILE     save the stream to a video file (via ffmpeg)
  --snapshot FILE   save one JPEG frame
  --list            just print phone /status and exit

Examples:
  python wificam_driver.py --host 192.168.1.50 --view
  python wificam_driver.py --host 192.168.1.50 --virtual-cam /dev/video0
  python wificam_driver.py --host 192.168.1.50 --record call.mp4

Virtual camera setup (Linux):
  sudo modprobe v4l2loopback exclusive_caps=1
  # creates /dev/video0 — then run with --virtual-cam /dev/video0
Windows/macOS: use the --view window and pick it as the camera in your app
(e.g. OBS virtual camera), or use a platform virtual-cam driver.
"""
import argparse
import http.client
import json
import shutil
import subprocess
import sys
import time
import urllib.parse


OBS_HELP = """OBS Studio setup with WiFi Cam (phone at {host}:{port}):

Option A - Browser source (no driver needed):
  OBS -> Sources -> + -> Browser
  URL: http://{host}:{port}/stream   (MJPEG, OBS renders it live)
  Width x Height: 1280 x 720

Option B - real virtual webcam on Linux (v4l2loopback):
  sudo modprobe v4l2loopback exclusive_caps=1
  python3 wificam_driver.py --host {host} --virtual-cam /dev/video0
  OBS -> Sources -> + -> Video Capture Device -> device /dev/video0

Option C - driver viewer window, capture the window in OBS:
  python3 wificam_driver.py --host {host} --view
  OBS -> Sources -> + -> Window Capture -> window "WiFi Cam"

The phone app shows this same URL on its screen while streaming."""


def status(host, port, timeout=5):
    conn = http.client.HTTPConnection(host, port, timeout=timeout)
    conn.request("GET", "/status")
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    return json.loads(body.decode("utf-8"))


def iter_mjpeg_frames(host, port, path="/stream", timeout=30):
    """Yield JPEG frame bytes from the multipart/x-mixed-replace stream.

    Pure-stdlib incremental parser: buffers the socket stream and splits on
    the multipart boundary, returning each part's payload.
    """
    conn = http.client.HTTPConnection(host, port, timeout=timeout)
    conn.request("GET", path, headers={"User-Agent": "wificam-driver/1.0"})
    resp = conn.getresponse()
    if resp.status != 200:
        raise RuntimeError(f"stream HTTP {resp.status}: {resp.read()[:200]!r}")
    ctype = resp.headers.get("Content-Type", "")
    boundary = None
    if "boundary=" in ctype:
        boundary = ctype.split("boundary=", 1)[1].strip().strip('"').encode()
    if boundary is None:
        boundary = b"frame"
    sep = b"--" + boundary

    def parse_part(part):
        # part = headers \r\n\r\n payload \r\n
        head, _, payload = part.partition(b"\r\n\r\n")
        payload = payload.rstrip(b"\r\n")
        if payload.startswith(b":") or not payload:
            return None  # keep-alive comment
        if b"Content-Length" in head:
            try:
                clen = int([l for l in head.split(b"\r\n") if l.lower().startswith(b"content-length")][0].split(b":")[1])
                payload = payload[:clen]
            except Exception:
                pass
        if payload[:2] == b"\xff\xd8":  # JPEG SOI
            return payload
        return None

    buf = b""
    eof = False
    while not eof:
        chunk = resp.read(65536)
        if not chunk:
            eof = True
        buf += chunk
        # extract complete parts (delimited by the NEXT boundary)
        while True:
            start = buf.find(sep)
            if start == -1:
                # keep the tail small
                if len(buf) > 1 << 20:
                    buf = buf[-65536:]
                break
            end = buf.find(sep, start + len(sep))
            if end == -1:
                break
            frame = parse_part(buf[start + len(sep):end])
            buf = buf[end:]
            if frame is not None:
                yield frame
    # end of stream: parse the trailing part (no closing boundary was sent)
    start = buf.find(sep)
    if start != -1:
        frame = parse_part(buf[start + len(sep):])
        if frame is not None:
            yield frame
    conn.close()


def cmd_view(host, port):
    try:
        import cv2
        import numpy as np
    except ImportError:
        sys.exit("opencv-python is required for --view: pip install opencv-python numpy")
    n = 0
    t0 = time.time()
    for frame in iter_mjpeg_frames(host, port):
        img = cv2.imdecode(np.frombuffer(frame, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            continue
        n += 1
        if n % 30 == 1:
            fps = n / max(1e-6, time.time() - t0)
            cv2.setWindowTitle("WiFi Cam", f"WiFi Cam — {fps:.1f} fps")
        cv2.imshow("WiFi Cam", img)
        if cv2.waitKey(1) == 27:  # ESC
            break
    cv2.destroyAllWindows()
    print(f"viewed {n} frames")


def cmd_snapshot(host, port, out):
    for frame in iter_mjpeg_frames(host, port):
        with open(out, "wb") as f:
            f.write(frame)
        print(f"saved {out} ({len(frame)} bytes)")
        return
    sys.exit("no frame received")


def _ffmpeg_base(host, port):
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg not found — install ffmpeg (apt install ffmpeg / brew install ffmpeg)")
    return ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
            "-f", "mjpeg", "-i", f"http://{host}:{port}/stream"]


def cmd_virtual_cam(host, port, dev):
    if not dev.startswith("/dev/"):
        sys.exit("virtual camera device must be like /dev/video0")
    cmd = _ffmpeg_base(host, port) + ["-c:v", "rawvideo", "-pix_fmt", "yuv420p", "-f", "v4l2", dev]
    print("piping stream to virtual camera:", " ".join(cmd))
    subprocess.run(cmd)


def cmd_record(host, port, out):
    cmd = _ffmpeg_base(host, port) + ["-c:v", "libx264", "-pix_fmt", "yuv420p", out]
    print("recording:", " ".join(cmd))
    subprocess.run(cmd)


def main():
    ap = argparse.ArgumentParser(description="WiFi Cam computer driver")
    ap.add_argument("--host", required=True, help="phone IP on the WiFi (shown in the app)")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--view", action="store_true", help="live OpenCV viewer window")
    ap.add_argument("--virtual-cam", metavar="DEV", help="pipe to a v4l2loopback device, e.g. /dev/video0")
    ap.add_argument("--record", metavar="FILE", help="record the stream to a video file")
    ap.add_argument("--snapshot", metavar="FILE", help="save one JPEG frame")
    ap.add_argument("--list", action="store_true", help="print phone status and exit")
    ap.add_argument("--obs", action="store_true",
                    help="print OBS Studio setup instructions (Browser source / v4l2loopback) and exit")
    args = ap.parse_args()

    if args.obs:
        print(OBS_HELP.format(host=args.host, port=args.port))
        return
    if args.list:
        print(json.dumps(status(args.host, args.port), indent=2))
        return
    if args.snapshot:
        cmd_snapshot(args.host, args.port, args.snapshot)
        return
    if args.virtual_cam:
        cmd_virtual_cam(args.host, args.port, args.virtual_cam)
        return
    if args.record:
        cmd_record(args.host, args.port, args.record)
        return
    if args.view:
        cmd_view(args.host, args.port)
        return
    print(OBS_HELP.format(host=args.host, port=args.port))
    ap.error("choose one of --list / --obs / --view / --virtual-cam / --record / --snapshot")


if __name__ == "__main__":
    main()
