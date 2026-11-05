#!/usr/bin/env python3
"""test_driver.py — stdlib-only tests for the WiFi Cam computer driver.

1. Synthetic multipart/x-mixed-replace MJPEG stream -> parser must yield
   exactly the sent frames, in order, with valid JPEG markers.
2. /status JSON parsing.
3. --auto LAN discovery finds the test server.
4. GUI/packaging static checks: app.ico, version resource, PyInstaller spec,
   GUI class + menus + help in the driver source.

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
from wificam_driver import (VERSION, adb_info, diagnose, diagnose_full, discover_phone,  # noqa: E402
                         discover_phones, iter_mjpeg_frames, local_ipv4s, status, tcp_check)

HERE = Path(__file__).parent


def fake_jpeg(i: int) -> bytes:
    return b"\xff\xd8" + struct.pack(">I", i) + b"FAKEFRAME" + bytes([i % 256]) * 64 + b"\xff\xd9"


N_FRAMES = 12


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/status"):
            body = ('{"ip":"10.0.0.5","port":%d,"streaming":true,"info":"640x480@15","clients":1}' % self.server.server_address[1]).encode()
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
            assert st["streaming"] is True and st["port"] == port, st
            print("ok: /status parsed:", st)

            frames = list(iter_mjpeg_frames("127.0.0.1", port))
            assert len(frames) == N_FRAMES, f"expected {N_FRAMES} frames, got {len(frames)}"
            for i, f in enumerate(frames):
                assert f[:2] == b"\xff\xd8" and f[-2:] == b"\xff\xd9", "bad JPEG markers"
                assert struct.unpack(">I", f[2:6])[0] == i, "frame order wrong"
            print(f"ok: parsed {len(frames)} MJPEG frames in order with valid markers")

            phones = discover_phones(port=port)
            assert "127.0.0.1" in phones, f"discovery should find the test server, got {phones!r}"
            assert discover_phone(port=port) is not None
            print("ok: --auto LAN discovery found the phone(s):", phones)

            steps = diagnose("127.0.0.1", port)
            assert steps and steps[0][0] is True, steps
            assert any("streaming" in m for _, m in steps), steps
            assert any("/stream" in m for _, m in steps), steps
            print("ok: --diag diagnose() reports TCP + /status + streaming + /stream:", len(steps), "steps")

            ok, err = tcp_check("127.0.0.1", port)
            assert ok, err
            ok2, err2 = tcp_check("127.0.0.1", 1, timeout=1)
            assert not ok2
            print("ok: tcp_check distinguishes open vs closed port")

            steps_full, all_ok = diagnose_full("127.0.0.1", port)
            assert all_ok, steps_full
            print("ok: diagnose_full() all-PASS against the phone-sim:", len(steps_full), "steps")

            steps_bad, ok_bad = diagnose_full("127.0.0.1", 1)
            assert not ok_bad
            assert any("LAN scan" in m or "adb" in m for _, m in steps_bad), steps_bad
            print("ok: diagnose_full() on a dead port adds LAN-scan/adb fallback hints")

            assert isinstance(local_ipv4s(), list)
            print("ok: local_ipv4s() enumerates this computer's interfaces:", local_ipv4s())
        finally:
            srv.shutdown()

    src = (HERE / "wificam_driver.py").read_text()
    assert "--obs" in src and "v4l2loopback" in src and "Browser" in src and "/stream" in src
    assert "--auto" in src and "discover_phone" in src and "--diag" in src and "def diagnose" in src
    assert "192.168.43" in src and "local_ipv4s" in src and "discover_phones" in src, "discovery must cover hotspot/other subnets"
    assert "--adb" in src and "adb_forward" in src and "adb forward" in src and "tcp_check" in src and "diagnose_full" in src, "USB fallback + richer --diag missing"
    assert "Connect via USB (adb)" in src, "GUI USB button missing"
    assert "_view_tk" in src and "PIL" in src, "bundled Pillow/tkinter viewer must exist for the exe"
    assert "class WifiCamApp" in src, "GUI window class missing"
    assert "--gui" in src and "hide_console" in src, "GUI launch + console hiding missing"
    for menu in ('"File"', '"Camera"', '"Help"'):
        assert menu in src, f"menu {menu} missing"
    assert "OBS Studio setup" in src and "About WiFi Cam Driver" in src and "Diagnose connection" in src, "help dialogs missing"
    assert "iconbitmap" in src and "app.ico" in src, "window icon not wired"
    assert f'VERSION = "{VERSION}"' in src
    print("ok: driver ships GUI window (menus File/Camera/Help, OBS help, About, icon), --obs, --auto, bundled viewer")

    ico = (HERE / "app.ico").read_bytes()
    assert ico[:4] == b"\x00\x00\x01\x00", "app.ico is not a valid ICO file"
    print("ok: app.ico exists and is a valid Windows icon")

    ver = (HERE / "wificam_driver.version.txt").read_text()
    assert "VSVersionInfo" in ver and "WificamDriver.exe" in ver and "FileVersion" in ver
    print("ok: Windows version resource (exe Properties -> Details) present")

    spec = (HERE / "wificam_driver.spec").read_text()
    bat = (HERE / "build_exe.bat").read_text()
    sh = (HERE / "build_exe.sh").read_text()
    assert "wificam_driver.py" in spec and "WificamDriver" in spec and "PIL.ImageTk" in spec
    assert "icon='app.ico'" in spec and "app.ico" in spec and "wificam_driver.version.txt" in spec
    assert "PyInstaller" in bat and "wificam_driver.spec" in bat and "WificamDriver.exe" in bat
    assert "PyInstaller" in sh and "wificam_driver.spec" in sh
    print("ok: standalone-exe packaging files present and consistent (spec icon+version, build_exe.bat/.sh)")

    print("\nWIFICAM DRIVER TEST: ALL PASSED")


if __name__ == "__main__":
    main()
