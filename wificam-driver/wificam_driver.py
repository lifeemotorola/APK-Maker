#!/usr/bin/env python3
"""
wificam_driver.py — computer-side driver for the WiFi Cam Android APK.

Connects to the phone's MJPEG-over-HTTP stream (http://<phone-ip>:8080/stream)
and can:
  --auto            discover the phone on the LAN automatically, then --view
  --view            show a live window on the computer (OpenCV if installed,
                    otherwise the bundled Pillow/tkinter viewer)
  --virtual-cam DEV pipe the stream into a v4l2loopback virtual camera
                    (e.g. /dev/video0, Linux) via ffmpeg — then any app
                    (Zoom, Meet, OBS) can use the phone as a webcam
  --record FILE     save the stream to a video file (via ffmpeg)
  --snapshot FILE   save one JPEG frame
  --list            just print phone /status and exit
  --obs             print OBS Studio setup instructions and exit

Run with NO arguments (e.g. double-clicking WificamDriver.exe): auto-discover
the phone and open the live viewer.

Examples:
  WificamDriver.exe                                  (auto-find phone, live view)
  python3 wificam_driver.py --host 192.168.1.50 --view
  python3 wificam_driver.py --host 192.168.1.50 --obs
  python3 wificam_driver.py --host 192.168.1.50 --virtual-cam /dev/video0
  python3 wificam_driver.py --host 192.168.1.50 --record call.mp4

Build the standalone Windows executable with build_exe.bat (PyInstaller):
  dist/WificamDriver.exe

Virtual camera setup (Linux):
  sudo modprobe v4l2loopback exclusive_caps=1
  # creates /dev/video0 — then run with --virtual-cam /dev/video0
OBS Studio on any OS: add a Browser source with http://<phone-ip>:8080/stream
(see --obs for all options).
"""
import argparse
import concurrent.futures
import http.client
import io
import json
import shutil
import socket
import subprocess
import sys
import time

OBS_HELP = """OBS Studio setup with WiFi Cam (phone at {host}:{port}):

Option A - Browser source (no driver needed, works on Windows/macOS/Linux):
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


def discover_phone(port=8080, timeout=0.6):
    """Probe the local subnet(s) for a WiFi Cam phone (port 8080 /status).

    Returns the phone IP or None. Pure stdlib; a /24 scan with 64 workers
    takes well under a second on a normal LAN.
    """
    candidates = {"127.0.0.1"}
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))  # no traffic is sent; just picks the interface
            ip = s.getsockname()[0]
        finally:
            s.close()
        base = ".".join(ip.split(".")[:3])
        candidates.update(f"{base}.{i}" for i in range(1, 255))
    except Exception:
        pass
    for base in ("192.168.1", "192.168.0", "10.0.0"):
        candidates.update(f"{base}.{i}" for i in range(1, 255))

    def probe(h):
        try:
            st = status(h, port, timeout=timeout)
            if st.get("streaming"):
                return h
        except Exception:
            return None
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=64) as ex:
        for r in ex.map(probe, sorted(candidates)):
            if r:
                return r
    return None


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


def _view_cv2(host, port):
    import cv2
    import numpy as np
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


def _view_tk(host, port):
    """Fallback viewer bundled into the .exe: tkinter + Pillow (stdlib GUI)."""
    import queue
    import threading
    import tkinter as tk
    from PIL import Image, ImageTk

    q = queue.Queue(maxsize=2)

    def reader():
        try:
            for frame in iter_mjpeg_frames(host, port):
                try:
                    q.put_nowait(frame)
                except queue.Full:
                    pass
        except Exception:
            pass

    threading.Thread(target=reader, daemon=True).start()
    root = tk.Tk()
    root.title(f"WiFi Cam — http://{host}:{port}/stream (close window to quit)")
    label = tk.Label(root, bg="black")
    label.pack()

    def poll():
        try:
            while True:
                frame = q.get_nowait()
                img = Image.open(io.BytesIO(frame))
                img.thumbnail((960, 720))
                photo = ImageTk.PhotoImage(img)
                label.configure(image=photo)
                label.image = photo
        except queue.Empty:
            pass
        root.after(33, poll)

    poll()
    root.mainloop()


def cmd_view(host, port):
    try:
        _view_cv2(host, port)
        return
    except ImportError:
        pass
    try:
        _view_tk(host, port)
        return
    except ImportError:
        pass
    sys.exit("no viewer available: pip install opencv-python numpy  (or Pillow) — "
             f"or use OBS Browser source: http://{host}:{port}/stream")


def cmd_snapshot(host, port, out):
    for frame in iter_mjpeg_frames(host, port):
        with open(out, "wb") as f:
            f.write(frame)
        print(f"saved {out} ({len(frame)} bytes)")
        return
    sys.exit("no frame received")


def _ffmpeg_base(host, port):
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg not found — install ffmpeg (apt install ffmpeg / brew install ffmpeg / winget install ffmpeg)")
    return ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
            "-f", "mjpeg", "-i", f"http://{host}:{port}/stream"]


def cmd_virtual_cam(host, port, dev):
    if not dev.startswith("/dev/"):
        sys.exit("virtual camera device must be like /dev/video0 (Linux v4l2loopback). "
                 "On Windows/macOS use OBS Browser source with the stream URL instead (see --obs)")
    cmd = _ffmpeg_base(host, port) + ["-c:v", "rawvideo", "-pix_fmt", "yuv420p", "-f", "v4l2", dev]
    print("piping stream to virtual camera:", " ".join(cmd))
    subprocess.run(cmd)


def cmd_record(host, port, out):
    cmd = _ffmpeg_base(host, port) + ["-c:v", "libx264", "-pix_fmt", "yuv420p", out]
    print("recording:", " ".join(cmd))
    subprocess.run(cmd)


def main():
    ap = argparse.ArgumentParser(
        description="WiFi Cam computer driver (standalone exe or python). "
                    "No arguments = auto-discover the phone on the LAN and show the live feed.",
        epilog="OBS Studio: run with --obs to print setup instructions.")
    ap.add_argument("--host", help="phone IP on the WiFi (shown on the phone screen); omit with --auto")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--auto", action="store_true",
                    help="auto-discover the phone on the LAN (probes port 8080 /status)")
    ap.add_argument("--view", action="store_true", help="live viewer window on this computer")
    ap.add_argument("--virtual-cam", metavar="DEV", help="pipe to a v4l2loopback device, e.g. /dev/video0 (Linux)")
    ap.add_argument("--record", metavar="FILE", help="record the stream to a video file")
    ap.add_argument("--snapshot", metavar="FILE", help="save one JPEG frame")
    ap.add_argument("--list", action="store_true", help="print phone status and exit")
    ap.add_argument("--obs", action="store_true",
                    help="print OBS Studio setup instructions (Browser source / v4l2loopback) and exit")
    args = ap.parse_args()

    # double-click UX: no arguments at all -> find the phone and show the feed
    no_input = not any([args.host, args.auto, args.view, args.virtual_cam,
                        args.record, args.snapshot, args.list, args.obs])
    if no_input:
        args.auto = True
        args.view = True

    if args.auto or not args.host:
        host = args.host or discover_phone(args.port)
        if host is None:
            print(f"no WiFi Cam phone found on the LAN (port {args.port}, /status streaming=true)")
            print(OBS_HELP.format(host="<phone-ip>", port=args.port))
            ap.error("pass --host <phone-ip>, or start streaming in the phone app first")
        args.host = host
        print("phone found at", args.host)

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
    ap.error("choose one of --obs / --view / --virtual-cam / --record / --snapshot / --list (or no arguments to auto-view)")


if __name__ == "__main__":
    main()
