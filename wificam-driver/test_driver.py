#!/usr/bin/env python3
"""test_driver.py — stdlib-only test for the WiFi Cam computer driver.

Spins a local HTTP server that emits a synthetic multipart/x-mixed-replace
MJPEG stream (fake JPEG payloads with valid SOI/EOI markers) and verifies that
wificam_driver.iter_mjpeg_frames parses exactly the sent frames.

Run: python3 test_driver.py   (also run in CI)
"""
import http.server
import socketserver
import struct
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from wificam_driver import iter_mjpeg_frames, status  # noqa: E402


def fake_jpeg(i: int) -> bytes:
    return b"\xff\xd8" + struct.pack(">I", i) + b"FAKEFRAME" + bytes([i % 256]) * 64 + b"\xff\xd9"


N_FRAMES = 12
BOUNDARY = b"frame"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/status"):
            body = b'{"ip":"10.0.0.5","port":8080,"streaming":true,"info":"640x480@15","clients":1}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/stream"):
            self.send_response(200)
            self.send_header("Content-Type",
                             "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            for i in range(N_FRAMES):
                payload = fake_jpeg(i)
                part = (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                        + str(len(payload)).encode() + b"\r\n\r\n" + payload + b"\r\n")
                self.wfile.write(part)
                self.wfile.flush()
                time.sleep(0.01)
            return
        self.send_response(404)
        self.end_headers()


def main():
    with socketserver.TCPServer(("127.0.0.1", 0), Handler) as srv:
        port = srv.server_address[1]
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            st = status("127.0.0.1", port)
            assert st["streaming"] is True and st["port"] == 8080, st
            print("ok: /status parsed:", st)

            frames = list(iter_mjpeg_frames("127.0.0.1", port))
            assert len(frames) == N_FRAMES, f"expected {N_FRAMES} frames, got {len(frames)}"
            for i, f in enumerate(frames):
                assert f[:2] == b"\xff\xd8" and f[-2:] == b"\xff\xd9", "bad JPEG markers"
                assert struct.unpack(">I", f[2:6])[0] == i, "frame order wrong"
            print(f"ok: parsed {len(frames)} MJPEG frames in order with valid markers")
        finally:
            srv.shutdown()
    print("\nWIFICAM DRIVER TEST: ALL PASSED")


if __name__ == "__main__":
    main()
