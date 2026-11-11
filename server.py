#!/usr/bin/env python3
"""
KeySense Studio — Unified Production & Live-Preview Server
Binds to 0.0.0.0:8000, serving both the React Studio SPA (repository static_ui/)
and the Acoustic DSP API (/api/analyze, /api/demos, /api/export-midi, /demos/*).
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import sys
import threading
import traceback
import urllib.parse
from email.parser import BytesParser
from email.policy import default as default_email_policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.demo_generator import DEMOS_DIR, ensure_demos_generated
from backend.dsp_engine import analyze_audio_bytes, build_midi_from_analysis, warmup_engine

STATIC_DIR = ROOT_DIR / "static_ui"
MAX_UPLOAD_BYTES = 75 * 1024 * 1024  # 75 MB

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("audio/wav", ".wav")
mimetypes.add_type("audio/mpeg", ".mp3")
mimetypes.add_type("audio/midi", ".mid")


def extract_multipart_file(body: bytes, content_type: str) -> tuple[bytes, str]:
    """Parses multipart/form-data without deprecated `cgi` module (Python 3.13 compatible)."""
    raw_msg = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body
    msg = BytesParser(policy=default_email_policy).parsebytes(raw_msg)
    if msg.is_multipart():
        for part in msg.iter_parts():
            fn = part.get_filename()
            payload = part.get_payload(decode=True)
            if payload and (fn or part.get_content_maintype() in ("audio", "video", "application")):
                return payload, fn or "uploaded_song.wav"
    raise ValueError("No audio file part found in multipart/form-data upload.")


class KeySenseHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        sys.stdout.write(f"[KeySense] {self.address_string()} - {fmt % args}\n")
        sys.stdout.flush()

    def _send_cors_and_frame_headers(self) -> None:
        # Allow Arena Live Preview iframe & proxied origins seamlessly
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename, Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")

    def _send_json(self, status: int, payload: object) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._send_cors_and_frame_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _serve_file_with_ranges(self, file_path: Path, head_only: bool = False) -> None:
        if not file_path.exists() or not file_path.is_file():
            self._send_json(404, {"error": "File not found"})
            return

        file_size = file_path.stat().st_size
        ctype, _ = mimetypes.guess_type(str(file_path))
        ctype = ctype or "application/octet-stream"

        range_header = self.headers.get("Range")
        if range_header:
            m = re.match(r"bytes=(\d*)-(\d*)", range_header)
            if m:
                start_s, end_s = m.groups()
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else file_size - 1
                start = max(0, min(start, file_size - 1))
                end = max(start, min(end, file_size - 1))
                chunk_len = end - start + 1

                self.send_response(206)
                self._send_cors_and_frame_headers()
                self.send_header("Content-Type", ctype)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self.send_header("Content-Length", str(chunk_len))
                self.end_headers()
                if not head_only:
                    with open(file_path, "rb") as f:
                        f.seek(start)
                        self.wfile.write(f.read(chunk_len))
                return

        self.send_response(200)
        self._send_cors_and_frame_headers()
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(file_size))
        if file_path.suffix in (".html",):
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=300")
        self.end_headers()
        if not head_only:
            with open(file_path, "rb") as f:
                self.wfile.write(f.read())

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._send_cors_and_frame_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self) -> None:
        self._handle_get_or_head(head_only=True)

    def do_GET(self) -> None:
        self._handle_get_or_head(head_only=False)

    def _handle_get_or_head(self, head_only: bool = False) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self._send_json(200, {"status": "ok", "engine": "KeySense DSP v1.0"})
            return

        if path == "/api/demos":
            manifest = ensure_demos_generated()
            self._send_json(200, {"demos": manifest})
            return

        if path.startswith("/api/demos/"):
            demo_id = path[len("/api/demos/") :].strip("/")
            safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", demo_id)
            json_path = DEMOS_DIR / f"{safe_id}.json"
            if not json_path.exists():
                ensure_demos_generated()
            if json_path.exists():
                with open(json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self._send_json(200, data)
            else:
                self._send_json(404, {"error": f"Demo '{safe_id}' not found"})
            return

        if path.startswith("/demos/"):
            rel_name = os.path.basename(urllib.parse.unquote(path[len("/demos/") :]))
            target = (DEMOS_DIR / rel_name).resolve()
            if DEMOS_DIR.resolve() in target.parents:
                self._serve_file_with_ranges(target, head_only=head_only)
            else:
                self._send_json(403, {"error": "Forbidden"})
            return

        # Serve Static SPA Assets from /home/user/static_ui
        rel = path.lstrip("/") or "index.html"
        candidate = (STATIC_DIR / urllib.parse.unquote(rel)).resolve()
        if STATIC_DIR.exists() and (candidate == STATIC_DIR.resolve() or STATIC_DIR.resolve() in candidate.parents):
            if candidate.exists() and candidate.is_file():
                self._serve_file_with_ranges(candidate, head_only=head_only)
                return

        index_file = STATIC_DIR / "index.html"
        if index_file.exists():
            self._serve_file_with_ranges(index_file, head_only=head_only)
        else:
            self._send_json(503, {"error": "UI bundle is building, please refresh shortly."})

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            content_len = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            content_len = 0

        if content_len <= 0 or content_len > MAX_UPLOAD_BYTES:
            self._send_json(
                400,
                {"error": f"Invalid payload size ({content_len} bytes). Max allowed is 75 MB."},
            )
            return

        body = self.rfile.read(content_len)

        if path == "/api/analyze":
            try:
                ctype = self.headers.get("Content-Type", "")
                qs = urllib.parse.parse_qs(parsed.query)
                filename = urllib.parse.unquote(
                    self.headers.get("X-Filename")
                    or (qs.get("filename", [None])[0] or "uploaded_song.wav")
                )
                if "multipart/form-data" in ctype:
                    audio_bytes, filename = extract_multipart_file(body, ctype)
                else:
                    audio_bytes = body

                result = analyze_audio_bytes(audio_bytes, filename=filename)
                self._send_json(200, result)
            except Exception as exc:
                traceback.print_exc()
                self._send_json(422, {"error": f"Audio analysis failed: {str(exc)}"})
            return

        if path == "/api/export-midi":
            try:
                payload = json.loads(body.decode("utf-8"))
                analysis = payload.get("analysis") or {}
                voicing_mode = str(payload.get("voicingMode") or "smooth")
                transpose = int(payload.get("transpose") or 0)
                midi_bytes = build_midi_from_analysis(
                    analysis, voicing_mode=voicing_mode, transpose_semitones=transpose
                )
                base_name = re.sub(
                    r"[^a-zA-Z0-9_-]+", "_", os.path.splitext(analysis.get("filename", "keysense"))[0]
                ).strip("_") or "keysense"
                out_name = f"{base_name}_chords_keys.mid"

                self.send_response(200)
                self._send_cors_and_frame_headers()
                self.send_header("Content-Type", "audio/midi")
                self.send_header("Content-Disposition", f'attachment; filename="{out_name}"')
                self.send_header("Content-Length", str(len(midi_bytes)))
                self.end_headers()
                self.wfile.write(midi_bytes)
            except Exception as exc:
                traceback.print_exc()
                self._send_json(400, {"error": f"MIDI export failed: {str(exc)}"})
            return

        self._send_json(404, {"error": f"Unknown API endpoint: {path}"})


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    ensure_demos_generated()

    # Warm up Numba/Librosa in background thread so startup is instant
    threading.Thread(target=warmup_engine, daemon=True).start()

    server = ThreadingHTTPServer(("0.0.0.0", port), KeySenseHandler)
    print(f"KeySense Studio server listening on http://0.0.0.0:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
