#!/usr/bin/env node
/* test_web.mjs — static checks for the KeyFinder Player shell, run by
 * android-keyfinder/build.sh (and CI) before the APK is packaged. */
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

const html = read('index.html');
const app = read('app.js');
const kf = read('keyfinder.ts');
const css = read('styles.css');
const manifest = readRoot('android-keyfinder/app/src/main/AndroidManifest.xml');
const main = readRoot('android-keyfinder/app/src/main/java/com/keyfinder/player/MainActivity.java');
const bridge = readRoot('android-keyfinder/app/src/main/java/com/keyfinder/player/NativeBridge.java');
const server = readRoot('android-keyfinder/app/src/main/java/com/keyfinder/player/LocalServer.java');
const build = readRoot('android-keyfinder/build.sh');

check(html.includes('keyfinder.js') && html.includes('app.js') && html.includes('styles.css'), 'index.html loads styles.css + keyfinder.js + app.js');
check(html.includes('id="fileInput"') && html.includes('accept="audio/*"'), 'file input accepts audio files (user songs)');
check(html.includes('id="wave"'), 'waveform canvas present');
check(html.includes('id="keyName"') && html.includes('id="chromaBars"') && html.includes('id="progChips"'), 'key analysis panel present (key, chroma, progression)');

check(/findKeyInSong/.test(app) && /window\.KeyFinder/.test(app), 'app.js runs the on-device key analysis via window.KeyFinder.findKeyInSong');
check(/decodeAudioData/.test(app) && /createBufferSource/.test(app) && /playbackRate/.test(app), 'WebAudio playback: decode + buffer source + rate control');
check(/getSongProgression/.test(app), 'progression chips use getSongProgression');
check(/loopA|loopB/.test(app), 'A-B loop implemented');
check(/demos\/manifest\.json/.test(app), 'bundled demo library loaded from demos/manifest.json');

check(/offlineAnalyze/.test(kf) && /analyzePcm/.test(kf) && /decodeAudioBytes/.test(kf), 'keyfinder.ts bundles the offline analyzer (analyzePcm/decodeAudioBytes)');
check(/musicTheory/.test(kf) && /getSongProgression/.test(kf), 'keyfinder.ts reuses musicTheory progression helper');
check(/window\.KeyFinder\s*=/.test(kf), 'window.KeyFinder bridge exported');

check(/package="com\.keyfinder\.player"/.test(manifest), 'manifest package com.keyfinder.player');
check(/onShowFileChooser/.test(main) && /REQUEST_FILE_CHOOSER/.test(main) && /onActivityResult/.test(main), 'MainActivity implements the audio file chooser');
check(/LocalServer/.test(main) && /addJavascriptInterface/.test(main), 'MainActivity serves www via LocalServer + exposes NativeBridge');
check(/127\.0\.0\.1/.test(server) && /assets/.test(server), 'LocalServer binds loopback and serves assets/www');
check(/JavascriptInterface/.test(bridge), 'NativeBridge is a @JavascriptInterface bridge');

check(/esbuild web\/keyfinder\.ts/.test(build) || /esbuild.*keyfinder/.test(build), 'build.sh bundles keyfinder.ts with esbuild');
check(/demos/.test(build) && /manifest\.json/.test(build), 'build.sh stages the demo songs into the APK');
check(/ecj\.jar/.test(build) && /d8/.test(build) && /aapt2/.test(build) && /apksigner/.test(build), 'build.sh runs the full ecj/d8/aapt2/apksigner pipeline');
check(/check_no_emoji\.py/.test(build), 'build.sh runs the emoji gate');
check(/--version-code 1/.test(build) && /--version-name 1\.0/.test(build), 'build.sh sets versionCode 1 / versionName 1.0');
check(existsSync(join(ROOT, 'demos', 'manifest.json')), 'demos/manifest.json exists in repo');

// css sanity: no emoji-ish glyphs are checked separately by check_no_emoji.py
check(!/\u{1F300}-\u{1FAFF}/u.test(css), 'styles.css has no emoji range glyphs');

if (failures) {
  console.error('\nKEYFINDER WEB TEST: ' + failures + ' FAILURE(S)');
  process.exit(1);
}
console.log('\nKEYFINDER WEB TEST: ALL PASSED');
