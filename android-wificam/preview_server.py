#!/usr/bin/env python3
"""preview_server.py — local dev preview of the WiFi Cam control page.

Serves android-wificam/web/ and simulates the phone side so the page can be
exercised in a browser without a device:

  /            control page (index.html, app.js, styles.css, img/)
  /status      JSON status (toggled by /api/start|stop), incl. fps/frames/bytes
  /api/*       stub control endpoints (start/stop/torch/quality/zoom/wb/...)
  /snapshot.jpg  latest simulated frame
  /stream      synthetic MJPEG stream (multipart/x-mixed-replace, boundary=frame)
               — PIL draws a moving test pattern with a timestamp if Pillow is
               installed, otherwise a static fake JPEG is repeated

Run:  python3 android-wificam/preview_server.py [port]     (default 8090)
      bind 0.0.0.0 so it is reachable through the sandbox preview proxy.
"""
import http.server
import io
import json
import socketserver
import struct
import sys
import threading
import time
from pathlib import Path

WEB = Path(__file__).parent / "web"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090

STATE = {
    "streaming": False,
    "cam": "back",
    "w": 640, "h": 480, "fps": 10,
    "torch": False, "quality": 90, "zoom": 1.0, "wb": "auto",
    "night": False, "grid": False, "watermark": True, "mirror": False,
    "stabilization": False,
    "frames": 0, "bytes": 0, "started": time.time(), "clients": 0,
}
LOCK = threading.Lock()

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

FONT = ImageFont.load_default() if HAS_PIL else None


def make_frame(i):
    """One synthetic 'camera' frame: gradient + moving box + timestamp."""
    if not HAS_PIL:
        return b"\xff\xd8" + struct.pack(">I", i) + b"SIMULATED-FRAME" + bytes([i % 256]) * 200 + b"\xff\xd9"
    w, h = STATE["w"], STATE["h"]
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(0, h, 8):
        d.line([(0, y), (w, y)], fill=(10 + y * 60 // h, 30 + y * 80 // h, 60 + y * 100 // h))
    x = (i * 7) % max(1, w - 80)
    d.rectangle([x, h // 3, x + 80, h // 3 + 60], outline=(240, 240, 240), width=3)
    d.ellipse([w // 2 - 30, h // 2 - 30, w // 2 + 30, h // 2 + 30], outline=(34, 211, 238), width=3)
    label = f"WiFi Cam PREVIEW (simulated)  {time.strftime('%H:%M:%S')}  frame {i}  {w}x{h}@{STATE['fps']}"
    if STATE["watermark"]:
        d.rectangle([4, h - 22, 4 + 8 * len(label), h - 4], fill=(0, 0, 0))
        d.text((8, h - 20), label, fill=(240, 240, 240), font=FONT)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=STATE["quality"])
    return buf.getvalue()


def status_json():
    with LOCK:
        s = dict(STATE)
    up = max(0.001, time.time() - s["started"])
    return {
        "ip": "127.0.0.1 (preview sim)",
        "ips": ["127.0.0.1"],
        "port": PORT,
        "streaming": s["streaming"],
        "info": f"{s['w']}x{s['h']}@{s['fps']} cam={s['cam']} q={s['quality']} zoom={s['zoom']:.1f} wb={s['wb']}",
        "clients": s["clients"],
        "clientIps": ["127.0.0.1"],
        "fps": round(s["frames"] / up, 1) if s["streaming"] else 0,
        "frames": s["frames"], "bytes": s["bytes"], "uptimeMs": int(up * 1000),
    }


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _q(self, key, default=None):
        if "?" not in self.path:
            return default
        for pair in self.path.split("?", 1)[1].split("&"):
            if "=" in pair and pair.split("=", 1)[0] == key:
                return pair.split("=", 1)[1]
        return default

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/status":
            self._json(status_json())
            return
        if path == "/snapshot.jpg":
            with LOCK:
                f = make_frame(STATE["frames"])
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(f)))
            self.end_headers()
            self.wfile.write(f)
            return
        if path == "/stream":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with LOCK:
                STATE["clients"] += 1
            try:
                i = 0
                while True:
                    with LOCK:
                        on = STATE["streaming"]
                        if on:
                            STATE["frames"] += 1
                    if not on:
                        time.sleep(0.5)
                        self.wfile.write(b": ping\r\n\r\n")
                        self.wfile.flush()
                        continue
                    frame = make_frame(i)
                    with LOCK:
                        STATE["bytes"] += len(frame)
                    part = (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                            + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n")
                    self.wfile.write(part)
                    self.wfile.flush()
                    i += 1
                    time.sleep(1.0 / max(1, STATE["fps"]))
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                with LOCK:
                    STATE["clients"] -= 1
            return
        if path.startswith("/api/"):
            name = path[len("/api/"):]
            with LOCK:
                if name == "start":
                    STATE["streaming"] = True
                    STATE["cam"] = self._q("cam", "back") or "back"
                    STATE["w"] = int(self._q("w", 640) or 640)
                    STATE["h"] = int(self._q("h", 480) or 480)
                    STATE["fps"] = int(self._q("fps", 10) or 10)
                    STATE["started"] = time.time()
                    STATE["frames"] = 0
                    STATE["bytes"] = 0
                    self._json({"ok": True, "permission": True, "streaming": True})
                elif name == "stop":
                    STATE["streaming"] = False
                    self._json({"ok": True})
                elif name == "sizes":
                    self._json({"sizes": [[640, 480], [1280, 720], [1920, 1080]]})
                elif name == "torch":
                    STATE["torch"] = self._q("on") == "1"
                    self._json({"ok": True, "torch": STATE["torch"]})
                elif name == "quality":
                    STATE["quality"] = max(1, min(100, int(self._q("q", 90) or 90)))
                    self._json({"ok": True, "quality": STATE["quality"]})
                elif name == "zoom":
                    STATE["zoom"] = max(1.0, min(4.0, float(self._q("level", 1) or 1)))
                    self._json({"ok": True, "zoom": STATE["zoom"]})
                elif name == "wb":
                    STATE["wb"] = self._q("mode", "auto") or "auto"
                    self._json({"ok": True, "wb": STATE["wb"]})
                elif name in ("night", "grid", "watermark", "mirror", "stabilization"):
                    STATE[name] = self._q("on") == "1"
                    self._json({"ok": True, name: STATE[name]})
                else:
                    self._json({"ok": True})
            return
        # static files from web/
        if path == "/":
            path = "/index.html"
        f = WEB / path.lstrip("/")
        if not f.is_file() or ".." in path:
            self.send_response(404)
            self.end_headers()
            return
        ctype = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".png": "image/png"}.get(f.suffix, "application/octet-stream")
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as srv:
        print(f"WiFi Cam preview (simulated phone) on http://0.0.0.0:{PORT}/  — Ctrl+C to stop")
        srv.serve_forever()
