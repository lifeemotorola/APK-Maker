/* Read canonical mono PCM WAVs, run the existing pitch trackers, and render
 * explicitly labelled sine guides. No output here is claimed to be a singer. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import '../android-choirtune/web/melody.js';
import '../android-choirtune/web/satb.js';
const M = globalThis.ChoirTuneMelody, S = globalThis.ChoirTuneSATB;
export function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected PCM WAV');
  let rate, offset, count;
  for (let p = 12; p + 8 <= b.length;) {
    const tag = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4), start = p + 8;
    if (start + size > b.length) throw new Error('Truncated WAV');
    if (tag === 'fmt ') {
      if (size < 16 || b.readUInt16LE(start) !== 1 || b.readUInt16LE(start + 2) !== 1 || b.readUInt16LE(start + 14) !== 16) throw new Error('Expected mono PCM16');
      rate = b.readUInt32LE(start + 4);
    }
    if (tag === 'data') { offset = start; count = size / 2; }
    p = start + size + (size % 2);
  }
  if (rate !== 22050 || !offset || !count || count > 22050 * 300) throw new Error('Expected 22050 Hz, up to five minutes');
  return { pcm: Float32Array.from({ length: count }, (_, i) => b.readInt16LE(offset + i * 2) / 32768), rate };
}
export function guideWav(tune) {
  const sr = 22050, count = Math.ceil(tune.duration * sr), signal = new Float32Array(count);
  for (const note of tune.notes) {
    const start = Math.max(0, Math.round(note.start * sr)), end = Math.min(count, Math.round(note.end * sr));
    const hz = M.noteFrequency(note, 0);
    for (let i = start; i < end; i++) {
      const env = Math.max(0, Math.min(1, (i - start) / (sr * .015), (end - i) / (sr * .025)));
      signal[i] += .2 * env * Math.sin(2 * Math.PI * hz * (i - start) / sr);
    }
  }
  const b = Buffer.alloc(44 + count * 2);
  b.write('RIFF', 0); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(count * 2, 40);
  signal.forEach((value, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), 44 + i * 2));
  return b;
}
export function render(folder, mode) {
  const audio = readWav(join(folder, 'vocals.wav'));
  const tune = M.extractTune(audio.pcm, audio.rate);
  const parts = mode === 'external_model' ? {} : S.extractSATB(audio.pcm, audio.rate, tune);
  for (const voice of S.VOICES) {
    if (mode === 'external_model') {
      const stem = readWav(join(folder, voice.id + '.wav'));
      const track = M.extractTune(stem.pcm, stem.rate);
      parts[voice.id] = { ...track, voice: voice.name, estimated: true };
    }
    const track = parts[voice.id];
    writeFileSync(join(folder, 'guide-' + voice.id + '.wav'), guideWav(track));
    writeFileSync(join(folder, voice.id + '.mid'), M.tuneToMidiBytes(track, tune.bpm, 0));
  }
  writeFileSync(join(folder, 'pitches.txt'), S.partsToText(parts, 'Server vocal analysis', 0));
  writeFileSync(join(folder, 'analysis.json'), JSON.stringify({ tune, parts }));
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  if (!['external_model', 'range_guided_estimate'].includes(process.argv[3])) throw new Error('Unknown mode');
  render(process.argv[2], process.argv[3]);
}
