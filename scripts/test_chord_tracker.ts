/**
 * test_chord_tracker.ts — unit tests for the Chord Tracker feature
 * (src/lib/chordTracker.ts): timed progression track, beats math, chart text
 * export, live-mic progression log. Run via android/build.sh (esbuild first):
 *   npx esbuild scripts/test_chord_tracker.ts --bundle --platform=node --format=esm --outfile=... && node ...
 */
import {
  LiveLogEntry,
  appendLiveChord,
  beatSeconds,
  beatsOf,
  buildChartText,
  buildLiveLogText,
  buildProgressionTrack,
  findActiveEntry,
  pruneLiveLog,
} from '../src/lib/chordTracker';
import type { ChordBlock } from '../src/types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

function chord(id: number, symbol: string, pcs: number[], start: number, end: number): ChordBlock {
  const suffix = symbol.endsWith('m') ? 'm' : '';
  return {
    id,
    start,
    end,
    duration: end - start,
    symbol,
    rootPc: pcs[0],
    rootName: symbol.replace(/[^A-G]#?b?/, ''),
    suffix,
    bassPc: pcs[0],
    bassName: '',
    hasSlash: false,
    intervals: pcs,
    pitchClasses: pcs,
    noteNames: [],
    roman: 'I',
    nashville: '1',
    isDiatonic: true,
    confidence: 0.9,
    voicings: {
      smooth: { lh: [], rh: [], all: [] },
      root: { lh: [], rh: [], all: [] },
      pro: { lh: [], rh: [], all: [] },
    },
    detectedMidi: [],
  };
}

// --- beats math ---
assert(beatSeconds(120) === 0.5, '120 BPM -> 0.5s per beat');
assert(beatSeconds(60) === 1, '60 BPM -> 1s per beat');
assert(beatsOf(2, 120) === 4, '2s at 120 BPM = 4 beats');
assert(beatsOf(1, 120) === 2, '1s at 120 BPM = 2 beats');
assert(beatsOf(0.2, 120) === 0.5, 'very short block clamps to 0.5 beats');
assert(beatsOf(1.25, 120) === 2.5, '1.25s at 120 BPM rounds to 2.5 beats');

// --- progression track: consecutive same-symbol blocks merge with timing ---
const chords = [
  chord(0, 'C', [0, 4, 7], 0, 2),
  chord(1, 'C', [0, 4, 7], 2, 5),
  chord(2, 'G', [7, 11, 2], 5, 9),
  chord(3, 'Am', [9, 0, 4], 9, 11),
  chord(4, 'F', [5, 9, 0], 11, 15),
];
const track = buildProgressionTrack(chords, 120);
console.log('track:', track.map((t) => `${t.symbol}@${t.start}-${t.end}(${t.beats}bt)`).join(' '));
assert(track.length === 4, 'C,C merge -> 4 entries, got ' + track.length);
assert(track[0].symbol === 'C' && track[0].start === 0 && track[0].end === 5, 'merged C spans 0-5s');
assert(track[0].duration === 5 && track[0].beats === 10, 'merged C: 5s = 10 beats, got ' + track[0].duration + '/' + track[0].beats);
assert(track[0].blockIds.join(',') === '0,1', 'merged entry keeps both block ids');
assert(track[1].beats === 8, 'G 5-9s = 8 beats, got ' + track[1].beats);

// --- active entry lookup ---
assert(findActiveEntry(track, 0) === 0, 't=0 -> entry 0');
assert(findActiveEntry(track, 4.9) === 0, 't=4.9 -> entry 0 (C run)');
assert(findActiveEntry(track, 5) === 1, 't=5 -> entry 1 (G)');
assert(findActiveEntry(track, 999) === 3, 'past end clamps to last entry');
assert(findActiveEntry([], 1) === -1, 'empty track -> -1');

// --- chart text export has timing + progression ---
const chart = buildChartText({
  title: 'Gospel Sunrise',
  bpm: 120,
  keyName: 'C Major',
  duration: 15,
  track,
  chords,
  transpose: 0,
  useFlats: false,
  notation: 'chord',
});
console.log('--- chart ---\n' + chart + '\n------------');
assert(chart.includes('CHORD TRACKER CHART — Gospel Sunrise'), 'chart header');
assert(chart.includes('120 BPM') && chart.includes('C Major') && chart.includes('0:15'), 'chart meta line has BPM/key/length');
assert(chart.includes('0:00-0:05') && chart.includes('10'), 'merged C row shows 0:00-0:05 and 10 beats');
assert(chart.includes('Progression: C - G - Am - F'), 'chart progression line, got: ' + chart.split('\n').pop());
assert(!EMOJI.test(chart), 'chart text has no emoji/arrow glyphs');

// --- live-mic progression log ---
let log: LiveLogEntry[] = [];
log = appendLiveChord(log, 'C', ['C', 'E', 'G'], 0.0);
assert(log.length === 1 && log[0].symbol === 'C' && log[0].start === 0, 'first detection opens entry');
log = appendLiveChord(log, 'C', ['C', 'E', 'G'], 1.2);
assert(log.length === 1 && log[0].end === 1.2, 'same chord extends the entry end');
log = appendLiveChord(log, 'G', ['G', 'B', 'D'], 2.0);
assert(log.length === 2 && log[1].symbol === 'G' && log[1].start === 2.0, 'new chord starts a new timed entry');
log = appendLiveChord(log, 'G', ['G', 'B', 'D'], 3.4); // held frames extend G
assert(log.length === 2 && log[1].end === 3.4, 'held same chord extends end to 3.4');
log = appendLiveChord(log, 'C', ['C', 'E', 'G'], 3.5); // 0.1s flicker back
log = appendLiveChord(log, 'Am', ['A', 'C', 'E'], 3.7);
const pruned = pruneLiveLog(log, 0.4);
assert(pruned.length === 3, 'prune drops the 0.1s flicker entry, keeps newest; got ' + pruned.length);
assert(pruned.map((e) => e.symbol).join(',') === 'C,G,Am', 'pruned symbols C,G,Am');
const liveText = buildLiveLogText(pruned, 'Live mic · 0:04');
assert(liveText.includes('LIVE PROGRESSION TRACK'), 'live log header');
assert(liveText.includes('Progression: C - G - Am'), 'live log progression line');
assert(liveText.includes('0:02-0:03') || liveText.includes('0:03'), 'live log lines carry timestamps');
assert(!EMOJI.test(liveText), 'live log text has no emoji/arrow glyphs');

console.log('CHORD TRACKER TEST: ALL PASSED');
