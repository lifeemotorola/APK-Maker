#!/usr/bin/env node
/* test_web.mjs — static + functional checks for the Choir Tune Finder APK
 * shell, run by android-choirtune/build.sh (and CI) before packaging.
 * The functional part synthesizes a known melody as PCM and verifies the
 * extractor finds it (notes, key, BPM), plus the text/MIDI exporters. */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = (p) => readFileSync(join(HERE, p), 'utf8');
const readRoot = (p) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('ok:', msg);
  else { console.error('FAIL:', msg); failures++; }
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

const html = read('index.html');
const app = read('app.js');
const melody = read('melody.js');
const css = read('styles.css');
const manifest = readRoot('android-choirtune/app/src/main/AndroidManifest.xml');
const main = readRoot('android-choirtune/app/src/main/java/com/choirtune/app/MainActivity.java');
const bridge = readRoot('android-choirtune/app/src/main/java/com/choirtune/app/NativeBridge.java');
const build = readRoot('android-choirtune/build.sh');

check(/package="com\.choirtune\.app"/.test(manifest), 'manifest package com.choirtune.app');
check(/android\.permission\.INTERNET/.test(manifest) && /usesCleartextTraffic="false"/.test(manifest), 'optional server feature: INTERNET permission with cleartext disabled');
check(/READ_EXTERNAL_STORAGE/.test(manifest) && /maxSdkVersion="28"/.test(manifest), 'legacy storage permission only up to API 28 (MediaStore on 29+)');
check(/@mipmap\/ic_launcher/.test(manifest) && /@string\/app_name/.test(manifest), 'PNG icon + app_name label');
check(/Choir Tune Finder/.test(readRoot('android-choirtune/app/src/main/res/values/strings.xml')), 'app label Choir Tune Finder');

check(/addJavascriptInterface/.test(main) && /"ChoirTune"/.test(main), 'window.ChoirTune bridge installed');
check(/https:\/\/appassets\.androidplatform\.net\/www\/index\.html/.test(main) && /shouldInterceptRequest/.test(main), 'page loaded from secure local bundled assets');
check(/setAllowContentAccess\(true\)/.test(main) && /onShowFileChooser/.test(main), 'song upload file picker wired (content URIs)');
check(/REQUEST_FILE_CHOOSER/.test(main) && /onActivityResult/.test(main), 'file chooser result handled');
check(/state\.json/.test(main) && /getFilesDir/.test(main), 'state persisted in app-private files dir');
check(/ACTION_SEND/.test(main) && /shareText/.test(main), 'share via system share sheet');
check(/MediaStore\.Downloads/.test(main) && /DIRECTORY_DOWNLOADS \+ "\/ChoirTune"/.test(main), 'exports saved to Downloads/ChoirTune (MediaStore)');
check(/REQUEST_STORAGE_PERMISSION/.test(main), 'legacy storage permission requested before saving on API<=28');

check(/loadState/.test(bridge) && /saveState/.test(bridge) && /shareText/.test(bridge) && /saveFile/.test(bridge), 'bridge: loadState/saveState/shareText/saveFile');

for (const id of ['fileInput', 'pickBtn', 'dropZone', 'status', 'results', 'songInfo', 'playTuneBtn', 'playOrigBtn', 'transposeSel', 'saveBtn', 'exportTxtBtn', 'exportMidBtn', 'roll', 'sheetBody', 'library']) {
  check(html.includes('id="' + id + '"'), 'control present: ' + id);
}
check(html.indexOf('melody.js') > -1 && html.indexOf('melody.js') < html.indexOf('app.js'), 'melody.js loaded before app.js');
check(/accept="audio/.test(html), 'file input accepts audio');

check(/extractTune/.test(app) && /decodeAudioData/.test(app) && /ChoirTuneMelody/.test(app), 'app decodes upload and runs extractTune');
check(/tuneToText/.test(app) && /shareText/.test(app), 'tune sheet share');
check(/tuneToMidiBytes/.test(app) && /saveFile/.test(app) && /bytesToBase64/.test(app), '.mid export via saveFile');
check(/saveState/.test(app) && /loadState/.test(app) && /localStorage/.test(app), 'library state load/save with browser fallback');
check(/roundRect/.test(app) || /fillRect/.test(app), 'piano roll drawn on canvas');

check(/ecj\.jar/.test(build) && /d8/.test(build) && /aapt2/.test(build) && /apksigner/.test(build), 'build.sh runs ecj/d8/aapt2/apksigner');
check(/melody\.js/.test(build), 'build.sh stages melody.js into the APK');
check(/check_no_emoji\.py/.test(build) && /test_web\.mjs/.test(build), 'build.sh runs emoji gate + this test');
check(/--version-code 5/.test(build) && /--version-name 1\.4/.test(build), 'versionCode 5 / versionName 1.4');
check(/ChoirTune-1\.4\.apk/.test(build), 'artifact name ChoirTune-1.4.apk');
check(existsSync(join(HERE, 'img', 'icon.png')), 'generated icon.png exists');
check(!EMOJI.test(html + app + melody + css), 'no emoji-range glyphs in web sources');

// ---------------- functional: synthesize a known melody, extract it ----------------
await import('./melody.js');
const M = globalThis.ChoirTuneMelody;
check(!!M && typeof M.extractTune === 'function', 'melody.js exposes globalThis.ChoirTuneMelody');

const SR = 22050;
const BPM = 120;
const beatSec = 60 / BPM;
// C4 E4 G4 C5, each one beat, with a short gap between notes
const seq = [[60, 0], [64, 1], [67, 2], [72, 3]];
const totalSec = 4.5;
const pcm = new Float32Array(Math.floor(totalSec * SR));
for (const [midi, beat] of seq) {
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const t0 = beat * beatSec + 0.03;
  const t1 = (beat + 1) * beatSec - 0.03;
  for (let i = Math.floor(t0 * SR); i < Math.floor(t1 * SR); i++) {
    const t = i / SR;
    const env = Math.min(1, (t - t0) / 0.02) * Math.min(1, (t1 - t) / 0.05);
    pcm[i] += env * (0.6 * Math.sin(2 * Math.PI * f0 * t) + 0.25 * Math.sin(2 * Math.PI * 2 * f0 * t) + 0.12 * Math.sin(2 * Math.PI * 3 * f0 * t));
  }
}
// light noise floor
let seed = 12345;
for (let i = 0; i < pcm.length; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  pcm[i] += (seed / 4294967296 - 0.5) * 0.004;
}

const tune = M.extractTune(pcm, SR);
console.log('extracted:', tune.notes.map((n) => M.midiToName(n.midi) + '@' + n.start.toFixed(2)).join(' '), '| key', tune.key.name, '| bpm', tune.bpm);
check(tune.notes.length >= 4, 'found at least 4 notes, got ' + tune.notes.length);
const midis = tune.notes.slice(0, 4).map((n) => n.midi);
check(midis.every((m, i) => Math.abs(m - seq[i][0]) <= 1), 'note pitches match C4 E4 G4 C5 (±1 st): ' + midis.join(','));
check(Math.abs(tune.notes[0].start - 0.03) < 0.15, 'first note starts near 0.03s, got ' + tune.notes[0].start);
check(tune.bpm >= 100 && tune.bpm <= 140, 'BPM ~120 detected: ' + tune.bpm);
check(tune.key.rootPc === 0 && tune.key.mode === 'major', 'key detected as C Major: ' + tune.key.name);
check(tune.duration > 4 && tune.duration < 5, 'duration ~4.5s: ' + tune.duration);
check(tune.voicedRatio > 0.3, 'voiced ratio sane: ' + tune.voicedRatio);

// exporters
const txt = M.tuneToText(tune, 'Test Song', 0, false);
check(txt.includes('CHOIR TUNE — Test Song') && txt.includes('C Major') && txt.includes('Melody:'), 'tune sheet text has header + melody line');
check(/C4/.test(txt) && /C5/.test(txt), 'tune sheet lists C4 and C5');
check(!EMOJI.test(txt), 'tune sheet has no emoji/arrow glyphs');
const txtT = M.tuneToText(tune, 'Test Song', 2, false);
check(/D4/.test(txtT) && /Estimated key: D Major/.test(txtT), 'transpose +2 shifts C4 to D4 and updates export key');

const mid = M.tuneToMidiBytes(tune, tune.bpm, 0);
const head = String.fromCharCode.apply(null, Array.from(mid.slice(0, 4)));
check(head === 'MThd' && mid.length > 60, 'MIDI file starts with MThd and has a track (' + mid.length + ' bytes)');
check(Array.from(mid.slice(14, 18)).map((b) => String.fromCharCode(b)).join('') === 'MTrk', 'MTrk chunk present');
const b64 = M.bytesToBase64(mid);
check(typeof b64 === 'string' && b64.length > 40 && /^[A-Za-z0-9+/=]+$/.test(b64), 'base64 export for saveFile bridge');

// empty input safety
const empty = M.extractTune(new Float32Array(1000), SR);
check(empty.notes.length === 0 && empty.bpm === 120, 'short/empty input handled gracefully');

// MIDI structure and event timing regressions (not just a header sniff).
const view = new DataView(mid.buffer, mid.byteOffset, mid.byteLength);
check(view.getUint32(18) === mid.length - 22, 'MIDI track length matches its actual bytes');
check(mid[22] === 0 && mid[23] === 0xff && mid[24] === 0x51 && mid[25] === 3,
  'tempo meta event is first in the track');
const tempo = (mid[26] << 16) | (mid[27] << 8) | mid[28];
check(tempo === Math.round(60000000 / tune.bpm), 'MIDI tempo matches exported BPM');
check(mid.at(-3) === 0xff && mid.at(-2) === 0x2f && mid.at(-1) === 0, 'MIDI ends with end-of-track event');
check(tune.notes.every((n, i) => n.dur >= 0.07 && n.start < n.end && n.end <= tune.duration &&
  (i === 0 || tune.notes[i - 1].end <= n.start)), 'notes have valid durations and do not overlap');
const silent = M.extractTune(new Float32Array(SR * 2), SR);
check(silent.notes.length === 0 && silent.voicedRatio === 0, 'silence does not become a melody');
const progress = [];
const asyncTune = await M.extractTuneAsync(pcm, SR, (p) => progress.push(p));
check(JSON.stringify(asyncTune) === JSON.stringify(tune) && progress.length > 0, 'yielding async extraction matches sync DSP');
let cancelled = false;
try { await M.extractTuneAsync(pcm, SR, null, () => true); } catch (e) { cancelled = /cancelled/.test(e.message); }
check(cancelled, 'superseded analysis can be cancelled');

if (failures) {
  console.error('\nCHOIRTUNE WEB TEST: ' + failures + ' FAILURE(S)');
  process.exit(1);
}
console.log('\nCHOIRTUNE WEB TEST: ALL PASSED');
