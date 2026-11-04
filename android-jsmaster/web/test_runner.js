#!/usr/bin/env node
/**
 * test_runner.js — regression test for the in-app code runner (web/app.js).
 *
 * The app runs user code in a sandboxed iframe via srcdoc + postMessage.
 * This test extracts the SHIPPED srcdoc template and escaping lines from
 * app.js, builds the iframe HTML exactly as the app does, executes every
 * <script> block in a VM with a mocked parent.postMessage, and asserts a
 * result message arrives for: hello-world playground code, a practice test,
 * syntax errors, failing tests, promise tests and '</script>' in strings.
 *
 * Run: node web/test_runner.js   (exits non-zero on any failure)
 */
// test_runner.js — proves the SHIPPED sandboxed-iframe runner in app.js works:
// extracts the real srcdoc template + escaping from app.js,
// builds the srcdoc with the SHIPPED escaping lines + template extracted from app.js,
// extracts each <script>...</script> block with real HTML close-tag semantics, runs
// them in a VM with a mocked parent.postMessage, and asserts a result message arrives.
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');

const m = src.match(/ifr\.srcdoc = ([\s\S]*?);\n/);
if (!m) throw new Error('srcdoc expression not found');
const expr = m[1];
const safeLine = src.match(/^ *var safe = .*$/m)[0];
const testJsLine = src.match(/^ *var testJs = .*$/m)[0];

function buildSrcdoc(id, code, test) {
  const safe = new Function('code', safeLine + '; return safe;')(code);
  const testJs = new Function('test', testJsLine + '; return testJs;')(test);
  return new Function('id', 'safe', 'testJs', 'test', 'return (' + expr + ');')(id, safe, testJs, test);
}

const OPEN = '<script>';
const CLOSE = '</scr' + 'ipt>'; // avoid any tag-eating in tooling; equals '</script>'

function runInFakeIframe(html) {
  const opens = html.split(OPEN).length - 1;
  const closes = html.split(CLOSE).length - 1;
  if (opens === 0) throw new Error('no script blocks');
  if (opens !== closes) throw new Error('unbalanced script tags in srcdoc: ' + opens + ' opens vs ' + closes + ' closes');
  const blocks = [];
  let i = 0;
  while (true) {
    const a = html.indexOf(OPEN, i);
    if (a === -1) break;
    const b = html.indexOf(CLOSE, a + OPEN.length);
    if (b === -1) throw new Error('unclosed <script> in srcdoc');
    blocks.push(html.slice(a + OPEN.length, b));
    i = b + CLOSE.length;
  }
  const messages = [];
  const sandbox = {
    parent: { postMessage: (msg) => messages.push(msg) },
    console: {},
    document: { getElementById: () => ({}) },
    setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  for (const js of blocks) {
    try {
      vm.runInContext(js, sandbox, { timeout: 2000 });
    } catch (e) {
      // browser behavior: a block that fails to parse fires window.onerror, not a throw
      if (typeof sandbox.window.onerror === 'function') sandbox.window.onerror(e.message);
      else throw e;
    }
  }
  return messages;
}

async function runCase(name, code, test) {
  const id = 'runSim1';
  const html = buildSrcdoc(id, code, test);
  const msgs = runInFakeIframe(html);
  for (let i = 0; i < 20 && !msgs.length; i++) await new Promise((r) => setImmediate(r));
  const hit = msgs.find((x) => x.__jsm === 1 && x.id === id);
  if (!hit) throw new Error(name + ': NO postMessage received (this was the on-device bug)');
  console.log(name + ': ok=' + hit.res.ok + ' logs=' + JSON.stringify(hit.res.logs) + ' err=' + hit.res.error);
  return hit.res;
}

// 1) playground hello world + loop (exactly the screenshot case)
const r1 = await runCase('playground hello', 'console.log("Hello, world!");\nfor (let i = 1; i <= 5; i++) { console.log(i, "squared is", i * i); }', null);
if (!r1.ok || r1.logs[0] !== 'Hello, world!' || r1.logs.length !== 6) throw new Error('playground case wrong: ' + JSON.stringify(r1));

// 2) practice case from screenshot: print exactly star-105, with its test
const r2 = await runCase('practice star-105', 'console.log("star-105");', '__logs.length === 1 && __logs[0] === "star-105"');
if (!r2.ok) throw new Error('practice test should pass: ' + JSON.stringify(r2));

// 3) broken user code reports an error, not a timeout
const r3 = await runCase('syntax error', 'let x = ;', null);
if (r3.ok || !r3.error) throw new Error('syntax error should be ok=false with error');

// 4) failing test -> ok=false
const r4 = await runCase('failing test', 'let x = 1;', 'x === 2');
if (r4.ok) throw new Error('failing test must be ok=false');

// 5) async (promise) test resolves
const r5 = await runCase('async test', 'let v = 42;', 'Promise.resolve(v === 42)');
if (!r5.ok) throw new Error('async test should pass');

// 6) user code containing the literal close tag must not break out nor change the value
const tag = '</scr' + 'ipt>';
const r6 = await runCase('script-tag-in-string', 'console.log("' + tag + '");', '__logs.length === 1 && __logs[0] === ' + JSON.stringify(tag));
if (!r6.ok) throw new Error('escaped close-tag case failed: ' + JSON.stringify(r6));

console.log('RUNNER TEST: ALL PASSED — the shipped srcdoc template executes and posts results');
