import { ChordBlock, KeyInfo, NotationMode, VoicingMode } from '../types';

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const FLAT_MAJOR_ROOTS = new Set([5, 10, 3, 8, 1, 6]); // F, Bb, Eb, Ab, Db, Gb
const FLAT_MINOR_ROOTS = new Set([2, 7, 0, 5, 10, 3]); // Dm, Gm, Cm, Fm, Bbm, Ebm

export function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

export function shouldUseFlats(keyRootPc: number, mode: 'major' | 'minor'): boolean {
  const pc = mod12(keyRootPc);
  return mode === 'major' ? FLAT_MAJOR_ROOTS.has(pc) : FLAT_MINOR_ROOTS.has(pc);
}

export function spellPitchClass(pc: number, useFlats: boolean): string {
  const idx = mod12(pc);
  return useFlats ? FLAT_NAMES[idx] : SHARP_NAMES[idx];
}

export function midiToNoteName(midi: number, useFlats = false): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${spellPitchClass(midi, useFlats)}${octave}`;
}

export function isBlackKey(midi: number): boolean {
  const pc = mod12(midi);
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function transposeKeyInfo(key: KeyInfo, semitones: number) {
  const newRoot = mod12(key.rootPc + semitones);
  const useFlats = shouldUseFlats(newRoot, key.mode);
  const rootName = spellPitchClass(newRoot, useFlats);
  const modeLabel = key.mode === 'major' ? 'Major' : 'Minor';
  const relRoot = key.mode === 'major' ? mod12(newRoot + 9) : mod12(newRoot + 3);
  const relMode = key.mode === 'major' ? 'Minor' : 'Major';

  const scalePitchClasses = key.scalePitchClasses.map((pc) => mod12(pc + semitones));
  const scaleNotes = scalePitchClasses.map((pc) => spellPitchClass(pc, useFlats));

  return {
    rootPc: newRoot,
    rootName,
    useFlats,
    name: `${rootName} ${modeLabel}`,
    relativeKey: `${spellPitchClass(relRoot, useFlats)} ${relMode}`,
    scalePitchClasses,
    scaleNotes,
  };
}

export function transposeChordSymbol(
  chord: ChordBlock,
  semitones: number,
  useFlats: boolean
): {
  symbol: string;
  rootName: string;
  bassName: string;
  noteNames: string[];
} {
  const rootPc = mod12(chord.rootPc + semitones);
  const bassPc = mod12(chord.bassPc + semitones);
  const rootName = spellPitchClass(rootPc, useFlats);
  const bassName = spellPitchClass(bassPc, useFlats);
  let symbol = `${rootName}${chord.suffix}`;
  if (chord.hasSlash && bassPc !== rootPc) {
    symbol = `${symbol}/${bassName}`;
  }
  const noteNames = chord.pitchClasses.map((pc) => spellPitchClass(pc + semitones, useFlats));
  return { symbol, rootName, bassName, noteNames };
}

export function formatPrimaryChordLabel(
  chord: ChordBlock,
  semitones: number,
  useFlats: boolean,
  notation: NotationMode
): { primary: string; secondary: string } {
  const { symbol } = transposeChordSymbol(chord, semitones, useFlats);
  if (notation === 'nashville') {
    const slashPart =
      chord.hasSlash && chord.bassPc !== chord.rootPc
        ? `/${spellPitchClass(chord.bassPc + semitones, useFlats)}`
        : '';
    return { primary: `${chord.nashville}${slashPart}`, secondary: symbol };
  }
  if (notation === 'roman') {
    return { primary: chord.roman, secondary: symbol };
  }
  return { primary: symbol, secondary: chord.nashville };
}

export function getActiveChordMidiNotes(
  chord: ChordBlock | null,
  voicingMode: VoicingMode,
  transposeSemitones: number
): { lh: number[]; rh: number[]; all: number[] } {
  if (!chord) return { lh: [], rh: [], all: [] };
  const shift = (arr: number[]) =>
    arr.map((m) => m + transposeSemitones).filter((m) => m >= 21 && m <= 108);

  if (voicingMode === 'detected') {
    const det = shift(chord.detectedMidi.length ? chord.detectedMidi : chord.voicings.smooth.all);
    const lh = det.filter((m) => m < 52);
    const rh = det.filter((m) => m >= 52);
    return { lh, rh, all: det };
  }

  const v = chord.voicings[voicingMode] || chord.voicings.smooth;
  const lh = shift(v.lh);
  const rh = shift(v.rh);
  return {
    lh,
    rh,
    all: Array.from(new Set([...lh, ...rh])).sort((a, b) => a - b),
  };
}

export function intervalLabelForMidi(midi: number, chordRootPc: number): string {
  const diff = mod12(midi - chordRootPc);
  const labels: Record<number, string> = {
    0: 'R',
    1: 'b9',
    2: '9',
    3: 'b3',
    4: '3',
    5: '4',
    6: 'b5',
    7: '5',
    8: '#5',
    9: '6',
    10: 'b7',
    11: '7',
  };
  return labels[diff] || '';
}

export interface DiatonicScaleChord {
  degree: string;
  nashville: string;
  symbol: string;
  role: string;
  lhMidi: number[];
  rhMidi: number[];
}

export function getDiatonicChordsForKey(
  keyRootPc: number,
  mode: 'major' | 'minor',
  useFlats: boolean
): DiatonicScaleChord[] {
  const specs =
    mode === 'major'
      ? [
          { iv: 0, suf: '', deg: 'I', nash: '1', role: 'Tonic', chordIvs: [0, 4, 7] },
          { iv: 2, suf: 'm7', deg: 'ii7', nash: '2m7', role: 'Subdominant', chordIvs: [0, 3, 7, 10] },
          { iv: 4, suf: 'm7', deg: 'iii7', nash: '3m7', role: 'Mediant', chordIvs: [0, 3, 7, 10] },
          { iv: 5, suf: 'maj7', deg: 'IVmaj7', nash: '4maj7', role: 'Subdominant', chordIvs: [0, 4, 7, 11] },
          { iv: 7, suf: '7', deg: 'V7', nash: '57', role: 'Dominant', chordIvs: [0, 4, 7, 10] },
          { iv: 9, suf: 'm7', deg: 'vi7', nash: '6m7', role: 'Relative Minor', chordIvs: [0, 3, 7, 10] },
          { iv: 11, suf: 'dim', deg: 'vii°', nash: '7dim', role: 'Leading Tone', chordIvs: [0, 3, 6] },
        ]
      : [
          { iv: 0, suf: 'm7', deg: 'i7', nash: '1m7', role: 'Tonic Minor', chordIvs: [0, 3, 7, 10] },
          { iv: 2, suf: 'dim', deg: 'ii°', nash: '2dim', role: 'Supertonic', chordIvs: [0, 3, 6] },
          { iv: 3, suf: 'maj7', deg: 'IIImaj7', nash: 'b3maj7', role: 'Relative Major', chordIvs: [0, 4, 7, 11] },
          { iv: 5, suf: 'm7', deg: 'iv7', nash: '4m7', role: 'Subdominant', chordIvs: [0, 3, 7, 10] },
          { iv: 7, suf: 'm7', deg: 'v7', nash: '5m7', role: 'Minor Dominant', chordIvs: [0, 3, 7, 10] },
          { iv: 8, suf: 'maj7', deg: 'VImaj7', nash: 'b6maj7', role: 'Submediant', chordIvs: [0, 4, 7, 11] },
          { iv: 10, suf: '7', deg: 'VII7', nash: 'b77', role: 'Subtonic', chordIvs: [0, 4, 7, 10] },
        ];

  return specs.map((sp) => {
    const rPc = mod12(keyRootPc + sp.iv);
    const rName = spellPitchClass(rPc, useFlats);
    const lh = 36 + rPc < 38 ? 48 + rPc : 36 + rPc;
    let rhBase = 60 + rPc;
    if (rhBase > 66) rhBase -= 12;
    return {
      degree: sp.deg,
      nashville: sp.nash,
      symbol: `${rName}${sp.suf}`,
      role: sp.role,
      lhMidi: [lh, lh + 7],
      rhMidi: sp.chordIvs.map((c) => rhBase + c),
    };
  });
}

/**
 * Lightweight real-time chord classifier from 12-bin chroma vector (for Live Mic streaming!)
 */
export function classifyLiveChroma(
  chroma: number[],
  useFlats = false
): { symbol: string; rootPc: number; notes: string[]; confidence: number; midiVoicing: number[] } | null {
  const maxVal = Math.max(...chroma, 0);
  if (maxVal < 0.08) return null;

  const norm = Math.hypot(...chroma) || 1;
  const unit = chroma.map((v) => v / norm);

  const qualities: Array<{ suf: string; ivs: number[]; penalty: number }> = [
    { suf: '', ivs: [0, 4, 7], penalty: 0 },
    { suf: 'm', ivs: [0, 3, 7], penalty: 0 },
    { suf: '7', ivs: [0, 4, 7, 10], penalty: 0.03 },
    { suf: 'maj7', ivs: [0, 4, 7, 11], penalty: 0.035 },
    { suf: 'm7', ivs: [0, 3, 7, 10], penalty: 0.03 },
  ];

  let bestScore = -999;
  let bestRoot = 0;
  let bestSuf = '';
  let bestIvs = [0, 4, 7];

  for (let root = 0; root < 12; root++) {
    for (const q of qualities) {
      let score = 0;
      for (let pc = 0; pc < 12; pc++) {
        const rel = mod12(pc - root);
        if (q.ivs.includes(rel)) {
          score += unit[pc] * (rel === 0 ? 1.15 : 0.95);
        } else {
          score -= unit[pc] * 0.28;
        }
      }
      score = score / Math.sqrt(q.ivs.length) - q.penalty;
      if (score > bestScore) {
        bestScore = score;
        bestRoot = root;
        bestSuf = q.suf;
        bestIvs = q.ivs;
      }
    }
  }

  if (bestScore < 0.32) return null;
  const rootName = spellPitchClass(bestRoot, useFlats);
  const notes = bestIvs.map((iv) => spellPitchClass(bestRoot + iv, useFlats));
  const lh = 36 + bestRoot < 38 ? 48 + bestRoot : 36 + bestRoot;
  const rhBase = 60 + bestRoot > 66 ? 48 + bestRoot : 60 + bestRoot;
  const midiVoicing = [lh, ...bestIvs.map((iv) => rhBase + iv)];

  return {
    symbol: `${rootName}${bestSuf}`,
    rootPc: bestRoot,
    notes,
    confidence: Math.min(0.98, Math.max(0.45, bestScore)),
    midiVoicing,
  };
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
