#!/usr/bin/env node
/* test_web.mjs — static checks for the Music Downloader shell, run by
 * android-musicdl/build.sh (and CI) before the APK is packaged. */
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
const manifest = readRoot('android-musicdl/app/src/main/AndroidManifest.xml');
const main = readRoot('android-musicdl/app/src/main/java/com/musicdownloader/app/MainActivity.java');
const bridge = readRoot('android-musicdl/app/src/main/java/com/musicdownloader/app/NativeBridge.java');
const server = readRoot('android-musicdl/app/src/main/java/com/musicdownloader/app/LocalServer.java');
const build = readRoot('android-musicdl/build.sh');

check(html.includes('app.js') && html.includes('styles.css'), 'index.html loads styles.css + app.js');
check(html.includes('id="searchForm"') && html.includes('id="searchInput"'), 'search UI present');
check(html.includes('id="downloads"') && html.includes('id="playerBar"'), 'downloads list + player bar present');

check(/archive\.org\/advancedsearch\.php/.test(app), 'search hits the archive.org advancedsearch API (internet)');
check(/mediatype:audio/.test(app), 'search restricted to audio items (any type of music)');
check(/archive\.org\/metadata\//.test(app), 'per-item metadata API used to list downloadable files');
check(/AUDIO_EXT/.test(app) && /\.mp3/.test(app) && /\.flac/.test(app) && /\.ogg/.test(app), 'many audio file types supported (mp3/ogg/flac/wav/m4a...)');
check(/MusicDLNative\.startDownload/.test(app), 'downloads go through the native bridge');
check(/window\.MusicDL\.onEvent|window\.MusicDL =/.test(app), 'progress events bridge (window.MusicDL.onEvent) installed');
check(/\/dl\//.test(app), 'local playback of finished downloads via /dl/<id>');

check(/package="com\.musicdownloader\.app"/.test(manifest), 'manifest package com.musicdownloader.app');
check(/android\.permission\.INTERNET/.test(manifest), 'INTERNET permission declared (downloads over the internet)');
check(/WRITE_EXTERNAL_STORAGE/.test(manifest) && /maxSdkVersion="28"/.test(manifest), 'legacy storage permission limited to API <= 28');
check(/@mipmap\/ic_launcher/.test(manifest), 'launcher icon is the PNG mipmap');

check(/startDownload/.test(bridge) && /HttpURLConnection/.test(bridge), 'NativeBridge downloads over HTTP(S) with HttpURLConnection');
check(/MediaStore\.Audio\.Media/.test(bridge) && /RELATIVE_PATH/.test(bridge), 'downloads saved to public Music folder via MediaStore');
check(/cancelDownload/.test(bridge) && /listDownloads/.test(bridge) && /deleteDownload/.test(bridge), 'cancel/list/delete download APIs present');
check(/PREFS_NAME/.test(bridge) && /SharedPreferences/.test(bridge), 'download registry persisted in SharedPreferences');
check(/pushJs/.test(bridge) && /window\.MusicDL/.test(bridge), 'progress pushed to the page via pushJs -> window.MusicDL.onEvent');

check(/pushJs/.test(main) && /requestWriteStorageAndRun/.test(main) && /REQUEST_WRITE_STORAGE/.test(main), 'MainActivity: pushJs + legacy storage permission flow');
check(/archive\.org/.test(main), 'WebView navigation allow-listed to archive.org + loopback');

check(/\/dl\//.test(server) && /openInputStream/.test(server), 'LocalServer streams downloaded songs at /dl/<id>');
check(/127\.0\.0\.1/.test(server), 'LocalServer binds loopback');

check(/ecj\.jar/.test(build) && /d8/.test(build) && /aapt2/.test(build) && /apksigner/.test(build), 'build.sh runs ecj/d8/aapt2/apksigner pipeline');
check(/check_no_emoji\.py/.test(build), 'build.sh runs the emoji gate');
check(/test_web\.mjs/.test(build), 'build.sh runs this test first');
check(/--version-code 1/.test(build) && /--version-name 1\.0/.test(build), 'build.sh sets versionCode 1 / versionName 1.0');
check(/cp "\$WEB\/img\/"\*\.png/.test(build), 'build.sh stages the icon PNG into the APK');
check(existsSync(join(HERE, 'img', 'icon.png')), 'generated icon.png exists');
check(!/\u{1F300}-\u{1FAFF}/u.test(css + html + app), 'no emoji-range glyphs in web sources');

check(/services\/img\//.test(app), 'cover-art thumbnails from archive.org services/img');
check(/quickChips/.test(app) && /surpriseMe/.test(app), 'quick-search chips + Surprise me random discovery');
check(/localStorage/.test(app) && /HIST_KEY/.test(app), 'search history persisted in localStorage');
check(/downloadAll/.test(app), 'download-all-files-of-an-item feature');
check(/classList\.add\('playing'\)/.test(app) || /eq\.classList/.test(app), 'animated equalizer in the player bar');
check(/addEventListener\('offline'/.test(app) && /addEventListener\('online'/.test(app), 'online/offline indicator');
check(/grid/.test(html) && /result-card/.test(css), 'results rendered as cover-art card grid');
check(/identifier/.test(bridge) && /startDownload\(final String id, final String url, final String filename,\s*final String title, final String creator, final String mime,\s*final String identifier\)/s.test(bridge), 'startDownload carries the archive identifier (for covers)');
check(/pendingDlIdent/.test(main), 'MainActivity threads identifier through the storage-permission retry');

if (failures) {
  console.error('\nMUSICDL WEB TEST: ' + failures + ' FAILURE(S)');
  process.exit(1);
}
console.log('\nMUSICDL WEB TEST: ALL PASSED');
