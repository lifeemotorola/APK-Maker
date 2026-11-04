/**
 * test_progression.ts — verifies the "relevant progression only" logic
 * (src/lib/musicTheory.ts: chordIsInKey + getSongProgression).
 * Run via android/build.sh (esbuild-bundled first): node scripts/test_progression.ts
 */
import { chordIsInKey, getSongProgression } from '../src/lib/musicTheory';
import type { ChordBlock, KeyInfo } from '../src/types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

const key: KeyInfo = {
  rootPc: 0,
  rootName: 'C',
  mode: 'major',
  name: 'C Major',
  useFlats: false,
  confidence: 0.9,
  relativeKey: 'A Minor',
  alternateKey: 'G Major',
  camelot: '8B',
  scalePitchClasses: [0, 2, 4, 5, 7, 9, 11],
  scaleNotes: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  chromaProfile: [],
};

function chord(id: number, symbol: string, pcs: number[], start: number, end: number): ChordBlock {
  return {
    id, start, end, duration: end - start, symbol,
    rootPc: pcs[0], rootName: symbol.replace(/[^A-G]#?b?/, ''), suffix: '',
    bassPc: pcs[0], bassName: '', hasSlash: false,
    intervals: pcs, pitchClasses: pcs, noteNames: [],
    roman: '', nashville: '', isDiatonic: true, confidence: 0.9,
    voicings: { smooth: { lh: [], rh: [], all: [] }, root: { lh: [], rh: [], all: [] }, pro: { lh: [], rh: [], all: [] } },
    detectedMidi: [],
  };
}

// C - G - Am - F - C - Bb(non-diatonic) - C
const chords = [
  chord(0, 'C', [0, 4, 7], 0, 2),
  chord(1, 'G', [7, 11, 2], 2, 4),
  chord(2, 'Am', [9, 0, 4], 4, 6),
  chord(3, 'F', [5, 9, 0], 6, 8),
  chord(4, 'C', [0, 4, 7], 8, 10),
  chord(5, 'Bb', [10, 2, 5], 10, 12), // NOT in C major
  chord(6, 'C', [0, 4, 7], 12, 14),
];
const analysis = { key, chords };

const prog = getSongProgression(analysis);
console.log('progression:', prog.map((p) => p.symbol).join(' - '));
// Bb is excluded, so the C at 8-10s and the C at 12-14s become adjacent in-key
// entries and collapse into one -> C,G,Am,F,C
assert(prog.map((p) => p.symbol).join(',') === 'C,G,Am,F,C', 'in-key chords only, in order, Bb excluded, got ' + prog.map((p) => p.symbol).join(','));
assert(prog.length === 5, '5 entries after collapsing the adjacent C run');
assert(Math.abs(prog[4].duration - 6) < 1e-6, 'merged final C spans 8s-14s (duration 6), got ' + prog[4].duration);
// collapse check: C at 0-2 and... make a run: chords C,C contiguous should merge
const collapsed = getSongProgression({ key, chords: [chord(0, 'C', [0, 4, 7], 0, 2), chord(1, 'C', [0, 4, 7], 2, 5)] });
assert(collapsed.length === 1 && collapsed[0].duration === 5, 'consecutive same chords collapse (duration 5), got ' + JSON.stringify(collapsed));

assert(chordIsInKey(chords[5], key) === false, 'Bb is not in C major');
assert(chordIsInKey(chords[0], key) === true, 'C is in C major');
assert(chordIsInKey({ symbol: 'N.C.', pitchClasses: [0, 4, 7] }, key) === false, 'N.C. excluded');

// minor key: A minor scale [9,11,0,2,4,5,7]; Am and E and C are diatonic, G is not
const amin: KeyInfo = { ...key, rootPc: 9, mode: 'minor', scalePitchClasses: [9, 11, 0, 2, 4, 5, 7] };
assert(chordIsInKey(chord(0, 'Am', [9, 0, 4], 0, 1), amin) === true, 'Am in A minor');
assert(chordIsInKey(chord(0, 'G', [7, 11, 2], 0, 1), amin) === true, 'G (VII) is diatonic in A natural minor');
assert(chordIsInKey(chord(0, 'D', [2, 6, 9], 0, 1), amin) === false, 'D major (D-F#-A) is NOT in A minor (F#=6 not in scale)');

console.log('PROGRESSION TEST: ALL PASSED');
