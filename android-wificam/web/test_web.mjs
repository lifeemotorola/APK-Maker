#!/usr/bin/env node
/* test_web.mjs — static checks for the WiFi Cam app, run by
 * android-wificam/build.sh (and CI) before the APK is packaged. */
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
const manifest = readRoot('android-wificam/app/src/main/AndroidManifest.xml');
const main = readRoot('android-wificam/app/src/main/java/com/wificam/app/MainActivity.java');
const server = readRoot('android-wificam/app/src/main/java/com/wificam/app/LanServer.java');
const cam = readRoot('android-wificam/app/src/main/java/com/wificam/app/CameraController.java');
const holder = readRoot('android-wificam/app/src/main/java/com/wificam/app/CameraHolder.java');
const svc = readRoot('android-wificam/app/src/main/java/com/wificam/app/CameraService.java');
const bus = readRoot('android-wificam/app/src/main/java/com/wificam/app/FrameBus.java');
const build = readRoot('android-wificam/build.sh');

check(/package="com\.wificam\.app"/.test(manifest), 'manifest package com.wificam.app');
check(/android\.permission\.CAMERA/.test(manifest) && /android\.permission\.INTERNET/.test(manifest), 'CAMERA + INTERNET permissions');
check(/FOREGROUND_SERVICE_CAMERA/.test(manifest) && /foregroundServiceType="camera"/.test(manifest), 'foreground camera service declared');
check(/usesCleartextTraffic="true"/.test(manifest), 'cleartext allowed (LAN webcam stream)');
check(/@mipmap\/ic_launcher/.test(manifest), 'PNG launcher icon');

check(/TextureView/.test(main) && /SurfaceTextureListener/.test(main) && /onSurfaceTextureAvailable/.test(main),
  'MainActivity shows a native full-screen camera preview (TextureView)');
check(!/addJavascriptInterface|WebView/.test(main), 'no WebView shell — phone UI is the native camera preview');
check(/requestPermissions/.test(main) && /Manifest\.permission\.CAMERA/.test(main), 'MainActivity requests CAMERA at runtime');
check(/CameraHolder\.ensureStarted/.test(main) && /wantStart = true/.test(main), 'camera auto-starts on open like a normal camera app');
check(/LanServer/.test(main), 'MainActivity starts the LAN server');
check(/--diag/.test(main), 'phone screen shows the PC-side --diag troubleshooting command');

check(/0\.0\.0\.0/.test(server) && /PORT = 8080/.test(server), 'LanServer binds 0.0.0.0:8080 (LAN reachable)');
check(/\/stream/.test(server) && /multipart\/x-mixed-replace/.test(server) && /boundary=frame/.test(server), 'MJPEG /stream route with multipart boundary');
check(/FrameBus\.awaitFrame/.test(server), 'stream pulls frames from FrameBus');
check(/\/status/.test(server) && /application\/json/.test(server), '/status JSON endpoint');
check(/\/api\/start/.test(server) && /\/api\/stop/.test(server) && /\/api\/torch/.test(server), 'HTTP control endpoints /api/start|stop|torch');
check(/NetworkInterface/.test(server) && /lanIp/.test(server), 'LAN IP detection via NetworkInterface');
check(/lanIps/.test(server) && /ips\.append/.test(server), '/status lists all phone IPv4 addresses via lanIps()');
check(/wlan/.test(server), 'LAN IP prefers WiFi interfaces over hotspot IP');

check(/hardware\.camera2/.test(cam) && /ImageReader\.newInstance/.test(cam) && /ImageFormat\.JPEG/.test(cam), 'Camera2 capture to JPEG ImageReader');
check(/setRepeatingRequest/.test(cam) && /AE_TARGET_FPS_RANGE/.test(cam), 'repeating capture with FPS range');
check(/addTargets/.test(cam) && /attachPreview/.test(cam) && /Surface preview/.test(cam), 'on-phone preview surface is a capture target too');
check(/FrameBus\.put/.test(cam), 'frames pushed to FrameBus');
check(/FLASH_MODE_TORCH/.test(cam), 'torch control');

check(/ensureStarted/.test(holder) && /stopAll/.test(holder), 'CameraHolder shared start/stop helpers');
check(!existsSync(join(ROOT, 'android-wificam/app/src/main/java/com/wificam/app/NativeBridge.java')), 'WebView JS bridge removed (native UI + /api control)');

check(/startForeground/.test(svc) && /FOREGROUND_SERVICE_TYPE_CAMERA/.test(svc), 'foreground service with camera type');
check(/FrameBus/.test(bus) && /notifyAll/.test(bus), 'FrameBus latest-frame with wait/notify');

check(html.includes('id="preview"') && html.includes('img/icon.png'), 'preview img + icon in page');
check(/OBS/.test(html) && /Browser/.test(html), 'page explains OBS Studio usage');
check(/\/api\/start/.test(app) && /\/api\/stop/.test(app) && /\/api\/torch/.test(app), 'page drives camera via /api endpoints');
check(/\/stream/.test(app) && /\/status/.test(app), 'page uses /stream preview + /status polling');
check(/wificam_driver\.py --host/.test(app) && /driverCmd/.test(html), 'page shows the computer driver command');
check(/--virtual-cam \/dev\/video0/.test(app), 'page mentions the OBS virtual-camera driver mode');
check(/copyBtn/.test(app), 'copy stream URL button');

check(/ecj\.jar/.test(build) && /d8/.test(build) && /aapt2/.test(build) && /apksigner/.test(build), 'build.sh runs ecj/d8/aapt2/apksigner');
check(/check_no_emoji\.py/.test(build) && /test_web\.mjs/.test(build), 'build.sh runs emoji gate + this test');
check(/--version-code 3/.test(build) && /--version-name 1\.2/.test(build), 'versionCode 3 / versionName 1.2');
check(/Wificam-1\.2\.apk/.test(build), 'artifact name Wificam-1.2.apk');
check(existsSync(join(HERE, 'img', 'icon.png')), 'generated icon.png exists');
check(!/\u{1F300}-\u{1FAFF}/u.test(css + html + app), 'no emoji-range glyphs in web sources');

if (failures) {
  console.error('\nWIFICAM WEB TEST: ' + failures + ' FAILURE(S)');
  process.exit(1);
}
console.log('\nWIFICAM WEB TEST: ALL PASSED');
