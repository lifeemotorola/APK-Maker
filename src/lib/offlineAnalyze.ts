/**
 * offlineAnalyze.ts — full in-browser song analysis for the Android APK.
 *
 * The desktop KeySense server analyzes uploads with Python/librosa
 * (backend/dsp_engine.py). Inside the APK there is no Python, so this module
 * re-implements the analysis pipeline in pure JS on top of WebAudio decoding:
 *
 *   decodeAudioData -> mono 22.05 kHz PCM
 *   -> STFT (radix-2 FFT, Hann 16k) -> 84-semitone energy (MIDI 24..107)
 *   -> overtone suppression -> 12-bin chroma per frame
 *   -> beat-aligned-ish segments (1.5 s windows, 0.75 s hop)
 *   -> classifyLiveChroma() per segment  (same classifier as Live Mic)
 *   -> Krumhansl-Schmuckler key estimation, onset-autocorrelation BPM,
 *      piano-roll slices, waveform peaks
 *
 * Produces the exact SongAnalysis shape the UI expects (same fields as the
 * Python engine), so uploads work 100% offline in the APK.
 */
import {
  classifyLiveChroma,
  mod12,
  shouldUseFlats,
  spellPitchClass,
} from './musicTheory';
import type {
  ChordBlock,
  ChordSummaryItem,
  KeyInfo,
  PianoRollSlice,
  SongAnalysis,
  VoicingSet,
} from '../types';

const TARGET_SR = 22050;
const FFT_N = 16384; // ~0.74 s window @ 22.05 kHz, 1.35 Hz/bin — resolves C1 (32.7 Hz)
const HOP = 4096; // ~0.186 s hop
const SEMI_LO = 24; // MIDI C1
const SEMI_COUNT = 84; // C1..B7
const SEG_FRAMES = 8; // ~1.49 s per chord segment
const SEG_HOP = 4; // ~0.74 s hop

/* ------------------------------ FFT ------------------------------ */
function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = i + k + half;
        const vRe = re[b] * curRe - im[b] * curIm;
        const vIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - vRe;
        im[b] = im[a] - vIm;
        re[a] += vRe;
        im[a] += vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

/* --------------------------- key estimation --------------------------- */
const KRUM_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KRUM_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const CAMELOT_MAJ: number[] = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1]; // pc -> Camelot number (8B = C major)
const MAJ_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MIN_SCALE = [0, 2, 3, 5, 7, 8, 10];

function corr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = 12;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    dot += da * db;
    na += da * da;
    nb += db * db;
  }
  if (na < 1e-9 || nb < 1e-9) return 0;
  return dot / Math.sqrt(na * nb);
}

function estimateKey(chroma: Float64Array): KeyInfo {
  let best = { root: 0, mode: 'major' as 'major' | 'minor', score: -2 };
  let second = { name: '', score: -2 };
  for (let root = 0; root < 12; root++) {
    for (const mode of ['major', 'minor'] as const) {
      const prof = mode === 'major' ? KRUM_MAJ : KRUM_MIN;
      const rot: number[] = [];
      for (let i = 0; i < 12; i++) rot[i] = prof[(i - root + 12) % 12];
      const c = corr(chroma, rot);
      const name = `${spellPitchClass(root, false)} ${mode === 'major' ? 'Major' : 'Minor'}`;
      if (c > best.score) {
        second = { name, score: best.score };
        best = { root, mode, score: c };
      } else if (c > second.score) {
        second = { name, score: c };
      }
    }
  }
  const useFlats = shouldUseFlats(best.root, best.mode);
  const rootName = spellPitchClass(best.root, useFlats);
  const scale = best.mode === 'major' ? MAJ_SCALE : MIN_SCALE;
  const scalePitchClasses = scale.map((iv) => mod12(best.root + iv));
  const relRoot = mod12(best.root + (best.mode === 'major' ? 9 : 3));
  const confidence = Math.min(0.98, Math.max(0.4, (best.score + 1) / 2));
  const chromaProfile: number[] = [];
  let cmax = 0;
  for (let i = 0; i < 12; i++) cmax = Math.max(cmax, chroma[i]);
  for (let i = 0; i < 12; i++) chromaProfile.push(cmax > 0 ? +(chroma[i] / cmax).toFixed(4) : 0);
  return {
    rootPc: best.root,
    rootName,
    mode: best.mode,
    name: `${rootName} ${best.mode === 'major' ? 'Major' : 'Minor'}`,
    useFlats,
    confidence: +confidence.toFixed(3),
    relativeKey: `${spellPitchClass(relRoot, useFlats)} ${best.mode === 'major' ? 'Minor' : 'Major'}`,
    alternateKey: second.name || '—',
    camelot: `${CAMELOT_MAJ[best.root]}${best.mode === 'minor' ? 'A' : 'B'}`,
    scalePitchClasses,
    scaleNotes: scalePitchClasses.map((pc) => spellPitchClass(pc, useFlats)),
    chromaProfile,
  };
}

/* ------------------------------ BPM ------------------------------ */
function estimateBpm(flux: Float64Array, hopSec: number, duration: number): { bpm: number; beats: number[] } {
  let bestBpm = 100;
  let bestScore = -1;
  const minLag = Math.max(1, Math.round(0.3 / hopSec)); // 200 bpm
  const maxLag = Math.min(flux.length - 1, Math.round(1.05 / hopSec)); // ~57 bpm
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < flux.length; i++) s += flux[i] * flux[i + lag];
    const bpmLag = 60 / (lag * hopSec);
    const w = Math.exp(-Math.pow((bpmLag - 120) / 70, 2)); // gentle preference for the common 80-160 range
    const score = (s / (flux.length - lag)) * (0.5 + 0.5 * w);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpmLag;
    }
  }
  let bpm = bestBpm;
  if (bpm < 58) bpm *= 2;
  else if (bpm > 185) bpm *= 0.5;
  if (!Number.isFinite(bpm) || bpm <= 0) bpm = 100;
  const step = 60 / bpm;
  const beats: number[] = [];
  for (let t = 0; t < duration; t += step) beats.push(+t.toFixed(3));
  return { bpm: +bpm.toFixed(1), beats };
}

/* --------------------------- chord blocks --------------------------- */
const SUFFIX_IVS: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
};
const ROMAN_MAJ = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];
const ROMAN_MIN = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

function buildChordBlock(
  id: number,
  start: number,
  end: number,
  det: { symbol: string; rootPc: number; notes: string[]; confidence: number; midiVoicing: number[] } | null,
  useFlats: boolean,
  key: KeyInfo,
  detectedMidi: number[],
  bassPc: number
): ChordBlock {
  const rootPc = det ? det.rootPc : 0;
  const rootName = spellPitchClass(rootPc, useFlats);
  const symbol = det ? det.symbol : 'N.C.';
  const suffix = det ? symbol.slice(rootName.length) : '';
  const ivs = SUFFIX_IVS[suffix] || [0, 4, 7];
  const pitchClasses = ivs.map((iv) => mod12(rootPc + iv));
  const noteNames = ivs.map((iv) => spellPitchClass(rootPc + iv, useFlats));
  const lhNote = 36 + rootPc < 38 ? 48 + rootPc : 36 + rootPc;
  const rhBase = 60 + rootPc > 66 ? 48 + rootPc : 60 + rootPc;
  const voicings: ChordBlock['voicings'] = {
    smooth: det
      ? {
          lh: [det.midiVoicing[0]],
          rh: det.midiVoicing.slice(1),
          all: [...det.midiVoicing].sort((a, b) => a - b),
        }
      : { lh: [lhNote], rh: [rhBase, rhBase + 4, rhBase + 7], all: [lhNote, rhBase, rhBase + 4, rhBase + 7] },
    root: { lh: [lhNote], rh: ivs.map((iv) => rhBase + iv), all: [] },
    pro: { lh: [lhNote], rh: [...ivs.map((iv) => rhBase + iv), rhBase + 14], all: [] },
  };
  voicings.root.all = Array.from(new Set([...voicings.root.lh, ...voicings.root.rh])).sort((a, b) => a - b);
  voicings.pro.all = Array.from(new Set([...voicings.pro.lh, ...voicings.pro.rh])).sort((a, b) => a - b);

  let roman = '—';
  let nashville = '—';
  let isDiatonic = false;
  const degIdx = key.scalePitchClasses.indexOf(rootPc);
  if (degIdx >= 0) {
    isDiatonic = true;
    roman = (key.mode === 'major' ? ROMAN_MAJ : ROMAN_MIN)[degIdx];
    nashville = `${degIdx + 1}${suffix.startsWith('m') ? 'm' : ''}`;
  }
  const bassName = spellPitchClass(bassPc, useFlats);
  return {
    id,
    start: +start.toFixed(3),
    end: +end.toFixed(3),
    duration: +Math.max(0.05, end - start).toFixed(3),
    symbol,
    rootPc,
    rootName,
    suffix,
    bassPc,
    bassName,
    hasSlash: bassPc !== rootPc && symbol !== 'N.C.',
    intervals: ivs,
    pitchClasses,
    noteNames,
    roman,
    nashville,
    isDiatonic,
    confidence: det ? det.confidence : 0,
    voicings,
    detectedMidi,
  };
}

/* ------------------------------ main ------------------------------ */
export function analyzePcm(input: Float32Array, sampleRate: number, filename: string, maxDurationSec = 360): SongAnalysis {
  const t0 = Date.now();
  // resample to TARGET_SR (linear)
  let y = input;
  if (sampleRate !== TARGET_SR && sampleRate > 0) {
    const ratio = sampleRate / TARGET_SR;
    const outLen = Math.floor(input.length / ratio);
    y = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const p = i * ratio;
      const i0 = Math.floor(p);
      const i1 = Math.min(input.length - 1, i0 + 1);
      const fr = p - i0;
      y[i] = input[i0] * (1 - fr) + input[i1] * fr;
    }
  }
  const sr = TARGET_SR;
  const maxLen = Math.floor(maxDurationSec * sr);
  if (y.length > maxLen) y = y.subarray(0, maxLen);
  const duration = y.length / sr;
  if (duration < 0.8) {
    throw new Error('Audio clip is too short (< 0.8s). Please provide at least 1 second of audio.');
  }
  let peak = 0;
  for (let i = 0; i < y.length; i++) { const a = Math.abs(y[i]); if (a > peak) peak = a; }
  if (peak > 1e-5) { const inv = 1 / peak; for (let i = 0; i < y.length; i++) y[i] *= inv; }

  const nFrames = Math.max(1, Math.floor((y.length - FFT_N) / HOP) + 1);
  const hann = new Float64Array(FFT_N);
  for (let i = 0; i < FFT_N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1));
  const re = new Float64Array(FFT_N);
  const im = new Float64Array(FFT_N);
  const binHz = sr / FFT_N;
  const frameSemi = new Float64Array(nFrames * SEMI_COUNT);
  const frameChroma = new Float64Array(nFrames * 12);
  const flux = new Float64Array(nFrames);
  let prevMag: Float64Array | null = null;

  for (let f = 0; f < nFrames; f++) {
    const start = f * HOP;
    for (let i = 0; i < FFT_N; i++) {
      const s = start + i < y.length ? y[start + i] : 0;
      re[i] = s * hann[i];
      im[i] = 0;
    }
    fftRadix2(re, im);
    const half = FFT_N / 2;
    const mag = new Float64Array(half);
    for (let b = 0; b < half; b++) mag[b] = Math.hypot(re[b], im[b]);
    const semi = frameSemi.subarray(f * SEMI_COUNT, f * SEMI_COUNT + SEMI_COUNT);
    for (let m = 0; m < SEMI_COUNT; m++) {
      const freq = 440 * Math.pow(2, (SEMI_LO + m - 69) / 12);
      const bin = Math.round(freq / binHz);
      if (bin < 1 || bin >= half - 1) { semi[m] = 0; continue; }
      semi[m] = Math.max(mag[bin - 1], mag[bin], mag[bin + 1]);
    }
    // suppress overtones (octave, fifth, double-octave, major third above)
    for (let m = 24; m < SEMI_COUNT; m++) {
      semi[m] = Math.max(0, semi[m] - 0.5 * semi[m - 12] - 0.35 * semi[m - 19] - 0.22 * semi[m - 24]);
    }
    const chr = frameChroma.subarray(f * 12, f * 12 + 12);
    for (let m = 0; m < SEMI_COUNT; m++) chr[(SEMI_LO + m) % 12] += semi[m];
    if (prevMag) {
      let fl = 0;
      for (let b = 0; b < half; b++) { const d = mag[b] - prevMag[b]; if (d > 0) fl += d; }
      flux[f] = fl;
    }
    prevMag = mag;
  }

  const overall = new Float64Array(12);
  for (let f = 0; f < nFrames; f++) {
    for (let i = 0; i < 12; i++) overall[i] += frameChroma[f * 12 + i];
  }
  const key = estimateKey(overall);
  const useFlats = key.useFlats;
  const hopSec = HOP / sr;
  const { bpm, beats } = estimateBpm(flux, hopSec, duration);

  // segments -> chords
  const segCount = Math.max(1, Math.floor((nFrames - SEG_FRAMES) / SEG_HOP) + 1);
  interface RawSeg {
    start: number;
    end: number;
    det: ReturnType<typeof classifyLiveChroma>;
    detectedMidi: number[];
    bassPc: number;
    maxE: number;
    avgSemi: Float64Array;
  }
  const raws: RawSeg[] = [];
  for (let s = 0; s < segCount; s++) {
    const f0 = s * SEG_HOP;
    const f1 = Math.min(nFrames, f0 + SEG_FRAMES);
    const avgSemi = new Float64Array(SEMI_COUNT);
    for (let f = f0; f < f1; f++) {
      for (let m = 0; m < SEMI_COUNT; m++) avgSemi[m] += frameSemi[f * SEMI_COUNT + m];
    }
    for (let m = 0; m < SEMI_COUNT; m++) avgSemi[m] /= f1 - f0;
    const chroma = new Array<number>(12).fill(0);
    let cmax = 0;
    for (let m = 0; m < SEMI_COUNT; m++) {
      chroma[(SEMI_LO + m) % 12] += avgSemi[m];
      cmax = Math.max(cmax, avgSemi[m]);
    }
    let maxE = 0;
    for (let m = 0; m < SEMI_COUNT; m++) maxE = Math.max(maxE, avgSemi[m]);
    const normChroma = chroma.map((v) => (cmax > 0 ? v / cmax : 0));
    const det = cmax > 0 ? classifyLiveChroma(normChroma, useFlats) : null;
    const detectedMidi: number[] = [];
    let bassPc = det ? det.rootPc : 0;
    if (maxE > 0) {
      const order = Array.from({ length: SEMI_COUNT }, (_, m) => m)
        .filter((m) => avgSemi[m] > maxE * 0.3)
        .sort((a, b) => avgSemi[b] - avgSemi[a]);
      for (const m of order.slice(0, 6)) {
        const midi = SEMI_LO + m;
        if (midi >= 21 && midi <= 108) detectedMidi.push(midi);
      }
      detectedMidi.sort((a, b) => a - b);
      for (const m of order) {
        if (avgSemi[m] > maxE * 0.2) { bassPc = (SEMI_LO + m) % 12; break; }
      }
    }
    const t0s = (f0 * HOP) / sr;
    raws.push({ start: t0s, end: duration, det, detectedMidi, bassPc, maxE, avgSemi });
  }
  // tile segments exactly: each segment ends where the next one starts
  for (let s = 0; s < raws.length - 1; s++) raws[s].end = Math.max(raws[s].start + 0.2, raws[s + 1].start);
  raws[raws.length - 1].end = duration;

  // merge consecutive identical chords
  const chords: ChordBlock[] = [];
  const pianoRoll: PianoRollSlice[] = [];
  for (const r of raws) {
    const last = chords[chords.length - 1];
    if (last && r.det && last.symbol === r.det.symbol && last.rootPc === r.det.rootPc) {
      last.end = r.end;
      last.duration = +(last.end - last.start).toFixed(3);
    } else {
      chords.push(buildChordBlock(chords.length, r.start, r.end, r.det, useFlats, key, r.detectedMidi, r.bassPc));
    }
    if (r.maxE > 0) {
      const notes = r.detectedMidi.map((midi) => {
        const m = midi - SEMI_LO;
        const vel = m >= 0 && m < SEMI_COUNT ? Math.min(1, r.avgSemi[m] / r.maxE) : 0.5;
        return { midi, vel: +vel.toFixed(2) };
      });
      if (notes.length) pianoRoll.push({ t: +r.start.toFixed(3), notes });
    }
  }
  if (!chords.length) chords.push(buildChordBlock(0, 0, duration, null, useFlats, key, [], 0));

  // chord summary
  const bySymbol = new Map<string, number>();
  for (const c of chords) bySymbol.set(c.symbol, (bySymbol.get(c.symbol) || 0) + c.duration);
  const chordSummary: ChordSummaryItem[] = Array.from(bySymbol.entries())
    .map(([symbol, seconds]) => ({ symbol, seconds: +seconds.toFixed(2), share: +(seconds / duration).toFixed(3) }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 12);

  // waveform peaks (~240 buckets)
  const NB = 240;
  const waveform: number[] = [];
  const bucket = Math.max(1, Math.floor(y.length / NB));
  for (let i = 0; i < NB; i++) {
    let mx = 0;
    const from = i * bucket;
    const to = Math.min(y.length, from + bucket);
    for (let j = from; j < to; j++) { const a = Math.abs(y[j]); if (a > mx) mx = a; }
    waveform.push(+mx.toFixed(3));
  }

  return {
    filename,
    duration: +duration.toFixed(3),
    bpm,
    tuningHz: 440.0,
    key,
    beats,
    chords,
    chordSummary,
    pianoRoll,
    waveform,
    analysisTimeSec: +((Date.now() - t0) / 1000).toFixed(3),
  };
}

/* --------------------- WebAudio decode (WebView) --------------------- */
export async function decodeAudioBytes(bytes: Uint8Array): Promise<{ samples: Float32Array; sampleRate: number }> {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const AC = w.AudioContext || w.webkitAudioContext;
  if (!AC) throw new Error('WebAudio is not available in this browser/WebView');
  const ctx = new AC();
  try {
    const copy = bytes.slice();
    const buf = await ctx.decodeAudioData(copy.buffer as ArrayBuffer);
    const ch = buf.numberOfChannels;
    const len = buf.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c);
      const wgt = 1 / ch;
      for (let i = 0; i < len; i++) mono[i] += d[i] * wgt;
    }
    return { samples: mono, sampleRate: buf.sampleRate };
  } finally {
    if (typeof ctx.close === 'function') ctx.close();
  }
}

export async function analyzeAudioBytes(bytes: Uint8Array, filename: string): Promise<SongAnalysis> {
  const { samples, sampleRate } = await decodeAudioBytes(bytes);
  return analyzePcm(samples, sampleRate, filename);
}
