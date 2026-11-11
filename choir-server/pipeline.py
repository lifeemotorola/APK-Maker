"""Model boundary for server-assisted processing. No fake production fallback.
Demucs isolates blended vocals. A separately installed, operator-configured
SATB model may supply real audio stems; otherwise only estimated guides exist.
"""
from __future__ import annotations
import json
import logging
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
import time
import wave

VOICES = ("soprano", "alto", "tenor", "bass")
ROOT = Path(__file__).resolve().parents[1]


class ProcessingError(Exception):
    pass


class Cancelled(ProcessingError):
    pass


def run_command(args, cancel, *, timeout=1200):
    """Fixed argv from the operator/code only. Never interpolate upload names.
    Kill the entire subprocess group on timeout/cancel (Linux deployment).
    Keep model logs off HTTP responses and bound in-memory log usage.
    """
    import tempfile
    with tempfile.TemporaryFile() as log:
        proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        deadline = time.monotonic() + timeout
        try:
            while proc.poll() is None:
                if cancel.is_set():
                    raise Cancelled("Processing cancelled")
                if time.monotonic() > deadline:
                    raise ProcessingError("Processing timed out")
                time.sleep(0.1)
            if proc.returncode:
                log.seek(max(0, log.tell() - 4096))
                logging.error("Processing command failed: %s", log.read(4096).decode(errors="replace"))
                raise ProcessingError("Audio/model processing failed. Ask the server operator to check model installation and logs.")
        finally:
            if proc.poll() is None:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.wait()
    if cancel.is_set():
        raise Cancelled("Processing cancelled")


def ffmpeg():
    binary = shutil.which("ffmpeg")
    if binary:
        return binary
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as exc:
        raise ProcessingError("Install FFmpeg or imageio-ffmpeg on the server") from exc


def duration(path):
    with wave.open(str(path), "rb") as wav:
        return wav.getnframes() / wav.getframerate()


def normalize(source, target, cancel, *, stereo=False):
    run_command([ffmpeg(), "-nostdin", "-v", "error", "-y",
                 "-protocol_whitelist", "file,pipe", "-format_whitelist", "wav,mp3,flac,ogg,mov,matroska,webm,aac",
                 "-i", str(source),
                 "-t", "301", "-vn", "-ac", "2" if stereo else "1", "-ar", "44100" if stereo else "22050",
                 "-c:a", "pcm_s16le", "-f", "wav", str(target)], cancel, timeout=90)
    seconds = duration(target)
    if seconds <= 0 or seconds > 300:
        raise ProcessingError("Choose a nonempty audio recording up to five minutes long")
    return seconds


class DemucsProvider:
    """Requires installed Demucs + licensed pretrained weights. Never mocked here."""
    def __init__(self, device="cpu"):
        if device not in ("cpu", "cuda"):
            raise ValueError("CHOIR_DEVICE must be cpu or cuda")
        self.device = device

    def separate(self, mixture, work, cancel):
        run_command([sys.executable, "-m", "demucs.separate", "-n", "htdemucs", "--two-stems", "vocals",
                     "--device", self.device, "--float32", "--out", str(work), str(mixture)], cancel)
        folder = work / "htdemucs" / mixture.stem
        vocals, accompaniment = folder / "vocals.wav", folder / "no_vocals.wav"
        if not vocals.is_file() or not accompaniment.is_file():
            raise ProcessingError("Vocal model did not produce the expected stems")
        return vocals, accompaniment


class Pipeline:
    def __init__(self, provider=None, satb_command=None):
        self.provider = provider or DemucsProvider(os.getenv("CHOIR_DEVICE", "cpu"))
        self.satb_command = satb_command
        if satb_command is not None and (not isinstance(satb_command, list) or not satb_command or
                not all(isinstance(arg, str) and arg for arg in satb_command)):
            raise ValueError("SATB command must be a nonempty JSON argv array")

    def __call__(self, source: Path, job_dir: Path, stage, cancel: threading.Event):
        work, result = job_dir / "work", job_dir / "result"
        work.mkdir(); result.mkdir()
        try:
            stage("Decoding recording")
            mix = work / "mix.wav"
            seconds = normalize(source, mix, cancel, stereo=True)
            stage("Neural vocal isolation (Demucs)")
            vocals, accompaniment = self.provider.separate(mix, work / "demucs", cancel)
            for source_audio, name in [(vocals, "vocals.wav"), (accompaniment, "accompaniment.wav")]:
                length = normalize(source_audio, result / name, cancel)
                if abs(length - seconds) > 0.15:
                    raise ProcessingError("Vocal model output lengths do not match the recording")
            mode = "range_guided_estimate"
            if self.satb_command:
                stage("External SATB model separation")
                stems = work / "satb"
                stems.mkdir()
                run_command(self.satb_command + ["--input", str(vocals), "--output-dir", str(stems)], cancel)
                for voice in VOICES:
                    candidate = stems / (voice + ".wav")
                    # Operator plugins are trusted code, but their outputs must
                    # still be finite, aligned audio files, not arbitrary paths.
                    if candidate.is_symlink() or not candidate.is_file():
                        raise ProcessingError("SATB model must output four WAV files named soprano, alto, tenor and bass")
                    length = normalize(candidate, result / candidate.name, cancel)
                    if abs(length - seconds) > 0.15:
                        raise ProcessingError("SATB model output lengths do not match the recording")
                mode = "external_model"
            stage("Tracking pitches and rendering practice guides")
            run_command(["node", str(ROOT / "choir-server" / "render_job.mjs"), str(result), mode], cancel)
            with (result / "analysis.json").open() as file:
                analysis = json.load(file)
            files = [dict(name="vocals.wav", kind="vocal_stem", label="Neural-isolated blended vocals"),
                     dict(name="accompaniment.wav", kind="accompaniment", label="Estimated accompaniment")]
            for voice in VOICES:
                if mode == "external_model":
                    files.append(dict(name=voice + ".wav", kind="satb_stem", label=voice.title() + " model audio stem"))
                files.extend([dict(name="guide-" + voice + ".wav", kind="synthesized_guide", label=voice.title() + " synthesized pitch guide"),
                              dict(name=voice + ".mid", kind="midi", label=voice.title() + " estimated MIDI")])
            files.append(dict(name="pitches.txt", kind="text", label="All estimated SATB pitches"))
            return dict(schemaVersion=1, analysis=analysis, files=files,
                        separation=dict(vocals="demucs_htdemucs", satb=mode),
                        warnings=["Model audio can contain bleed and artifacts; check against the original."] +
                        (["No SATB model configured. Four guide tracks are synthesized from range-guided pitch estimates, not isolated singers."]
                         if mode != "external_model" else ["SATB model supplied by server operator; no accuracy certification is implied."]))
        finally:
            source.unlink(missing_ok=True)
            shutil.rmtree(work, ignore_errors=True)
