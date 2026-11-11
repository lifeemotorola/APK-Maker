import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REPO, RELEASE_TAG, validateApps, publishedAssets, selectApps, formatSize, parseLabel, escapeHTML } from '../../../downloads/catalog.js';
const apps = JSON.parse(readFileSync(new URL('../../../downloads/apps.json', import.meta.url)));
const asset = (app, overrides = {}) => ({ name: app.file, state: 'uploaded', size: 1048576, updated_at: '2026-10-01T12:00:00Z', label: `version=1.5;sha256=${'a'.repeat(64)};commit=${'b'.repeat(40)}`, browser_download_url: `https://github.com/${REPO}/releases/download/${RELEASE_TAG}/${app.file}`, ...overrides });
const release = assets => ({ tag_name: RELEASE_TAG, draft: false, assets });
test('catalog covers all ten active APK build outputs, with unique filenames and source projects', () => {
  assert.equal(validateApps(apps).length, 10);
  for (const app of apps) {
    const build = readFileSync(new URL(`../../../${app.project}/build.sh`, import.meta.url), 'utf8');
    assert.ok(build.includes(app.file), app.file);
  }
  assert.ok(!apps.some(a => /fingerlock|\.exe|\.7z/i.test(a.name + a.file)));
  assert.throws(() => validateApps([...apps, apps[0]]));
  assert.throws(() => validateApps([{ ...apps[0], file: '../bad.apk' }]));
});
test('only existing uploaded assets from the exact trusted release enable direct APK links', () => {
  assert.equal(publishedAssets(release([asset(apps[0])]), apps).size, 1);
  const published = publishedAssets(release([asset(apps[0])]), apps).get('choirtune');
  assert.equal(published.version, '1.5'); assert.equal(published.sha256, 'a'.repeat(64));
  assert.ok(published.url.endsWith('/ChoirTune.apk'));
  for (const overrides of [{ state: 'new' }, { size: 0 }, { size: '123' }, { browser_download_url: 'javascript:alert(1)' }, { browser_download_url: 'https://evil.test/ChoirTune.apk' }, { name: 'ChoirTune.apk.zip' }]) assert.equal(publishedAssets(release([asset(apps[0], overrides)]), apps).size, 0);
  assert.equal(publishedAssets({ ...release([asset(apps[0])]), draft: true }, apps).size, 0);
  assert.equal(publishedAssets({ ...release([asset(apps[0])]), tag_name: 'other' }, apps).size, 0);
  assert.equal(publishedAssets(null, apps).size, 0);
});
test('metadata is validated; digest can come from GitHub, invalid labels never become HTML', () => {
  assert.deepEqual(parseLabel('version=<script>;sha256=x;commit=no'), { version: null, sha256: null, commit: null });
  assert.equal(publishedAssets(release([asset(apps[0], { label: '', digest: 'sha256:' + 'c'.repeat(64) })]), apps).get('choirtune').sha256, 'c'.repeat(64));
  assert.equal(escapeHTML('<img src=x onerror="evil">'), '&lt;img src=x onerror=&quot;evil&quot;&gt;');
});
test('search, categories, saved apps and sorts return actual matching apps', () => {
  assert.equal(selectApps(apps, { category: 'music' }).length, 4);
  assert.deepEqual(selectApps(apps, { query: 'MONROVIA' }).map(a => a.id), ['marketplace']);
  assert.equal(selectApps(apps, { query: 'no such application' }).length, 0);
  assert.deepEqual(selectApps(apps, { savedOnly: true, saved: new Set(['choirtune']) }).map(a => a.id), ['choirtune']);
  assert.equal(selectApps(apps, { sort: 'name' })[0].name, 'Bible Quiz');
  const published = publishedAssets(release([asset(apps[0], { size: 1000 }), asset(apps[1], { size: 500, updated_at: '2026-10-02T12:00:00Z' })]), apps);
  assert.equal(selectApps(apps, { sort: 'size', published })[0].id, 'keysense');
  assert.equal(selectApps(apps, { sort: 'updated', published })[0].id, 'keysense');
  assert.equal(selectApps(apps).length, 10); // sorting did not mutate source
});
test('sizes are derived from actual assets, not invented catalog figures', () => {
  assert.equal(formatSize(1048576), '1.0 MB'); assert.equal(formatSize(600), '1 KB'); assert.equal(formatSize(undefined), 'Size pending');
});
