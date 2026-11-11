/* Server-client consent, manifest and playback contracts. Fetch/audio are
 * deterministic test doubles, not a running neural separator. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
class Element {
  constructor(id) { this.id = id; this.value = ''; this.checked = id.startsWith('include-'); this.disabled = false; this.textContent = ''; this.style = {}; this.listeners = {}; this.children = []; this.classes = new Set(['hidden']); this.classList = { add: (s) => this.classes.add(s), remove: (s) => this.classes.delete(s), contains: (s) => this.classes.has(s) }; }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  click() { return this.listeners.click?.(); }
  appendChild(child) { this.children.push(child); if (!this.value) this.value = child.value; }
  set innerHTML(value) { this.children = []; this.value = ''; }
  remove() {}
}
const elements = Object.fromEntries([...read('index.html').matchAll(/id="([^"]+)"/g)].map((m) => [m[1], new Element(m[1])]));
const $ = (id) => elements[id], calls = [], gains = [], startTimes = [];
let imported, saved, currentMode = 'range_guided_estimate', badManifest = false, stopCalls = 0, closed = 0;
const id = 'test_job_identifier_0123456789';
const voices = ['soprano', 'alto', 'tenor', 'bass'];
function track(voice = 'Main melody') { return { voice, duration: 1, bpm: 120, key: { name: 'C Major', rootPc: 0, mode: 'major' }, notes: [{ midi: 60, start: .1, end: .7, dur: .6, frequencyHz: 261.6 }] }; }
function manifest() {
  const result = { schemaVersion: 1, analysis: { tune: track(), parts: Object.fromEntries(voices.map((v) => [v, track(v)])) }, separation: { satb: currentMode }, warnings: ['Test fixture, not model inference.'], files: [{ name: 'vocals.wav', kind: 'vocal_stem', label: 'Blended vocals' }].concat(voices.map((v) => ({ name: (currentMode === 'external_model' ? '' : 'guide-') + v + '.wav', kind: currentMode === 'external_model' ? 'satb_stem' : 'synthesized_guide', label: v }))) };
  if (badManifest) result.files[1].kind = 'satb_stem';
  return result;
}
class Context {
  constructor() { this.currentTime = 1; this.destination = {}; }
  resume() { return Promise.resolve(); }
  close() { closed++; return Promise.resolve(); }
  decodeAudioData(data, done) { done({ duration: 1 }); }
  createBufferSource() { return { connect() {}, start: (at) => startTimes.push(at), stop: () => stopCalls++ }; }
  createGain() { const gain = { gain: { value: 0 }, connect() {} }; gains.push(gain); return gain; }
}
const events = {};
const sandbox = {
  URL, Blob, Uint8Array, AbortController, console, AudioContext: Context,
  location: { hostname: 'appassets.androidplatform.net', protocol: 'https:', origin: 'https://appassets.androidplatform.net' },
  document: { getElementById: $, createElement: () => new Element('option'), body: new Element('body'), addEventListener: (event, fn) => events[event] = fn },
  addEventListener() {}, setTimeout, clearTimeout,
  ChoirTune: { saveFile: (name, data, mime) => (saved = { name, data, mime }, 'Downloads/' + name) },
  ChoirTuneMelody: { bytesToBase64: (b) => Buffer.from(b).toString('base64') },
  ChoirLiveTuner: { stop: () => stopCalls++ }, ChoirSongPlayback: { stop: () => stopCalls++ },
  ChoirImportServerAnalysis: (analysis, title) => imported = { analysis, title },
  fetch: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers['X-Choir-Key'], 'test-access-key');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    if (options.method === 'DELETE') return Response.json({ status: 'deleting' });
    if (url.endsWith('/health')) return Response.json({ demucsInstalled: false, satbModelConfigured: false, retentionSeconds: 3600 });
    if (url.endsWith('/jobs')) {
      assert.equal(options.headers['X-Choir-Consent'], 'upload-audio');
      assert.equal(options.body.name, 'Choir.wav');
      return Response.json({ id });
    }
    if (url.endsWith('/result')) return Response.json(manifest());
    if (url.includes('/files/')) return new Response(new Uint8Array([1, 2, 3]));
    return Response.json({ status: 'complete', stage: 'Ready' });
  },
};
sandbox.window = sandbox;
vm.createContext(sandbox); vm.runInContext(read('server.js'), sandbox);
$('serverFile').files = [{ name: 'Choir.wav', size: 20 }];
$('serverUrl').value = 'https://choir.example'; $('serverKey').value = 'test-access-key';
await $('uploadServerBtn').click(); assert.equal(calls.length, 0, 'no upload without explicit consent');
assert($('serverStatus').textContent.includes('consent'));
await $('checkServerBtn').click(); assert($('serverStatus').textContent.includes('No SATB model'));
$('uploadConsent').checked = true; await $('uploadServerBtn').click();
assert.equal($('uploadConsent').checked, false, 'consent is per upload');
assert(!$('serverResults').classList.contains('hidden'));
assert($('stemKind').textContent.includes('NOT separated singers'));
$('importServerBtn').click(); assert.equal(imported.title, 'Choir');
await $('playServerPartsBtn').click(); await new Promise((r) => setTimeout(r, 10));
assert.equal(startTimes.length, 4); assert(startTimes.every((at) => at === startTimes[0]), 'all tracks use one audio clock');
$('solo-tenor').click();
assert.equal(gains[2].gain.value, .25); assert.equal(gains[0].gain.value, 0);
$('include-tenor').checked = false; $('include-tenor').listeners.change(); assert.equal(gains[2].gain.value, 0);
$('stopServerAudioBtn').click(); assert(stopCalls >= 4 && closed > 0);
$('serverArtifact').value = 'guide-tenor.wav'; await $('downloadServerBtn').click();
assert.equal(saved.name, 'guide-tenor.wav'); assert.equal(saved.mime, 'audio/wav');
currentMode = 'external_model'; $('uploadConsent').checked = true; await $('uploadServerBtn').click();
assert($('stemKind').textContent.includes('external-model SATB audio stems'));
currentMode = 'range_guided_estimate'; badManifest = true;
$('uploadConsent').checked = true; await $('uploadServerBtn').click();
assert($('serverStatus').textContent.includes('mislabeled'));
assert($('serverResults').classList.contains('hidden'), 'reject fake SATB stem claims');
badManifest = false;
$('serverUrl').value = 'http://insecure.example'; $('uploadConsent').checked = true;
const before = calls.length; await $('uploadServerBtn').click(); assert.equal(calls.length, before);
assert($('serverStatus').textContent.includes('HTTPS'));
$('serverUrl').value = 'https://user:password@choir.example'; await $('uploadServerBtn').click(); assert.equal(calls.length, before);
$('deleteServerBtn').click(); await new Promise((r) => setTimeout(r, 10));
assert(calls.some((c) => c.options.method === 'DELETE'));
assert.equal($('uploadServerBtn').disabled, false);
assert(!/localStorage/.test(read('server.js')), 'no keys or job tokens persisted');
console.log('CHOIRTUNE SERVER CLIENT TEST: consent, HTTPS/auth, capability labels, guide/stem distinction, synchronized mixer, solo/mute, exports and deletion ALL PASSED');
