#!/usr/bin/env node
/**
 * gen_questions.js — builds the Bible Quiz question bank.
 *
 *   node web/gen_questions.js [outDir]        (default: app/src/main/assets/www)
 *
 * Reads:
 *   ../bibles/kjv/kjv.js   (var bible_data = [{ari,name,verse}, ...], 31,102 verses)
 *   web/curated.json       (hand-written Q&A)
 *
 * Writes into outDir:
 *   questions.js           (var QUIZ_BANK = [...])   — the quiz questions
 *   books.js               (var QUIZ_BOOKS = [...])  — book metadata for the app
 *
 * Question shape:
 *   { id, c: category, d: difficulty(easy|medium|hard), q, o: [4 options],
 *     a: index of correct option, v: "Book C:V" verse ref or null, x: explanation }
 *
 * Deterministic (seeded PRNG) so CI builds are reproducible. The generator
 * validates the bank (>= 2000 questions, unique ids, 4 unique options, valid
 * answer index, verse refs resolvable in the KJV data) and exits non-zero on
 * any problem, so a broken bank can never ship.
 */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const OUT = process.argv[2] || path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'www');

const CAT = {
  OT: 'Old Testament', NT: 'New Testament', PPL: 'People', PLC: 'Places',
  EV: 'Events', BKS: 'Books of the Bible', QTE: 'Quotes & Sayings',
  NUM: 'Numbers & Facts', PM: 'Parables & Miracles',
  VH: 'Verse Hunt', FB: 'Fill in the Blank',
};
const DIFF = { e: 'easy', m: 'medium', h: 'hard' };

// ---------------------------------------------------------------- PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261103);
const ri = (n) => Math.floor(rnd() * n);
const pick = (arr) => arr[ri(arr.length)];
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = ri(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- load KJV
const kjvSrc = fs.readFileSync(path.join(ROOT, 'bibles', 'kjv', 'kjv.js'), 'utf8');
const VERSES = new Function(kjvSrc + '; return bible_data;')();
if (!Array.isArray(VERSES) || VERSES.length < 30000) {
  console.error('FATAL: could not parse bibles/kjv/kjv.js (%s verses)', VERSES.length);
  process.exit(1);
}

// books metadata derived from the data
const books = [];
{
  const byIdx = new Map();
  for (const v of VERSES) {
    const bi = parseInt(v.ari.split(':')[0], 10);
    if (!byIdx.has(bi)) byIdx.set(bi, { i: bi, name: v.name.replace(/\s+\d+:\d+$/, ''), chapters: new Set(), verses: 0, first: v.name });
    const b = byIdx.get(bi);
    b.chapters.add(parseInt(v.ari.split(':')[1], 10));
    b.verses++;
  }
  for (const b of [...byIdx.values()].sort((x, y) => x.i - y.i)) {
    books.push({
      i: b.i, name: b.name, testament: b.i < 39 ? 'OT' : 'NT',
      chapters: b.chapters.size, verses: b.verses, first: b.first,
      chapterList: [...b.chapters].sort((a, b2) => a - b2),
    });
  }
}
if (books.length !== 66 || books[0].name !== 'Genesis' || books[65].name !== 'Revelation') {
  console.error('FATAL: unexpected book table:', books.length, books[0] && books[0].name, books[65] && books[65].name);
  process.exit(1);
}
const bookByName = new Map(books.map(b => [b.name, b]));
const verseByName = new Map(VERSES.map(v => [v.name, v]));

// verse lookup helper: "John 3:16" -> verse object
const refRe = /^(.+?)\s+(\d+):(\d+)$/;
function verseOf(ref) { return verseByName.get(ref) || null; }

// famous verses (for easy difficulty + they are crowd favourites)
const FAMOUS = new Set([
  'Genesis 1:1', 'Genesis 1:27', 'Genesis 3:15', 'Exodus 20:3', 'Psalm 23:1', 'Psalm 46:10',
  'Psalm 119:105', 'Proverbs 3:5', 'Isaiah 9:6', 'Isaiah 40:31', 'Isaiah 53:5', 'Jeremiah 29:11',
  'Matthew 5:3', 'Matthew 6:9', 'Matthew 7:1', 'Matthew 11:28', 'Matthew 28:19', 'Mark 8:36',
  'Luke 2:11', 'John 1:1', 'John 3:16', 'John 6:35', 'John 8:12', 'John 10:11', 'John 11:25',
  'John 11:35', 'John 14:6', 'John 15:13', 'Acts 1:8', 'Romans 8:28', 'Romans 12:2', '1 Corinthians 13:13',
  'Philippians 4:13', 'Hebrews 11:1', 'James 1:5', 'Revelation 21:4', 'Revelation 22:13',
]);

// ---------------------------------------------------------------- bank
const bank = [];
const seenQ = new Set();
let idCounter = 0;
function addQ(cat, diff, q, options, answerText, verseRef, explanation) {
  if (seenQ.has(q)) return;
  const opts = shuffle([answerText, ...options]);
  const a = opts.indexOf(answerText);
  if (opts.length !== 4 || new Set(opts).size !== 4 || opts.some(o => !o || !String(o).trim())) return;
  if (a < 0) return;
  if (verseRef && !verseOf(verseRef)) return; // verse ref must resolve
  seenQ.add(q);
  bank.push({
    id: 'q' + (++idCounter), c: cat, d: diff,
    q: String(q), o: opts.map(String), a, v: verseRef || null, x: explanation || null,
  });
}

// ---------------------------------------------------------------- curated
{
  const cur = JSON.parse(fs.readFileSync(path.join(HERE, 'curated.json'), 'utf8'));
  let n = 0;
  for (const [cat, diff, q, ans, wrongs, v, x] of cur.questions) {
    if (!CAT[cat] || !DIFF[diff] || !Array.isArray(wrongs) || wrongs.length !== 3) {
      console.error('FATAL: malformed curated entry:', q);
      process.exit(1);
    }
    addQ(CAT[cat], DIFF[diff], q, wrongs, ans, v || null, x || null);
    n++;
  }
  console.log('curated questions added:', n, '(unique:', bank.length + ')');
}

// ---------------------------------------------------------------- generated: books
for (let i = 0; i < books.length - 1; i++) {
  const b = books[i], next = books[i + 1];
  const others = shuffle(books.filter(x => x !== b && x !== next)).slice(0, 3).map(x => x.name);
  addQ(CAT.BKS, i % 2 === 0 ? 'easy' : 'medium',
    `Which book of the Bible comes immediately after ${b.name}?`,
    [next.name, ...others.slice(0, 3)].slice(0, 3).filter(x => x !== next.name),
    next.name, next.first,
    `${next.name} follows ${b.name} in the canon.`);
}
for (let i = 1; i < books.length; i++) {
  const b = books[i], prev = books[i - 1];
  const others = shuffle(books.filter(x => x !== b && x !== prev)).slice(0, 3).map(x => x.name);
  addQ(CAT.BKS, i % 2 === 0 ? 'easy' : 'medium',
    `Which book of the Bible comes immediately before ${b.name}?`,
    others.filter(x => x !== prev.name), prev.name, prev.first,
    `${prev.name} precedes ${b.name}.`);
}
for (const b of books) {
  const n = b.chapters;
  const wrongs = new Set();
  for (const d of [1, -1, 2, -2, 3]) {
    const c = n + d;
    if (c >= 1 && c !== n) wrongs.add(String(c));
    if (wrongs.size === 3) break;
  }
  while (wrongs.size < 3) wrongs.add(String(n + ri(20) + 4));
  const FAMOUS_BOOKS = new Set(['Genesis','Exodus','Psalms','Proverbs','Isaiah','Matthew','John','Romans','1 Corinthians','Revelation']);
  addQ(CAT.BKS, FAMOUS_BOOKS.has(b.name) ? 'easy' : 'medium',
    `How many chapters are in the book of ${b.name}?`,
    [...wrongs], String(n), b.first, `${b.name} has ${n} chapter${n === 1 ? '' : 's'}.`);
}
for (const b of books) {
  const n = b.verses;
  const wrongs = new Set();
  for (const f of [0.9, 1.1, 0.8, 1.25]) {
    const c = Math.max(1, Math.round(n * f));
    if (c !== n) wrongs.add(String(c));
    if (wrongs.size === 3) break;
  }
  while (wrongs.size < 3) wrongs.add(String(n + ri(500) + 10));
  addQ(CAT.BKS, 'hard',
    `About how many verses are in the book of ${b.name}?`,
    [...wrongs], String(n), b.first, `${b.name} contains ${n} verses in the KJV.`);
}
// notable chapter verse-counts
const notable = [
  ['Psalms', 119], ['Psalms', 117], ['Psalms', 23], ['Genesis', 1], ['Exodus', 20],
  ['John', 3], ['Matthew', 5], ['Matthew', 6], ['Matthew', 7], ['Romans', 8],
  ['1 Corinthians', 13], ['Revelation', 22], ['Psalms', 1], ['Genesis', 3],
  ['Luke', 2], ['Matthew', 28], ['John', 14], ['Isaiah', 53], ['Psalms', 51],
  ['Hebrews', 11], ['Philippians', 4], ['James', 1], ['1 Peter', 5],
];
for (const [bn, ch] of notable) {
  const b = bookByName.get(bn);
  if (!b) continue;
  const v = VERSES.find(v => v.ari === `${b.i}:${ch}:1`);
  if (!v) continue;
  const n = VERSES.filter(v2 => v2.ari.startsWith(`${b.i}:${ch}:`)).length;
  const wrongs = new Set();
  for (const d of [1, -1, 2, -2, 10]) {
    const c = n + d;
    if (c > 0 && c !== n) wrongs.add(String(c));
    if (wrongs.size === 3) break;
  }
  while (wrongs.size < 3) wrongs.add(String(n + ri(30) + 5));
  addQ(CAT.NUM, 'medium', `How many verses are in ${bn} ${ch}?`,
    [...wrongs], String(n), v.name, `${bn} ${ch} has ${n} verses (KJV).`);
}

// ---------------------------------------------------------------- generated: verse hunt (find the reference)
{
  const candidates = VERSES.filter(v => {
    const t = v.verse;
    return t.length >= 60 && t.length <= 260 && !t.includes('[') && !t.includes(']');
  });
  shuffle(candidates);
  let added = 0;
  for (const v of candidates) {
    if (added >= 800) break;
    const b = books[parseInt(v.ari.split(':')[0], 10)];
    // distractors: same book other chapters first, then other books
    const sameBook = b.chapterList.filter(c => c !== parseInt(v.ari.split(':')[1], 10))
      .map(c => `${b.name} ${c}:${1 + ri(20)}`);
    const pool = [...sameBook];
    const otherBooks = shuffle(books.filter(x => x !== b));
    for (const ob of otherBooks) {
      pool.push(`${ob.name} ${1 + ri(ob.chapters)}:${1 + ri(25)}`);
      if (pool.length >= 12) break;
    }
    const wrongs = [];
    for (const p of shuffle(pool)) {
      if (p === v.name) continue;
      if (!verseOf(p)) continue;
      if (wrongs.includes(p)) continue;
      wrongs.push(p);
      if (wrongs.length === 3) break;
    }
    if (wrongs.length < 3) continue;
    const diff = FAMOUS.has(v.name) || v.verse.length < 100 ? 'easy' : (v.verse.length < 160 ? 'medium' : 'hard');
    addQ(CAT.VH, diff,
      `"${v.verse}"\n\nWhere is this verse found?`,
      wrongs, v.name, v.name,
      `Read the full verse: ${v.name}.`);
    added++;
  }
  console.log('verse hunt added:', added);
}

// ---------------------------------------------------------------- generated: which book contains this verse
{
  const candidates = VERSES.filter(v => {
    const t = v.verse;
    return t.length >= 50 && t.length <= 160 && !t.includes('[');
  });
  shuffle(candidates);
  let added = 0;
  for (const v of candidates) {
    if (added >= 300) break;
    const b = books[parseInt(v.ari.split(':')[0], 10)];
    const wrongs = [];
    for (const ob of shuffle(books.filter(x => x !== b))) {
      if (!wrongs.includes(ob.name)) wrongs.push(ob.name);
      if (wrongs.length === 3) break;
    }
    if (wrongs.length < 3) continue;
    const snippet = v.verse.length > 90 ? v.verse.slice(0, 90).trim() + ' …' : v.verse;
    addQ(CAT.BKS, FAMOUS.has(v.name) ? 'easy' : 'medium',
      `"${snippet}"\n\nThis verse is in which book of the Bible?`,
      wrongs, b.name, v.name,
      `${v.name} is in the book of ${b.name}.`);
    added++;
  }
  console.log('which-book added:', added);
}

// ---------------------------------------------------------------- generated: fill in the blank
const STOP = new Set(('the a an and or but of to in on at for with from by as is are was were be been being it its his her their theirs he she they we you i this that these those into over under not no shall will would can could may might must do does did done have has had you your my our me him them then than so if when where who whom which what all any both each few more most other some such only own same too very just about above after again once here there now once out up down off again').split(' '));
function contentWords(text) {
  return text.replace(/[^A-Za-z'’ ]/g, ' ').split(/\s+/)
    .map(w => w.replace(/^'+|'+$/g, ''))
    .filter(w => w.length >= 4 && !STOP.has(w.toLowerCase()));
}
{
  const candidates = VERSES.filter(v => v.verse.length >= 55 && v.verse.length <= 210 && !v.verse.includes('['));
  shuffle(candidates);
  let added = 0;
  for (const v of candidates) {
    if (added >= 800) break;
    const words = contentWords(v.verse);
    if (words.length < 4) continue;
    // answer = longest content word; distractors = other content words of the verse
    const answer = words.reduce((a, b) => (b.length > a.length ? b : a));
    const others = shuffle(words.filter(w => w.toLowerCase() !== answer.toLowerCase()));
    const wrongs = [];
    for (const w of others) {
      if (wrongs.length >= 3) break;
      const wl = w.toLowerCase();
      if (wl === answer.toLowerCase()) continue;
      if (wrongs.some(x => x.toLowerCase() === wl)) continue;
      wrongs.push(w);
    }
    if (wrongs.length < 3) continue;
    // replace first occurrence of the answer word in the verse
    const idx = v.verse.toLowerCase().indexOf(answer.toLowerCase());
    if (idx < 0) continue;
    const qText = v.verse.slice(0, idx) + '______' + v.verse.slice(idx + answer.length);
    addQ(CAT.FB, answer.length <= 6 ? 'easy' : (answer.length <= 9 ? 'medium' : 'hard'),
      `Fill in the blank:\n\n"${qText}"`,
      wrongs, answer, v.name,
      `The full verse is ${v.name}: "${v.verse}"`);
    added++;
  }
  console.log('fill-in-the-blank added:', added);
}

// ---------------------------------------------------------------- validate + write
function validate() {
  const problems = [];
  const ids = new Set();
  const cats = new Set(), diffs = new Set();
  for (const q of bank) {
    if (ids.has(q.id)) problems.push('dup id ' + q.id);
    ids.add(q.id);
    if (!q.q || q.q.length < 8) problems.push('short q ' + q.id);
    if (!Array.isArray(q.o) || q.o.length !== 4) problems.push('options ' + q.id);
    if (new Set(q.o).size !== 4) problems.push('dup options ' + q.id);
    if (typeof q.a !== 'number' || q.a < 0 || q.a > 3) problems.push('answer ' + q.id);
    if (q.v && !verseOf(q.v)) problems.push('bad verse ' + q.id + ' ' + q.v);
    cats.add(q.c); diffs.add(q.d);
  }
  if (bank.length < 2000) problems.push('bank too small: ' + bank.length);
  if (problems.length) {
    console.error('VALIDATION FAILED:\n' + problems.slice(0, 20).join('\n'));
    process.exit(1);
  }
  return { cats: [...cats].sort(), diffs: [...diffs].sort() };
}
const info = validate();

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'questions.js'),
  '// GENERATED by web/gen_questions.js — do not edit by hand.\n' +
  '// ' + bank.length + ' questions, seed 20261103.\n' +
  'var QUIZ_BANK = ' + JSON.stringify(bank) + ';\n');
fs.writeFileSync(path.join(OUT, 'books.js'),
  '// GENERATED by web/gen_questions.js — book metadata from bibles/kjv/kjv.js.\n' +
  'var QUIZ_BOOKS = ' + JSON.stringify(books.map(b => ({
    i: b.i, name: b.name, testament: b.testament, chapters: b.chapters,
    verses: b.verses, first: b.first,
  }))) + ';\n');

const byCat = {}, byDiff = {};
for (const q of bank) { byCat[q.c] = (byCat[q.c] || 0) + 1; byDiff[q.d] = (byDiff[q.d] || 0) + 1; }
console.log('TOTAL QUESTIONS:', bank.length);
console.log('by category:', JSON.stringify(byCat, null, 1));
console.log('by difficulty:', JSON.stringify(byDiff));
console.log('wrote', path.join(OUT, 'questions.js'), '(' + fs.statSync(path.join(OUT, 'questions.js')).size + ' bytes)');
console.log('wrote', path.join(OUT, 'books.js'));
