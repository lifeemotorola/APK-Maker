#!/usr/bin/env python3
"""
wificam_driver.py — WiFi Cam computer driver (GUI app + CLI).

Connects to the phone's MJPEG-over-HTTP stream (http://<phone-ip>:8080/stream).

GUI (default):  run with NO arguments (or --gui), or double-click
WificamDriver.exe — a real window opens with the live camera feed, menus
(File / Camera / Help), auto-discovery of the phone on the LAN, snapshot,
record, torch, FPS/status bar, OBS Studio setup help and an About dialog.

CLI (python wificam_driver.py ...):
  --auto            discover the phone on the LAN automatically, then --view
  --view            live viewer window (OpenCV if installed, else Pillow/tkinter)
  --virtual-cam DEV pipe the stream into a v4l2loopback virtual camera
                    (e.g. /dev/video0, Linux) via ffmpeg — then any app
                    (Zoom, Meet, OBS) can use the phone as a webcam
  --record FILE     save the stream to a video file (via ffmpeg)
  --snapshot FILE   save one JPEG frame
  --list            print phone /status JSON and exit
  --obs             print OBS Studio setup instructions and exit
  --version         print the driver version and exit

Examples:
  WificamDriver.exe                                  (GUI: auto-find phone, live feed)
  python3 wificam_driver.py --host 192.168.1.50 --view
  python3 wificam_driver.py --host 192.168.1.50 --obs
  python3 wificam_driver.py --host 192.168.1.50 --virtual-cam /dev/video0
  python3 wificam_driver.py --host 192.168.1.50 --record call.mp4

Build the standalone Windows executable with build_exe.bat (PyInstaller):
  dist/WificamDriver.exe   (window icon + version info embedded)

Virtual camera setup (Linux):
  sudo modprobe v4l2loopback exclusive_caps=1
OBS Studio on any OS: add a Browser source with http://<phone-ip>:8080/stream
(see --obs / Help menu for all options).
"""
import argparse
import concurrent.futures
import http.client
import io
import json
import os
import queue
import shutil
import socket
import subprocess
import sys
import threading
import time
try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
    HAS_TK = True
except ImportError:  # e.g. Debian without python3-tk — CLI still works
    tk = None
    HAS_TK = False

VERSION = "1.2"
DEFAULT_PORT = 8080

OBS_HELP = """OBS Studio setup with WiFi Cam (phone at {host}:{port}):

Option A - Browser source (no driver needed, works on Windows/macOS/Linux):
  OBS -> Sources -> + -> Browser
  URL: http://{host}:{port}/stream   (MJPEG, OBS renders it live)
  Width x Height: 1280 x 720

Option B - real virtual webcam on Linux (v4l2loopback):
  sudo modprobe v4l2loopback exclusive_caps=1
  python3 wificam_driver.py --host {host} --virtual-cam /dev/video0
  OBS -> Sources -> + -> Video Capture Device -> device /dev/video0

Option C - this driver's window, capture it in OBS:
  WificamDriver.exe (or --view) opens the live window
  OBS -> Sources -> + -> Window Capture -> window "WiFi Cam Driver"

The phone app shows this same URL on its screen while streaming."""


def resource_path(rel):
    """Path that works both from source and inside a PyInstaller bundle."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


def hide_console():
    """Windows: hide the console window when the GUI is launched."""
    if os.name == "nt":
        try:
            import ctypes
            hwnd = ctypes.windll.kernel32.GetConsoleWindow()
            if hwnd:
                ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE
        except Exception:
            pass


# ---------------------------------------------------------------- HTTP / LAN

def status(host, port, timeout=5):
    conn = http.client.HTTPConnection(host, port, timeout=timeout)
    conn.request("GET", "/status")
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    return json.loads(body.decode("utf-8"))


def api_torch(host, port, on, timeout=5):
    conn = http.client.HTTPConnection(host, port, timeout=timeout)
    conn.request("GET", "/api/torch?on=" + ("1" if on else "0"))
    resp = conn.getresponse()
    body = resp.read()
    conn.close()
    return json.loads(body.decode("utf-8"))


def discover_phone(port=DEFAULT_PORT, timeout=0.6):
    """Probe the local subnet(s) for a WiFi Cam phone (port /status)."""
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
    """Yield JPEG frame bytes from the multipart/x-mixed-replace stream."""
    conn = http.client.HTTPConnection(host, port, timeout=timeout)
    conn.request("GET", path, headers={"User-Agent": "wificam-driver/" + VERSION})
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
        while True:
            start = buf.find(sep)
            if start == -1:
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
    start = buf.find(sep)
    if start != -1:
        frame = parse_part(buf[start + len(sep):])
        if frame is not None:
            yield frame
    conn.close()


def stream_url(host, port):
    return f"http://{host}:{port}/stream"


# ---------------------------------------------------------------- GUI app

class WifiCamApp:
    """Tkinter GUI: live MJPEG viewer + controls for the WiFi Cam phone."""

    def __init__(self, root):
        self.root = root
        self.host_var = tk.StringVar(value="")
        self.port_var = tk.StringVar(value=str(DEFAULT_PORT))
        self.url_var = tk.StringVar(value="")
        self.info_var = tk.StringVar(value="not connected")
        self.status_var = tk.StringVar(value="ready — press Auto-find or Connect")
        self.torch_var = tk.BooleanVar(value=False)

        self.q = queue.Queue(maxsize=2)
        self.stop_reader = threading.Event()
        self.reader_thread = None
        self.connected = False
        self.last_frame = None
        self.record_proc = None
        self.frames_shown = 0
        self.fps_t0 = time.time()
        self.fps = 0.0

        root.title(f"WiFi Cam Driver {VERSION}")
        try:
            root.iconbitmap(resource_path("app.ico"))
        except Exception:
            pass
        root.geometry("1024x620")
        root.minsize(780, 480)
        root.protocol("WM_DELETE_WINDOW", self.on_close)

        self._build_menu()
        self._build_widgets()
        self._poll()

    # ---------- UI construction ----------

    def _build_menu(self):
        menubar = tk.Menu(self.root)
        m_file = tk.Menu(menubar, tearoff=0)
        m_file.add_command(label="Auto-find phone on LAN", command=self.auto_find, accelerator="Ctrl+A")
        m_file.add_command(label="Connect", command=self.connect, accelerator="Ctrl+C")
        m_file.add_command(label="Disconnect", command=self.disconnect)
        m_file.add_separator()
        m_file.add_command(label="Save snapshot...", command=self.snapshot)
        m_file.add_command(label="Record video...", command=self.record)
        m_file.add_separator()
        m_file.add_command(label="Exit", command=self.on_close)
        menubar.add_cascade(label="File", menu=m_file)

        m_cam = tk.Menu(menubar, tearoff=0)
        m_cam.add_checkbutton(label="Torch", variable=self.torch_var, command=self.toggle_torch)
        m_cam.add_command(label="Refresh phone status", command=self.refresh_status)
        menubar.add_cascade(label="Camera", menu=m_cam)

        m_help = tk.Menu(menubar, tearoff=0)
        m_help.add_command(label="OBS Studio setup...", command=self.show_obs_help)
        m_help.add_command(label="About WiFi Cam Driver...", command=self.about)
        menubar.add_cascade(label="Help", menu=m_help)

        self.root.config(menu=menubar)
        self.root.bind("<Control-a>", lambda e: self.auto_find())
        self.root.bind("<Control-c>", lambda e: self.connect())

    def _build_widgets(self):
        paned = ttk.Panedwindow(self.root, orient=tk.HORIZONTAL)
        paned.pack(fill=tk.BOTH, expand=True)

        video_frame = ttk.Frame(paned)
        self.video = tk.Label(video_frame, bg="black", text="no signal",
                              fg="#8FB0BF", font=("Segoe UI", 14))
        self.video.pack(fill=tk.BOTH, expand=True)
        paned.add(video_frame, weight=4)

        side = ttk.Frame(paned, padding=10)
        paned.add(side, weight=1)

        ttk.Label(side, text="Phone on WiFi", font=("Segoe UI", 11, "bold")).pack(anchor=tk.W, pady=(0, 6))
        row = ttk.Frame(side); row.pack(fill=tk.X)
        ttk.Label(row, text="Host").pack(side=tk.LEFT)
        ttk.Entry(row, textvariable=self.host_var, width=16).pack(side=tk.LEFT, padx=(4, 8))
        ttk.Label(row, text="Port").pack(side=tk.LEFT)
        ttk.Entry(row, textvariable=self.port_var, width=6).pack(side=tk.LEFT, padx=(4, 0))

        btns = ttk.Frame(side); btns.pack(fill=tk.X, pady=8)
        ttk.Button(btns, text="Auto-find", command=self.auto_find).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(btns, text="Connect", command=self.connect).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(btns, text="Disconnect", command=self.disconnect).pack(side=tk.LEFT)

        ttk.Label(side, text="Stream URL (for OBS Browser source)", font=("Segoe UI", 10, "bold")).pack(anchor=tk.W, pady=(10, 2))
        urow = ttk.Frame(side); urow.pack(fill=tk.X)
        ttk.Entry(urow, textvariable=self.url_var, state="readonly").pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(urow, text="Copy", width=6, command=self.copy_url).pack(side=tk.LEFT, padx=(4, 0))

        ttk.Label(side, text="Phone info").pack(anchor=tk.W, pady=(10, 2))
        ttk.Label(side, textvariable=self.info_var, foreground="#444").pack(anchor=tk.W)

        ttk.Checkbutton(side, text="Torch on/off", variable=self.torch_var, command=self.toggle_torch).pack(anchor=tk.W, pady=(10, 0))

        ttk.Button(side, text="Save snapshot...", command=self.snapshot).pack(fill=tk.X, pady=(10, 4))
        ttk.Button(side, text="Record video...", command=self.record).pack(fill=tk.X, pady=4)
        ttk.Button(side, text="OBS Studio setup...", command=self.show_obs_help).pack(fill=tk.X, pady=4)

        statusbar = ttk.Label(self.root, textvariable=self.status_var, relief=tk.SUNKEN, anchor=tk.W, padding=(6, 3))
        statusbar.pack(fill=tk.X, side=tk.BOTTOM)

    # ---------- actions ----------

    def set_status(self, msg):
        self.status_var.set(msg)

    def _port(self):
        try:
            return int(self.port_var.get().strip() or DEFAULT_PORT)
        except ValueError:
            return DEFAULT_PORT

    def auto_find(self):
        if self.connected:
            return
        self.set_status("searching for the phone on the LAN (port %d /status)..." % self._port())
        threading.Thread(target=self._auto_find_worker, daemon=True).start()

    def _auto_find_worker(self):
        try:
            h = discover_phone(self._port())
        except Exception:
            h = None
        self.root.after(0, lambda: self._auto_find_done(h))

    def _auto_find_done(self, h):
        if h:
            self.host_var.set(h)
            self.set_status("phone found at " + h + " — connecting...")
            self.connect()
        else:
            self.set_status("no phone found — start WiFi Cam on the phone first, then Connect")

    def connect(self):
        host = self.host_var.get().strip()
        if not host:
            self.auto_find()
            return
        port = self._port()
        self.url_var.set(stream_url(host, port))
        self.set_status(f"connecting to {host}:{port} ...")
        threading.Thread(target=self._connect_worker, args=(host, port), daemon=True).start()

    def _connect_worker(self, host, port):
        try:
            st = status(host, port, timeout=5)
        except Exception as e:
            self.root.after(0, lambda: self.set_status(f"cannot reach {host}:{port} — {e}"))
            return
        self.root.after(0, lambda: self._connect_ok(host, port, st))

    def _connect_ok(self, host, port, st):
        self.connected = True
        self.stop_reader.clear()
        self.info_var.set(f"{st.get('ip')}:{st.get('port')}  {st.get('info', '')}  clients={st.get('clients', 0)}"
                          + ("" if st.get("streaming") else "  (camera not streaming on the phone yet)"))
        self.set_status("connected — streaming from " + stream_url(host, port))
        self.reader_thread = threading.Thread(target=self._reader, args=(host, port), daemon=True)
        self.reader_thread.start()

    def disconnect(self):
        self.connected = False
        self.stop_reader.set()
        self._stop_record()
        self.last_frame = None
        self.video.configure(image="", text="no signal")
        self.info_var.set("not connected")
        self.set_status("disconnected")

    def _reader(self, host, port):
        try:
            for frame in iter_mjpeg_frames(host, port):
                if self.stop_reader.is_set():
                    break
                try:
                    self.q.put_nowait(frame)
                except queue.Full:
                    try:
                        self.q.get_nowait()
                        self.q.put_nowait(frame)
                    except Exception:
                        pass
        except Exception as e:
            if not self.stop_reader.is_set():
                self.root.after(0, lambda: self.set_status("stream ended: " + str(e)))

    def _poll(self):
        try:
            from PIL import Image, ImageTk
            while True:
                frame = self.q.get_nowait()
                self.last_frame = frame
                img = Image.open(io.BytesIO(frame))
                img.thumbnail((960, 540))
                photo = ImageTk.PhotoImage(img)
                self.video.configure(image=photo, text="")
                self.video.image = photo
                self.frames_shown += 1
        except queue.Empty:
            pass
        except Exception:
            pass
        now = time.time()
        if now - self.fps_t0 >= 1.0:
            self.fps = self.frames_shown / (now - self.fps_t0)
            self.frames_shown = 0
            self.fps_t0 = now
            if self.connected:
                self.set_status(f"streaming — {self.fps:.1f} fps — " + self.url_var.get())
        self.root.after(33, self._poll)

    def refresh_status(self):
        host = self.host_var.get().strip()
        if not host:
            self.set_status("enter the phone IP first")
            return
        try:
            st = status(host, self._port(), timeout=5)
            self.info_var.set(f"{st.get('ip')}:{st.get('port')}  {st.get('info', '')}  streaming={st.get('streaming')}  clients={st.get('clients', 0)}")
            self.set_status("status refreshed")
        except Exception as e:
            self.set_status(f"cannot reach {host} — {e}")

    def toggle_torch(self):
        host = self.host_var.get().strip()
        if not host:
            self.set_status("enter the phone IP first")
            self.torch_var.set(False)
            return
        on = self.torch_var.get()
        threading.Thread(target=self._torch_worker, args=(host, self._port(), on), daemon=True).start()

    def _torch_worker(self, host, port, on):
        try:
            api_torch(host, port, on)
            self.root.after(0, lambda: self.set_status("torch " + ("on" if on else "off")))
        except Exception as e:
            self.root.after(0, lambda: (self.torch_var.set(not on), self.set_status(f"torch failed — {e}")))

    def copy_url(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.url_var.get() or stream_url(self.host_var.get().strip() or "?", self._port()))
        self.set_status("stream URL copied — paste it into OBS as a Browser source")

    def snapshot(self):
        if self.last_frame is None:
            self.set_status("no frame yet — connect first")
            return
        path = filedialog.asksaveasfilename(defaultextension=".jpg",
                                            filetypes=[("JPEG image", "*.jpg")],
                                            title="Save snapshot")
        if path:
            with open(path, "wb") as f:
                f.write(self.last_frame)
            self.set_status(f"snapshot saved: {path} ({len(self.last_frame)} bytes)")

    def record(self):
        host = self.host_var.get().strip()
        if not host:
            self.set_status("enter the phone IP first")
            return
        path = filedialog.asksaveasfilename(defaultextension=".mp4",
                                            filetypes=[("MP4 video", "*.mp4")],
                                            title="Record stream to file")
        if not path:
            return
        if shutil.which("ffmpeg") is None:
            messagebox.showerror("ffmpeg missing", "Recording needs ffmpeg installed (winget install ffmpeg).")
            return
        cmd = _ffmpeg_base(host, self._port()) + ["-c:v", "libx264", "-pix_fmt", "yuv420p", path]
        self._stop_record()
        self.record_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.set_status("recording to " + path + " — press Disconnect (or close) to stop")

    def _stop_record(self):
        if self.record_proc is not None:
            try:
                self.record_proc.terminate()
            except Exception:
                pass
            self.record_proc = None

    # ---------- help ----------

    def show_obs_help(self):
        host = self.host_var.get().strip() or "<phone-ip>"
        win = tk.Toplevel(self.root)
        win.title("OBS Studio setup — WiFi Cam Driver")
        win.geometry("640x420")
        try:
            win.iconbitmap(resource_path("app.ico"))
        except Exception:
            pass
        txt = tk.Text(win, wrap=tk.WORD, padx=10, pady=10)
        txt.pack(fill=tk.BOTH, expand=True)
        txt.insert("1.0", OBS_HELP.format(host=host, port=self._port()))
        txt.config(state=tk.DISABLED)
        ttk.Button(win, text="Close", command=win.destroy).pack(pady=6)

    def about(self):
        messagebox.showinfo(
            "About WiFi Cam Driver",
            f"WiFi Cam Driver {VERSION}\n\n"
            "Turns the WiFi Cam Android app (phone camera streamed over WiFi as MJPEG)\n"
            "into a webcam feed on this computer.\n\n"
            "Stream URL: " + (self.url_var.get() or "http://<phone-ip>:8080/stream") + "\n"
            "Help -> OBS Studio setup shows how to use it in OBS.\n\n"
            "Repo: github.com/lifeemotorola/APK-Maker (wificam-driver/)")

    def on_close(self):
        self.stop_reader.set()
        self._stop_record()
        self.root.destroy()


def launch_gui(auto=False):
    if not HAS_TK:
        sys.exit("tkinter is not available in this Python build — use the python.org "
                 "installer on Windows (it bundles tkinter), install python3-tk, "
                 "or use the prebuilt WificamDriver.exe")
    hide_console()
    root = tk.Tk()
    app = WifiCamApp(root)
    if auto:
        root.after(300, app.auto_find)
    root.mainloop()


# ---------------------------------------------------------------- CLI modes

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
        if cv2.waitKey(1) == 27:
            break
    cv2.destroyAllWindows()
    print(f"viewed {n} frames")


def _view_tk(host, port):
    if not HAS_TK:
        raise ImportError("tkinter not available in this Python build")
    root = tk.Tk()
    root.title(f"WiFi Cam — {stream_url(host, port)} (close window to quit)")
    label = tk.Label(root, bg="black")
    label.pack()
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

    def poll():
        from PIL import Image, ImageTk
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
        except Exception:
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
             f"or use OBS Browser source: {stream_url(host, port)}")


def cmd_snapshot(host, port, out):
    for frame in iter_mjpeg_frames(host, port):
        with open(out, "wb") as f:
            f.write(frame)
        print(f"saved {out} ({len(frame)} bytes)")
        return
    sys.exit("no frame received")


def _ffmpeg_base(host, port):
    if shutil.which("ffmpeg") is None:
        sys.exit("ffmpeg not found — install ffmpeg (winget install ffmpeg / apt install ffmpeg)")
    return ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
            "-f", "mjpeg", "-i", stream_url(host, port)]


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
        description="WiFi Cam computer driver. No arguments opens the GUI app "
                    "(auto-finds the phone on the LAN and shows the live feed).",
        epilog="OBS Studio: run with --obs to print setup instructions.")
    ap.add_argument("--host", help="phone IP on the WiFi (shown on the phone screen); omit with --auto")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--auto", action="store_true", help="auto-discover the phone on the LAN")
    ap.add_argument("--gui", action="store_true", help="open the GUI window (default when no arguments)")
    ap.add_argument("--view", action="store_true", help="CLI live viewer window")
    ap.add_argument("--virtual-cam", metavar="DEV", help="pipe to a v4l2loopback device, e.g. /dev/video0 (Linux)")
    ap.add_argument("--record", metavar="FILE", help="record the stream to a video file")
    ap.add_argument("--snapshot", metavar="FILE", help="save one JPEG frame")
    ap.add_argument("--list", action="store_true", help="print phone status and exit")
    ap.add_argument("--obs", action="store_true", help="print OBS Studio setup instructions and exit")
    ap.add_argument("--version", action="version", version=f"WificamDriver {VERSION}")
    args = ap.parse_args()

    no_input = not any([args.host, args.auto, args.gui, args.view, args.virtual_cam,
                        args.record, args.snapshot, args.list, args.obs])
    if no_input or args.gui:
        launch_gui(auto=no_input or args.auto)
        return

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
    ap.error("choose one of --obs / --view / --virtual-cam / --record / --snapshot / --list (or no arguments for the GUI)")


if __name__ == "__main__":
    main()
