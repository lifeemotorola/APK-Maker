#!/usr/bin/env node
/* test_web.mjs — static checks for the FingerLock APK shell, run by
 * android-fingerlock/build.sh (and CI) before packaging. */
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
const css = read('styles.css');
const manifest = readRoot('android-fingerlock/app/src/main/AndroidManifest.xml');
const main = readRoot('android-fingerlock/app/src/main/java/com/fingerlock/app/MainActivity.java');
const bridge = readRoot('android-fingerlock/app/src/main/java/com/fingerlock/app/NativeBridge.java');
const auth = readRoot('android-fingerlock/app/src/main/java/com/fingerlock/app/FingerprintAuth.java');
const build = readRoot('android-fingerlock/build.sh');

check(/package="com\.fingerlock\.app"/.test(manifest), 'manifest package com.fingerlock.app');
check(/USE_BIOMETRIC/.test(manifest) && /USE_FINGERPRINT/.test(manifest), 'USE_BIOMETRIC + legacy USE_FINGERPRINT permissions');
check(/android\.hardware\.fingerprint/.test(manifest), 'fingerprint hardware feature declared (not required)');
check(/@mipmap\/ic_launcher/.test(manifest) && /@string\/app_name/.test(manifest), 'PNG icon + app_name label');
check(/FingerLock/.test(readRoot('android-fingerlock/app/src/main/res/values/strings.xml')), 'app label FingerLock');

check(/addJavascriptInterface/.test(main) && /"FingerLock"/.test(main), 'window.FingerLock bridge installed');
check(/file:\/\/\/android_asset\/www\/index\.html/.test(main), 'page loaded from bundled assets (no network needed)');
check(/evaluateJavascript/.test(main), 'pushJs results back to the page');
check(/SharedPreferences/.test(main) && /locked/.test(main), 'lock state persisted across launches');
check(/MAX_ATTEMPTS/.test(main) && /LOCKOUT_SECONDS/.test(main), 'failed-attempt lockout implemented');

check(/biometrics\.BiometricPrompt/.test(auth) && /setNegativeButton/.test(auth) && /authenticate\(/.test(auth), 'API 28+ platform BiometricPrompt path');
check(/BIOMETRIC_STRONG/.test(auth) && /DEVICE_CREDENTIAL/.test(auth), 'biometric-strong + device-credential (PIN fallback)');
check(/hardware\.fingerprint\.FingerprintManager/.test(auth) && /CryptoObject/.test(auth), 'API 23-27 legacy FingerprintManager + CryptoObject path');
check(/AndroidKeyStore/.test(auth), 'AndroidKeyStore key for the legacy crypto path');
check(/canAuthenticate/.test(auth), 'enrollment check (canAuthenticate / hasEnrolledFingerprints)');

check(/isEnrolled/.test(bridge) && /authenticate/.test(bridge) && /lock\(\)/.test(bridge) && /getState/.test(bridge), 'bridge: isEnrolled/authenticate/lock/getState');

check(html.includes('id="unlockBtn"') && html.includes('img/icon.png'), 'unlock button + icon in page');
check(/FingerLockEvents/.test(app) && /onResult/.test(app) && /onState/.test(app), 'page handles bridge events');
check(/N\.authenticate\(\)/.test(app) && /N\.lock\(\)/.test(app) && /N\.getState\(\)/.test(app), 'page drives the bridge');
check(/id="homePane"/.test(html) && /id="clock"/.test(html), 'unlocked home screen with clock');

check(/ecj\.jar/.test(build) && /d8/.test(build) && /aapt2/.test(build) && /apksigner/.test(build), 'build.sh runs ecj/d8/aapt2/apksigner');
check(/check_no_emoji\.py/.test(build) && /test_web\.mjs/.test(build), 'build.sh runs emoji gate + this test');
check(/--version-code 1/.test(build) && /--version-name 1\.0/.test(build), 'versionCode 1 / versionName 1.0');
check(/FingerLock-1\.0\.apk/.test(build), 'artifact name FingerLock-1.0.apk');
check(existsSync(join(HERE, 'img', 'icon.png')), 'generated icon.png exists');
check(!/\u{1F300}-\u{1FAFF}/u.test(css + html + app), 'no emoji-range glyphs in web sources');

if (failures) {
  console.error('\nFINGERLOCK WEB TEST: ' + failures + ' FAILURE(S)');
  process.exit(1);
}
console.log('\nFINGERLOCK WEB TEST: ALL PASSED');
