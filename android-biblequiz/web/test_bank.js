#!/usr/bin/env node
/**
 * test_bank.js — validates the GENERATED question bank (questions.js/books.js)
 * against the source KJV data. Run after gen_questions.js:
 *
 *   node web/gen_questions.js /tmp/bq && node web/test_bank.js /tmp/bq
 *   (defaults to the staged app/src/main/assets/www)
 *
 * Checks: >= 2000 questions, unique ids, 4 unique non-empty options, valid
 * answer index, known category/difficulty, verse refs resolve in the KJV,
 * books table has 66 books with sane chapter counts.
 */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const OUT = process.argv[2] || path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'www');

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };

const bankSrc = fs.readFileSync(path.join(OUT, 'questions.js'), 'utf8');
const booksSrc = fs.readFileSync(path.join(OUT, 'books.js'), 'utf8');
const QUIZ_BANK = new Function(bankSrc + '; return QUIZ_BANK;')();
const QUIZ_BOOKS = new Function(booksSrc + '; return QUIZ_BOOKS;')();
const kjvSrc = fs.readFileSync(path.join(ROOT, 'bibles', 'kjv', 'kjv.js'), 'utf8');
const VERSES = new Function(kjvSrc + '; return bible_data;')();
const byName = new Map(VERSES.map(v => [v.name, v]));

ok(QUIZ_BANK.length >= 2000, `bank has >= 2000 questions (got ${QUIZ_BANK.length})`);
ok(QUIZ_BOOKS.length === 66, `books table has 66 books (got ${QUIZ_BOOKS.length})`);
ok(QUIZ_BOOKS[0].name === 'Genesis' && QUIZ_BOOKS[65].name === 'Revelation', 'first=Genesis last=Revelation');
ok(QUIZ_BOOKS.every(b => b.chapters >= 1 && b.verses >= 1), 'all books have chapters/verses');

const ids = new Set();
const cats = new Set(), diffs = new Set();
let badOpts = 0, badAns = 0, badVerse = 0, shortQ = 0, dupId = 0;
for (const q of QUIZ_BANK) {
  if (ids.has(q.id)) dupId++; ids.add(q.id);
  if (!q.q || q.q.length < 8) shortQ++;
  if (!Array.isArray(q.o) || q.o.length !== 4 || new Set(q.o).size !== 4 || q.o.some(o => !String(o).trim())) badOpts++;
  if (typeof q.a !== 'number' || q.a < 0 || q.a > 3 || q.o[q.a] == null) badAns++;
  if (q.v && !byName.has(q.v)) badVerse++;
  cats.add(q.c); diffs.add(q.d);
}
ok(dupId === 0, `unique ids (${dupId} dupes)`);
ok(shortQ === 0, `all questions have text (${shortQ} short)`);
ok(badOpts === 0, `all have 4 unique non-empty options (${badOpts} bad)`);
ok(badAns === 0, `all have a valid answer index (${badAns} bad)`);
ok(badVerse === 0, `all verse refs resolve in the KJV (${badVerse} bad)`);
ok([...diffs].every(d => ['easy', 'medium', 'hard'].includes(d)), `difficulties valid: ${[...diffs].join(',')}`);
ok(cats.size >= 8, `at least 8 categories (got ${cats.size}: ${[...cats].join(' | ')})`);

const byCat = {}, byDiff = {};
for (const q of QUIZ_BANK) { byCat[q.c] = (byCat[q.c] || 0) + 1; byDiff[q.d] = (byDiff[q.d] || 0) + 1; }
console.log('\nquestions:', QUIZ_BANK.length, ' categories:', JSON.stringify(byCat), ' difficulty:', JSON.stringify(byDiff));

// answer must not be trivially the longest option every time (sanity of shuffling)
let longestWins = 0;
for (const q of QUIZ_BANK) {
  const lens = q.o.map(o => String(o).length);
  if (lens.indexOf(Math.max(...lens)) === q.a) longestWins++;
}
ok(longestWins < QUIZ_BANK.length * 0.6, `answers not always the longest option (${longestWins}/${QUIZ_BANK.length})`);

// spot-check some famous questions exist
const has = (pred, label) => ok(QUIZ_BANK.some(pred), label);
has(q => q.q.includes('ark') && q.o[q.a] === 'Noah', 'Noah/ark question present');
has(q => q.v === 'John 3:16', 'a John 3:16 verse question present');
has(q => q.q.includes('Ten Commandments') || q.q.includes('commandments'), 'commandments question present');
has(q => q.c === 'Verse Hunt' && q.o.every(o => /:/.test(o)), 'verse-hunt options are references');
has(q => q.c === 'Fill in the Blank' && q.q.includes('______'), 'fill-in-the-blank has a blank');

console.log('\n' + (fails === 0 ? 'BANK TESTS: ALL PASSED' : `BANK TESTS: ${fails} FAILED`));
process.exit(fails === 0 ? 0 : 1);
