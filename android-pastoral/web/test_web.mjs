#!/usr/bin/env node
/* test_web.mjs — static + functional checks for the Pastoral APK shell,
 * run by android-pastoral/build.sh (and CI) before packaging.
 * The functional part really generates sermons from the repo KJV file. */
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
const gen = read('generate.js');
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
check(html.indexOf('generate.js') > -1 && html.indexOf('generate.js') < html.indexOf('app.js'), 'generate.js loaded before app.js');
for (const v of ['home', 'sermons', 'editor', 'scripture', 'series']) {
  check(html.includes('id="view-' + v + '"'), 'view present: ' + v);
}
for (const id of ['fTitle', 'fSeries', 'fDate', 'fRef', 'fKeyVerse', 'fTheme', 'fIntro', 'points', 'fIllustration', 'fApplication', 'fConclusion', 'fDuration', 'fDelivery', 'saveSermonBtn', 'shareSermonBtn']) {
  check(html.includes('id="' + id + '"'), 'editor field present: ' + id);
}
for (const id of ['fTopic', 'genBtn', 'genQuickBtn', 'genQuickBtn2', 'genFromVerseBtn']) {
  check(html.includes('id="' + id + '"'), 'auto-generate control present: ' + id);
}
check(html.includes('id="searchInput"') && html.includes('id="seriesFilter"'), 'search + series filter');
check(html.includes('id="exportBtn"') && html.includes('id="importBtn"'), 'backup export/import');
check(html.includes('id="bookSel"') && html.includes('id="chapterSel"') && html.includes('id="verseSearch"'), 'scripture browser controls');

check(/bible_data/.test(app) && /versesOf/.test(app) && /chaptersOf/.test(app), 'scripture browser reads bundled bible_data');
check(/pickVerse/.test(app) && /pickMode/.test(app) && /lastAri/.test(app), 'pick verse into editor + last verse tracked');
check(/PastoralGen/.test(app) && /generateSermon/.test(app) && /applyGenerated/.test(app) && /genFromVerseBtn/.test(app) && /genBtn/.test(app), 'auto-generate wired in editor + scripture views');
check(/sermonText/.test(app) && /OUTLINE/.test(app), 'sermon export formats outline');
check(/saveState/.test(app) && /loadState/.test(app) && /localStorage/.test(app), 'state load/save with browser fallback');
check(/duplicateSermon/.test(app) && /renderHome/.test(app) && /renderSeries/.test(app), 'duplicate / dashboard / series views');

check(/ecj\.jar/.test(build) && /d8/.test(build) && /aapt2/.test(build) && /apksigner/.test(build), 'build.sh runs ecj/d8/aapt2/apksigner');
check(/bibles\/kjv\/kjv\.js/.test(build), 'build.sh bundles the KJV bible');
check(/generate\.js/.test(build), 'build.sh stages generate.js into the APK');
check(/check_no_emoji\.py/.test(build) && /test_web\.mjs/.test(build), 'build.sh runs emoji gate + this test');
check(/--version-code 1/.test(build) && /--version-name 1\.0/.test(build), 'versionCode 1 / versionName 1.0');
check(/Pastoral-1\.0\.apk/.test(build), 'artifact name Pastoral-1.0.apk');
check(existsSync(join(HERE, 'img', 'icon.png')), 'generated icon.png exists');
check(existsSync(join(ROOT, 'bibles', 'kjv', 'kjv.js')), 'repo bibles/kjv/kjv.js exists');
check(!EMOJI.test(css + html + app + gen), 'no emoji-range glyphs in web sources');

// ---------------- functional: real sermon generation from the repo KJV ----------------
await import('./generate.js');
const G = globalThis.PastoralGen;
check(!!G && typeof G.generateSermon === 'function', 'generate.js exposes globalThis.PastoralGen');

const bible = new Function(readRoot('bibles/kjv/kjv.js') + '\n;return bible_data;')();
check(Array.isArray(bible) && bible.length > 30000, 'KJV bible_data loaded from repo (' + (bible ? bible.length : 0) + ' verses)');

const p = G.parseRef('Song of Solomon 2:1', bible);
check(!!p && p.book === 'Song of Solomon' && p.chapter === 2 && p.verse === 1, 'parseRef handles multi-word book + verse');
const p2 = G.parseRef('Psalm 23', bible);
check(!!p2 && p2.book === 'Psalms' && p2.chapter === 23 && p2.verse === null, 'parseRef chapter-only ref (Psalm -> Psalms)');
check(G.chapterVerses(bible, 'Psalms', 23).length === 6, 'Psalms 23 has 6 verses');
check(G.parseRef('Psalms 23', bible).book === 'Psalms', 'canonical plural book name parses too');
check(G.searchBible(bible, 'shepherd', 5).length > 0, 'searchBible finds shepherd verses');

const g1 = G.generateSermon({ ref: 'Psalm 23', topic: 'shepherd', duration: 30, bible });
check(typeof g1.title === 'string' && g1.title.length > 4 && !/^\s*$/.test(g1.title), 'generated title: ' + JSON.stringify(g1.title));
check(/Psalms? 23/.test(g1.ref), 'generated ref is Psalm 23-based: ' + g1.ref);
check(g1.keyVerse.toLowerCase().indexOf('shepherd') >= 0 || g1.keyVerse.length > 20, 'key verse chosen');
check(g1.theme.length > 20 && g1.intro.length > 60, 'theme + intro generated');
check(Array.isArray(g1.points) && g1.points.length === 3 && g1.points.every((x) => x.h && x.notes), 'outline: 3 points with headings + verse notes');
check(/Psalms? 23:\d/.test(g1.points[0].notes), 'point 1 notes quote the key verse');
check(g1.illustration.length > 30 && g1.application.indexOf('?') >= 0 && g1.conclusion.length > 30, 'illustration + application + conclusion generated');
check(g1.delivery.indexOf('30 min') >= 0 && g1.delivery.indexOf('intro') >= 0, 'timed delivery notes');
check(g1.duration === 30, 'duration carried through');

const g2 = G.generateSermon({ ref: 'John 3:16', bible });
check(g2.ref === 'John 3:16', 'single-verse ref kept: ' + g2.ref);
check(/God so loved the world/.test(g2.keyVerse), 'John 3:16 key verse is the verse itself');

const g3 = G.generateSermon({ ref: '', topic: 'shepherd', duration: 25, bible });
check(g3.points.length === 3 && g3.keyVerse.length > 10 && /Psalm|verse/i.test(g3.ref), 'topic-only mode searches the Bible (ref: ' + g3.ref + ')');
check(g3.delivery.indexOf('25 min') >= 0, 'topic-only respects duration');

const g4 = G.generateSermon({ ref: 'Romans 8:28-30', bible });
check(g4.ref === 'Romans 8:28-30' && g4.points.length === 3, 'verse-range ref: ' + g4.ref);

check(!EMOJI.test(JSON.stringify([g1, g2, g3, g4])), 'generated sermons contain no emoji/arrow glyphs');

if (failures) {
  console.error('\nPASTORAL WEB TEST: ' + failures + ' FAILURE(S)');
  process.exit(1);
}
console.log('\nPASTORAL WEB TEST: ALL PASSED');
