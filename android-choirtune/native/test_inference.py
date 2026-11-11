#!/usr/bin/env python3
"""Run real weighted host inference and input guards (not Android/choir quality).
Requires fetch.py and a host CMake build, documented in ../README.md.
"""
import math
from pathlib import Path
import resource
import struct
import subprocess
import time
import wave

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.cache' / 'demucs-native'
EXE = CACHE / 'host' / 'demucs_smoke'
MODEL = CACHE / 'ggml-model-htdemucs-4s-f16.bin'
PCM, WAV = CACHE / 'smoke-input.pcm', CACHE / 'smoke-vocals.wav'


def run(expect_ok):
    start = time.monotonic()
    result = subprocess.run([str(EXE), str(MODEL), str(PCM), str(WAV)], capture_output=True, text=True)
    assert (result.returncode == 0) == expect_ok, result.stdout + result.stderr
    return result, time.monotonic() - start


# Invalid, oversized and silent audio must fail before model inference.
for content in [b'', b'123', bytes(44100 * 4)]:
    PCM.write_bytes(content)
    run(False)
with PCM.open('wb') as oversized:
    oversized.truncate((44100 * 900 + 1) * 4)
run(False)
PCM.write_bytes(b''.join(struct.pack('<hh',
    int(8000 * math.sin(2 * math.pi * 220 * i / 44100) + 2000 * math.sin(2 * math.pi * 440 * i / 44100)),
    int(8000 * math.sin(2 * math.pi * 220 * i / 44100) + 2000 * math.sin(2 * math.pi * 440 * i / 44100)))
    for i in range(44100)))
result, elapsed = run(True)
assert '533 tensors' in result.stdout, 'Real checkpoint tensors must be loaded'
assert 'Real Demucs inference passed' in result.stdout
with wave.open(str(WAV)) as output:
    assert (output.getnchannels(), output.getframerate(), output.getsampwidth(), output.getnframes()) == (2, 44100, 2, 44100)
    data = output.readframes(44100)
    assert any(data), 'Expected nonzero vocal estimate on tone input'
    assert data != PCM.read_bytes(), 'Vocal output must not be a passthrough'
assert Path(str(WAV) + '.analysis.f32').stat().st_size == 11025 * 4
print(result.stdout)
print('PASS: real weights, finite stereo WAV, exact duration, non-passthrough output, silent/malformed/oversized rejection')
print('Host seconds:', round(elapsed, 2), 'Peak child RSS KiB:', resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)
print('Synthetic input is NOT a singing separation benchmark. Physical Android testing is still required.')
