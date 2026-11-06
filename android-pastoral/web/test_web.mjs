#!/usr/bin/env node
/* test_web.mjs — static checks for the Pastoral APK shell, run by
 * android-pastoral/build.sh (and CI) before packaging. */
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
const manifest = readRoot('android-pastoral/app/src/main/AndroidManifest.xml');
const main = readRoot('android-pastoral/app/src/main/java/com/pastoral/app/MainActivity.java');
const bridge = readRoot('android-pastoral/app/src/main/java/com/pastoral/app/NativeBridge.java');
const build = readRoot('android-pastoral/build.sh');

check(/package="com\.pastoral\.app"/.test(manifest), 'manifest package com.pastoral.app');
check(!/android\.permission\.INTERNET/.test(manifest), 'fully offline: no INTERNET permission');
check(/@mipmap\/ic_launcher/.test(manifest) && /@string\/app_name/.test(manifest), 'PNG icon + app_name label');
check(/Pastoral/.test(readRoot('android-pastoral/app/src/main/res/values/strings.xml')), 'app label Pastoral');
check(!/screenOrientation/.test(manifest), 'portrait + landscape allowed');

check(/addJavascriptInterface/.test(main) && /"Pastoral"/.test(main), 'window.Pastoral bridge installed');
check(/file:\/\/\/android_asset\/www\/index\.html/.test(main), 'page loaded from bundled assets');
check(/state\.json/.test(main) && /getFilesDir/.test(main), 'state persisted in app-private files dir');
check(/ACTION_SEND/.test(main) && /shareText/.test(main), 'share via system share sheet');

check(/loadState/.test(bridge) && /saveState/.test(bridge) && /shareText/.test(bridge), 'bridge: loadState/saveState/shareText');

check(html.includes('bibles/kjv.js'), 'bundled KJV scripture script included');
for (const v of ['home', 'sermons', 'editor', 'scripture', 'series']) {
  check(html.includes('id="view-' + v + '"'), 'view present: ' + v);
}
for (const id of ['fTitle', 'fSeries', 'fDate', 'fRef', 'fKeyVerse', 'fTheme', 'fIntro', 'points', 'fIllustration', 'fApplication', 'fConclusion', 'fDuration', 'fDelivery', 'saveSermonBtn', 'shareSermonBtn']) {
  check(html.includes('id="' + id + '"'), 'editor field present: ' + id);
}
check(html.includes('id="searchInput"') && html.includes('id="seriesFilter"'), 'search + series filter');
check(html.includes('id="exportBtn"') && html.includes('id="importBtn"'), 'backup export/import');
check(html.includes('id="bookSel"') && html.includes('id="chapterSel"') && html.includes('id="verseSearch"'), 'scripture browser controls');

check(/bible_data/.test(app) && /versesOf/.test(app) && /chaptersOf/.test(app), 'scripture browser reads bundled bible_data');
check(/pickVerse/.test(app) && /pickMode/.test(app), 'pick verse into editor');
check(/sermonText/.test(app) && /OUTLINE/.test(app), 'sermon export formats outline');
check(/saveState/.test(app) && /loadState/.test(app) && /localStorage/.test(app), 'state load/save with browser fallback');
check(/duplicateSermon/.test(app) && /renderHome/.test(app) && /renderSeries/.test(app), 'duplicate / dashboard / series views');

check(/ecj\.jar/.test(build) && /d8/.test(build) && /aapt2/.test(build) && /apksigner/.test(build), 'build.sh runs ecj/d8/aapt2/apksigner');
check(/bibles\/kjv\/kjv\.js/.test(build), 'build.sh bundles the KJV bible');
check(/check_no_emoji\.py/.test(build) && /test_web\.mjs/.test(build), 'build.sh runs emoji gate + this test');
check(/--version-code 1/.test(build) && /--version-name 1\.0/.test(build), 'versionCode 1 / versionName 1.0');
check(/Pastoral-1\.0\.apk/.test(build), 'artifact name Pastoral-1.0.apk');
check(existsSync(join(HERE, 'img', 'icon.png')), 'generated icon.png exists');
check(existsSync(join(ROOT, 'bibles', 'kjv', 'kjv.js')), 'repo bibles/kjv/kjv.js exists');
check(!/\u{1F300}-\u{1FAFF}/u.test(css + html + app), 'no emoji-range glyphs in web sources');

if (failures) {
  console.error('\nPASTORAL WEB TEST: ' + failures + ' FAILURE(S)');
  process.exit(1);
}
console.log('\nPASTORAL WEB TEST: ALL PASSED');
