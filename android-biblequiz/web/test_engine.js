#!/usr/bin/env node
/**
 * test_engine.js — unit tests for the quiz engine (pure logic in app.js,
 * exposed as window.BQ). Run with the real bank + KJV data:
 *
 *   node web/test_engine.js [stagedWwwDir]
 */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const OUT = process.argv[2] || path.join(HERE, '..', 'app', 'src', 'main', 'assets', 'www');

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' ' + m); if (!c) fails++; };

// load bank + books + kjv into a sandbox, then run app.js in it (no document -> pure mode)
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  QUIZ_BANK: new Function(fs.readFileSync(path.join(OUT, 'questions.js'), 'utf8') + '; return QUIZ_BANK;')(),
  QUIZ_BOOKS: new Function(fs.readFileSync(path.join(OUT, 'books.js'), 'utf8') + '; return QUIZ_BOOKS;')(),
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
// icons.js must load before app.js (index.html order) and define window.I
vm.runInContext(fs.readFileSync(path.join(HERE, 'icons.js'), 'utf8'), sandbox, { filename: 'icons.js' });
ok(typeof sandbox.I === 'function', 'icons.js defines window.I');
ok(/<svg/.test(sandbox.I('bolt')) && /bolt|M13 2L4 14/.test(sandbox.I('bolt')), "I('bolt') returns an <svg> string");
ok(sandbox.I('no-such-icon').includes('<svg'), 'unknown icon falls back to help icon');
vm.runInContext(fs.readFileSync(path.join(HERE, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
const BQ = sandbox.BQ;
ok(!!BQ, 'BQ exposed on window');
ok(BQ.BANK.length >= 2000, `bank loaded in engine: ${BQ.BANK.length}`);

const kjv = new Function(fs.readFileSync(path.join(ROOT, 'bibles', 'kjv', 'kjv.js'), 'utf8') + '; return bible_data;')();

// --- pickQuestions ---
const a = BQ.pickQuestions({ category: 'Verse Hunt', difficulty: 'easy', count: 20, seed: 42 });
const b = BQ.pickQuestions({ category: 'Verse Hunt', difficulty: 'easy', count: 20, seed: 42 });
ok(a.length === 20 && a.every((q, i) => q.id === b[i].id), 'pickQuestions deterministic for same seed');
const c = BQ.pickQuestions({ category: 'Verse Hunt', difficulty: 'easy', count: 20, seed: 43 });
ok(c.some((q, i) => !a[i] || q.id !== a[i].id), 'different seed -> different pick');
ok(a.every(q => q.c === 'Verse Hunt' && q.d === 'easy'), 'pickQuestions respects category+difficulty');
const all = BQ.pickQuestions({ count: 500, seed: 7 });
ok(all.length === 500 && new Set(all.map(q => q.id)).size === 500, '500 unique questions, no repeats');
const orig = BQ.BANK[0];
BQ.pickQuestions({ count: 10, seed: 1 });
ok(JSON.stringify(BQ.BANK[0]) === JSON.stringify(orig), 'pickQuestions does not mutate the bank');
const ids = all.slice(0, 10).map(q => q.id);
const only = BQ.pickQuestions({ onlyIds: ids, count: 50, seed: 9 });
ok(only.length === 10 && only.every(q => ids.includes(q.id)), 'onlyIds restricts the pool');

// --- daily seed ---
const d1 = BQ.dateStr(new Date(2026, 10, 3));
ok(d1 === '2026-11-03', `dateStr -> ${d1}`);
ok(BQ.dailySeed(new Date(2026, 10, 3)) === BQ.dailySeed(new Date(2026, 10, 3)), 'dailySeed stable for a date');
ok(BQ.dailySeed(new Date(2026, 10, 3)) !== BQ.dailySeed(new Date(2026, 10, 4)), 'dailySeed differs per day');
const daily = BQ.pickQuestions({ count: 10, seed: BQ.dailySeed(new Date(2026, 10, 3)) });
ok(daily.length === 10, 'daily challenge picks 10 questions');

// --- xp / levels ---
ok(BQ.levelForXp(0) === 1 && BQ.levelForXp(99) === 1 && BQ.levelForXp(100) === 2, `levelForXp boundaries (${BQ.levelForXp(0)},${BQ.levelForXp(99)},${BQ.levelForXp(100)})`);
for (let xp = 0; xp < 5000; xp += 137) {
  const l = BQ.levelForXp(xp);
  if (!(BQ.xpForLevel(l) <= xp && xp < BQ.xpForLevel(l + 1))) { ok(false, `levelForXp roundtrip at xp=${xp}`); break; }
}
ok(true, 'levelForXp/xpForLevel roundtrip over 0..5000');
ok(BQ.xpGain(true, 0) === 10 && BQ.xpGain(true, 5) === 15 && BQ.xpGain(true, 99) === 20 && BQ.xpGain(false, 9) === 0,
   'xpGain correct/streak rules');

// --- achievements ---
const S0 = { answered: 0, correct: 0, bestStreak: 0, perCat: {}, achievements: [], daysPlayed: 0, versesRead: {} };
ok(BQ.newAchievements(S0, null).length === 0, 'no achievements at zero state');
const S1 = { ...S0, answered: 1 };
ok(BQ.newAchievements(S1, null).some(a => a.id === 'first'), 'first achievement unlocks at 1 answered');
const S2 = { ...S0, bestStreak: 25 };
ok(BQ.newAchievements(S2, null).some(a => a.id === 'streak25'), 'streak25 unlocks');
const Sp = { ...S0, answered: 100, correct: 100, achievements: [] };
ok(BQ.newAchievements(Sp, { count: 10, correct: 10 }).some(a => a.id === 'perfect'), 'perfect unlocks on 10/10 quiz');
ok(BQ.newAchievements({ ...S0, answered: 50, correct: 47 }, null).some(a => a.id === 'acc90'), 'acc90 unlocks at 94% over 50');
ok(BQ.newAchievements({ ...S0, answered: 50, correct: 40 }, null).every(a => a.id !== 'acc90'), 'acc90 does NOT unlock at 80%');
const Scat = { ...S0, perCat: Object.fromEntries(BQ.CATEGORIES.slice(1).map(c => [c, { a: 1, c: 1 }])) };
ok(BQ.newAchievements(Scat, null).some(a => a.id === 'allcat'), 'allcat unlocks when every category played');

// --- search ---
const r1 = BQ.searchBank('goliath');
ok(r1.length >= 1 && r1.some(q => q.o[q.a].toLowerCase().includes('goliath') || q.q.toLowerCase().includes('goliath')), `searchBank('goliath') -> ${r1.length}`);
const r2 = BQ.searchBank('john 3:16');
ok(r2.length >= 1, `searchBank('john 3:16') -> ${r2.length}`);
ok(BQ.searchBank('').length === 0, 'empty query -> no results');

// --- refs / bible helpers ---
const p = BQ.parseRef('1 Samuel 3:5');
ok(p && p.book === '1 Samuel' && p.ch === 3 && p.v === 5, 'parseRef handles numbered books');
ok(BQ.parseRef('Psalm 23') === null, 'parseRef rejects missing verse');
ok(BQ.bookIndex('Revelation') === 65 && BQ.bookIndex('Genesis') === 0, 'bookIndex');
ok(!!BQ.verseByName(kjv, 'John 3:16') && /God so loved/.test(BQ.verseByName(kjv, 'John 3:16').verse), 'verseByName John 3:16');
const ps119 = BQ.chapterVerses(kjv, 'Psalms', 119);
ok(ps119.length === 176, `Psalm 119 has 176 verses (got ${ps119.length})`);
const gen1 = BQ.chapterVerses(kjv, 'Genesis', 1);
ok(gen1.length === 31 && gen1[0].name === 'Genesis 1:1', 'Genesis 1 has 31 verses');

// --- modes / categories ---
ok(Object.keys(BQ.MODES).length >= 5, '4 game modes');
ok(!!BQ.MODES.general && BQ.MODES.general.name === 'General Knowledge', 'general knowledge mode present');
ok(BQ.CATEGORIES[0] === 'All' && BQ.CATEGORIES.length >= 9, `categories list (${BQ.CATEGORIES.length})`);

console.log('\n' + (fails === 0 ? 'ENGINE TESTS: ALL PASSED' : `ENGINE TESTS: ${fails} FAILED`));
process.exit(fails === 0 ? 0 : 1);
