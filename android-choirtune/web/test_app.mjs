/* Dependency-free app interaction regression tests using a minimal DOM/audio
 * harness. This exercises real app.js and melody.js; it does not replace a
 * browser or Android device test. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');

class Element {
  constructor(id = '') {
    this.id = id; this.listeners = {}; this.value = '0'; this.style = {};
    this.textContent = ''; this.disabled = false; this.children = [];
    const classes = new Set(id === 'results' ? ['hidden'] : []);
    this.classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) };
  }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  click() { return this.dispatch('click'); }
  dispatch(event) { return this.listeners[event]?.({ target: this }); }
  set innerHTML(value) {
    this.html = value;
    this.rows = [...value.matchAll(/data-id="([^"]+)"/g)].map((match) => {
      const row = new Element(match[1]);
      row.buttons = Object.fromEntries(['load', 'share', 'del'].map((action) => ['.act-' + action, new Element()]));
      return row;
    });
  }
  get innerHTML() { return this.html || ''; }
  querySelectorAll() { return this.rows || []; }
  querySelector(selector) { return this.buttons[selector]; }
  getAttribute() { return this.id; }
  scrollIntoView() {}
  appendChild(child) { this.children.push(child); }
  remove() {}
  getContext() { return new Proxy({}, { get: () => () => {} }); }
}
const elements = Object.fromEntries([...read('index.html').matchAll(/id="([^"]+)"/g)].map((m) => [m[1], new Element(m[1])]));
const $ = (id) => elements[id];
let saved = '{}', exported, shared, decodeFail = false, decodedDuration = 1, paused = true, playCount = 0, revoked = 0;
const pcm = new Float32Array(22050);
for (let i = 0; i < pcm.length; i++) pcm[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 22050);
class AudioContext {
  constructor() { this.currentTime = 0; this.state = 'running'; }
  decodeAudioData(buffer, ok, fail) {
    if (decodeFail) fail(new Error('bad audio'));
    else ok({ duration: decodedDuration, length: pcm.length, sampleRate: 22050, numberOfChannels: 1, getChannelData: () => pcm });
  }
  close() { return Promise.resolve(); }
  resume() { return Promise.resolve(); }
  createOscillator() { return { frequency: {}, connect() {}, start() { playCount++; }, stop() {} }; }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; }
}
const sandbox = {
  console, Float32Array, ArrayBuffer, Buffer, setTimeout: (fn, ms) => ms === 2600 ? 0 : setTimeout(fn, 0),
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, confirm: () => true,
  AudioContext,
  Audio: class {
    get paused() { return paused; }
    pause() { paused = true; }
    play() { paused = false; return Promise.resolve(); }
  },
  URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => revoked++ },
  document: { getElementById: $, addEventListener() {}, body: new Element(), createElement: () => new Element() },
  ChoirTune: {
    loadState: () => saved, saveState: (s) => (saved = s, true),
    shareText: (title, text) => shared = text,
    saveFile: (name, data, mime) => (exported = { name, data, mime }, 'Downloads/ChoirTune/' + name),
  },
  addEventListener() {}, navigator: {},
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('melody.js'), sandbox);
vm.runInContext(read('satb.js'), sandbox);
vm.runInContext(read('app.js'), sandbox);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function upload(name) {
  $('fileInput').files = [{ name, size: 100, arrayBuffer: async () => new ArrayBuffer(10) }];
  await $('fileInput').dispatch('change');
  for (let tries = 0; tries < 100; tries++) {
    if (!$('results').classList.contains('hidden') || $('status').textContent.includes('Could not analyze')) break;
    await delay(10);
  }
}
$('stopTuneBtn').click(); // stopping before the first upload must not draw null tune
await upload('Solo.wav');
assert(!$('results').classList.contains('hidden'));
assert($('sheetBody').innerHTML.includes('A4'));
assert($('partSummary').textContent.includes('Soprano: 1'));
$('partSel').value = 'soprano'; $('partSel').dispatch('change');
assert($('sheetBody').innerHTML.includes('A4'));
const pitchCell = $('sheetBody').innerHTML.match(/<\/td><td>([0-9]+\.[0-9])<\/td>/);
assert(pitchCell && Math.abs(Number(pitchCell[1]) - 440) < 1);
$('playTuneBtn').click(); assert(playCount > 0);
$('stopTuneBtn').click();
$('playOrigBtn').click(); await delay(1); assert(!paused);
$('stopTuneBtn').click(); assert(paused);
$('transposeSel').value = '2'; $('transposeSel').dispatch('change');
assert($('sheetBody').innerHTML.includes('B4'));
$('exportMidBtn').click();
const midi = Buffer.from(exported.data, 'base64');
assert.equal(midi.toString('ascii', 0, 4), 'MThd');
assert.equal(midi.readUInt32BE(18), midi.length - 22);
assert(midi.includes(Buffer.from([0x90, 71, 100])));
$('exportTxtBtn').click(); assert(shared.includes('B4') && shared.includes('Soprano'));
$('sharePartsBtn').click(); assert(shared.includes('Soprano') && shared.includes('Alto') && shared.includes('Tenor') && shared.includes('Bass'));
$('partSel').value = 'bass'; $('partSel').dispatch('change');
assert($('sheetBody').innerHTML.includes('no stable pitches'));
$('partSel').value = 'soprano'; $('partSel').dispatch('change');
$('saveBtn').click(); assert.equal(JSON.parse(saved).tunes.length, 1);
assert(JSON.parse(saved).tunes[0].parts.soprano.notes.length > 0);
let row = $('library').rows[0];
row.querySelector('.act-load').click();
assert($('playOrigBtn').disabled); assert(revoked > 0);
assert($('sheetBody').innerHTML.includes('B4'));
assert.equal($('partSel').value, 'soprano');
row.querySelector('.act-share').click(); assert(shared.includes('B4'));
row.querySelector('.act-del').click(); assert.equal(JSON.parse(saved).tunes.length, 0);
// Older version 1.0 saves remain usable, but do not pretend to contain SATB.
saved = JSON.stringify({ tunes: [{ id: 'legacy', title: 'Old tune', tune: { notes: [{ midi: 60, start: 0, end: 1, dur: 1 }], key: { rootPc: 0, mode: 'major', name: 'C Major' }, bpm: 120, duration: 1 } }] });
vm.runInContext(read('app.js'), sandbox);
$('library').rows[0].querySelector('.act-load').click();
assert($('sharePartsBtn').disabled);
$('partSel').value = 'alto'; $('partSel').dispatch('change');
assert.equal($('partSel').value, 'main');
assert($('sheetBody').innerHTML.includes('C4'));
const serverTrack = { notes: [{ midi: 76, start: 0, end: 1, dur: 1, frequencyHz: 659.2 }], key: { rootPc: 0, mode: 'major', name: 'C Major' }, bpm: 120, duration: 1 };
sandbox.ChoirImportServerAnalysis({ tune: serverTrack, parts: Object.fromEntries(['soprano','alto','tenor','bass'].map((v) => [v, serverTrack])) }, 'Server choir');
assert.equal($('partSel').value, 'soprano');
assert($('sheetBody').innerHTML.includes('E5'));
assert($('playOrigBtn').disabled);
// Native Demucs output, not the original PCM, must feed both estimators.
let nativeCalls = 0, nativeFail = false;
const vocalPcm = new Float32Array(22050);
for (let i = 0; i < vocalPcm.length; i++) vocalPcm[i] = 0.5 * Math.sin(2 * Math.PI * 659.255 * i / 22050);
sandbox.ChoirLocalDemucs = {
  enabled: () => true, busy: () => false, clear() {}, cancel() {}, stopAudio() {},
  async isolate(audio, progress) {
    nativeCalls++;
    if (nativeFail) throw new Error('Native model failed');
    progress('Isolating blended vocals offline');
    return { duration: 1, length: vocalPcm.length, sampleRate: 22050, numberOfChannels: 1, getChannelData: () => vocalPcm };
  }
};
await upload('Native.wav');
assert.equal(nativeCalls, 1);
assert($('sheetBody').innerHTML.includes('E5'));
assert($('songInfo').innerHTML.includes('Demucs vocals; SATB estimates'));
assert($('status').textContent.includes('not separated singers'));
nativeFail = true;
await upload('Native-error.wav');
assert($('status').textContent.includes('Native model failed'));
assert($('results').classList.contains('hidden')); // no silent fallback to mix
// Duration guard contracts use a short decoded fixture with overridden duration;
// full-duration sample/timestamp behavior is covered by native streaming_test.
for (const duration of [180, 900]) {
  decodedDuration = duration;
  const before = nativeCalls;
  await upload('Long-song.wav');
  assert.equal(nativeCalls, before + 1); // not rejected by old 30s/5min guards
  assert($('status').textContent.includes('Native model failed'));
}
decodedDuration = 900.01;
const beforeOversized = nativeCalls;
await upload('Too-long.wav');
assert.equal(nativeCalls, beforeOversized);
assert($('status').textContent.includes('15 minutes'));
decodedDuration = 1;
sandbox.ChoirLocalDemucs = undefined;
decodeFail = true;
await upload('broken.mp3');
assert($('status').textContent.includes('Could not analyze'));
assert($('results').classList.contains('hidden'));
console.log('CHOIRTUNE APP TEST: upload, playback, stop, transpose, MIDI, share, library, native-vocal analysis and errors ALL PASSED');
