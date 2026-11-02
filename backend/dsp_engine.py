"""
KeySense Studio — Acoustic DSP & Music Theory Engine
Performs tuning-corrected 24-BPO Constant-Q Transform (CQT), CQT-domain
Harmonic-Percussive Source Separation, iterative harmonic overtone suppression,
key signature detection (Krumhansl-Kessler + Temperley ensemble with enharmonic
spelling), beat-synchronous Viterbi chord & slash-bass decoding, smooth piano
voice-leading generation, polyphonic piano key extraction, and MIDI export.
"""

from __future__ import annotations

import io
import math
import struct
import time
from typing import Any, Dict, List, Optional, Tuple

import librosa
import numpy as np
import scipy.ndimage
import scipy.signal
import soundfile as sf

# ---------------------------------------------------------------------------
# Pitch, Key & Enharmonic Spelling Constants
# ---------------------------------------------------------------------------

PITCH_CLASSES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
PITCH_CLASSES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# Keys whose standard music-theory spelling uses flats:
FLAT_MAJOR_ROOTS = {5, 10, 3, 8, 1, 6}   # F, Bb, Eb, Ab, Db, Gb
FLAT_MINOR_ROOTS = {2, 7, 0, 5, 10, 3}   # Dm, Gm, Cm, Fm, Bbm, Ebm

CAMELOT_MAJOR = {
    0: "8B", 7: "9B", 2: "10B", 9: "11B", 4: "12B", 11: "1B",
    6: "2B", 1: "3B", 8: "4B", 3: "5B", 10: "6B", 5: "7B",
}
CAMELOT_MINOR = {
    9: "8A", 4: "9A", 11: "10A", 6: "11A", 1: "12A", 8: "1A",
    3: "2A", 10: "3A", 5: "4A", 0: "5A", 7: "6A", 2: "7A",
}

# Ensemble of Krumhansl-Kessler & Temperley pitch-class profiles (normalized)
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

TEMP_MAJOR = np.array([5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0])
TEMP_MINOR = np.array([5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 2.5, 3.0])

MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11]
MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10]

# Chord quality definitions: (suffix, intervals_semitones, weights, complexity_penalty)
CHORD_QUALITIES: List[Tuple[str, List[int], List[float], float]] = [
    ("",     [0, 4, 7],     [1.15, 0.98, 0.92],       0.000), # Major triad
    ("m",    [0, 3, 7],     [1.15, 0.98, 0.92],       0.000), # Minor triad
    ("7",    [0, 4, 7, 10], [1.08, 0.90, 0.80, 0.92], 0.024), # Dominant 7th
    ("maj7", [0, 4, 7, 11], [1.08, 0.90, 0.80, 0.92], 0.026), # Major 7th
    ("m7",   [0, 3, 7, 10], [1.08, 0.90, 0.80, 0.92], 0.022), # Minor 7th
    ("sus4", [0, 5, 7],     [1.10, 0.95, 0.85],       0.052), # Suspended 4th
    ("sus2", [0, 2, 7],     [1.10, 0.92, 0.85],       0.062), # Suspended 2nd
    ("dim",  [0, 3, 6],     [1.05, 0.95, 0.95],       0.068), # Diminished
    ("aug",  [0, 4, 8],     [1.05, 0.95, 0.95],       0.078), # Augmented
]


def spell_pc(pc: int, use_flats: bool) -> str:
    pc = int(pc) % 12
    return PITCH_CLASSES_FLAT[pc] if use_flats else PITCH_CLASSES_SHARP[pc]


def midi_to_name(midi_note: int, use_flats: bool = False) -> str:
    octave = (midi_note // 12) - 1
    return f"{spell_pc(midi_note % 12, use_flats)}{octave}"


# ---------------------------------------------------------------------------
# Chord Templates & Musical Theory Helpers
# ---------------------------------------------------------------------------

def _build_chord_catalog() -> Tuple[np.ndarray, List[Tuple[int, str, List[int], float]]]:
    """
    Returns:
      templates: (N_chords, 12) L2-normalized template matrix with negative penalty on non-chord tones
      meta: list of (root_pc, suffix, intervals, complexity_penalty)
    """
    templates = []
    meta = []
    for root in range(12):
        for suffix, intervals, weights, penalty in CHORD_QUALITIES:
            vec = np.full(12, -0.18, dtype=np.float32)
            for iv, w in zip(intervals, weights):
                vec[(root + iv) % 12] = w
            # Penalize clashing 3rds specifically so Major vs Minor vs Sus4 are crisp
            if suffix == "":
                vec[(root + 3) % 12] = -0.35
                vec[(root + 5) % 12] = -0.25
            elif suffix == "m":
                vec[(root + 4) % 12] = -0.35
                vec[(root + 5) % 12] = -0.25
            elif suffix in ("sus4", "sus2"):
                vec[(root + 3) % 12] = -0.35
                vec[(root + 4) % 12] = -0.35
            norm = np.linalg.norm(np.maximum(vec, 0.0)) + 1e-8
            vec = vec / norm
            templates.append(vec)
            meta.append((root, suffix, intervals, penalty))
    return np.stack(templates, axis=0), meta


CHORD_TEMPLATES, CHORD_META = _build_chord_catalog()


def compute_roman_and_nashville(
    chord_root: int,
    suffix: str,
    key_root: int,
    key_mode: str,
) -> Tuple[str, str, bool]:
    """
    Computes Roman numeral, Nashville number, and whether the chord is diatonic
    to the detected song key (using relative major reference for Nashville numbers).
    """
    # For Nashville numbers, musicians typically reference the Major tonic (or natural minor 1m..7)
    rel_major_root = key_root if key_mode == "major" else (key_root + 3) % 12
    rel_semitones = (chord_root - key_root) % 12

    if key_mode == "major":
        degree_map = {
            0: ("I", "1"),
            1: ("bII", "b2"),
            2: ("ii", "2"),
            3: ("bIII", "b3"),
            4: ("iii", "3"),
            5: ("IV", "4"),
            6: ("#IV", "#4"),
            7: ("V", "5"),
            8: ("bVI", "b6"),
            9: ("vi", "6"),
            10: ("bVII", "b7"),
            11: ("vii", "7"),
        }
        diatonic_pairs = {
            (0, ""), (0, "maj7"), (0, "sus4"), (0, "sus2"),
            (2, "m"), (2, "m7"),
            (4, "m"), (4, "m7"),
            (5, ""), (5, "maj7"), (5, "sus2"),
            (7, ""), (7, "7"), (7, "sus4"),
            (9, "m"), (9, "m7"),
            (11, "dim"),
        }
    else:
        degree_map = {
            0: ("i", "1"),
            1: ("bII", "b2"),
            2: ("ii", "2"),
            3: ("III", "b3"),
            4: ("#III", "3"),
            5: ("iv", "4"),
            6: ("#iv", "#4"),
            7: ("v", "5"),
            8: ("VI", "b6"),
            9: ("vi", "6"),
            10: ("VII", "b7"),
            11: ("vii", "7"),
        }
        diatonic_pairs = {
            (0, "m"), (0, "m7"), (0, "sus4"), (0, "sus2"),
            (2, "dim"),
            (3, ""), (3, "maj7"),
            (5, "m"), (5, "m7"),
            (7, "m"), (7, "m7"), (7, ""), (7, "7"),  # harmonic minor V/V7 included!
            (8, ""), (8, "maj7"),
            (10, ""), (10, "7"),
            (11, "dim"),
        }

    base_roman, base_num = degree_map[rel_semitones]
    is_minor_chord = suffix in ("m", "m7", "dim")
    is_major_chord = suffix in ("", "7", "maj7", "aug")

    # Adjust Roman case to reflect actual chord quality
    roman_letters = base_roman.lstrip("b#")
    accidental = base_roman[: len(base_roman) - len(roman_letters)]
    if is_minor_chord:
        roman_core = roman_letters.lower()
    elif is_major_chord:
        roman_core = roman_letters.upper()
    else:
        roman_core = roman_letters

    roman_ext = ""
    if suffix == "7":
        roman_ext = "7"
    elif suffix == "maj7":
        roman_ext = "maj7"
    elif suffix == "m7":
        roman_ext = "7"
    elif suffix in ("sus4", "sus2", "aug"):
        roman_ext = suffix
    elif suffix == "dim":
        roman_ext = "°"

    nash_ext = suffix
    roman = f"{accidental}{roman_core}{roman_ext}"
    nashville = f"{base_num}{nash_ext}"
    is_diatonic = (rel_semitones, suffix) in diatonic_pairs
    return roman, nashville, is_diatonic


# ---------------------------------------------------------------------------
# Piano Voicing Generator (Beginner Triad, Smooth Voice-Led, Pro 7th/Gospel)
# ---------------------------------------------------------------------------

def generate_piano_voicings(
    root_pc: int,
    suffix: str,
    intervals: List[int],
    bass_pc: int,
    prev_rh_midi: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """
    Generates three playable two-hand piano voicings for a chord:
      1. `root`: Easy beginner triad/tetrad in Root Position around C4 (MIDI 60) + single LH bass note
      2. `smooth`: Voice-led inversion minimizing finger movement from previous chord + LH octave/fifth
      3. `pro`: Rich studio/gospel/neo-soul extended voicing (add9 / shell + color tones)
    """
    # Left-hand bass in C2..B2 (MIDI 36..47) or E2..D#3 (MIDI 40..51) for clarity
    lh_root = 36 + bass_pc
    if lh_root < 38:
        lh_root += 12  # Keep low D2..C#3 warm and clear, avoiding muddy C2 rumble

    # 1. Root position RH (C4..B4 base = MIDI 60..71)
    rh_base = 60 + root_pc
    if rh_base > 67:
        rh_base -= 12  # Keep between G3 (55) and F#4 (66) so top notes sit comfortably around C5
    root_rh = sorted([rh_base + iv for iv in intervals])
    root_lh = [lh_root]

    # 2. Smooth Voice-Led RH (choose inversion around MIDI 57..74 closest to prev_rh_midi)
    pcs = [(root_pc + iv) % 12 for iv in intervals]
    candidate_voicings: List[List[int]] = []
    for base_midi in range(53, 69):  # F3 to G#4 bottom note candidates
        if (base_midi % 12) not in pcs:
            continue
        voicing = [base_midi]
        cur = base_midi
        remaining = [p for p in pcs if p != (base_midi % 12)]
        for _ in range(len(remaining)):
            # Pick next pitch class upward to make a compact close voicing
            best_next = min(
                [cur + ((p - cur) % 12 or 12) for p in remaining]
            )
            voicing.append(best_next)
            remaining.remove(best_next % 12)
            cur = best_next
        candidate_voicings.append(voicing)

    target_center = 64.0
    if prev_rh_midi and len(prev_rh_midi) > 0:
        prev_center = sum(prev_rh_midi) / len(prev_rh_midi)
        def voice_cost(v: List[int]) -> float:
            center_diff = abs((sum(v) / len(v)) - 63.5) * 0.35
            # Sum of minimum note-to-note distances from previous chord
            move_cost = sum(min(abs(n - p) for p in prev_rh_midi) for n in v) / len(v)
            return move_cost + center_diff
        smooth_rh = min(candidate_voicings, key=voice_cost)
    else:
        smooth_rh = min(candidate_voicings, key=lambda v: abs((sum(v) / len(v)) - target_center))

    smooth_lh = [lh_root, lh_root + 12] if bass_pc != root_pc else [lh_root, lh_root + 7]

    # 3. Pro / Rich Studio Voicing (adds 9th or lush spread voicing)
    pro_lh = [lh_root - 12 if lh_root >= 45 else lh_root, lh_root + 7]
    if suffix == "":
        # Major add9 / maj7 lush voicing: 3 - 5 - 9 (or 1 - 3 - 5 - 9)
        pro_ivs = [4, 7, 12, 14]
    elif suffix == "m":
        # Minor add9 / m7 lush voicing: b3 - 5 - b7 - 9
        pro_ivs = [3, 7, 10, 14]
    elif suffix == "7":
        # Dominant 9 / 13 shell: 3 - b7 - 9 - 13 (9 + 21 -> 3, 9, 10, 14)
        pro_ivs = [4, 9, 10, 14]
    elif suffix == "maj7":
        # Major 9: 3 - 5 - 7 - 9
        pro_ivs = [4, 7, 11, 14]
    elif suffix == "m7":
        # Minor 9: b3 - 5 - b7 - 9
        pro_ivs = [3, 7, 10, 14]
    elif suffix == "sus4":
        pro_ivs = [2, 5, 7, 12]
    else:
        pro_ivs = [iv for iv in intervals] + [intervals[0] + 12]

    pro_base = 55 + root_pc if (55 + root_pc) >= 55 else 67 + root_pc
    if pro_base > 64:
        pro_base -= 12
    pro_rh = sorted(list({pro_base + iv for iv in pro_ivs}))

    return {
        "smooth": {"lh": smooth_lh, "rh": smooth_rh, "all": sorted(list(set(smooth_lh + smooth_rh)))},
        "root": {"lh": root_lh, "rh": root_rh, "all": sorted(list(set(root_lh + root_rh)))},
        "pro": {"lh": pro_lh, "rh": pro_rh, "all": sorted(list(set(pro_lh + pro_rh)))},
    }


# ---------------------------------------------------------------------------
# Harmonic Overtone Suppression on 84-Key CQT
# ---------------------------------------------------------------------------

def suppress_overtones(cqt_harm: np.ndarray) -> np.ndarray:
    """
    Iteratively subtracts acoustic harmonic partials (2f=+12, 3f=+19, 4f=+24, 5f=+28)
    from an 84-bin semitone CQT magnitude matrix (C1..B7) so upper piano keys and
    chord 3rds/7ths aren't polluted by bass/fundamental overtones.
    """
    cleaned = cqt_harm.copy()
    partials = [(12, 0.34), (19, 0.22), (24, 0.14), (28, 0.09), (31, 0.06)]
    n_bins = cleaned.shape[0]
    for b in range(n_bins):
        fund = cleaned[b]
        for offset, alpha in partials:
            target = b + offset
            if target < n_bins:
                cleaned[target] = np.maximum(0.0, cleaned[target] - alpha * fund)
    return cleaned


# ---------------------------------------------------------------------------
# Core Song Analysis Pipeline
# ---------------------------------------------------------------------------

def detect_key_signature(
    chroma_mid: np.ndarray,
    chroma_bass: np.ndarray,
) -> Dict[str, Any]:
    """
    Combines mid-register harmonic chroma and bass-register root chroma against
    both Krumhansl-Kessler and Temperley major/minor key profiles.
    """
    # Weight bass chroma heavily toward tonic & dominant stability
    profile_obs = 0.72 * np.mean(chroma_mid, axis=1) + 0.28 * np.mean(chroma_bass, axis=1)
    if np.std(profile_obs) < 1e-8:
        profile_obs = np.ones(12, dtype=np.float32)

    obs_z = (profile_obs - np.mean(profile_obs)) / (np.std(profile_obs) + 1e-8)

    def znorm(arr: np.ndarray) -> np.ndarray:
        return (arr - np.mean(arr)) / (np.std(arr) + 1e-8)

    kk_maj_z, kk_min_z = znorm(KK_MAJOR), znorm(KK_MINOR)
    tp_maj_z, tp_min_z = znorm(TEMP_MAJOR), znorm(TEMP_MINOR)

    candidates = []
    for root in range(12):
        rot_obs = np.roll(obs_z, -root)
        maj_score = 0.55 * float(np.dot(rot_obs, kk_maj_z) / 12.0) + 0.45 * float(np.dot(rot_obs, tp_maj_z) / 12.0)
        min_score = 0.55 * float(np.dot(rot_obs, kk_min_z) / 12.0) + 0.45 * float(np.dot(rot_obs, tp_min_z) / 12.0)
        # Small tonic bass tie-breaker between relative Major and Minor!
        bass_norm = np.mean(chroma_bass, axis=1) / (np.max(np.mean(chroma_bass, axis=1)) + 1e-8)
        maj_score += 0.08 * float(bass_norm[root])
        min_score += 0.08 * float(bass_norm[root])

        candidates.append((maj_score, root, "major"))
        candidates.append((min_score, root, "minor"))

    candidates.sort(key=lambda x: x[0], reverse=True)
    best_score, best_root, best_mode = candidates[0]
    second_score, alt_root, alt_mode = candidates[1]

    use_flats = (
        (best_root in FLAT_MAJOR_ROOTS)
        if best_mode == "major"
        else (best_root in FLAT_MINOR_ROOTS)
    )
    root_name = spell_pc(best_root, use_flats)
    mode_label = "Major" if best_mode == "major" else "Minor"
    full_name = f"{root_name} {mode_label}"

    # Relative Major / Minor
    if best_mode == "major":
        rel_root = (best_root + 9) % 12
        rel_name = f"{spell_pc(rel_root, use_flats)} Minor"
        camelot = CAMELOT_MAJOR[best_root]
        scale_ivs = MAJOR_SCALE_INTERVALS
    else:
        rel_root = (best_root + 3) % 12
        rel_name = f"{spell_pc(rel_root, use_flats)} Major"
        camelot = CAMELOT_MINOR[best_root]
        scale_ivs = MINOR_SCALE_INTERVALS

    scale_pcs = [(best_root + iv) % 12 for iv in scale_ivs]
    scale_notes = [spell_pc(pc, use_flats) for pc in scale_pcs]

    # Calibrate confidence to a readable 65%..99% studio confidence
    margin = max(0.0, best_score - second_score)
    confidence = float(np.clip(0.68 + 0.25 * best_score + 0.45 * margin, 0.55, 0.99))

    alt_flats = (alt_root in FLAT_MAJOR_ROOTS) if alt_mode == "major" else (alt_root in FLAT_MINOR_ROOTS)
    alt_name = f"{spell_pc(alt_root, alt_flats)} {'Major' if alt_mode == 'major' else 'Minor'}"

    return {
        "rootPc": int(best_root),
        "rootName": root_name,
        "mode": best_mode,
        "name": full_name,
        "useFlats": bool(use_flats),
        "confidence": round(confidence, 3),
        "relativeKey": rel_name,
        "alternateKey": alt_name,
        "camelot": camelot,
        "scalePitchClasses": scale_pcs,
        "scaleNotes": scale_notes,
        "chromaProfile": [round(float(x), 4) for x in (profile_obs / (np.max(profile_obs) + 1e-8))],
    }


def analyze_audio_bytes(
    audio_bytes: bytes,
    filename: str = "uploaded_song.wav",
    max_duration_sec: float = 360.0,
) -> Dict[str, Any]:
    """
    Full song key, BPM, beat grid, chord progression, piano voicings, and
    polyphonic piano-key extraction from audio bytes.
    """
    t_start = time.time()

    with io.BytesIO(audio_bytes) as bio:
        data, orig_sr = sf.read(bio, dtype="float32", always_2d=True)

    # Convert to mono while preserving harmonic clarity
    y = np.mean(data, axis=1)
    target_sr = 22050
    if orig_sr != target_sr:
        y = librosa.resample(y, orig_sr=orig_sr, target_sr=target_sr)
    sr = target_sr

    if len(y) > int(max_duration_sec * sr):
        y = y[: int(max_duration_sec * sr)]

    duration = float(len(y) / sr)
    if duration < 0.8:
        raise ValueError("Audio clip is too short (< 0.8s). Please provide at least 1 second of audio.")

    # Normalize audio gently for consistent analysis thresholds
    peak = float(np.max(np.abs(y)))
    if peak > 1e-5:
        y = y / peak

    # 1. Estimate tuning offset on up to 30s of middle audio
    mid_slice_start = max(0, int((duration * 0.2) * sr))
    mid_slice_end = min(len(y), mid_slice_start + int(25 * sr))
    try:
        tuning = float(librosa.estimate_tuning(y=y[mid_slice_start:mid_slice_end], sr=sr))
    except Exception:
        tuning = 0.0
    a4_hz = round(440.0 * (2.0 ** (tuning / 12.0)), 1)

    # 2. High-selectivity 24-BPO Constant-Q Transform from C1 (MIDI 24) to B7 (MIDI 107)
    hop_length = 512  # ~23.2 ms temporal resolution
    cqt_24 = np.abs(
        librosa.cqt(
            y,
            sr=sr,
            hop_length=hop_length,
            fmin=librosa.note_to_hz("C1"),
            n_bins=84 * 2,
            bins_per_octave=24,
            tuning=tuning,
        )
    )
    # Center bin of each semitone -> 84 piano keys (MIDI 24..107)
    cqt_raw = cqt_24[0::2, :]
    n_frames = cqt_raw.shape[1]
    frame_times = librosa.frames_to_time(np.arange(n_frames), sr=sr, hop_length=hop_length)

    # 3. CQT-domain Harmonic-Percussive Source Separation
    cqt_harm, cqt_perc = librosa.decompose.hpss(cqt_raw, kernel_size=(13, 19), margin=(1.4, 1.4))

    # 4. Suppress acoustic overtones across the 84 semitone bins
    cqt_clean = suppress_overtones(cqt_harm)

    # 5. Beat & Tempo Tracking using combined percussive + harmonic onset envelope
    onset_perc = librosa.onset.onset_strength(
        S=librosa.amplitude_to_db(cqt_perc + 1e-6), sr=sr, hop_length=hop_length
    )
    onset_harm = librosa.onset.onset_strength(
        S=librosa.amplitude_to_db(cqt_harm + 1e-6), sr=sr, hop_length=hop_length
    )
    onset_env = 0.65 * onset_perc + 0.35 * onset_harm
    tempo_arr, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sr, hop_length=hop_length, start_bpm=110.0
    )
    bpm = float(np.atleast_1d(tempo_arr)[0])
    if bpm < 58.0 and bpm > 0:
        bpm *= 2.0
    elif bpm > 185.0:
        bpm *= 0.5
    if bpm <= 0 or math.isnan(bpm):
        bpm = 100.0

    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop_length).tolist()
    # Fallback regular beat grid if song is ambient/rubato with sparse percussion
    if len(beat_times) < max(3, int(duration / 2.5)):
        beat_step = 60.0 / bpm
        beat_times = list(np.arange(0.0, duration, beat_step))
        beat_frames = librosa.time_to_frames(beat_times, sr=sr, hop_length=hop_length)

    # Build analysis segment boundaries aligned to beats (ensure 0.0 and duration are included)
    seg_frames = sorted(list({0, *[int(f) for f in beat_frames if 0 < f < n_frames - 2], n_frames}))
    # Subdivide very long beats (>0.85s) so half-bar passing chords are caught accurately!
    refined_frames = [seg_frames[0]]
    for i in range(len(seg_frames) - 1):
        f0, f1 = seg_frames[i], seg_frames[i + 1]
        dt = (f1 - f0) * hop_length / sr
        if dt > 0.85 and (f1 - f0) >= 8:
            mid = (f0 + f1) // 2
            refined_frames.extend([mid, f1])
        else:
            refined_frames.append(f1)
    seg_frames = refined_frames

    # 6. Build Register-Separated Chroma Matrices:
    #    - Bass register: C1..B2 (bins 0..23, MIDI 24..47) + C3..F#3 weighted
    #    - Harmony register: G2..C6 (bins 19..60, MIDI 43..84)
    chroma_bass = np.zeros((12, n_frames), dtype=np.float32)
    for b in range(0, 28):  # C1..E3
        weight = 1.0 if b < 24 else 0.5
        chroma_bass[b % 12] += weight * cqt_clean[b]

    chroma_mid = np.zeros((12, n_frames), dtype=np.float32)
    for b in range(12, 64):  # C2..E6
        weight = 1.0 if 19 <= b <= 55 else 0.65
        chroma_mid[b % 12] += weight * cqt_clean[b]

    # 7. Global Key Signature Detection
    key_info = detect_key_signature(chroma_mid, chroma_bass)
    use_flats = key_info["useFlats"]
    key_root = key_info["rootPc"]
    key_mode = key_info["mode"]

    # 8. Segment-Synchronous Chord & Bass Observation Scoring + Viterbi Decoding
    n_segs = len(seg_frames) - 1
    n_chords = len(CHORD_META)
    log_lik = np.zeros((n_segs, n_chords), dtype=np.float32)
    seg_bass_pc = np.zeros(n_segs, dtype=np.int32)
    seg_bass_strength = np.zeros(n_segs, dtype=np.float32)
    seg_rms = np.zeros(n_segs, dtype=np.float32)

    # Precompute diatonic bonus vector for detected key
    diatonic_bonus = np.zeros(n_chords, dtype=np.float32)
    complexity_penalties = np.array([m[3] for m in CHORD_META], dtype=np.float32)
    for c_idx, (c_root, c_suf, _, _) in enumerate(CHORD_META):
        _, _, is_diatonic = compute_roman_and_nashville(c_root, c_suf, key_root, key_mode)
        if is_diatonic:
            diatonic_bonus[c_idx] = 0.048

    for s in range(n_segs):
        f0, f1 = seg_frames[s], max(seg_frames[s] + 1, seg_frames[s + 1])
        mid_vec = np.median(chroma_mid[:, f0:f1], axis=1)
        bass_vec = np.median(chroma_bass[:, f0:f1], axis=1)
        comb_vec = 0.72 * mid_vec + 0.28 * bass_vec

        energy = float(np.linalg.norm(comb_vec))
        seg_rms[s] = energy
        if energy < 1e-6:
            log_lik[s, :] = 0.0
            continue

        norm_vec = comb_vec / energy
        scores = CHORD_TEMPLATES @ norm_vec

        # Bass root reinforcement: if a clear low bass note is present, boost chords whose root matches
        bass_sum = float(np.sum(bass_vec)) + 1e-8
        bass_top = int(np.argmax(bass_vec))
        bass_prominence = float(bass_vec[bass_top] / bass_sum)
        seg_bass_pc[s] = bass_top
        seg_bass_strength[s] = bass_prominence

        if bass_prominence > 0.24:
            for c_idx, (c_root, _, c_ivs, _) in enumerate(CHORD_META):
                if c_root == bass_top:
                    scores[c_idx] += 0.085 * min(1.0, bass_prominence * 2.2)
                elif ((bass_top - c_root) % 12) in c_ivs:
                    # Potential inversion (e.g., C/E, Eb/G, or G/B)
                    scores[c_idx] += 0.055 * min(1.0, bass_prominence * 2.0)

        # Penalize candidates that have a completely silent chord tone (e.g. Gm missing D when Eb/G is played)
        for c_idx, (c_root, _, c_ivs, _) in enumerate(CHORD_META):
            min_tone = min(float(norm_vec[(c_root + iv) % 12]) for iv in c_ivs)
            if min_tone < 0.08:
                scores[c_idx] -= 0.055

        scores = scores + diatonic_bonus - complexity_penalties
        log_lik[s] = scores * 5.0  # Temperature scaling for Viterbi transition balance

    # Viterbi Decoding with musical self-transition stickiness so chords don't flicker
    stay_bonus = 0.62
    dp = np.zeros((n_segs, n_chords), dtype=np.float32)
    backptr = np.zeros((n_segs, n_chords), dtype=np.int32)
    dp[0] = log_lik[0]

    for s in range(1, n_segs):
        best_prev_idx = int(np.argmax(dp[s - 1]))
        best_prev_val = float(dp[s - 1, best_prev_idx])
        for c in range(n_chords):
            stay_val = dp[s - 1, c] + stay_bonus
            if stay_val >= best_prev_val:
                dp[s, c] = stay_val + log_lik[s, c]
                backptr[s, c] = c
            else:
                dp[s, c] = best_prev_val + log_lik[s, c]
                backptr[s, c] = best_prev_idx

    path = [0] * n_segs
    path[-1] = int(np.argmax(dp[-1]))
    for s in range(n_segs - 2, -1, -1):
        path[s] = int(backptr[s + 1, path[s + 1]])

    # 9. Extract Polyphonic Detected Piano Keys per time slice (~140ms grid for live piano roll)
    #    AND merge consecutive identical chords into clean Chord Segments!
    global_cqt_max = float(np.percentile(cqt_clean, 99.2)) + 1e-8
    cqt_norm = np.clip(cqt_clean / global_cqt_max, 0.0, 1.0)

    piano_roll_step_frames = 4  # 4 * 23.2ms = ~92.8ms resolution!
    piano_slices: List[Dict[str, Any]] = []
    for f0 in range(0, n_frames, piano_roll_step_frames):
        f1 = min(n_frames, f0 + piano_roll_step_frames)
        col = np.mean(cqt_norm[:, f0:f1], axis=1)  # 84 bins (MIDI 24..107)
        # Peak-pick prominent piano keys across bass & treble registers
        peaks, _ = scipy.signal.find_peaks(col, height=0.19, prominence=0.07)
        if len(peaks) > 0:
            # Sort by strength and keep up to 7 strongest simultaneous notes
            ranked = sorted(peaks.tolist(), key=lambda b: float(col[b]), reverse=True)[:7]
            notes = [
                {"midi": int(24 + b), "vel": round(float(col[b]), 2)}
                for b in sorted(ranked)
            ]
        else:
            notes = []
        t_slice = round(float(f0 * hop_length / sr), 3)
        if notes:
            piano_slices.append({"t": t_slice, "notes": notes})

    # Merge segments into chord blocks
    raw_blocks = []
    max_rms = float(np.max(seg_rms)) + 1e-8
    for s in range(n_segs):
        f0, f1 = seg_frames[s], seg_frames[s + 1]
        t0 = float(frame_times[min(f0, n_frames - 1)])
        t1 = duration if f1 >= n_frames else float(frame_times[f1])
        c_idx = path[s]
        c_root, c_suf, c_ivs, _ = CHORD_META[c_idx]

        # Check slash bass (inversion) if bass note is clearly a non-root chord tone
        bass_pc = int(seg_bass_pc[s])
        has_slash = (
            seg_bass_strength[s] > 0.34
            and bass_pc != c_root
            and ((bass_pc - c_root) % 12) in c_ivs
        )
        eff_bass = bass_pc if has_slash else c_root

        # Compute confidence for this segment
        seg_probs = np.exp(log_lik[s] - np.max(log_lik[s]))
        conf = float(seg_probs[c_idx] / (np.sum(seg_probs) + 1e-8))
        # Calibrate readable confidence
        cal_conf = float(np.clip(0.55 + conf * 2.8, 0.52, 0.99))
        if seg_rms[s] < 0.06 * max_rms:
            cal_conf *= 0.6

        raw_blocks.append({
            "start": t0,
            "end": t1,
            "f0": f0,
            "f1": f1,
            "chordIdx": c_idx,
            "rootPc": c_root,
            "suffix": c_suf,
            "intervals": c_ivs,
            "bassPc": eff_bass,
            "hasSlash": has_slash,
            "confidence": cal_conf,
        })

    # Merge adjacent blocks with identical chordIdx & bassPc
    merged_blocks = []
    for blk in raw_blocks:
        if (
            merged_blocks
            and merged_blocks[-1]["chordIdx"] == blk["chordIdx"]
            and merged_blocks[-1]["bassPc"] == blk["bassPc"]
        ):
            prev = merged_blocks[-1]
            dur_prev = prev["end"] - prev["start"]
            dur_cur = blk["end"] - blk["start"]
            prev["end"] = blk["end"]
            prev["f1"] = blk["f1"]
            prev["confidence"] = (prev["confidence"] * dur_prev + blk["confidence"] * dur_cur) / max(
                1e-6, dur_prev + dur_cur
            )
        else:
            merged_blocks.append(dict(blk))

    # Build enriched final chord list with smooth voice-leading across the song!
    chords_out = []
    prev_rh_midi: Optional[List[int]] = None
    chord_usage_counts: Dict[str, float] = {}

    for idx, blk in enumerate(merged_blocks):
        c_root = blk["rootPc"]
        c_suf = blk["suffix"]
        c_ivs = blk["intervals"]
        bass_pc = blk["bassPc"]

        root_str = spell_pc(c_root, use_flats)
        bass_str = spell_pc(bass_pc, use_flats)
        symbol = f"{root_str}{c_suf}"
        if blk["hasSlash"] and bass_pc != c_root:
            symbol = f"{symbol}/{bass_str}"

        roman, nashville, is_diatonic = compute_roman_and_nashville(
            c_root, c_suf, key_root, key_mode
        )
        voicings = generate_piano_voicings(c_root, c_suf, c_ivs, bass_pc, prev_rh_midi)
        prev_rh_midi = voicings["smooth"]["rh"]

        # Also extract actual detected piano keys during this chord's span!
        f0, f1 = blk["f0"], max(blk["f0"] + 1, min(n_frames, blk["f1"]))
        chord_cqt_avg = np.mean(cqt_norm[:, f0:f1], axis=1)
        peaks, _ = scipy.signal.find_peaks(chord_cqt_avg, height=0.16, prominence=0.05)
        ranked_peaks = sorted(peaks.tolist(), key=lambda b: float(chord_cqt_avg[b]), reverse=True)[:6]
        detected_midi = sorted([int(24 + b) for b in ranked_peaks])

        chord_pcs = [(c_root + iv) % 12 for iv in c_ivs]
        chord_note_names = [spell_pc(pc, use_flats) for pc in chord_pcs]

        seg_dur = max(0.0, blk["end"] - blk["start"])
        chord_usage_counts[symbol] = chord_usage_counts.get(symbol, 0.0) + seg_dur

        chords_out.append({
            "id": idx,
            "start": round(blk["start"], 3),
            "end": round(blk["end"], 3),
            "duration": round(seg_dur, 3),
            "symbol": symbol,
            "rootPc": int(c_root),
            "rootName": root_str,
            "suffix": c_suf,
            "bassPc": int(bass_pc),
            "bassName": bass_str,
            "hasSlash": bool(blk["hasSlash"]),
            "intervals": c_ivs,
            "pitchClasses": chord_pcs,
            "noteNames": chord_note_names,
            "roman": roman,
            "nashville": nashville,
            "isDiatonic": bool(is_diatonic),
            "confidence": round(float(blk["confidence"]), 3),
            "voicings": voicings,
            "detectedMidi": detected_midi,
        })

    # 10. Downsampled Stereo/Envelope Waveform Peaks (600 points) for crisp timeline rendering
    n_wave_pts = min(700, max(120, int(duration * 12)))
    chunk = max(1, len(y) // n_wave_pts)
    trimmed = y[: chunk * n_wave_pts].reshape(n_wave_pts, chunk)
    wave_peaks = np.max(np.abs(trimmed), axis=1)
    wave_max = float(np.max(wave_peaks)) + 1e-8
    waveform = [round(float(v / wave_max), 3) for v in wave_peaks]

    # Top chords summary sorted by total time in song
    sorted_usage = sorted(chord_usage_counts.items(), key=lambda kv: kv[1], reverse=True)
    chord_summary = [
        {
            "symbol": sym,
            "seconds": round(sec, 2),
            "share": round(sec / max(0.01, duration), 3),
        }
        for sym, sec in sorted_usage[:12]
    ]

    elapsed = round(time.time() - t_start, 3)
    return {
        "filename": filename,
        "duration": round(duration, 3),
        "bpm": round(bpm, 1),
        "tuningHz": a4_hz,
        "key": key_info,
        "beats": [round(float(bt), 3) for bt in beat_times],
        "chords": chords_out,
        "chordSummary": chord_summary,
        "pianoRoll": piano_slices,
        "waveform": waveform,
        "analysisTimeSec": elapsed,
    }


# ---------------------------------------------------------------------------
# Pure-Python Standard MIDI File (.mid) Writer (Multi-Track SMF Type 1)
# ---------------------------------------------------------------------------

def _vlq(val: int) -> bytes:
    """Encode non-negative integer as MIDI Variable-Length Quantity."""
    val = max(0, int(val))
    out = [val & 0x7F]
    val >>= 7
    while val > 0:
        out.append((val & 0x7F) | 0x80)
        val >>= 7
    out.reverse()
    return bytes(out)


def _events_to_mtrk(events: List[Tuple[int, bytes]]) -> bytes:
    """
    events: list of (absolute_tick, midi_event_bytes).
    Sorts stably by tick (Note-Off before Note-On at identical tick) and packs MTrk chunk.
    """
    # Sort so meta/note-off (0x80) at the same tick precedes note-on (0x90)
    def sort_key(item: Tuple[int, bytes]) -> Tuple[int, int]:
        tick, raw = item
        status = raw[0] & 0xF0 if raw else 0
        prio = 0 if status == 0x80 else (1 if raw[0] == 0xFF else 2)
        return (tick, prio)

    sorted_ev = sorted(events, key=sort_key)
    buf = bytearray()
    prev_tick = 0
    for tick, raw in sorted_ev:
        delta = max(0, tick - prev_tick)
        prev_tick = tick
        buf.extend(_vlq(delta))
        buf.extend(raw)
    # End of Track meta event
    buf.extend(_vlq(0))
    buf.extend(b"\xFF\x2F\x00")
    return b"MTrk" + struct.pack(">I", len(buf)) + bytes(buf)


def build_midi_from_analysis(
    analysis: Dict[str, Any],
    voicing_mode: str = "smooth",
    transpose_semitones: int = 0,
) -> bytes:
    """
    Builds a 3-track Standard MIDI File (SMF Type 1, 480 TPQN):
      Track 0: Tempo, Time Signature, Key Signature & Chord Marker labels
      Track 1: Studio Piano Chords (Left-Hand Bass + Right-Hand Voicing)
      Track 2: Detected Polyphonic Song Notes (Piano Roll)
    """
    tpqn = 480
    bpm = float(analysis.get("bpm") or 110.0)
    us_per_qn = int(round(60_000_000.0 / max(30.0, min(240.0, bpm))))

    def sec_to_tick(sec: float) -> int:
        return max(0, int(round((sec * bpm / 60.0) * tpqn)))

    # Track 0: Conductor + Chord Markers
    t0_events: List[Tuple[int, bytes]] = [
        (0, b"\xFF\x03" + _vlq(15) + b"KeySense Studio"),
        (0, b"\xFF\x51\x03" + struct.pack(">I", us_per_qn)[1:]),
        (0, b"\xFF\x58\x04\x04\x02\x18\x08"),  # 4/4 time
    ]
    for ch in analysis.get("chords", []):
        tick = sec_to_tick(float(ch["start"]))
        label = str(ch["symbol"]).encode("ascii", errors="ignore")
        t0_events.append((tick, b"\xFF\x06" + _vlq(len(label)) + label))

    # Track 1: Piano Chord Voicings (Channel 0, Acoustic Grand Piano = Program 0)
    t1_events: List[Tuple[int, bytes]] = [
        (0, b"\xFF\x03" + _vlq(12) + b"Piano Chords"),
        (0, b"\xC0\x00"),
    ]
    for ch in analysis.get("chords", []):
        s_tick = sec_to_tick(float(ch["start"]))
        e_tick = max(s_tick + 60, sec_to_tick(float(ch["end"])) - 10)
        voicing = ch.get("voicings", {}).get(voicing_mode) or ch.get("voicings", {}).get("smooth", {})
        lh_notes = voicing.get("lh", [])
        rh_notes = voicing.get("rh", [])
        for n in lh_notes:
            mn = int(np.clip(n + transpose_semitones, 21, 108))
            t1_events.append((s_tick, bytes([0x90, mn, 88])))
            t1_events.append((e_tick, bytes([0x80, mn, 0])))
        for n in rh_notes:
            mn = int(np.clip(n + transpose_semitones, 21, 108))
            t1_events.append((s_tick, bytes([0x90, mn, 78])))
            t1_events.append((e_tick, bytes([0x80, mn, 0])))

    # Track 2: Detected Song Piano Notes (Channel 1, Electric Piano = Program 4)
    t2_events: List[Tuple[int, bytes]] = [
        (0, b"\xFF\x03" + _vlq(19) + b"Detected Song Notes"),
        (0, b"\xC1\x04"),
    ]
    slices = analysis.get("pianoRoll", [])
    slice_dur_sec = 0.095
    for sl in slices:
        s_tick = sec_to_tick(float(sl["t"]))
        e_tick = max(s_tick + 30, sec_to_tick(float(sl["t"]) + slice_dur_sec) - 4)
        for note_obj in sl.get("notes", []):
            mn = int(np.clip(int(note_obj["midi"]) + transpose_semitones, 21, 108))
            vel = int(np.clip(round(float(note_obj.get("vel", 0.6)) * 110), 35, 115))
            t2_events.append((s_tick, bytes([0x91, mn, vel])))
            t2_events.append((e_tick, bytes([0x81, mn, 0])))

    header = b"MThd" + struct.pack(">IHHH", 6, 1, 3, tpqn)
    return header + _events_to_mtrk(t0_events) + _events_to_mtrk(t1_events) + _events_to_mtrk(t2_events)


def warmup_engine() -> None:
    """Pre-warms Numba/Librosa JIT kernels on a short synthetic clip."""
    sr = 22050
    t = np.linspace(0.0, 1.2, int(sr * 1.2), endpoint=False, dtype=np.float32)
    y = 0.25 * np.sin(2 * np.pi * 261.63 * t) + 0.2 * np.sin(2 * np.pi * 329.63 * t)
    buf = io.BytesIO()
    sf.write(buf, y, sr, format="WAV", subtype="PCM_16")
    analyze_audio_bytes(buf.getvalue(), filename="warmup.wav")
