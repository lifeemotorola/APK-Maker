/* Functional regression tests for range-guided polyphonic pitch estimation.
 * Synthetic signals are controlled cases, not an accuracy benchmark for choir
 * recordings. Tests deliberately exercise missing parts and ambiguous unison. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
await import('./melody.js');
await import('./satb.js');
const M = globalThis.ChoirTuneMelody, S = globalThis.ChoirTuneSATB;
const SR = 22050;
function signal(chords, seconds = 1.2, detune = 0, harmonic = true) {
  const pcm = new Float32Array(Math.floor(SR * seconds * chords.length));
  chords.forEach((chord, j) => {
    for (const midi of chord) {
      const f = 440 * 2 ** ((midi - 69 + detune / 100) / 12);
      const begin = j * seconds + 0.02, end = (j + 1) * seconds - 0.02;
      for (let i = Math.ceil(begin * SR); i < Math.floor(end * SR); i++) {
        const env = Math.min(1, (i / SR - begin) / 0.03, (end - i / SR) / 0.03);
        for (let h = 1; h <= (harmonic ? 6 : 1); h++) {
          pcm[i] += 0.12 * env * Math.sin(2 * Math.PI * f * h * i / SR) / h ** 1.2;
        }
      }
    }
  });
  return pcm;
}
const metadata = { key: { rootPc: 0, mode: 'major', name: 'C Major' }, bpm: 120 };
const pcm = signal([[43, 55, 64, 76], [45, 57, 65, 77]]);
const parts = S.extractSATB(pcm, SR, metadata);
for (const [id, expected] of Object.entries({ bass: [43, 45], tenor: [55, 57], alto: [64, 65], soprano: [76, 77] })) {
  const t = parts[id];
  console.log(id, t.notes.map((n) => M.midiToName(n.midi) + ' ' + n.frequencyHz + 'Hz').join(', '));
  assert.deepEqual(t.notes.map((n) => n.midi), expected, id + ' follows both independently estimated notes');
  for (const [i, n] of t.notes.entries()) {
    assert(Math.abs(n.frequencyHz - 440 * 2 ** ((n.midi - 69) / 12)) < 2, 'measured fundamental close to generated pitch');
    assert(n.start >= 0 && n.start < n.end && n.end <= t.duration && n.dur >= 0.1);
    if (i) assert(t.notes[i - 1].end <= n.start);
  }
  assert.equal(t.bpm, 120); assert.equal(t.voice.toLowerCase(), id);
  assert.equal(t.estimated, true);
}
// Polyphonic fundamentals are analyzed from the PCM, not manufactured by
// transposing or routing the already-extracted main melody.
const noLead = { ...metadata, notes: [{ midi: 1 }] };
assert.deepEqual(S.extractSATB(pcm, SR, noLead), parts);
const missing = S.extractSATB(signal([[43, 76]]), SR, metadata);
assert.deepEqual(missing.bass.notes.map((n) => n.midi), [43]);
assert.deepEqual(missing.soprano.notes.map((n) => n.midi), [76]);
assert.equal(missing.alto.notes.length + missing.tenor.notes.length, 0, 'does not invent inner harmony');
const solo = S.extractSATB(signal([[43]]), SR);
assert.equal(Object.values(solo).reduce((n, t) => n + t.notes.length, 0), 1, 'harmonics do not become extra singers');
const unison = S.extractSATB(signal([[60, 60]]), SR);
assert.equal(Object.values(unison).filter((t) => t.notes.length).length, 1, 'unison pitch is not duplicated across voice labels');
const silence = S.extractSATB(new Float32Array(SR * 2), SR);
assert(Object.values(silence).every((t) => t.notes.length === 0));
assert(Object.values(S.extractSATB(new Float32Array(10), SR)).every((t) => t.notes.length === 0));
const detuned = S.extractSATB(signal([[76]], 1.2, 20), SR);
assert.equal(detuned.soprano.notes[0].midi, 76);
assert(Math.abs(detuned.soprano.notes[0].cents - 20) < 5, 'Hz reflects detuning, not just the equal-tempered note lookup');
assert(Math.abs(M.noteFrequency(detuned.soprano.notes[0], 12) / detuned.soprano.notes[0].frequencyHz - 2) < 0.001);
const pure = S.extractSATB(signal([[43, 55, 64, 76]], 1.2, 0, false), SR);
assert(Object.values(pure).every((t) => t.notes.length > 0), 'supports fundamental-only tones as well as harmonic voices');
const assigned = S.assignVoices([{ midi: 43 }, { midi: 55 }, { midi: 64 }, { midi: 76 }], [null, null, null, null]);
assert.equal(new Set(assigned.filter(Boolean)).size, 4);
const outside = S.assignVoices([{ midi: 30 }], [null, null, null, null]);
assert(outside.every((n) => n === null), 'does not force out-of-range pitches into a voice');
let progressCount = 0;
assert.deepEqual(await S.extractSATBAsync(pcm, SR, metadata, () => progressCount++), parts);
assert(progressCount > 0);
await assert.rejects(S.extractSATBAsync(pcm, SR, metadata, null, () => true), /cancelled/);
const txt = S.partsToText(parts, 'Choir example', 2);
for (const name of ['Soprano', 'Alto', 'Tenor', 'Bass', 'Pitch Hz', 'range-guided']) assert(txt.includes(name));
const midi = M.tuneToMidiBytes(parts.bass, 120, 0);
assert.equal(new DataView(midi.buffer).getUint32(18), midi.length - 22);
const html = readFileSync(new URL('index.html', import.meta.url), 'utf8');
for (const id of ['partSel', 'partSummary', 'sharePartsBtn']) assert(html.includes('id="' + id + '"'));
assert(html.indexOf('melody.js') < html.indexOf('satb.js') && html.indexOf('satb.js') < html.indexOf('app.js'));
assert(/not isolated voices/i.test(html));
console.log('CHOIRTUNE SATB TEST: polyphony, Hz, missing parts, unison, silence, detuning, timing, async/cancel and exports ALL PASSED');
