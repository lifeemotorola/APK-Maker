import { SongAnalysis } from '../types';
import { isAndroidNative, saveNativeFile } from './nativeBridge';

/**
 * Client-side Standard MIDI File (SMF) writer.
 * Ports backend/dsp_engine.py::build_midi_from_analysis so the Android APK
 * (which has no Python server) can export multi-track .mid files, plus a
 * Type-0 writer for live MIDI performances recorded from USB/BLE MIDI input.
 */

function strBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0x7f);
  return out;
}

function asciiBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out.push(c < 128 ? c : 0x3f); // '?' fallback for non-ascii
  }
  return out;
}

function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    out.unshift(0x80 | (n & 0x7f));
    n >>= 7;
  }
  return out;
}

const clip = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Builds one complete 'MTrk' chunk from [absoluteTick, eventBytes] pairs. */
function mtrkChunk(events: Array<[number, number[]]>): number[] {
  const sorted = [...events].sort((a, b) => a[0] - b[0]);
  const data: number[] = [];
  let last = 0;
  for (const [tick, bytes] of sorted) {
    data.push(...vlq(Math.max(0, tick - last)));
    last = tick;
    data.push(...bytes);
  }
  data.push(0x00, 0xff, 0x2f, 0x00); // End of Track
  return [...strBytes('MTrk'), ...u32(data.length), ...data];
}

/**
 * 3-track SMF Type 1 (480 TPQN) — direct port of the Python DSP exporter:
 *   Track 0: tempo / time-sig / key + chord marker labels
 *   Track 1: piano chord voicings (LH bass + RH), ch 0, Acoustic Grand
 *   Track 2: detected song piano-roll notes, ch 1, Electric Piano
 */
export function buildMidiFromAnalysis(
  analysis: SongAnalysis,
  voicingMode: string,
  transposeSemitones: number
): Uint8Array {
  const tpqn = 480;
  const bpm = analysis.bpm || 110;
  const usPerQn = Math.round(60_000_000 / Math.max(30, Math.min(240, bpm)));
  const secToTick = (sec: number) => Math.max(0, Math.round((sec * bpm * tpqn) / 60));

  const t0: Array<[number, number[]]> = [
    [0, [0xff, 0x03, ...vlq(15), ...strBytes('KeySense Studio')]],
    [0, [0xff, 0x51, 0x03, (usPerQn >> 16) & 0xff, (usPerQn >> 8) & 0xff, usPerQn & 0xff]],
    [0, [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]], // 4/4
  ];
  for (const ch of analysis.chords) {
    const tick = secToTick(ch.start);
    const label = asciiBytes(ch.symbol);
    t0.push([tick, [0xff, 0x06, ...vlq(label.length), ...label]]);
  }

  const t1: Array<[number, number[]]> = [
    [0, [0xff, 0x03, ...vlq(12), ...strBytes('Piano Chords')]],
    [0, [0xc0, 0x00]], // program 0 = Acoustic Grand Piano, channel 0
  ];
  for (const ch of analysis.chords) {
    const s = secToTick(ch.start);
    const e = Math.max(s + 60, secToTick(ch.end) - 10);
    const voicings = ch.voicings as unknown as Record<string, { lh: number[]; rh: number[] }>;
    const v = voicings[voicingMode] || voicings.smooth;
    for (const n of v.lh) {
      const mn = clip(n + transposeSemitones, 21, 108);
      t1.push([s, [0x90, mn, 88]]);
      t1.push([e, [0x80, mn, 0]]);
    }
    for (const n of v.rh) {
      const mn = clip(n + transposeSemitones, 21, 108);
      t1.push([s, [0x90, mn, 78]]);
      t1.push([e, [0x80, mn, 0]]);
    }
  }

  const t2: Array<[number, number[]]> = [
    [0, [0xff, 0x03, ...vlq(19), ...strBytes('Detected Song Notes')]],
    [0, [0xc1, 0x04]], // program 4 = Electric Piano, channel 1
  ];
  for (const sl of analysis.pianoRoll) {
    const s = secToTick(sl.t);
    const e = Math.max(s + 30, secToTick(sl.t + 0.095) - 4);
    for (const n of sl.notes) {
      const mn = clip(n.midi + transposeSemitones, 21, 108);
      const vel = clip((n.vel ?? 0.6) * 110, 35, 115);
      t2.push([s, [0x91, mn, vel]]);
      t2.push([e, [0x81, mn, 0]]);
    }
  }

  const header = [...strBytes('MThd'), ...u32(6), ...u16(1), ...u16(3), ...u16(tpqn)];
  const body = [...mtrkChunk(t0), ...mtrkChunk(t1), ...mtrkChunk(t2)];
  return new Uint8Array([...header, ...body]);
}

export interface LiveMidiRecordedEvent {
  tSec: number; // seconds since recording started
  on: boolean;
  note: number;
  vel: number;
}

/**
 * SMF Type 0 file of a live MIDI performance captured from a
 * USB / Bluetooth (BLE) MIDI controller.
 */
export function buildLivePerformanceMidi(
  events: LiveMidiRecordedEvent[],
  bpm = 120
): Uint8Array {
  const tpqn = 480;
  const usPerQn = Math.round(60_000_000 / Math.max(30, Math.min(240, bpm)));
  const secToTick = (s: number) => Math.max(0, Math.round((s * bpm * tpqn) / 60));

  const track: Array<[number, number[]]> = [
    [0, [0xff, 0x03, ...vlq(18), ...strBytes('KeySense Live MIDI')]],
    [0, [0xff, 0x51, 0x03, (usPerQn >> 16) & 0xff, (usPerQn >> 8) & 0xff, usPerQn & 0xff]],
    [0, [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]],
    [0, [0xc0, 0x00]],
  ];
  const lastNoteOff: Record<number, number> = {};
  for (const ev of events) {
    const tick = secToTick(ev.tSec);
    if (ev.on) {
      track.push([tick, [0x90, clip(ev.note, 0, 127), clip(ev.vel, 1, 127)]]);
      lastNoteOff[ev.note] = tick;
    } else {
      track.push([tick, [0x80, clip(ev.note, 0, 127), 0]]);
      lastNoteOff[ev.note] = tick;
    }
  }
  // Close any hanging notes at the last event time
  const endTick = events.length ? secToTick(events[events.length - 1].tSec) + tpqn : tpqn;
  for (const noteStr of Object.keys(lastNoteOff)) {
    const note = Number(noteStr);
      if (lastNoteOff[note] < endTick) track.push([endTick, [0x80, note, 0]]);
  }

  const header = [...strBytes('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(tpqn)];
  const body = mtrkChunk(track);
  return new Uint8Array([...header, ...body]);
}

/**
 * Saves bytes as a download. Inside the Android APK the file is written to
 * the public Downloads folder through the native bridge; in a desktop
 * browser the classic blob-anchor download is used.
 */
export function downloadBytes(filename: string, data: Uint8Array, mime: string): string | null {
  if (isAndroidNative()) {
    return saveNativeFile(filename, data, mime);
  }
  const blob = new Blob([data.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return null;
}
