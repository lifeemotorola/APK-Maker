/**
 * test_offline_analyze.ts — verifies the APK's offline song analyzer
 * (src/lib/offlineAnalyze.ts) on a synthesized song, in plain Node.
 *
 * Run via android/build.sh (esbuild-bundled first, because the repo is ESM TS):
 *   npx esbuild scripts/test_offline_analyze.ts --bundle --platform=node --format=esm --outfile=... && node ...
 */
import { analyzePcm } from '../src/lib/offlineAnalyze';
import type { SongAnalysis } from '../src/types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

// Synthesize a 6 s, 22050 Hz mono "song": C major (0-2s), F major (2-4s),
// G major (4-6s), with a 0.5 s pulse (120 bpm onsets) and a bass note.
const SR = 22050;
const DUR = 6;
const y = new Float32Array(SR * DUR);
function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
const prog: Array<{ t0: number; t1: number; notes: number[] }> = [
  { t0: 0, t1: 2, notes: [48, 60, 64, 67] }, // C3 C4 E4 G4
  { t0: 2, t1: 4, notes: [41, 57, 60, 65] }, // F2 A3 C4 F4
  { t0: 4, t1: 6, notes: [43, 59, 62, 67] }, // G2 B3 D4 G4
];
for (let i = 0; i < y.length; i++) {
  const t = i / SR;
  const seg = prog.find((s) => t >= s.t0 && t < s.t1) || prog[prog.length - 1];
  const pulse = 0.55 + 0.45 * Math.sin(2 * Math.PI * t * 2); // 2 Hz pulse -> 120 bpm onsets
  let v = 0;
  for (const n of seg.notes) v += 0.22 * Math.sin(2 * Math.PI * midiHz(n) * t) * pulse;
  y[i] = v + (Math.random() - 0.5) * 0.01; // tiny noise
}

const a: SongAnalysis = analyzePcm(y, SR, 'test-song.wav');
console.log('duration:', a.duration, '| bpm:', a.bpm, '| key:', a.key.name, a.key.camelot, '| chords:', a.chords.map((c) => c.symbol).join(' '));

assert(Math.abs(a.duration - DUR) < 0.05, 'duration ~6s');
assert(a.filename === 'test-song.wav', 'filename passthrough');
assert(a.key.mode === 'major', 'key mode major (got ' + a.key.mode + ')');
assert([0, 5, 7].includes(a.key.rootPc), 'key root is C/F/G-ish (got pc ' + a.key.rootPc + ')');
assert(a.key.scalePitchClasses.length === 7 && a.key.scaleNotes.length === 7, 'key scale fields');
assert(a.key.camelot.length >= 2, 'camelot wheel string');
assert(a.chords.length >= 2, 'at least 2 chord segments, got ' + a.chords.length);
assert(a.chords[0].symbol.startsWith('C'), 'first chord is C (got ' + a.chords[0].symbol + ')');
for (const c of a.chords) {
  for (const k of ['id', 'start', 'end', 'duration', 'symbol', 'rootPc', 'rootName', 'suffix', 'bassPc', 'bassName', 'hasSlash', 'intervals', 'pitchClasses', 'noteNames', 'roman', 'nashville', 'isDiatonic', 'confidence', 'voicings', 'detectedMidi'] as const) {
    assert(k in c, 'chord has field ' + k);
  }
  const v = c.voicings.smooth as { lh: number[]; rh: number[]; all: number[] };
  assert(Array.isArray(v.lh) && Array.isArray(v.rh) && Array.isArray(v.all) && v.all.length >= 3, 'voicing shape for ' + c.symbol);
  assert(c.end > c.start, 'chord start<end');
}
assert(a.bpm > 60 && a.bpm < 200, 'bpm in range, got ' + a.bpm);
assert(a.beats.length > 5, 'beat grid non-empty');
assert(a.pianoRoll.length > 0 && a.pianoRoll[0].notes.length > 0, 'piano roll has notes');
assert(a.waveform.length === 240 && a.waveform.some((v) => v > 0.3), 'waveform peaks');
const shareSum = a.chordSummary.reduce((s, x) => s + x.share, 0);
assert(Math.abs(shareSum - 1) < 0.05, 'chordSummary shares sum to ~1, got ' + shareSum);
assert(a.analysisTimeSec >= 0, 'analysisTimeSec');

// short clip must throw the friendly error
let threw = false;
try {
  analyzePcm(new Float32Array(SR * 0.3), SR, 'short.wav');
} catch (e) {
  threw = /too short/.test(String(e));
}
assert(threw, 'short clip throws friendly error');

console.log('OFFLINE ANALYZE TEST: ALL PASSED');
