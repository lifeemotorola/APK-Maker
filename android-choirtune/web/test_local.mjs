/* Deterministic native-bridge contract tests, NOT neural inference/device tests.
 * Real weighted C++ inference is tested separately with native/demucs_smoke.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('local.js', import.meta.url), 'utf8');
function harness({ available = true, failBegin = '', failAppend = '', phases = ['loading', 'processing', 'done'], nativeError = 'Test native failure', pending = false, badOutput = false, duration = 0.25, clockStep = 0 } = {}) {
  const elements = {}, calls = [], timers = [];
  let statusIndex = 0;
  const element = (id) => elements[id] ||= {
    checked: false, disabled: false, textContent: '', listeners: {}, src: '',
    classList: { add() {}, remove() {} },
    pause() { calls.push(['pause']); }, removeAttribute() {},
    addEventListener(name, fn) { this.listeners[name] = fn; }
  };
  const frames = Math.round(duration * 44100), resultSize = Math.ceil(frames / 4) * 4;
  let clock = 0;
  const bridge = {
    demucsAvailable: () => available,
    demucsBegin(bytes) { calls.push(['begin', bytes]); return failBegin; },
    demucsAppend(chunk) { calls.push(['append', Buffer.from(chunk, 'base64')]); return failAppend; },
    demucsStart() { calls.push(['start']); return ''; },
    demucsStatus() {
      const phase = pending ? 'processing' : phases[Math.min(statusIndex++, phases.length - 1)];
      return JSON.stringify({ phase, progress: pending ? 0.5 : Math.min(0.9, statusIndex * 0.2), error: phase === 'error' ? nativeError : '' });
    },
    demucsCancel() { calls.push(['cancel']); },
    demucsExport() { calls.push(['export']); }
  };
  class Offline {
    constructor(channels, count, rate) { assert.equal(channels, 2); assert.ok(count <= 30 * 44100); this.count = count; assert.equal(rate, 44100); calls.push(['resample', count]); }
    createBufferSource() { return { connect() {}, disconnect() {}, start(...args) { calls.push(['source', ...args]); } }; }
    startRendering() { const count = this.count; return Promise.resolve({ getChannelData(c) { return new Float32Array(count).fill(c === 0 ? 0.5 : -0.25); } }); }
  }
  class Decode {
    decodeAudioData(bytes, done) { done({ duration: 0.25, sampleRate: 44100, vocals: true }); }
    close() { calls.push(['closed']); return Promise.resolve(); }
  }
  const window = { ChoirTune: bridge, OfflineAudioContext: Offline, AudioContext: Decode, addEventListener() {} };
  vm.runInNewContext(source, {
    window, document: { getElementById: element, addEventListener() {} },
    setTimeout(fn) { if (pending) timers.push(fn); else queueMicrotask(fn); },
    fetch: async (url, options) => {
      assert.equal(url, 'https://appassets.androidplatform.net/demucs/analysis.f32');
      assert.equal(options.cache, 'no-store'); calls.push(['fetch']);
      return { ok: true, arrayBuffer: async () => new Float32Array(badOutput ? 25 : resultSize / 4).fill(0.125).buffer };
    },
    URL: { createObjectURL() { return 'blob:fixture'; }, revokeObjectURL() {} },
    Blob, Uint8Array, DataView, Date: clockStep ? { now: () => (clock += clockStep) } : Date, Number, JSON, btoa: (s) => Buffer.from(s, 'binary').toString('base64')
  });
  return { api: window.ChoirLocalDemucs, elements, calls, timers, frames, bridge };
}
const audio = { duration: 0.25 };
const h = harness();
assert.equal(h.api.enabled(), false, 'Native availability does not opt into Demucs');
assert.equal(h.elements.useDemucs.checked, false);
assert.equal(h.elements.pickDemucsBtn.disabled, true);
assert.equal(h.calls.some(([kind]) => kind === 'begin' || kind === 'start'), false);
h.elements.useDemucs.checked = true;
h.elements.useDemucs.listeners.change();
assert.equal(h.api.enabled(), true);
assert.equal(h.elements.pickDemucsBtn.disabled, false);
h.elements.useDemucs.checked = false;
h.elements.useDemucs.listeners.change();
assert.equal(h.api.enabled(), false);
assert.equal(h.elements.pickDemucsBtn.disabled, true);
const progress = [];
const vocals = await h.api.isolate(audio, (text) => progress.push(text));
assert.equal(vocals.sampleRate, 11025);
assert.equal(vocals.length, Math.ceil(h.frames / 4));
assert.equal(vocals.getChannelData(0)[0], 0.125);
assert.equal(h.calls.find(([kind]) => kind === 'begin')[1], h.frames * 4);
const transferred = Buffer.concat(h.calls.filter(([kind]) => kind === 'append').map(([, data]) => data));
assert.equal(transferred.length, h.frames * 4);
assert.equal(transferred.readInt16LE(0), 16384);
assert.equal(transferred.readInt16LE(2), -8192);
assert.ok(progress.some((s) => /Verifying/.test(s)));
assert.ok(progress.some((s) => /40%/.test(s)));
assert.ok(h.elements.localVocalsPlayer.src.startsWith('https://appassets.androidplatform.net/demucs/vocals.wav?job='));
h.elements.saveLocalVocalsBtn.listeners.click();
assert.ok(h.calls.some(([kind]) => kind === 'export'));
assert.equal(h.calls.some(([kind]) => kind === 'save'), false);
assert.equal(h.api.busy(), false);
assert.equal(h.elements.cancelDemucsBtn.disabled, true);
assert.equal(h.calls.filter(([kind]) => kind === 'cancel').length, 0);

for (const duration of [0, 0.24, 900.001, 3600, NaN]) {
  const test = harness();
  await assert.rejects(test.api.isolate({ duration }, () => {}), /15 minutes/);
  assert.equal(test.calls.some(([kind]) => kind === 'begin'), false);
}
const browser = harness({ available: false });
assert.equal(browser.api.enabled(), false);
assert.equal(browser.elements.useDemucs.disabled, true);
assert.equal(browser.elements.pickDemucsBtn.disabled, true);
await assert.rejects(browser.api.isolate(audio, () => {}), /not available/);
for (const options of [{ failBegin: 'Could not prepare private audio storage' }, { failAppend: 'Invalid size' }, { phases: ['error'] }, { badOutput: true }]) {
  const test = harness(options);
  await assert.rejects(test.api.isolate(audio, () => {}));
  assert.equal(test.api.busy(), false);
  assert.equal(test.elements.cancelDemucsBtn.disabled, true);
  if (!options.failBegin) assert.ok(test.calls.some(([kind]) => kind === 'cancel'));
  else assert.equal(test.calls.some(([kind]) => kind === 'start'), false);
}
// Inference is attempted even without a RAM eligibility check. A REAL native
// allocation failure must still be surfaced and cleaned up, never hidden.
const oom = harness({ phases: ['processing', 'error'], nativeError: 'Demucs ran out of working memory on this device. No preset RAM limit was applied.' });
await assert.rejects(oom.api.isolate(audio, () => {}), /No preset RAM limit was applied/);
assert.ok(oom.calls.some(([kind]) => kind === 'start'));
assert.ok(oom.calls.some(([kind]) => kind === 'cancel'));
assert.equal(oom.calls.some(([kind]) => kind === 'fetch'), false);
assert.equal(oom.api.busy(), false);
const cancel = harness({ pending: true });
const operation = cancel.api.isolate(audio, () => {});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(cancel.api.busy(), true);
await assert.rejects(cancel.api.isolate(audio, () => {}), /previous/);
cancel.api.cancel();
for (const timer of cancel.timers.splice(0)) timer();
await assert.rejects(operation, /cancelled/);
assert.ok(cancel.calls.some(([kind]) => kind === 'cancel'));
assert.equal(cancel.api.busy(), false);
const stale = harness();
await assert.rejects(stale.api.isolate(audio, () => {}, () => true), /cancelled/);
assert.equal(stale.calls.some(([kind]) => kind === 'begin'), false);
// Requested 3-15 minute durations reach the native begin call, not a clip cap.
for (const duration of [180, 900]) {
  const test = harness({ duration, failBegin: 'fixture resource rejection' });
  await assert.rejects(test.api.isolate({ duration }, () => {}), /fixture resource/);
  assert.equal(test.calls.find(([kind]) => kind === 'begin')[1], duration * 44100 * 4);
}
// Real transport across the former limit, including a partial final chunk.
const long = harness({ duration: 60.25 });
const longVocals = await long.api.isolate({ duration: 60.25 }, () => {});
assert.equal(longVocals.length, Math.ceil(60.25 * 44100 / 4));
assert.deepEqual(long.calls.filter(([kind]) => kind === 'source').map(([, ...args]) => args), [[0, 0, 30], [0, 30, 30], [0, 60, 0.25]]);
assert.equal(long.calls.filter(([kind]) => kind === 'append').reduce((sum, [, bytes]) => sum + bytes.length, 0), 60.25 * 44100 * 4);
assert.equal(long.calls.filter(([kind]) => kind === 'start').length, 1); // one native job/model per song
const slow = harness({ clockStep: 15 * 60 * 1000 });
await slow.api.isolate(audio, () => {}); // progress continues beyond old 20-minute cutoff
const stalled = harness({ clockStep: 31 * 60 * 1000 });
await assert.rejects(stalled.api.isolate(audio, () => {}), /no progress/);
console.log('CHOIRTUNE LOCAL TEST: stereo transport, native errors, storage startup errors, 15-minute bounds, bounded resampling, long transport and stall watchdog, cancellation, stale jobs, offline output and export PASSED');
