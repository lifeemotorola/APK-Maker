/* ============================================================================
 * Bible Quiz — single-page app (no backend; the APK serves this over a
 * loopback HTTP server). Pure logic is exposed on window.BQ so it can be
 * unit-tested under node (see test_engine.js).
 * ==========================================================================*/
(function () {
'use strict';

/* ------------------------------ utils ---------------------------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function shuffleSeeded(arr, seed) {
  const r = mulberry32(seed), a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------ bank ----------------------------------- */
const BANK = (typeof window !== 'undefined' && window.QUIZ_BANK) || (typeof QUIZ_BANK !== 'undefined' ? QUIZ_BANK : []);
const BOOKS = (typeof window !== 'undefined' && window.QUIZ_BOOKS) || (typeof QUIZ_BOOKS !== 'undefined' ? QUIZ_BOOKS : []);
const CATEGORIES = ['All', ...new Set(BANK.map(q => q.c))];
const MODES = {
  sprint:  { name: 'Sprint',        icon: 'bolt', count: 15, seconds: 15, strikes: 0, desc: '15 questions · 15s each' },
  marathon:{ name: 'Marathon',      icon: 'flag', count: 50, seconds: 20, strikes: 0, desc: '50 questions · 20s each' },
  daily:   { name: 'Daily Challenge', icon: 'sun', count: 10, seconds: 20, strikes: 0, desc: '10 questions · new every day' },
  death:   { name: 'Sudden Death',  icon: 'skull', count: 999, seconds: 15, strikes: 3, desc: '3 wrong answers and it is over' },
};

/* --------------------------- quiz engine (pure) ------------------------- */
function pickQuestions(opts) {
  const o = opts || {};
  const category = o.category || 'All';
  const difficulty = o.difficulty || 'any';
  const count = o.count || 15;
  const seed = (o.seed == null ? 1 : o.seed) >>> 0;
  let pool = BANK.filter(q =>
    (category === 'All' || q.c === category) &&
    (difficulty === 'any' || q.d === difficulty));
  if (o.onlyIds && o.onlyIds.length) {
    const set = new Set(o.onlyIds);
    pool = pool.filter(q => set.has(q.id));
  }
  const picked = shuffleSeeded(pool, seed).slice(0, count);
  // deep-copy so a session never mutates the bank
  return picked.map(q => ({ ...q, o: q.o.slice() }));
}
function dailySeed(date) { // date: Date -> int seed
  const s = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  return hashStr('biblequiz-daily-' + s);
}
function dateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function xpForLevel(level) { return 100 * (level - 1) * (level - 1); }
function levelForXp(xp) { let l = 1; while (xpForLevel(l + 1) <= xp) l++; return l; }
function xpGain(correct, streak) { return correct ? 10 + Math.min(streak, 10) : 0; }

const ACHIEVEMENTS = [
  { id: 'first',    name: 'First Steps',   icon: 'leaf', desc: 'Answer your first question',        test: S => S.answered >= 1 },
  { id: 'c10',      name: 'Getting Warm',  icon: 'hash', desc: 'Answer 10 questions',               test: S => S.answered >= 10 },
  { id: 'c100',     name: 'Century',       icon: 'target', desc: 'Answer 100 questions',              test: S => S.answered >= 100 },
  { id: 'c500',     name: 'Scholar',       icon: 'cap', desc: 'Answer 500 questions',              test: S => S.answered >= 500 },
  { id: 'c1000',    name: 'Bible Master',  icon: 'crown', desc: 'Answer 1,000 questions',            test: S => S.answered >= 1000 },
  { id: 'streak10', name: 'On Fire',       icon: 'flame', desc: 'Reach a 10-question streak',        test: S => S.bestStreak >= 10 },
  { id: 'streak25', name: 'Unstoppable',   icon: 'zap', desc: 'Reach a 25-question streak',        test: S => S.bestStreak >= 25 },
  { id: 'perfect',  name: 'Flawless',      icon: 'sparkles', desc: 'Perfect score on a 10+ question quiz', test: (S, r) => r && r.count >= 10 && r.correct === r.count },
  { id: 'acc90',    name: 'Sharp Mind',    icon: 'bulb', desc: '90%+ accuracy over 50+ answers',    test: S => S.answered >= 50 && (S.correct / S.answered) >= 0.9 },
  { id: 'daily7',   name: 'Daily Devotion', icon: 'calendar', desc: 'Play the daily challenge 7 days',  test: S => (S.daysPlayed || 0) >= 7 },
  { id: 'explorer', name: 'Explorer',      icon: 'compass', desc: 'Read 25 different verses',          test: S => Object.keys(S.versesRead || {}).length >= 25 },
  { id: 'allcat',   name: 'Well-Rounded',  icon: 'globe', desc: 'Answer in every category',          test: S => CATEGORIES.slice(1).every(c => (S.perCat[c] || {}).a > 0) },
];
function newAchievements(S, result) {
  return ACHIEVEMENTS.filter(a => !S.achievements.includes(a.id) && a.test(S, result))
    .map(a => ({ id: a.id, name: a.name, icon: a.icon, desc: a.desc }));
}
function searchBank(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return BANK.filter(x =>
    x.q.toLowerCase().includes(q) || x.o.some(o => o.toLowerCase().includes(q)) ||
    (x.v && x.v.toLowerCase().includes(q)) || (x.x && x.x.toLowerCase().includes(q)));
}
function parseRef(ref) {
  const m = /^(.+?)\s+(\d+):(\d+)$/.exec(String(ref || '').trim());
  if (!m) return null;
  return { book: m[1], ch: +m[2], v: +m[3] };
}
function bookIndex(name) { const b = BOOKS.find(b => b.name === name); return b ? b.i : -1; }
function verseByName(data, ref) { return data.find(v => v.name === ref) || null; }
function chapterVerses(data, book, ch) {
  const bi = bookIndex(book);
  if (bi < 0) return [];
  const pre = bi + ':' + ch + ':';
  return data.filter(v => v.ari.startsWith(pre));
}

/* expose pure API for tests */
const BQ = {
  mulberry32, hashStr, shuffleSeeded, pickQuestions, dailySeed, dateStr,
  xpForLevel, levelForXp, xpGain, newAchievements, searchBank, parseRef,
  bookIndex, verseByName, chapterVerses, MODES, CATEGORIES, ACHIEVEMENTS,
  get BANK() { return BANK; }, get BOOKS() { return BOOKS; },
};
if (typeof window !== 'undefined') window.BQ = BQ;
if (typeof module !== 'undefined') module.exports = BQ;

/* ============================ UI (browser only) ========================= */
if (typeof document === 'undefined') return;

const APP_VERSION = '1.1';
const APP_AUTHOR = 'Emmanuel Suah';
const LS_KEY = 'bq_state_v1';
function defaultState() {
  return {
    xp: 0, answered: 0, correct: 0, streak: 0, bestStreak: 0,
    perCat: {}, saved: {}, wrongIds: {}, achievements: [], daysPlayed: 0,
    versesRead: {}, settings: { sound: true, timer: true, theme: 'parchment', translation: 'kjv' },
    lastDaily: null, // {date, score, count}
  };
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const st = Object.assign(defaultState(), JSON.parse(raw));
      if (st.settings.theme === 'dark') st.settings.theme = 'midnight'; // v1.0 theme migration
      return st;
    }
  } catch (e) { /* corrupted storage -> fresh */ }
  return defaultState();
}
let S = loadState();
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {} }

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg, icon) {
  toastEl.innerHTML = (icon ? '<span class="t-ico">' + I(icon) + '</span>' : '') + esc(msg);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

/* ------------------------------ audio ---------------------------------- */
let AC = null;
function ac() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
function beep(freq, dur, type, gain, when) {
  if (!S.settings.sound) return;
  const ctx = ac(); if (!ctx) return;
  const t = ctx.currentTime + (when || 0);
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain || 0.12, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
const sfx = {
  click:   () => beep(620, 0.06, 'triangle', 0.08),
  correct: () => { beep(660, 0.12, 'sine', 0.12); beep(880, 0.18, 'sine', 0.12, 0.09); },
  wrong:   () => { beep(180, 0.25, 'sawtooth', 0.10); beep(120, 0.3, 'sawtooth', 0.08, 0.12); },
  fanfare: () => { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, 'triangle', 0.12, i * 0.11)); },
  tick:    () => beep(900, 0.04, 'square', 0.05),
};
function buzz(correct) {
  if (navigator.vibrate) { try { navigator.vibrate(correct ? 25 : [70, 40, 70]); } catch (e) {} }
}

/* ------------------------------ confetti -------------------------------- */
const cv = document.getElementById('confetti');
function confetti() {
  const ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = ['#e8c468', '#7c5cff', '#4f8cff', '#34d399', '#f472b6', '#fff'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.6,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4,
    r: Math.random() * 7 + 3, c: colors[(Math.random() * colors.length) | 0],
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
  }));
  const t0 = performance.now();
  (function frame(t) {
    const k = (t - t0) / 2600;
    if (k >= 1) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.35; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = 1 - k; ctx.fillStyle = p.c;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  })(t0);
}

/* ------------------------------ bible data ------------------------------ */
const bibleCache = {};   // translationId -> bible_data array
async function loadTranslation(id) {
  if (bibleCache[id]) return bibleCache[id];
  const res = await fetch('/bibles/' + id + '/' + id + '.js');
  if (!res.ok) throw new Error('translation load failed: ' + id);
  const src = await res.text();
  const data = new Function(src + '; return bible_data;')();
  bibleCache[id] = data;
  return data;
}
let manifestPromise = null;
function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('/bibles/manifest.json').then(r => r.json()).catch(() => ({ translations: [{ id: 'kjv', label: 'KING JAMES VERSION', short: 'KJV' }] }));
  }
  return manifestPromise;
}

/* ------------------------------ screens --------------------------------- */
let screen = { name: 'home' };
let session = null;

function go(name, params) { screen = Object.assign({ name }, params || {}); render(); window.scrollTo(0, 0); }

function h(html) { app.innerHTML = html; }

function navBar(active) {
  const items = [
    ['home', 'home', 'Home'], ['stats', 'chart', 'Stats'], ['saved', 'star', 'Saved'],
    ['search', 'search', 'Search'], ['settings', 'gear', 'Settings'],
  ];
  return '<nav class="navbar">' + items.map(([n, ic, lb]) =>
    `<button class="nav-btn ${n === active ? 'active' : ''}" data-nav="${n}">${I(ic, 'nav-ico')}<span>${lb}</span></button>`).join('') + '</nav>';
}
function bindNav() {
  app.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => { sfx.click(); go(b.dataset.nav); }));
}

/* ------------------------------ home ------------------------------------ */
async function renderHome() {
  const today = dateStr(new Date());
  const seed = dailySeed(new Date());
  const votd = pickQuestions({ count: 1, seed: hashStr('votd-' + today) })[0];
  let votdHtml = '';
  try {
    const kjv = await loadTranslation('kjv');
    const v = votd && votd.v ? verseByName(kjv, votd.v) : null;
    if (v) votdHtml = `<div class="votd"><div class="votd-label">VERSE OF THE DAY</div>
      <p class="votd-text">“${esc(v.verse)}”</p><button class="votd-ref" data-open-ref="${esc(v.name)}">${esc(v.name)} ${I('chevronRight')}</button></div>`;
  } catch (e) { /* votd optional */ }
  const dailyDone = S.lastDaily && S.lastDaily.date === today;
  const acc = S.answered ? Math.round(100 * S.correct / S.answered) : 0;
  const lvl = levelForXp(S.xp);
  h(`
  <section class="screen home">
    <header class="hero">
      <div class="hero-eyebrow">The Holy Bible &middot; Quiz</div>
      <svg class="hero-orn" viewBox="0 0 140 12" aria-hidden="true"><path d="M2 6h52M86 6h52" stroke="currentColor" stroke-width="1"/><path d="M70 1l5 5-5 5-5-5z" fill="currentColor"/></svg>
      <h1 class="hero-title">Bible Quiz</h1>
      <p class="hero-sub">Test your knowledge of Scripture — people, places, verses and promises.</p>
      <div class="hero-stats">
        <div class="chip">Level ${lvl}</div><div class="chip">${S.xp.toLocaleString()} XP</div>
        <div class="chip">${acc}% accuracy</div><div class="chip">${I('flame')} best ${S.bestStreak}</div>
      </div>
    </header>
    ${votdHtml}
    <div class="modes">
      ${Object.entries(MODES).map(([k, m]) => `
        <button class="mode-card" data-mode="${k}">
          ${I(m.icon, 'mode-ico')}
          <span class="mode-name">${m.name}</span>
          <span class="mode-desc">${m.desc}</span>
          ${k === 'daily' && dailyDone ? `<span class="mode-done">${I('check')} done today · ${S.lastDaily.score}/${S.lastDaily.count}</span>` : ''}
        </button>`).join('')}
    </div>
    <p class="hint">Pick a mode, then choose a category and difficulty.</p>
    <footer class="credit">by ${APP_AUTHOR} &middot; v${APP_VERSION} &middot; fully offline</footer>
  </section>${navBar('home')}`);
  bindNav();
  app.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    sfx.click(); go('setup', { mode: b.dataset.mode });
  }));
  app.querySelectorAll('[data-open-ref]').forEach(b => b.addEventListener('click', () => {
    sfx.click(); go('reader', { ref: b.dataset.openRef });
  }));
}

/* ------------------------------ setup ----------------------------------- */
function renderSetup() {
  const m = MODES[screen.mode] || MODES.sprint;
  const cat = screen.category || 'All';
  const diff = screen.difficulty || 'any';
  h(`
  <section class="screen">
    <button class="back" data-nav="home">${I('chevronLeft')} Back</button>
    <h2 class="screen-title">${I(m.icon)} ${m.name}</h2>
    <p class="screen-sub">${m.desc}</p>
    <h3 class="group-label">Category</h3>
    <div class="chip-row">${CATEGORIES.map(c =>
      `<button class="chip-btn ${c === cat ? 'sel' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <h3 class="group-label">Difficulty</h3>
    <div class="chip-row">${[['any', 'Any'], ['easy', I('smile') + ' Easy'], ['medium', I('meh') + ' Medium'], ['hard', I('frown') + ' Hard']].map(([v, lb]) =>
      `<button class="chip-btn ${v === diff ? 'sel' : ''}" data-diff="${v}">${lb}</button>`).join('')}</div>
    <button class="btn primary big" id="start">Start quiz ${I('chevronRight')}</button>
  </section>${navBar('home')}`);
  bindNav();
  app.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => { sfx.click(); screen.category = b.dataset.cat; renderSetup(); }));
  app.querySelectorAll('[data-diff]').forEach(b => b.addEventListener('click', () => { sfx.click(); screen.difficulty = b.dataset.diff; renderSetup(); }));
  document.getElementById('start').addEventListener('click', () => { sfx.click(); startQuiz(); });
}

function startQuiz(onlyIds) {
  const m = MODES[screen.mode] || MODES.sprint;
  const today = dateStr(new Date());
  const seed = screen.mode === 'daily' ? dailySeed(new Date()) : (Math.random() * 1e9) >>> 0;
  const qs = pickQuestions({
    category: screen.category || 'All',
    difficulty: screen.difficulty || 'any',
    count: m.count,
    seed,
    onlyIds,
  });
  if (!qs.length) { toast('No questions match those filters', 'help'); return; }
  session = {
    mode: screen.mode || 'sprint', questions: qs, idx: 0, answers: [],
    correct: 0, streak: 0, bestStreakInQuiz: 0, xpGained: 0,
    seconds: m.seconds, strikes: m.strikes, timeLeft: m.seconds, locked: false, timerId: null,
  };
  go('quiz');
}

/* ------------------------------ quiz ------------------------------------ */
function renderQuiz() {
  const q = session.questions[session.idx];
  const total = session.questions.length;
  const prog = Math.round(100 * session.idx / total);
  const mode = MODES[session.mode];
  h(`
  <section class="screen quiz">
    <div class="quiz-top">
      <span class="q-count">${session.idx + 1} / ${total === 999 ? '∞' : total}</span>
      <span class="q-cat">${esc(q.c)}</span>
      <span class="q-streak ${session.streak >= 3 ? 'hot' : ''}">${session.streak >= 2 ? I('flame') + ' ' + session.streak : ''}</span>
    </div>
    <div class="bar"><div class="bar-fill" style="width:${prog}%"></div></div>
    ${S.settings.timer ? `<div class="timer"><div class="timer-fill" id="timerFill"></div></div>` : ''}
    <div class="card q-card">
      <div class="q-diff d-${q.d}">${q.d}</div>
      <p class="q-text">${esc(q.q).replace(/\n/g, '<br>')}</p>
    </div>
    <div class="options" id="opts">
      ${q.o.map((o, i) => `<button class="opt" data-i="${i}"><span class="opt-letter">${'ABCD'[i]}</span><span class="opt-text">${esc(o)}</span></button>`).join('')}
    </div>
    <div class="feedback" id="fb"></div>
  </section>`);
  app.querySelectorAll('.opt').forEach(b => b.addEventListener('click', () => answer(+b.dataset.i)));
  startTimer();
}
function startTimer() {
  stopTimer();
  if (!S.settings.timer) return;
  session.timeLeft = session.seconds;
  const fill = document.getElementById('timerFill');
  if (fill) {
    fill.style.transition = 'none';
    fill.style.width = '100%';
    requestAnimationFrame(() => {
      fill.style.transition = `width ${session.seconds}s linear`;
      fill.style.width = '0%';
    });
  }
  let last = session.seconds;
  session.timerId = setInterval(() => {
    session.timeLeft -= 0.25;
    if (session.timeLeft <= 5 && session.timeLeft > 4.75 && last > 5) sfx.tick();
    last = session.timeLeft;
    if (session.timeLeft <= 0) { stopTimer(); answer(-1); }
  }, 250);
}
function stopTimer() { if (session && session.timerId) { clearInterval(session.timerId); session.timerId = null; } }

function answer(i) {
  if (!session || session.locked) return;
  session.locked = true;
  stopTimer();
  const q = session.questions[session.idx];
  const correct = i === q.a;
  if (correct) { session.correct++; session.streak++; session.bestStreakInQuiz = Math.max(session.bestStreakInQuiz, session.streak); }
  else { session.streak = 0; if (session.mode === 'death' && session.strikes) session.strikesLeft = (session.strikesLeft == null ? session.strikes : session.strikesLeft) - 1; }
  const gain = xpGain(correct, session.streak);
  session.xpGained += gain;
  // persist stats
  S.answered++; if (correct) S.correct++;
  S.streak = correct ? session.streak : 0;
  S.bestStreak = Math.max(S.bestStreak, session.streak, S.bestStreak);
  const pc = S.perCat[q.c] || (S.perCat[q.c] = { a: 0, c: 0 });
  pc.a++; if (correct) pc.c++;
  if (!correct) S.wrongIds[q.id] = true;
  save();
  // feedback UI
  const opts = app.querySelectorAll('.opt');
  opts.forEach(b => {
    const idx = +b.dataset.i;
    b.classList.add('disabled');
    if (idx === q.a) b.classList.add('correct');
    else if (idx === i) b.classList.add('wrong');
    else b.classList.add('dim');
  });
  if (correct) { sfx.correct(); buzz(true); } else { sfx.wrong(); buzz(false); }
  const fb = document.getElementById('fb');
  fb.className = 'feedback show ' + (correct ? 'ok' : 'bad');
  fb.innerHTML = `
    <div class="fb-head">${correct ? I('check') + ' Correct! <b>+' + gain + ' XP</b>' : (i < 0 ? I('clock') + ' Time is up!' : I('x') + ' Not quite — the answer is “' + esc(q.o[q.a]) + '”')}</div>
    ${q.x ? `<p class="fb-x">${esc(q.x)}</p>` : ''}
    <div class="fb-actions">
      ${q.v ? `<button class="btn ghost sm" id="fbVerse">${I('book')} Read ${esc(q.v)}</button>` : ''}
      <button class="btn ghost sm" id="fbSave">${S.saved[q.id] ? I('starFill') + ' Saved' : I('star') + ' Save for review'}</button>
      <button class="btn primary sm" id="fbNext">${session.idx + 1 >= session.questions.length ? 'See results ' + I('chevronRight') : 'Next ' + I('chevronRight')}</button>
    </div>`;
  const bv = document.getElementById('fbVerse');
  if (bv) bv.addEventListener('click', () => { sfx.click(); go('reader', { ref: q.v }); });
  document.getElementById('fbSave').addEventListener('click', () => {
    sfx.click();
    if (S.saved[q.id]) delete S.saved[q.id]; else S.saved[q.id] = true;
    save(); renderQuizFeedbackOnly(q);
  });
  document.getElementById('fbNext').addEventListener('click', () => { sfx.click(); nextQuestion(); });
}
function renderQuizFeedbackOnly(q) {
  const b = document.getElementById('fbSave');
  if (b) b.innerHTML = S.saved[q.id] ? I('starFill') + ' Saved' : I('star') + ' Save for review';
}
function nextQuestion() {
  if (!session) return;
  const mode = MODES[session.mode];
  const died = session.mode === 'death' && session.strikesLeft === 0;
  if (died || session.idx + 1 >= session.questions.length) { finishQuiz(); return; }
  session.idx++;
  session.locked = false;
  session.timeLeft = session.seconds;
  renderQuiz();
}
function finishQuiz() {
  stopTimer();
  const total = session.questions.length;
  const correct = session.correct;
  const mode = session.mode;
  // xp + level
  const before = levelForXp(S.xp);
  S.xp += session.xpGained;
  const after = levelForXp(S.xp);
  // daily bookkeeping
  const today = dateStr(new Date());
  if (mode === 'daily') {
    if (!S.lastDaily || S.lastDaily.date !== today) S.daysPlayed = (S.daysPlayed || 0) + 1;
    S.lastDaily = { date: today, score: correct, count: total };
  }
  const res = { count: total, correct };
  const unlocked = newAchievements(S, res);
  S.achievements.push(...unlocked.map(a => a.id));
  save();
  go('results', { mode, total, correct, xpGained: session.xpGained, leveledUp: after > before, newLevel: after, unlocked, questions: session.questions, answers: session.answers });
  if (unlocked.length) setTimeout(() => unlocked.forEach((a, i) => setTimeout(() => toast(I(a.icon) + ' Achievement: ' + esc(a.name), a.icon), 400 + i * 1400)), 600);
  if (after > before) sfx.fanfare();
  if (total >= 5 && correct / total >= 0.7) confetti();
  session = null;
}

/* ------------------------------ results --------------------------------- */
function renderResults() {
  const r = screen;
  const pct = r.total ? Math.round(100 * r.correct / r.total) : 0;
  const acc = S.answered ? Math.round(100 * S.correct / S.answered) : 0;
  const grade = pct >= 90 ? 'trophy' : pct >= 70 ? 'sparkles' : pct >= 50 ? 'smile' : 'trending';
  h(`
  <section class="screen">
    <div class="card results">
      <div class="r-icon">${I(grade, 'grade-ico')}</div>
      <h2 class="r-title">${r.correct} / ${r.total}</h2>
      <div class="r-pct">${pct}% correct</div>
      ${r.leveledUp ? `<div class="levelup">${I('sparkles')} Level up! You are now level ${r.newLevel}</div>` : ''}
      <div class="r-grid">
        <div><b>+${r.xpGained}</b><span>XP earned</span></div>
        <div><b>${acc}%</b><span>all-time accuracy</span></div>
        <div><b>${I('flame')} ${S.bestStreak}</b><span>best streak</span></div>
      </div>
      ${r.unlocked && r.unlocked.length ? `<div class="r-ach">${r.unlocked.map(a => `<span class="ach-badge" title="${esc(a.desc)}">${I(a.icon)} ${esc(a.name)}</span>`).join('')}</div>` : ''}
      <div class="r-actions">
        <button class="btn primary" id="again">${I('refresh')} Play again</button>
        <button class="btn ghost" data-nav="home">Home</button>
      </div>
    </div>
    <h3 class="group-label">Review</h3>
    <div class="review-list">
      ${r.questions.map((q, i) => `
        <div class="review-item">
          <div class="rv-q">${esc(q.q.length > 90 ? q.q.slice(0, 90) + '…' : q.q)}</div>
          <div class="rv-a">Answer: <b>${esc(q.o[q.a])}</b>${q.v ? ` · <button class="link" data-ref="${esc(q.v)}">${esc(q.v)}</button>` : ''}</div>
        </div>`).join('')}
    </div>
  </section>${navBar('home')}`);
  bindNav();
  document.getElementById('again').addEventListener('click', () => { sfx.click(); startQuiz(); });
  app.querySelectorAll('[data-ref]').forEach(b => b.addEventListener('click', () => go('reader', { ref: b.dataset.ref })));
}

/* ------------------------------ stats ----------------------------------- */
function renderStats() {
  const acc = S.answered ? Math.round(100 * S.correct / S.answered) : 0;
  const lvl = levelForXp(S.xp);
  const nextLvlXp = xpForLevel(lvl + 1);
  const xpInto = S.xp - xpForLevel(lvl);
  const span = nextLvlXp - xpForLevel(lvl);
  h(`
  <section class="screen">
    <h2 class="screen-title">${I('chart')} Your progress</h2>
    <div class="card level-card">
      <div class="lv-num">${lvl}</div>
      <div class="lv-body">
        <div class="lv-bar"><div style="width:${clamp(100 * xpInto / span, 0, 100)}%"></div></div>
        <div class="lv-xp">${S.xp.toLocaleString()} XP · next level at ${nextLvlXp.toLocaleString()}</div>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat"><b>${S.answered.toLocaleString()}</b><span>answered</span></div>
      <div class="stat"><b>${S.correct.toLocaleString()}</b><span>correct</span></div>
      <div class="stat"><b>${acc}%</b><span>accuracy</span></div>
      <div class="stat"><b>${I('flame')} ${S.bestStreak}</b><span>best streak</span></div>
      <div class="stat"><b>${Object.keys(S.saved).length}</b><span>saved</span></div>
      <div class="stat"><b>${Object.keys(S.versesRead).length}</b><span>verses read</span></div>
    </div>
    <h3 class="group-label">Accuracy by category</h3>
    <div class="cat-bars">
      ${Object.entries(S.perCat).sort((a, b) => b[1].a - a[1].a).map(([c, v]) => {
        const p = v.a ? Math.round(100 * v.c / v.a) : 0;
        return `<div class="cat-row"><span class="cat-name">${esc(c)}</span>
          <span class="cat-bar"><i style="width:${p}%"></i></span>
          <span class="cat-pct">${p}% <em>(${v.c}/${v.a})</em></span></div>`;
      }).join('') || '<p class="hint">Nothing yet — play a quiz!</p>'}
    </div>
    <h3 class="group-label">Achievements</h3>
    <div class="ach-grid">
      ${ACHIEVEMENTS.map(a => {
        const got = S.achievements.includes(a.id);
        return `<div class="ach ${got ? 'got' : ''}"><span>${I(a.icon, 'ach-ico')}</span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div>`;
      }).join('')}
    </div>
  </section>${navBar('stats')}`);
  bindNav();
}

/* ------------------------------ saved / review --------------------------- */
function renderSaved() {
  const savedIds = Object.keys(S.saved);
  const wrongIds = Object.keys(S.wrongIds).filter(id => !S.saved[id]);
  const savedQs = BANK.filter(q => S.saved[q.id]);
  const wrongQs = BANK.filter(q => S.wrongIds[q.id] && !S.saved[q.id]);
  h(`
  <section class="screen">
    <h2 class="screen-title">${I('star')} Saved &amp; missed</h2>
    <div class="r-actions" style="margin:10px 0 18px">
      <button class="btn primary" id="revSaved" ${savedIds.length ? '' : 'disabled'}>Review saved (${savedIds.length})</button>
      <button class="btn ghost" id="revWrong" ${wrongIds.length ? '' : 'disabled'}>Review missed (${wrongIds.length})</button>
    </div>
    <div class="review-list">
      ${[...savedQs, ...wrongQs].map(q => `
        <div class="review-item" data-id="${q.id}">
          <div class="rv-q">${esc(q.q.length > 110 ? q.q.slice(0, 110) + '…' : q.q)}</div>
          <div class="rv-a"><span class="chip mini">${esc(q.c)}</span> answer: <b>${esc(q.o[q.a])}</b>
            ${q.v ? ` · <button class="link" data-ref="${esc(q.v)}">${esc(q.v)}</button>` : ''}
            <button class="link star" data-unsave="${q.id}">${S.saved[q.id] ? I('starFill') : I('x') + ' remove'}</button>
          </div>
        </div>`).join('') || '<p class="hint">Star questions during a quiz (' + I('star') + ' Save for review) to build your list.</p>'}
    </div>
  </section>${navBar('saved')}`);
  bindNav();
  const rs = document.getElementById('revSaved'); if (rs) rs.addEventListener('click', () => { sfx.click(); startQuiz(savedIds); });
  const rw = document.getElementById('revWrong'); if (rw) rw.addEventListener('click', () => { sfx.click(); startQuiz(wrongIds); });
  app.querySelectorAll('[data-ref]').forEach(b => b.addEventListener('click', () => go('reader', { ref: b.dataset.ref })));
  app.querySelectorAll('[data-unsave]').forEach(b => b.addEventListener('click', () => {
    sfx.click(); delete S.saved[b.dataset.unsave]; delete S.wrongIds[b.dataset.unsave]; save(); renderSaved();
  }));
}

/* ------------------------------ search ---------------------------------- */
let searchTab = 'questions';
async function renderSearch() {
  h(`
  <section class="screen">
    <h2 class="screen-title">${I('search')} Search</h2>
    <div class="seg">
      <button class="seg-btn ${searchTab === 'questions' ? 'sel' : ''}" data-tab="questions">Questions</button>
      <button class="seg-btn ${searchTab === 'bible' ? 'sel' : ''}" data-tab="bible">Bible (KJV)</button>
    </div>
    <input id="searchInput" class="search-input" type="search" placeholder="${searchTab === 'bible' ? 'Search the King James Bible…' : 'Search questions, answers, references…'}" value="${esc(screen.query || '')}">
    <div id="searchResults" class="review-list"></div>
  </section>${navBar('search')}`);
  bindNav();
  app.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { sfx.click(); searchTab = b.dataset.tab; screen.query = ''; renderSearch(); }));
  const input = document.getElementById('searchInput');
  input.focus();
  let bibleData = null;
  input.addEventListener('input', async () => {
    const q = input.value.trim();
    screen.query = q;
    const box = document.getElementById('searchResults');
    if (!q) { box.innerHTML = '<p class="hint">Type to search.</p>'; return; }
    if (searchTab === 'questions') {
      const res = searchBank(q).slice(0, 60);
      box.innerHTML = `<p class="hint">${res.length} question${res.length === 1 ? '' : 's'} found` +
        (res.length ? ` · <button class="btn primary sm" id="practice">${I('play')} Practice these</button>` : '') + `</p>` +
        res.map(x => `<div class="review-item"><div class="rv-q">${esc(x.q.length > 110 ? x.q.slice(0, 110) + '…' : x.q)}</div>
          <div class="rv-a"><span class="chip mini">${esc(x.c)}</span> <b>${esc(x.o[x.a])}</b>${x.v ? ` · <button class="link" data-ref="${esc(x.v)}">${esc(x.v)}</button>` : ''}</div></div>`).join('');
      const p = document.getElementById('practice');
      if (p) p.addEventListener('click', () => { sfx.click(); screen.category = 'All'; screen.difficulty = 'any'; screen.mode = 'sprint'; startQuiz(res.map(x => x.id)); });
      box.querySelectorAll('[data-ref]').forEach(b => b.addEventListener('click', () => go('reader', { ref: b.dataset.ref })));
    } else {
      if (!bibleData) { box.innerHTML = '<p class="hint">Loading the KJV…</p>'; bibleData = await loadTranslation('kjv'); }
      const ql = q.toLowerCase();
      const res = bibleData.filter(v => v.verse.toLowerCase().includes(ql)).slice(0, 50);
      box.innerHTML = `<p class="hint">${bibleData.length.toLocaleString()} verses loaded · ${res.length} match${res.length === 1 ? '' : 'es'}</p>` +
        res.map(v => `<div class="review-item" data-ref="${esc(v.name)}"><div class="rv-q">“${esc(v.verse.length > 140 ? v.verse.slice(0, 140) + '…' : v.verse)}”</div>
          <div class="rv-a"><button class="link">${esc(v.name)} ${I('chevronRight')}</button></div></div>`).join('');
      box.querySelectorAll('[data-ref]').forEach(b => b.addEventListener('click', () => go('reader', { ref: b.dataset.ref })));
    }
  });
  if (screen.query) input.dispatchEvent(new Event('input'));
}

/* ------------------------------ reader ---------------------------------- */
async function renderReader() {
  const ref = screen.ref || (BOOKS[0] && BOOKS[0].first) || 'Genesis 1:1';
  const p = parseRef(ref);
  const man = await loadManifest();
  h(`
  <section class="screen">
    <button class="back" data-nav="home">${I('chevronLeft')} Back</button>
    <div class="card reader">
      <div class="reader-head">
        <input id="refInput" class="ref-input" value="${esc(ref)}" placeholder="e.g. John 3:16">
        <select id="transSel" class="trans-sel">
          ${man.translations.map(t => `<option value="${esc(t.id)}" ${t.id === S.settings.translation ? 'selected' : ''}>${esc(t.short)}</option>`).join('')}
        </select>
      </div>
      <div id="readerBody" class="reader-body"><p class="hint">Loading…</p></div>
      <div class="reader-nav">
        <button class="btn ghost sm" id="prevCh">‹ Prev chapter</button>
        <button class="btn ghost sm" id="chaptersBtn">Chapters</button>
        <button class="btn ghost sm" id="nextCh">Next chapter ›</button>
      </div>
      <div id="chapterPicker" class="chapter-picker hidden"></div>
    </div>
  </section>${navBar('home')}`);
  bindNav();
  const body = document.getElementById('readerBody');
  async function show(ref2) {
    const pp = parseRef(ref2);
    if (!pp) { body.innerHTML = '<p class="hint">Could not parse that reference.</p>'; return; }
    body.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const data = await loadTranslation(S.settings.translation);
      S.versesRead[ref2] = true; save();
      const v = verseByName(data, ref2);
      const chVerses = chapterVerses(data, pp.book, pp.ch).filter(x => true);
      const bi = bookIndex(pp.book);
      const book = BOOKS.find(b => b.i === bi);
      body.innerHTML = `
        <div class="verse-hero">
          <div class="verse-ref">${esc(pp.book)} ${pp.ch}:${pp.v}</div>
          <p class="verse-text">${v ? '“' + esc(v.verse) + '”' : '<i>verse not found in this translation</i>'}</p>
          <div class="verse-meta">${esc(book ? book.name : pp.book)} · chapter ${pp.ch} · ${chVerses.length} verses · ${esc((man.translations.find(t => t.id === S.settings.translation) || {}).label || S.settings.translation)}</div>
        </div>
        <h3 class="group-label">Chapter ${pp.ch}</h3>
        <div class="chapter-list">
          ${chVerses.map(x => `<p class="ch-v ${x.name === ref2 ? 'cur' : ''}" data-ref="${esc(x.name)}"><sup>${x.ari.split(':')[2]}</sup> ${esc(x.verse)}</p>`).join('')}
        </div>`;
      body.querySelectorAll('.ch-v').forEach(el => el.addEventListener('click', () => { sfx.click(); show(el.dataset.ref); }));
    } catch (e) {
      body.innerHTML = '<p class="hint">Failed to load: ' + esc(e.message) + '</p>';
    }
  }
  await show(ref);
  document.getElementById('refInput').addEventListener('change', e => { sfx.click(); go('reader', { ref: e.target.value.trim() }); });
  document.getElementById('transSel').addEventListener('change', e => {
    S.settings.translation = e.target.value; save(); sfx.click();
    go('reader', { ref: document.getElementById('refInput').value.trim() || ref });
  });
  document.getElementById('prevCh').addEventListener('click', () => {
    const pp = parseRef(document.getElementById('refInput').value);
    if (pp && pp.ch > 1) { sfx.click(); show(`${pp.book} ${pp.ch - 1}:1`); }
  });
  document.getElementById('nextCh').addEventListener('click', () => {
    const pp = parseRef(document.getElementById('refInput').value);
    const book = BOOKS.find(b => b.name === pp.book);
    if (pp && book && pp.ch < book.chapters) { sfx.click(); show(`${pp.book} ${pp.ch + 1}:1`); }
  });
  document.getElementById('chaptersBtn').addEventListener('click', () => {
    const pp = parseRef(document.getElementById('refInput').value);
    const book = BOOKS.find(b => b.name === pp.book);
    const cp = document.getElementById('chapterPicker');
    if (!book) return;
    cp.classList.toggle('hidden');
    if (!cp.classList.contains('hidden')) {
      cp.innerHTML = Array.from({ length: book.chapters }, (_, i) =>
        `<button class="chip-btn ${i + 1 === pp.ch ? 'sel' : ''}" data-ch="${i + 1}">${i + 1}</button>`).join('');
      cp.querySelectorAll('[data-ch]').forEach(b => b.addEventListener('click', () => { sfx.click(); show(`${book.name} ${b.dataset.ch}:1`); }));
    }
  });
}

/* ------------------------------ settings --------------------------------- */
function renderSettings() {
  const st = S.settings;
  h(`
  <section class="screen">
    <h2 class="screen-title">${I('gear')} Settings</h2>
    <div class="card set-list">
      <label class="set-row">${I('volume')} Sound effects <input type="checkbox" id="sSound" ${st.sound ? 'checked' : ''}></label>
      <label class="set-row">${I('clock')} Question timer <input type="checkbox" id="sTimer" ${st.timer ? 'checked' : ''}></label>
      <label class="set-row">${I('moon')} Midnight theme <input type="checkbox" id="sTheme" ${st.theme === 'midnight' ? 'checked' : ''}></label>
      <div class="set-row">${I('book')} Default translation
        <select id="sTrans" class="trans-sel"></select></div>
      <div class="set-row about"><span>${I('book')} Bible Quiz v${APP_VERSION}</span><b>by ${APP_AUTHOR}</b></div>
      <button class="btn danger" id="reset">${I('trash')} Reset all progress</button>
    </div>
  </section>${navBar('settings')}`);
  bindNav();
  document.getElementById('sSound').addEventListener('change', e => { S.settings.sound = e.target.checked; save(); });
  document.getElementById('sTimer').addEventListener('change', e => { S.settings.timer = e.target.checked; save(); });
  document.getElementById('sTheme').addEventListener('change', e => {
    S.settings.theme = e.target.checked ? 'midnight' : 'parchment'; save();
    document.documentElement.dataset.theme = S.settings.theme;
  });
  const sel = document.getElementById('sTrans');
  loadManifest().then(man => {
    sel.innerHTML = man.translations.map(t => `<option value="${esc(t.id)}" ${t.id === st.translation ? 'selected' : ''}>${esc(t.label)}</option>`).join('');
  });
  sel.addEventListener('change', e => { S.settings.translation = e.target.value; save(); toast('Translation set to ' + e.target.selectedOptions[0].text, 'book'); });
  document.getElementById('reset').addEventListener('click', () => {
    if (confirm('Reset all XP, stats, saved questions and achievements?')) {
      S = defaultState(); save(); toast('Progress reset', 'trash'); renderSettings();
    }
  });
}

/* ------------------------------ router ---------------------------------- */
window.addEventListener('error', function (e) {
  try {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:999;background:#7f1d1d;color:#fff;padding:10px 12px;border-radius:8px;font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap;';
    d.textContent = 'Error: ' + (e.message || e.type) + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno;
    document.body.appendChild(d);
  } catch (ignore) {}
});
function render() {
  document.documentElement.dataset.theme = S.settings.theme;
  switch (screen.name) {
    case 'home': renderHome(); break;
    case 'setup': renderSetup(); break;
    case 'quiz': if (session) renderQuiz(); else go('home'); break;
    case 'results': renderResults(); break;
    case 'stats': renderStats(); break;
    case 'saved': renderSaved(); break;
    case 'search': renderSearch(); break;
    case 'reader': renderReader(); break;
    case 'settings': renderSettings(); break;
    default: renderHome();
  }
}
try {
  render();
} catch (e) {
  app.innerHTML = '<div class="card" style="margin:40px 16px"><h2 class="screen-title">Could not start</h2>' +
    '<pre style="white-space:pre-wrap;font-size:12px;color:var(--muted)">' + esc(String((e && e.stack) || e)) + '</pre></div>';
}

})();
