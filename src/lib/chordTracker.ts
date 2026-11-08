/**
 * chordTracker.ts — pure "Yamaha Chord Tracker"-style progression tracking
 * helpers for KeySense Studio: timed progression-track building (chord runs
 * merged with start/end/beats), plain-text chord-chart export, and the
 * live-microphone progression log. No DOM access — unit-tested by
 * scripts/test_chord_tracker.ts (esbuild-bundled + node, run in
 * android/build.sh step 1).
 */
import { ChordBlock, NotationMode, SongAnalysis } from '../types';
import { formatPrimaryChordLabel, formatTime } from './musicTheory';

export interface TrackEntry {
  symbol: string; // raw (untransposed) symbol of the run
  start: number; // seconds
  end: number; // seconds
  duration: number;
  beats: number; // duration in beats (rounded to nearest 0.5, min 0.5)
  roman: string;
  nashville: string;
  blockId: number; // first ChordBlock id of the run
  blockIds: number[];
  confidence: number; // max confidence across merged blocks
  rootPc: number;
}

export function beatSeconds(bpm: number): number {
  return bpm > 0 ? 60 / bpm : 0.5;
}

export function beatsOf(duration: number, bpm: number): number {
  const bs = beatSeconds(bpm);
  return Math.max(0.5, Math.round((duration / bs) * 2) / 2);
}

/** Merge consecutive blocks with the same symbol into timed track entries. */
export function buildProgressionTrack(chords: ChordBlock[], bpm: number): TrackEntry[] {
  const out: TrackEntry[] = [];
  for (const c of chords) {
    const last = out[out.length - 1];
    if (last && last.symbol === c.symbol) {
      last.end = c.end;
      last.duration = +(last.end - last.start).toFixed(3);
      last.beats = beatsOf(last.duration, bpm);
      last.blockIds.push(c.id);
      last.confidence = Math.max(last.confidence, c.confidence);
    } else {
      out.push({
        symbol: c.symbol,
        start: c.start,
        end: c.end,
        duration: c.duration,
        beats: beatsOf(c.duration, bpm),
        roman: c.roman,
        nashville: c.nashville,
        blockId: c.id,
        blockIds: [c.id],
        confidence: c.confidence,
        rootPc: c.rootPc,
      });
    }
  }
  return out;
}

/** Index of the track entry sounding at `time` (clamped to the ends). */
export function findActiveEntry(track: TrackEntry[], time: number): number {
  if (!track.length) return -1;
  for (let i = 0; i < track.length; i++) {
    if (time >= track[i].start && time < track[i].end) return i;
  }
  return time >= track[track.length - 1].end ? track.length - 1 : 0;
}

function labelFor(
  entry: TrackEntry,
  chords: ChordBlock[],
  transpose: number,
  useFlats: boolean,
  notation: NotationMode
): string {
  const block =
    chords.find((c) => c.id === entry.blockId) ||
    chords.find((c) => c.symbol === entry.symbol);
  return block
    ? formatPrimaryChordLabel(block, transpose, useFlats, notation).primary
    : entry.symbol;
}

/** Plain-text chord chart with full timing — the export/share target. */
export function buildChartText(opts: {
  title: string;
  bpm: number;
  keyName: string;
  duration: number;
  track: TrackEntry[];
  chords: ChordBlock[];
  transpose: number;
  useFlats: boolean;
  notation: NotationMode;
}): string {
  const L: string[] = [];
  L.push(`CHORD TRACKER CHART — ${opts.title}`);
  L.push(
    `Key: ${opts.keyName}   Tempo: ${Math.round(opts.bpm)} BPM (${beatSeconds(opts.bpm).toFixed(3)}s/beat)   Length: ${formatTime(opts.duration)}   Chord entries: ${opts.track.length}`
  );
  L.push('');
  L.push('#   Chord        Time         Dur    Beats  Roman/Number');
  opts.track.forEach((e, i) => {
    const label = labelFor(e, opts.chords, opts.transpose, opts.useFlats, opts.notation);
    const alt = e.roman && e.roman !== '—' ? e.roman : e.nashville;
    L.push(
      `${String(i + 1).padStart(2)}  ${label.padEnd(12)} ${formatTime(e.start)}-${formatTime(e.end)}  ${e.duration.toFixed(1).padStart(5)}s  ${String(e.beats).padStart(5)}  ${alt}`
    );
  });
  L.push('');
  L.push(
    'Progression: ' +
      opts.track
        .map((e) => labelFor(e, opts.chords, opts.transpose, opts.useFlats, opts.notation))
        .join(' - ')
  );
  return L.join('\n');
}

/** Live-mic progression log entry (times in seconds since listening started). */
export interface LiveLogEntry {
  symbol: string;
  notes: string[];
  start: number;
  end: number;
}

/**
 * Append a detected chord at time `now`: same symbol as the last entry extends
 * its end time, a new symbol starts a new entry. Returns a new array.
 */
export function appendLiveChord(
  log: LiveLogEntry[],
  symbol: string,
  notes: string[],
  now: number
): LiveLogEntry[] {
  const out = log.map((e) => ({ ...e }));
  const last = out[out.length - 1];
  if (last && last.symbol === symbol) {
    last.end = Math.max(last.end, now);
    if (notes.length) last.notes = notes;
  } else {
    out.push({ symbol, notes, start: now, end: now });
  }
  return out;
}

/** Drop flicker entries shorter than minHold (the newest entry is always kept). */
export function pruneLiveLog(log: LiveLogEntry[], minHold = 0.4): LiveLogEntry[] {
  return log.filter((e, i) => i === log.length - 1 || e.end - e.start >= minHold);
}

export function buildLiveLogText(entries: LiveLogEntry[], header: string): string {
  const L: string[] = [];
  L.push(`LIVE PROGRESSION TRACK — ${header}`);
  L.push(`Captured ${entries.length} chord change(s):`);
  entries.forEach((e, i) => {
    L.push(
      `${String(i + 1).padStart(2)}  ${formatTime(e.start)}-${formatTime(e.end)}  ${e.symbol}  (${e.notes.join(' ')})`
    );
  });
  L.push('');
  L.push('Progression: ' + entries.map((e) => e.symbol).join(' - '));
  return L.join('\n');
}

export function analysisTitle(analysis: SongAnalysis | null, demoTitle?: string): string {
  if (demoTitle) return demoTitle;
  return analysis?.filename?.replace(/\.[^.]+$/, '') || 'Song';
}
