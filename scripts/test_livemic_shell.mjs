#!/usr/bin/env node
/**
 * test_livemic_shell.mjs — regression guard for the Live Mic feature in the
 * KeySense Studio APK. The mic needs three things that broke before:
 *   1. WebChromeClient.onPermissionRequest must grant RESOURCE_AUDIO_CAPTURE,
 *      and if the app-level RECORD_AUDIO is missing it must ask first and
 *      resolve the pending WebView request in onRequestPermissionsResult.
 *   2. window.KeySenseNative.requestMicPermission must exist (retry button).
 *   3. LiveMicModal must resume a suspended AudioContext, pull the analyser
 *      graph (muted gain -> destination), fall back to { audio: true }, and
 *      offer a grant-permission retry on error.
 * Run: node scripts/test_livemic_shell.mjs   (wired into android/build.sh)
 */
import fs from 'node:fs';

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error('FAIL: ' + msg);
  } else {
    console.log('ok: ' + msg);
  }
}

const main = fs.readFileSync('android/app/src/main/java/com/keysense/studio/MainActivity.java', 'utf8');
const bridge = fs.readFileSync('android/app/src/main/java/com/keysense/studio/NativeBridge.java', 'utf8');
const modal = fs.readFileSync('src/components/LiveMicModal.tsx', 'utf8');
const nb = fs.readFileSync('src/lib/nativeBridge.ts', 'utf8');

check(/onPermissionRequest\(PermissionRequest/.test(main), 'MainActivity handles WebView onPermissionRequest');
check(/pendingMicRequest/.test(main), 'pending mic request stored while asking user for RECORD_AUDIO');
check(/REQUEST_MIC_PERMISSION/.test(main), 'dedicated mic permission request code');
check(/onRequestPermissionsResult[\s\S]*?pendingMicRequest/.test(main), 'permission result resolves the pending WebView request');
check(/requestMicPermission\(\)/.test(main), 'MainActivity.requestMicPermission() exists');
check(/RESOURCE_AUDIO_CAPTURE/.test(main), 'grants RESOURCE_AUDIO_CAPTURE to the WebView');
check(/requestMicPermission/.test(bridge), 'NativeBridge exposes requestMicPermission to JS');
check(/requestMicPermissionNative/.test(nb), 'nativeBridge.ts helper requestMicPermissionNative');
check(/requestMicPermission\(\): boolean/.test(nb), 'Window.KeySenseNative interface declares requestMicPermission');
check(/ctx\.resume\(\)/.test(modal), 'LiveMicModal resumes a suspended AudioContext');
check(/createGain\(\)[\s\S]*?gain\.value = 0[\s\S]*?ctx\.destination/.test(modal), 'analyser graph pulled via muted gain to destination');
check(/getUserMedia\(\{ audio: true \}\)/.test(modal), 'getUserMedia falls back to { audio: true }');
check(/Grant microphone permission/.test(modal), 'error UI offers grant-permission & retry (native)');

check(/startNativeMic/.test(bridge), 'NativeBridge exposes startNativeMic (AudioRecord capture)');
check(/AudioRecord/.test(bridge) && /AudioSource\.MIC/.test(bridge), 'native mic uses AudioRecord MIC source');
check(/stopNativeMic/.test(bridge), 'NativeBridge exposes stopNativeMic');
check(/pushPcm/.test(bridge), 'native mic pushes PCM to window.KeySenseMic.pushPcm');
check(/startNativeMic\(\): boolean/.test(nb), 'Window.KeySenseNative interface declares startNativeMic');
check(/KeySenseMic\?:/.test(nb), 'Window.KeySenseMic bridge interface declared');
check(/subscribeNativeMic/.test(nb), 'subscribeNativeMic helper exported');
check(/startNativeMic\(\)/.test(modal), 'LiveMicModal falls back to native AudioRecord capture');
check(/subscribeNativeMic/.test(modal), 'LiveMicModal feeds native PCM into the analyser graph');
check(/createBufferSource/.test(modal), 'native PCM played through BufferSource into analyser');
check(/disabled=\{!streamRef\.current\}/.test(modal), 'record button disabled in native-capture mode');

// Chord Tracker (Yamaha Chord Tracker-style progression tracking)
check(/appendLiveChord/.test(modal), 'LiveMicModal tracks a timed live progression log (appendLiveChord)');
check(/Live Progression Track/.test(modal), 'Live Progression Track UI present in LiveMicModal');
check(/buildLiveLogText/.test(modal) && /exportTrackLog/.test(modal), 'live progression exportable as a text chart');
const appSrc = fs.readFileSync('src/App.tsx', 'utf8');
const trackerSrc = fs.readFileSync('src/components/ChordTracker.tsx', 'utf8');
check(/ChordTracker/.test(appSrc) && /setBottomTab\('tracker'\)/.test(appSrc), 'App adds the Chord Tracker tab');
check(/buildProgressionTrack/.test(trackerSrc) && /findActiveEntry/.test(trackerSrc), 'ChordTracker builds the timed progression track');
check(/buildChartText/.test(trackerSrc) && /downloadBytes/.test(trackerSrc), 'ChordTracker exports the chart text');

if (failures) {
  console.error(`LIVEMIC SHELL TEST: ${failures} FAILED`);
  process.exit(1);
}
console.log('LIVEMIC SHELL TEST: ALL PASSED');
