"""
Generates 5 lush, realistic multi-instrument studio demo songs (Acoustic Piano +
Warm Rhodes Pad + Upright/Sub Bass + Top Melody + Drum Groove) saved in /home/user/demos,
and runs KeySense's DSP Engine on each so users can immediately explore real songs.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import soundfile as sf

from backend.dsp_engine import analyze_audio_bytes

DEMOS_DIR = Path("/home/user/demos")


def midi_to_hz(midi: float) -> float:
    return 440.0 * (2.0 ** ((midi - 69.0) / 12.0))


def synth_piano_note(
    sr: int,
    midi: int,
    duration: float,
    velocity: float = 0.8,
    warmth: float = 1.0,
) -> np.ndarray:
    """
    Synthesizes an acoustic piano string strike with inharmonicity,
    frequency-dependent partial decay, and soft hammer attack.
    """
    n_samples = max(1, int(sr * duration))
    t = np.arange(n_samples, dtype=np.float32) / sr
    f0 = midi_to_hz(midi)

    # Faster decay on higher notes, longer sustain on lower notes
    base_decay = 2.8 * (0.975 ** max(0, midi - 36))
    attack = np.minimum(1.0, t / 0.009)
    release_len = min(int(0.06 * sr), n_samples // 4)
    release = np.ones(n_samples, dtype=np.float32)
    if release_len > 1:
        release[-release_len:] = np.linspace(1.0, 0.0, release_len, dtype=np.float32)

    partials = [
        (1.0, 1.00, 1.0),
        (2.0005, 0.42 * warmth, 1.4),
        (3.0020, 0.22 * warmth, 1.9),
        (4.0045, 0.11 * warmth, 2.5),
        (5.0080, 0.06 * warmth, 3.2),
    ]
    sig = np.zeros(n_samples, dtype=np.float32)
    for mult, amp, decay_mult in partials:
        freq = f0 * mult
        if freq >= sr * 0.46:
            continue
        env = attack * np.exp(-t * ( decay_mult / max(0.35, base_decay) )) * release
        # Slight detuned unison string pair for realistic acoustic piano chorus
        sig += amp * env * (
            0.65 * np.sin(2.0 * np.pi * freq * t)
            + 0.35 * np.sin(2.0 * np.pi * (freq * 1.0009) * t + 0.3)
        )

    return sig * (velocity * 0.22)


def add_drums(
    left: np.ndarray,
    right: np.ndarray,
    sr: int,
    bpm: float,
    total_beats: int,
    style: str = "pop",
) -> None:
    """Adds subtle, realistic studio kick, snare/rim, and hi-hat groove."""
    beat_sec = 60.0 / bpm
    rng = np.random.default_rng(42)
    total_len = len(left)

    for b in range(total_beats * 2):  # 8th-note grid
        t_sec = b * (beat_sec * 0.5)
        idx = int(t_sec * sr)
        if idx >= total_len:
            break
        beat_in_bar = b % 8  # 0..7 eighth notes in 4/4

        # Kick drum
        is_kick = (
            beat_in_bar in (0, 5) if style == "afrobeats"
            else (beat_in_bar in (0, 4) if style == "pop" else beat_in_bar == 0)
        )
        if is_kick:
            k_len = min(int(0.18 * sr), total_len - idx)
            kt = np.arange(k_len, dtype=np.float32) / sr
            f_sweep = 52.0 + 95.0 * np.exp(-kt * 36.0)
            phase = 2.0 * np.pi * np.cumsum(f_sweep) / sr
            kick = 0.20 * np.sin(phase) * np.exp(-kt * 14.0)
            left[idx : idx + k_len] += kick
            right[idx : idx + k_len] += kick

        # Soft snare / rimshot on backbeats
        is_snare = (
            beat_in_bar in (3, 6) if style == "afrobeats"
            else (beat_in_bar in (2, 6) if style in ("pop", "neosoul") else beat_in_bar == 4)
        )
        if is_snare:
            s_len = min(int(0.14 * sr), total_len - idx)
            st = np.arange(s_len, dtype=np.float32) / sr
            noise = rng.standard_normal(s_len).astype(np.float32)
            snare = (0.07 * noise * np.exp(-st * 26.0)) + (0.06 * np.sin(2 * np.pi * 195.0 * st) * np.exp(-st * 22.0))
            left[idx : idx + s_len] += snare * 0.95
            right[idx : idx + s_len] += snare * 1.05

        # Shaker / Hi-hat
        h_len = min(int(0.05 * sr), total_len - idx)
        ht = np.arange(h_len, dtype=np.float32) / sr
        hat = 0.025 * rng.standard_normal(h_len).astype(np.float32) * np.exp(-ht * 55.0)
        left[idx : idx + h_len] += hat * 1.1
        right[idx : idx + h_len] += hat * 0.85


def render_song(
    bpm: float,
    bars: List[Tuple[int, List[int], List[Tuple[float, float, int]]]],
    style: str = "pop",
    beats_per_chord: int = 4,
) -> bytes:
    """
    Renders a stereo 22050 Hz WAV song from a bar list:
      each item: (bass_midi, chord_rh_midis, melody_events[(beat_offset, dur_beats, midi)])
    """
    sr = 22050
    beat_sec = 60.0 / bpm
    total_beats = len(bars) * beats_per_chord
    duration = total_beats * beat_sec + 0.6
    n_samples = int(sr * duration)

    left = np.zeros(n_samples, dtype=np.float32)
    right = np.zeros(n_samples, dtype=np.float32)

    for bar_idx, (bass_midi, rh_midis, melody_evs) in enumerate(bars):
        bar_start_beat = bar_idx * beats_per_chord
        bar_start_sec = bar_start_beat * beat_sec
        bar_dur_sec = beats_per_chord * beat_sec

        # 1. Left-hand bass root + octave pulse on beat 1 (and beat 3 gentle re-strike)
        for sub_b, vel in [(0.0, 0.92), (beats_per_chord * 0.5, 0.58)]:
            idx = int((bar_start_sec + sub_b * beat_sec) * sr)
            b_sig = synth_piano_note(sr, bass_midi, bar_dur_sec * 0.55, velocity=vel, warmth=0.9)
            end = min(n_samples, idx + len(b_sig))
            left[idx:end] += b_sig[: end - idx] * 1.05
            right[idx:end] += b_sig[: end - idx] * 0.95

        # 2. Right-hand chord voicing: sustained block + rhythmic comping pulse
        comp_offsets = [0.0, 2.0] if beats_per_chord == 4 else [0.0]
        for comp_idx, off_b in enumerate(comp_offsets):
            comp_dur = (bar_dur_sec * 0.62) if len(comp_offsets) > 1 else (bar_dur_sec * 0.95)
            vel = 0.82 if comp_idx == 0 else 0.62
            for n_i, m_note in enumerate(rh_midis):
                # Subtle 12ms humanize arpeggiation across fingers
                idx = int((bar_start_sec + off_b * beat_sec + n_i * 0.011) * sr)
                c_sig = synth_piano_note(sr, m_note, comp_dur, velocity=vel, warmth=1.0)
                end = min(n_samples, idx + len(c_sig))
                pan_r = 0.42 + 0.08 * min(4, n_i)
                pan_l = 1.0 - pan_r * 0.45
                left[idx:end] += c_sig[: end - idx] * pan_l
                right[idx:end] += c_sig[: end - idx] * pan_r

        # 3. Expressive Piano Melody notes in upper octave
        for m_off, m_dur, m_midi in melody_evs:
            idx = int((bar_start_sec + m_off * beat_sec) * sr)
            m_sig = synth_piano_note(sr, m_midi, m_dur * beat_sec * 1.05, velocity=0.76, warmth=1.1)
            end = min(n_samples, idx + len(m_sig))
            left[idx:end] += m_sig[: end - idx] * 0.72
            right[idx:end] += m_sig[: end - idx] * 0.98

    if style != "ballad":
        add_drums(left, right, sr, bpm, total_beats, style=style)

    stereo = np.stack([left, right], axis=1)
    peak = float(np.max(np.abs(stereo))) + 1e-8
    stereo = (stereo / peak) * 0.88

    import io
    buf = io.BytesIO()
    sf.write(buf, stereo, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


DEMO_SPECS: List[Dict[str, Any]] = [
    {
        "id": "gospel-sunrise",
        "title": "Grace & Sunrise (Gospel Piano)",
        "artist": "KeySense Studio Session",
        "genre": "Gospel / Worship",
        "bpm": 84.0,
        "style": "neosoul",
        "beatsPerChord": 4,
        # Key of Ab Major: Ab -> Eb/G -> Fm7 -> Db (2 cycles = 8 bars)
        "bars": [
            (44, [56, 60, 63, 68], [(0.0, 1.5, 75), (1.5, 1.0, 72), (2.5, 1.5, 68)]),   # Ab
            (43, [55, 58, 63, 67], [(0.0, 2.0, 70), (2.0, 2.0, 67)]),                    # Eb/G
            (41, [56, 60, 63, 65], [(0.0, 1.5, 72), (1.5, 1.0, 75), (2.5, 1.5, 77)]),   # Fm7
            (37, [56, 61, 65, 68], [(0.0, 2.0, 73), (2.0, 2.0, 72)]),                    # Db
            (44, [56, 60, 63, 68], [(0.0, 1.5, 80), (1.5, 1.0, 75), (2.5, 1.5, 72)]),   # Ab
            (39, [55, 58, 63, 67], [(0.0, 2.0, 75), (2.0, 2.0, 70)]),                    # Eb
            (41, [53, 56, 60, 65], [(0.0, 2.0, 72), (2.0, 2.0, 68)]),                    # Fm
            (37, [53, 56, 61, 65], [(0.0, 3.5, 68)]),                                     # Db
        ],
    },
    {
        "id": "afrobeats-golden",
        "title": "Monrovia Sunset (Afrobeats Groove)",
        "artist": "KeySense Studio Session",
        "genre": "Afrobeats / Afro-Piano",
        "bpm": 102.0,
        "style": "afrobeats",
        "beatsPerChord": 4,
        # Key of F Minor / Ab Major: Fm7 -> Db -> Ab -> Eb (8 bars)
        "bars": [
            (41, [56, 60, 63, 65], [(0.0, 1.0, 77), (1.5, 1.0, 75), (3.0, 1.0, 72)]),   # Fm7
            (37, [56, 61, 65],     [(0.0, 1.5, 73), (2.0, 2.0, 72)]),                    # Db
            (44, [56, 60, 63],     [(0.0, 1.5, 75), (1.5, 1.5, 72), (3.0, 1.0, 68)]),   # Ab
            (39, [55, 58, 63],     [(0.0, 2.0, 70), (2.0, 2.0, 67)]),                    # Eb
            (41, [56, 60, 63, 65], [(0.0, 1.0, 77), (1.5, 1.0, 80), (3.0, 1.0, 75)]),   # Fm7
            (37, [56, 61, 65],     [(0.0, 1.5, 73), (2.0, 2.0, 72)]),                    # Db
            (44, [56, 60, 63],     [(0.0, 2.0, 72), (2.0, 2.0, 68)]),                    # Ab
            (36, [52, 55, 60, 64], [(0.0, 3.5, 72)]),                                     # C7 (V7 of Fm!)
        ],
    },
    {
        "id": "midnight-ballad",
        "title": "City Lights Ballad (Grand Piano)",
        "artist": "KeySense Studio Session",
        "genre": "Pop / Piano Ballad",
        "bpm": 76.0,
        "style": "ballad",
        "beatsPerChord": 4,
        # Key of C Major: C -> G/B -> Am7 -> F -> Dm7 -> G7 -> C (8 bars)
        "bars": [
            (36, [55, 60, 64],     [(0.0, 1.5, 76), (1.5, 1.0, 74), (2.5, 1.5, 72)]),   # C
            (47, [55, 59, 62, 67], [(0.0, 2.0, 74), (2.0, 2.0, 71)]),                    # G/B
            (45, [57, 60, 64, 67], [(0.0, 1.5, 72), (1.5, 1.0, 76), (2.5, 1.5, 74)]),   # Am7
            (41, [57, 60, 65],     [(0.0, 2.0, 72), (2.0, 2.0, 69)]),                    # F
            (38, [57, 60, 62, 65], [(0.0, 1.5, 69), (1.5, 1.0, 72), (2.5, 1.5, 74)]),   # Dm7
            (43, [55, 59, 62, 65], [(0.0, 2.0, 74), (2.0, 2.0, 71)]),                    # G7
            (36, [55, 60, 64],     [(0.0, 2.0, 72), (2.0, 2.0, 76)]),                    # C
            (36, [55, 59, 60, 64], [(0.0, 3.5, 72)]),                                     # Cmaj7
        ],
    },
    {
        "id": "velvet-neosoul",
        "title": "Velvet Keys (Neo-Soul 7ths)",
        "artist": "KeySense Studio Session",
        "genre": "R&B / Neo-Soul",
        "bpm": 90.0,
        "style": "neosoul",
        "beatsPerChord": 4,
        # Key of Eb Major: Fm7 -> Bb7 -> Ebmaj7 -> Cm7 (8 bars)
        "bars": [
            (41, [56, 60, 63, 65], [(0.0, 1.5, 77), (2.0, 2.0, 75)]),                    # Fm7
            (46, [56, 58, 62, 65], [(0.0, 1.5, 74), (2.0, 2.0, 70)]),                    # Bb7
            (39, [55, 58, 62, 63], [(0.0, 1.5, 74), (1.5, 1.0, 75), (2.5, 1.5, 70)]),   # Ebmaj7
            (36, [55, 58, 60, 63], [(0.0, 2.0, 72), (2.0, 2.0, 67)]),                    # Cm7
            (41, [56, 60, 63, 65], [(0.0, 1.5, 77), (2.0, 2.0, 79)]),                    # Fm7
            (46, [56, 58, 62, 65], [(0.0, 1.5, 77), (2.0, 2.0, 74)]),                    # Bb7
            (39, [55, 58, 62, 63], [(0.0, 3.5, 75)]),                                     # Ebmaj7
            (36, [55, 58, 60, 63], [(0.0, 3.5, 72)]),                                     # Cm7
        ],
    },
    {
        "id": "horizon-anthem",
        "title": "Northern Horizon (Pop-Rock Progression)",
        "artist": "KeySense Studio Session",
        "genre": "Pop / Indie Anthem",
        "bpm": 116.0,
        "style": "pop",
        "beatsPerChord": 4,
        # Key of G Major: G -> D -> Em -> C (8 bars)
        "bars": [
            (43, [55, 59, 62], [(0.0, 1.5, 74), (1.5, 1.5, 71), (3.0, 1.0, 67)]),       # G
            (38, [54, 57, 62], [(0.0, 2.0, 69), (2.0, 2.0, 66)]),                        # D
            (40, [55, 59, 64], [(0.0, 1.5, 71), (1.5, 1.5, 74), (3.0, 1.0, 76)]),       # Em
            (36, [55, 60, 64], [(0.0, 2.0, 72), (2.0, 2.0, 67)]),                        # C
            (43, [55, 59, 62], [(0.0, 1.5, 79), (1.5, 1.5, 74), (3.0, 1.0, 71)]),       # G
            (38, [54, 57, 62], [(0.0, 2.0, 74), (2.0, 2.0, 69)]),                        # D
            (36, [55, 60, 64], [(0.0, 2.0, 72), (2.0, 2.0, 71)]),                        # C
            (43, [55, 59, 62], [(0.0, 3.5, 67)]),                                         # G
        ],
    },
]


def ensure_demos_generated() -> List[Dict[str, Any]]:
    DEMOS_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = DEMOS_DIR / "manifest.json"
    if manifest_path.exists():
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if len(cached) == len(DEMO_SPECS) and all(
                (DEMOS_DIR / f"{item['id']}.wav").exists() for item in cached
            ):
                return cached
        except Exception:
            pass

    manifest: List[Dict[str, Any]] = []
    for spec in DEMO_SPECS:
        wav_bytes = render_song(
            bpm=spec["bpm"],
            bars=spec["bars"],
            style=spec["style"],
            beats_per_chord=spec["beatsPerChord"],
        )
        wav_filename = f"{spec['id']}.wav"
        wav_path = DEMOS_DIR / wav_filename
        with open(wav_path, "wb") as wf:
            wf.write(wav_bytes)

        analysis = analyze_audio_bytes(wav_bytes, filename=f"{spec['title']}.wav")
        analysis_path = DEMOS_DIR / f"{spec['id']}.json"
        with open(analysis_path, "w", encoding="utf-8") as af:
            json.dump(analysis, af)

        manifest.append({
            "id": spec["id"],
            "title": spec["title"],
            "artist": spec["artist"],
            "genre": spec["genre"],
            "audioUrl": f"/demos/{wav_filename}",
            "duration": analysis["duration"],
            "bpm": analysis["bpm"],
            "keyName": analysis["key"]["name"],
            "chordPreview": [c["symbol"] for c in analysis["chords"][:6]],
        })

    with open(manifest_path, "w", encoding="utf-8") as mf:
        json.dump(manifest, mf, indent=2)
    return manifest


if __name__ == "__main__":
    items = ensure_demos_generated()
    for it in items:
        print(
            f"[{it['id']}] {it['title']} -> Key: {it['keyName']} | "
            f"BPM: {it['bpm']} | Chords: {' -> '.join(it['chordPreview'])}"
        )
