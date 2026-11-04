/* Data validation for the Community Market offline directory.
 * Run: node web/test_data.js [dataDir]   (default: ./data)
 * Fails (exit 1) on any invalid record — wired into build.sh. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || path.join(HERE, 'data');

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log('PASS', msg);
  else { failures++; console.log('FAIL', msg); }
}
function load(name) {
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}

const meta = load('meta.json');
const businesses = load('businesses.json');
const routes = load('routes.json');
const posts = load('posts.json');

ok(Array.isArray(meta.areas) && meta.areas.length >= 10, `meta.areas has ${meta.areas.length} Monrovia areas`);
ok(Array.isArray(meta.categories) && meta.categories.length >= 8, `meta.categories has ${meta.categories.length} categories`);
const catIds = new Set(meta.categories.map(c => c.id));

ok(businesses.length >= 50, `businesses: ${businesses.length} entries`);
const bizIds = new Set();
let bizOk = true;
for (const b of businesses) {
  if (!b.id || bizIds.has(b.id)) bizOk = false;
  bizIds.add(b.id);
  if (!b.name || !catIds.has(b.cat) || !meta.areas.includes(b.area)) bizOk = false;
  if (!/^\+231 /.test(b.phone || '')) bizOk = false;
  if (!Array.isArray(b.services) || !b.services.length) bizOk = false;
  if (!b.hours || !b.landmark || !b.desc) bizOk = false;
}
ok(bizOk, 'every business has id/name/valid cat+area/phone/hours/landmark/desc/services');
const areasCovered = new Set(businesses.map(b => b.area));
ok(areasCovered.size >= 10, `businesses cover ${areasCovered.size} areas`);

ok(routes.length >= 8, `kehkeh routes: ${routes.length}`);
let routesOk = true;
const routeIds = new Set();
for (const r of routes) {
  if (!r.id || routeIds.has(r.id)) routesOk = false;
  routeIds.add(r.id);
  if (!r.frm || !r.to || !/^LRD/.test(r.fare || '')) routesOk = false;
  if (!Array.isArray(r.stops) || r.stops.length < 3) routesOk = false;
  if (!r.first || !r.last || !r.freq) routesOk = false;
}
ok(routesOk, 'every route has id/from/to/LRD fare/3+ stops/hours/frequency');

ok(posts.length >= 8, `community posts: ${posts.length}`);
const tags = new Set(['event', 'lost', 'job', 'safety', 'announcement', 'sale']);
let postsOk = true;
for (const p of posts) {
  if (!p.id || !p.title || !p.body || !meta.areas.includes(p.area) || !tags.has(p.tag) || isNaN(new Date(p.ts))) postsOk = false;
}
ok(postsOk, 'every post has id/title/body/valid area+tag/parseable timestamp');

console.log(failures === 0 ? '\nDATA TESTS: ALL PASSED' : `\nDATA TESTS: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
