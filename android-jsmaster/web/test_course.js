#!/usr/bin/env node
/**
 * test_course.js — validates the generated JS Mastery course by actually
 * RUNNING every practice solution and its test in a VM (same semantics as
 * the in-app sandboxed runner: user code then the test expression).
 *
 *   node web/test_course.js [dataDir]     (default: app/src/main/assets/www/data)
 *
 * Checks: exactly 50 topics; 7 practices per topic (350 total); unique ids; every topic has
 * a lesson and >= 8 quiz questions; every practice has prompt/starter/test/
 * hint/solution; every solution passes its own test (async-aware).
 */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.argv[2] || path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'www', 'data');

let failures = 0;
function ok(cond, msg) {
  if (cond) { if (process.env.VERBOSE) console.log('PASS', msg); }
  else { failures++; console.log('FAIL', msg); }
}

const index = JSON.parse(fs.readFileSync(path.join(DIR, 'topics.json'), 'utf8'));
ok(index.count === 50, `exactly 50 topics (got ${index.count})`);
ok(index.totalPractices === 50 * 7, `350 practices (7 per topic), got ${index.totalPractices}`);

const seen = new Set();
let ran = 0, passed = 0;
const levels = {};

async function checkPractice(topicId, p) {
  if (seen.has(p.id)) { ok(false, `duplicate practice id ${p.id}`); return; }
  seen.add(p.id);
  for (const k of ['prompt', 'starter', 'test', 'hint', 'solution']) {
    if (typeof p[k] !== 'string' || !p[k].length) { ok(false, `${p.id}: missing ${k}`); return; }
  }
  // simulate the app runner: user code, then the test expression, same scope
  const outEl = { textContent: '' };
  const sandbox = { console: { log() {}, warn() {}, error() {} }, __logs: [], document: { getElementById: () => outEl } };
  sandbox.console.log = (...a) => sandbox.__logs.push(a.map(String).join(' '));
  vm.createContext(sandbox);
  const code = `${p.solution}\n;var __r = (${p.test});\n__r;`;
  try {
    let r = vm.runInContext(code, sandbox, { timeout: 3000 });
    if (r && typeof r.then === 'function') r = await r;
    ran++;
    if (r) passed++; else ok(false, `${p.id}: solution did not pass test`);
  } catch (e) {
    ran++;
    ok(false, `${p.id}: threw ${e.message}`);
  }
}

for (const t of index.topics) {
  levels[t.level] = (levels[t.level] || 0) + 1;
  ok(typeof t.lesson === 'string' && t.lesson.includes('<h2>'), `${t.id}: has lesson HTML`);
  ok(t.lesson.includes('Common pitfalls') && t.lesson.includes('Where you will use this'), `${t.id}: lesson has pitfalls + real-world details`);
  ok(Array.isArray(t.quiz) && t.quiz.length >= 8, `${t.id}: has >= 8 quiz questions (${t.quiz?.length})`);
  const file = path.join(DIR, 'p', t.id + '.json');
  ok(fs.existsSync(file), `${t.id}: practice file exists`);
  const practices = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(practices.length === 7, `${t.id}: exactly 7 practices (got ${practices.length})`);
  for (const p of practices) await checkPractice(t.id, p);
}

console.log(`levels: ${JSON.stringify(levels)}`);
console.log(`practices executed: ${ran}, passed: ${passed}`);
ok(ran === index.totalPractices, `all ${index.totalPractices} practices ran`);
ok(passed === ran, `all ${ran} solutions pass their tests`);
console.log(failures === 0 ? '\nCOURSE TESTS: ALL PASSED' : `\nCOURSE TESTS: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
