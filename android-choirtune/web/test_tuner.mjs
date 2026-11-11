/* No external dependencies. Synthetic YIN tests plus lifecycle/UI test doubles.
 * This is not a physical microphone latency or real-singer accuracy benchmark. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
await import('./tunerPitch.js');
const P = globalThis.ChoirTunerPitch;
function singing(midi, cents = 0, sr = 44100, noise = 0) {
  const f = P.frequency(midi) * 2 ** (cents / 1200), x = new Float32Array(4096);
  let seed = 7;
  for (let i = 0; i < x.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const phase = 2 * Math.PI * f * i / sr;
    x[i] = 0.35 * Math.sin(phase) + 0.18 * Math.sin(2 * phase) + 0.09 * Math.sin(3 * phase) + (seed / 4294967296 - 0.5) * noise;
  }
  return x;
}
for (const sr of [44100, 48000]) for (const midi of [40, 43, 48, 55, 60, 64, 69, 76, 84]) for (const cents of [-25, 0, 25]) {
  const detected = P.detectPitch(singing(midi, cents, sr, 0.005), sr);
  assert(detected && detected.confidence > 0.85, 'voiced YIN result');
  const mapped = P.mapFrequency(detected.frequencyHz);
  assert.equal(mapped.midi, midi);
  assert(Math.abs(mapped.cents - cents) < 1, `${sr}Hz MIDI ${midi}: expected ${cents}c, got ${mapped.cents}`);
}
assert.equal(P.mapFrequency(440).name, 'A4');
assert.equal(P.mapFrequency(440).cents, 0);
assert.equal(P.mapFrequency(0), null);
assert(Math.abs(P.mapFrequency(440 * 2 ** (-10 / 1200), 69).cents + 10) < 0.001);
assert.equal(P.detectPitch(new Float32Array(4096), 44100), null);
assert.equal(P.detectPitch(new Float32Array(4096).fill(0.5), 44100), null, 'DC is not singing');
assert.equal(P.detectPitch(singing(69).map((v) => v * 0.001), 44100), null, 'noise gate suppresses quiet input');
let seed = 33;
const noise = Float32Array.from({ length: 4096 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 4294967296 - 0.5) * 0.2; });
assert.equal(P.detectPitch(noise, 44100), null, 'aperiodic noise is not a note');
assert.equal(P.detectPitch(new Float32Array(50), 44100), null);

class Element {
  constructor() { this.value = ''; this.textContent = ''; this.style = {}; this.disabled = false; this.events = {}; this.attrs = {}; this.children = []; this.classes = new Set(); this.classList = { add: (c) => this.classes.add(c), remove: (c) => this.classes.delete(c), contains: (c) => this.classes.has(c) }; }
  addEventListener(type, fn) { this.events[type] = fn; }
  setAttribute(key, value) { this.attrs[key] = value; }
  appendChild(child) { this.children.push(child); }
  set innerHTML(value) { this.children = []; }
  click() { return this.events.click?.(); }
}
const elements = Object.fromEntries([...read('index.html').matchAll(/id="([^"]+)"/g)].map((m) => [m[1], new Element()]));
const $ = (id) => elements[id];
$('noiseFloor').value = '0.008'; $('tuningMode').value = 'nearest';
let started = 0, stopped = 0, songStops = 0, oscillatorStops = 0, toneStarts = 0, closes = 0, now = 0;
const intervals = new Map(); let nextTimer = 0; const documentEvents = {};
class Context {
  constructor() { this.currentTime = 0; this.destination = {}; this.sampleRate = 44100; }
  resume() { return Promise.resolve(); }
  close() { closes++; return Promise.resolve(); }
  createOscillator() { return { frequency: {}, type: '', connect() {}, start() { toneStarts++; }, stop() { oscillatorStops++; } }; }
  createAnalyser() { return { fftSize: 4096, getFloatTimeDomainData: (frame) => frame.set(singing(69)) }; }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; }
}
const sandbox = {
  console, Float32Array, performance: { now: () => now += 40 },
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  setInterval: (fn, ms) => { assert.equal(ms, 40); intervals.set(++nextTimer, fn); return nextTimer; },
  clearInterval: (id) => intervals.delete(id),
  document: { getElementById: $, createElement: () => new Element(), addEventListener: (event, fn) => documentEvents[event] = fn, hidden: false },
  navigator: {}, addEventListener() {}, AudioContext: Context,
  ChoirTune: { startMicrophone: () => started++, stopMicrophone: () => stopped++ },
  ChoirSongPlayback: { stop: () => songStops++ },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('tunerPitch.js'), sandbox);
vm.runInContext(read('tuner.js'), sandbox);
function send(frame) {
  const bytes = Buffer.alloc(frame.length * 2);
  frame.forEach((v, i) => bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  sandbox.ChoirTunerNative.onFrame(bytes.toString('base64'), 44100);
  intervals.forEach((fn) => fn());
}
await $('startTunerBtn').click(); assert.equal(started, 1); assert(songStops > 0);
sandbox.ChoirTunerNative.onReady(44100);
for (let i = 0; i < 5; i++) send(singing(69));
assert.equal($('liveNote').textContent, 'A4');
assert($('pitchGauge').classList.contains('locked'));
assert($('liveState').textContent.includes('In tune'));
send(singing(69, -20)); send(singing(69, -20));
assert($('liveState').textContent.includes('Flat')); assert(Number.parseFloat($('pitchNeedle').style.left) < 50);
send(singing(69, 20)); send(singing(69, 20));
assert($('liveState').textContent.includes('Sharp')); assert(Number.parseFloat($('pitchNeedle').style.left) > 50);
send(new Float32Array(4096));
assert.equal($('liveNote').textContent, '--'); assert(!$('pitchGauge').classList.contains('locked'));
$('preset-bass').click(); assert.equal($('preset-bass').attrs['aria-pressed'], 'true');
send(singing(69)); assert($('liveState').textContent.includes('Outside')); assert.equal($('pitchNeedle').style.visibility, 'hidden');
$('tuningMode').value = 'reference'; $('referenceNote').value = '48';
for (let i = 0; i < 4; i++) send(singing(48, 3));
assert($('pitchGauge').classList.contains('locked'));
assert($('liveCents').textContent.includes('C3'));
await $('playDroneBtn').click(); assert(stopped > 0); assert.equal(intervals.size, 0);
assert($('tunerStatus').textContent.includes('Reference tone: C3'));
$('stopDroneBtn').click(); assert(oscillatorStops > 0 && closes > 0);
await $('startTunerBtn').click(); $('stopTunerBtn').click();
sandbox.ChoirTunerNative.onReady(44100); // late ready after stop must not restart
assert.equal(intervals.size, 0); assert.equal($('startTunerBtn').disabled, false);
await $('startTunerBtn').click(); sandbox.ChoirTunerNative.onError('Permission denied');
assert($('tunerStatus').textContent.includes('Permission denied')); assert.equal(intervals.size, 0);
await $('startTunerBtn').click(); sandbox.ChoirTunerNative.onReady(44100);
sandbox.document.hidden = true; documentEvents.visibilitychange();
assert.equal(intervals.size, 0); assert.equal($('startTunerBtn').disabled, false);
// Browser denied permission and cancellation of an in-flight permission prompt.
sandbox.ChoirTune.startMicrophone = undefined;
sandbox.navigator.mediaDevices = { getUserMedia: async () => { throw new Error('denied'); } };
await $('startTunerBtn').click(); assert($('tunerStatus').textContent.includes('denied'));
let resolvePrompt, tracksStopped = 0;
sandbox.navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => resolvePrompt = resolve);
const pending = $('startTunerBtn').click(); $('stopTunerBtn').click();
resolvePrompt({ getTracks: () => [{ stop: () => tracksStopped++ }] }); await pending;
assert.equal(tracksStopped, 1); assert.equal(intervals.size, 0);
// Successful browser capture uses its actual sample rate and releases tracks.
const browserTrack = { stop: () => tracksStopped++ };
sandbox.navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [browserTrack] });
sandbox.document.hidden = false;
$('preset-soprano').click(); $('tuningMode').value = 'nearest';
await $('startTunerBtn').click();
for (let i = 0; i < 4; i++) intervals.forEach((fn) => fn());
assert.equal($('liveNote').textContent, 'A4');
browserTrack.onended(); assert.equal(intervals.size, 0); assert(tracksStopped >= 2);
assert($('tunerStatus').textContent.includes('disconnected'));
const beforeTone = toneStarts;
const startingTone = $('playDroneBtn').click();
$('preset-alto').click(); // cancel an awaiting context.resume(), not just an active oscillator
await startingTone;
assert.equal(toneStarts, beforeTone, 'no late reference drone after preset change');

// Native wiring gates: capture permission is explicit and release is lifecycle-bound.
const java = read('../app/src/main/java/com/choirtune/app/MainActivity.java');
const capture = read('../app/src/main/java/com/choirtune/app/MicrophoneController.java');
const manifest = read('../app/src/main/AndroidManifest.xml');
assert(manifest.includes('android.permission.RECORD_AUDIO'));
assert(/REQUEST_MIC_PERMISSION/.test(java) && /pendingMicrophone = false/.test(java));
assert(/onPause\(\)[\s\S]*?stopMicrophone\(\)/.test(java));
assert(/audio.release\(\)/.test(capture) && /generation == token/.test(capture));
assert(/short\[4096\]/.test(capture) && /rate \/ 25/.test(capture));
assert(/android.permission.INTERNET/.test(manifest), 'optional server access leaves native tuner independent of network');
console.log('CHOIRTUNE TUNER TEST: YIN, Hz/cents, silence/noise, gauge/presets, reference, permissions, cancellation and lifecycle ALL PASSED');
