/* ============================================================================
 * JS Mastery — offline interactive JavaScript course (beginner -> advanced).
 * 50 topics, 5,250 runnable practice problems, per-topic quizzes, a final
 * exam and a printable certificate. User code runs in a sandboxed iframe
 * (sandbox="allow-scripts") with a 3s time limit. Progress is cached in the
 * WebView's local SQLite database (WebSQL, localStorage fallback).
 * Icons are inline SVG only (icons.js) — no emoji.
 * ==========================================================================*/
(function () {
  'use strict';

  var APP_VERSION = '1.0';
  var APP_AUTHOR = 'Emmanuel Suah';

  /* ------------------------------ dom helpers ---------------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var app = document.getElementById('app');
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function toast(msg, icon) {
    toastEl.innerHTML = (icon ? '<span class="t-ico">' + I(icon) + '</span>' : '') + '<span>' + esc(msg) + '</span>';
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }
  toastEl.addEventListener('click', function () { clearTimeout(toastTimer); toastEl.classList.remove('show'); });
  function dismissSplash() {
    var sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('done')) return;
    sp.classList.add('done');
    setTimeout(function () { sp.remove(); }, 700);
  }
  function h(html) { app.innerHTML = html; dismissSplash(); window.scrollTo(0, 0); }
  window.addEventListener('error', function (e) {
    try {
      $all('.errbox').forEach(function (x) { x.remove(); });
      var d = document.createElement('div');
      d.className = 'errbox';
      d.innerHTML = '<b>Error</b> <span class="err-msg"></span><button class="err-x">&times;</button>';
      d.querySelector('.err-msg').textContent = (e.message || e.type) + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno;
      d.querySelector('.err-x').addEventListener('click', function () { d.remove(); });
      d.addEventListener('click', function (ev) { if (ev.target === d) d.remove(); });
      document.body.appendChild(d);
      setTimeout(function () { d.remove(); }, 12000);
    } catch (ignore) {}
  });

  /* --------------------------- local SQLite ------------------------------ */
  var sqlDB = null, useFallback = false;
  function dbOpen() {
    return new Promise(function (resolve) {
      if (sqlDB || useFallback) return resolve();
      try {
        if (typeof window.openDatabase === 'function') {
          sqlDB = window.openDatabase('jsmaster', '1.0', 'JS Mastery progress', 2 * 1024 * 1024);
          sqlDB.transaction(function (tx) {
            tx.executeSql('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
          }, function () { useFallback = true; sqlDB = null; resolve(); }, function () { resolve(); });
        } else { useFallback = true; resolve(); }
      } catch (e) { useFallback = true; sqlDB = null; resolve(); }
    });
  }
  function kvGet(k) {
    return dbOpen().then(function () {
      if (useFallback) { try { return JSON.parse(localStorage.getItem('jsm_' + k) || 'null'); } catch (e) { return null; } }
      return new Promise(function (res) {
        sqlDB.transaction(function (tx) {
          tx.executeSql('SELECT v FROM kv WHERE k = ?', [k], function (t, rs) {
            res(rs.rows.length ? JSON.parse(rs.rows.item(0).v) : null);
          });
        }, function () { try { res(JSON.parse(localStorage.getItem('jsm_' + k) || 'null')); } catch (e) { res(null); } });
      });
    });
  }
  function kvSet(k, v) {
    return dbOpen().then(function () {
      var s = JSON.stringify(v);
      try { localStorage.setItem('jsm_' + k, s); } catch (e) {}
      if (useFallback) return;
      return new Promise(function (res) {
        sqlDB.transaction(function (tx) { tx.executeSql('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', [k, s]); },
          function () {}, function () { res(); });
      });
    });
  }

  /* ------------------------------ state ---------------------------------- */
  function defaultState() {
    return { solved: {}, quiz: {}, exam: null, name: '', theme: 'day' };
  }
  var S = defaultState();

  /* ------------------------------ course data ---------------------------- */
  var COURSE = null; // topics.json
  var practiceCache = {}; // topicId -> [practices]
  function loadCourse() {
    return fetch('/data/topics.json').then(function (r) { return r.json(); }).then(function (j) { COURSE = j; });
  }
  function loadPractices(topicId) {
    if (practiceCache[topicId]) return Promise.resolve(practiceCache[topicId]);
    return fetch('/data/p/' + topicId + '.json').then(function (r) { return r.json(); }).then(function (j) {
      practiceCache[topicId] = j; return j;
    });
  }
  function topicById(id) { return COURSE.topics.find(function (t) { return t.id === id; }); }
  function solvedCount(topicId) {
    var n = 0;
    for (var k in S.solved) if (k.indexOf(topicId + '-p') === 0) n++;
    return n;
  }
  function topicDone(t) { return solvedCount(t.id) >= Math.ceil(t.practices * 0.8) && (S.quiz[t.id] || 0) >= 5; }
  function topicUnlocked(t) {
    if (t.n === 1) return true;
    var prev = COURSE.topics[t.n - 2];
    return topicDone(prev);
  }
  function allDone() { return COURSE.topics.every(topicDone); }
  function totalSolved() { return Object.keys(S.solved).length; }

  /* ------------------------------ router --------------------------------- */
  var screen = { name: 'home' };
  var navStack = [screen];
  function go(name, params) {
    screen = Object.assign({ name: name }, params || {});
    navStack.push(screen);
    if (navStack.length > 40) navStack.shift();
    render(); window.scrollTo(0, 0);
  }
  function goTab(name) {
    screen = { name: name };
    navStack.length = 0; navStack.push(screen);
    render(); window.scrollTo(0, 0);
  }
  window.__back = function () {
    if (navStack.length > 1) {
      navStack.pop();
      screen = navStack[navStack.length - 1];
      render(); window.scrollTo(0, 0);
      return true;
    }
    return false;
  };
  function render() {
    document.documentElement.dataset.theme = S.theme;
    switch (screen.name) {
      case 'home': renderHome(); break;
      case 'topics': renderTopics(); break;
      case 'topic': renderTopic(); break;
      case 'practice': renderPractice(); break;
      case 'playground': renderPlayground(); break;
      case 'quiz': renderQuiz(); break;
      case 'quizResult': renderQuizResult(); break;
      case 'exam': renderExam(); break;
      case 'certificate': renderCertificate(); break;
      default: renderHome();
    }
  }

  function topBar() {
    return '<header class="topbar"><span class="brand">' + I('code', 'brand-ico') + '<b>JS Mastery</b></span>' +
      '<button class="icon-btn" id="themeBtn" title="Switch theme">' + I(S.theme === 'day' ? 'moon' : 'sun') + '</button></header>';
  }
  function navBar(active) {
    var items = [['home', 'home', 'Home'], ['topics', 'list', 'Topics'], ['playground', 'play', 'Playground'], ['certificate', 'award', 'Certificate']];
    return '<nav class="navbar">' + items.map(function (it) {
      return '<button class="nav-btn' + (active === it[0] ? ' active' : '') + '" data-nav="' + it[0] + '">' + I(it[1]) + '<span>' + it[2] + '</span></button>';
    }).join('') + '</nav>';
  }
  function bindNav() {
    $all('[data-nav]').forEach(function (b) { b.addEventListener('click', function () { goTab(b.dataset.nav); }); });
    $all('[data-back]').forEach(function (b) { b.addEventListener('click', function () { window.__back(); }); });
    var tb = document.getElementById('themeBtn');
    if (tb) tb.addEventListener('click', function () {
      S.theme = S.theme === 'day' ? 'night' : 'day';
      kvSet('state', S); render();
    });
  }

  /* --------------------------- code runner ------------------------------- */
  /* Runs user code in a sandboxed iframe; if `test` is given, it is eval'd
   * after the user code in the same scope and must be truthy (or a promise
   * resolving truthy) to pass. Console output is captured into logs. */
  function runUserCode(code, test, timeoutMs) {
    return new Promise(function (resolve) {
      var ifr = document.createElement('iframe');
      ifr.sandbox = 'allow-scripts';
      ifr.style.cssText = 'display:none';
      document.body.appendChild(ifr);
      var id = 'run' + Math.random().toString(36).slice(2);
      var done = false;
      var timer = setTimeout(function () {
        finish({ ok: false, logs: [], error: 'Time limit (3s) exceeded — infinite loop?' });
      }, timeoutMs || 3000);
      function finish(res) {
        if (done) return; done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onmsg);
        setTimeout(function () { ifr.remove(); }, 50);
        resolve(res);
      }
      function onmsg(e) {
        if (e.source === ifr.contentWindow && e.data && e.data.id === id) finish(e.data.res);
      }
      window.addEventListener('message', onmsg);
      var safe = String(code).replace(/<\/script/gi, '<\\/script');
      var testJs = test ? JSON.stringify(test) : 'null';
      ifr.srcdoc = '<!DOCTYPE html><html><body><div id="out"></div><script>' +
        'var __logs = [];' +
        'function __cap(){ __logs.push(Array.prototype.map.call(arguments, function(x){ return typeof x === "string" ? x : JSON.stringify(x); }).join(" ")); }' +
        'console.log = __cap; console.warn = __cap; console.error = __cap; console.info = __cap;' +
        'function __finish(ok, error){ parent.postMessage({ id: ' + JSON.stringify(id) + ', res: { ok: !!ok, logs: __logs, error: error || null } }, "*"); }' +
        'window.onerror = function(m){ __finish(false, String(m)); };' +
        'try {' + safe + '\n' +
        (test ? 'var __r = eval(' + testJs + ');' : '') +
        (test
          ? 'if (__r && typeof __r.then === "function") { __r.then(function(v){ __finish(v); }, function(e){ __finish(false, String(e)); }); } else { __finish(__r); }'
          : '__finish(true);') +
        '} catch (e) { __finish(false, String((e && e.message) || e)); }' +
        '<\\/script></body></html>';
    });
  }

  /* ------------------------------ home ----------------------------------- */
  function renderHome() {
    var done = COURSE.topics.filter(topicDone).length;
    var next = COURSE.topics.find(function (t) { return !topicDone(t); }) || COURSE.topics[COURSE.topics.length - 1];
    var quizScores = Object.keys(S.quiz).map(function (k) { return S.quiz[k]; });
    var avg = quizScores.length ? Math.round(quizScores.reduce(function (a, b) { return a + b; }, 0) / quizScores.length * 100 / 8) : 0;
    h(topBar() + `
  <section class="screen home">
    <figure class="hero-fig">
      <div class="hf-frame"><img src="/img/hero.jpg" alt="Developer desk with code on a laptop"></div>
      <figcaption><svg viewBox="0 0 8 8" class="dia"><path d="M4 0l4 4-4 4-4-4z"/></svg> JavaScript, from zero to hero <svg viewBox="0 0 8 8" class="dia"><path d="M4 0l4 4-4 4-4-4z"/></svg></figcaption>
    </figure>
    <h1 class="hero-title">JS Mastery</h1>
    <p class="hero-sub">A full interactive JavaScript course — <b>${COURSE.count} topics</b>, <b>${COURSE.totalPractices.toLocaleString()} runnable practice problems</b>, quizzes, a final exam and a printable certificate. Works <b>100% offline</b>.</p>
    <button class="btn big" id="continueBtn">${I('play')} Continue — Topic ${next.n}: ${esc(next.title)}</button>
    <div class="stat-strip">
      <span class="chip">${I('book')} ${done}/${COURSE.count} topics</span>
      <span class="chip">${I('target')} ${totalSolved().toLocaleString()}/${COURSE.totalPractices.toLocaleString()} practices</span>
      <span class="chip">${I('trophy')} quiz avg ${avg}%</span>
      <span class="chip">${I('award')} ${S.exam ? 'exam ' + S.exam + '%' : 'exam locked'}</span>
    </div>
    <div class="card">
      <h3 class="group-label" style="margin-top:0">How it works</h3>
      <ol class="how-list">
        <li>${I('list')} Study each topic's lesson and example.</li>
        <li>${I('code')} Solve its practice problems in the built-in editor — your code runs for real.</li>
        <li>${I('check')} Pass the topic quiz (5/8) to unlock the next topic.</li>
        <li>${I('award')} Finish all ${COURSE.count} topics, pass the final exam (70%+), print your certificate.</li>
      </ol>
    </div>
    <footer class="credit">by ${APP_AUTHOR} &middot; v${APP_VERSION} &middot; offline course engine</footer>
  </section>${navBar('home')}`);
    bindNav();
    document.getElementById('continueBtn').addEventListener('click', function () { go('topic', { id: next.id }); });
  }

  /* ----------------------------- topics ---------------------------------- */
  function renderTopics() {
    var groups = ['Beginner', 'Intermediate', 'Advanced'];
    h(topBar() + `
  <section class="screen">
    <h1 class="screen-title">${COURSE.count} topics</h1>
    <p class="screen-sub">Finish a topic (80% of its practices + quiz 5/8) to unlock the next. ${COURSE.totalPractices.toLocaleString()} practices in total.</p>
    ${groups.map(function (lv) {
      return `<h3 class="group-label">${lv}</h3><div class="card-list">` + COURSE.topics.filter(function (t) { return t.level === lv; }).map(function (t) {
        var unlocked = topicUnlocked(t), done = topicDone(t), sc = solvedCount(t.id);
        return `<button class="card topic-row ${unlocked ? '' : 'locked'}" data-topic="${t.id}" ${unlocked ? '' : 'disabled'}>
          <span class="topic-num">${t.n}</span>
          <span class="biz-main"><b class="biz-name">${esc(t.title)}</b>
          <span class="biz-meta">${sc}/${t.practices} practices${S.quiz[t.id] != null ? ' · quiz ' + S.quiz[t.id] + '/8' : ''}</span></span>
          ${done ? '<span class="topic-state ok">' + I('check') + '</span>' : unlocked ? '<span class="topic-state">' + I('chevR') + '</span>' : '<span class="topic-state">' + I('lock') + '</span>'}
        </button>`;
      }).join('') + '</div>';
    }).join('')}
    ${allDone() ? `<div class="card note-card">${I('trophy')}<p>All topics complete! Take the <a class="link" data-nav="exam">final exam</a> to unlock your certificate.</p></div>` : ''}
  </section>${navBar('topics')}`);
    bindNav();
    $all('[data-topic]').forEach(function (b) {
      b.addEventListener('click', function () { go('topic', { id: b.dataset.topic }); });
    });
  }

  /* ------------------------------ topic ---------------------------------- */
  function renderTopic() {
    var t = topicById(screen.id);
    if (!t) { goTab('topics'); return; }
    if (!topicUnlocked(t)) { toast('Finish the previous topic to unlock this one', 'lock'); goTab('topics'); return; }
    var sc = solvedCount(t.id), quiz = S.quiz[t.id];
    h(topBar() + `
  <section class="screen">
    <button class="back" data-back>${I('chevL')} Topics</button>
    <div class="card lesson">${t.lesson}</div>
    <div class="row-between">
      <h3 class="group-label">Progress</h3>
      <span class="count">${sc}/${t.practices} solved${quiz != null ? ' · quiz ' + quiz + '/8' : ''}</span>
    </div>
    <div class="lv-bar"><div style="width:${Math.round(100 * sc / t.practices)}%"></div></div>
    <div class="r-actions">
      <button class="btn" id="goPractices">${I('code')} Practices (${t.practices})</button>
      <button class="btn ghost" id="goQuiz">${I('target')} Quiz (8)</button>
    </div>
    <div id="practiceList" class="card-list"></div>
  </section>${navBar('topics')}`);
    bindNav();
    document.getElementById('goPractices').addEventListener('click', function () {
      loadPractices(t.id).then(function (list) {
        $('#practiceList').innerHTML = list.map(function (p, idx) {
          var done = !!S.solved[p.id];
          return `<button class="card prac-row ${done ? 'done' : ''}" data-prac="${idx}">
            <span class="prac-state">${done ? I('check') : I('code')}</span>
            <span class="biz-main"><b class="biz-name">Practice ${idx + 1}</b>
            <span class="biz-meta">${esc(p.prompt.length > 90 ? p.prompt.slice(0, 90) + '…' : p.prompt)}</span></span>
          </button>`;
        }).join('');
        $all('[data-prac]').forEach(function (b) {
          b.addEventListener('click', function () { go('practice', { id: t.id, idx: +b.dataset.prac }); });
        });
      });
    });
    document.getElementById('goQuiz').addEventListener('click', function () { go('quiz', { id: t.id }); });
    // auto-load practice list
    document.getElementById('goPractices').click();
  }

  /* ----------------------------- practice -------------------------------- */
  function renderPractice() {
    var t = topicById(screen.id);
    loadPractices(screen.id).then(function (list) {
      var idx = screen.idx || 0;
      var p = list[idx];
      h(topBar() + `
  <section class="screen">
    <button class="back" data-back>${I('chevL')} ${esc(t.title)}</button>
    <div class="card">
      <div class="row-between"><b>Practice ${idx + 1}/${list.length}</b>
      <span class="count">${S.solved[p.id] ? I('check') + ' solved' : 'not solved yet'}</span></div>
      <p class="prac-prompt">${esc(p.prompt)}</p>
      <textarea id="editor" class="editor" spellcheck="false">${esc(p.starter)}</textarea>
      <div class="r-actions">
        <button class="btn" id="runBtn">${I('play')} Run &amp; test</button>
        <button class="btn ghost sm" id="hintBtn">${I('bulb')} Hint</button>
        <button class="btn ghost sm" id="solBtn">${I('eye')} Solution</button>
      </div>
      <div id="hintBox" class="hint-box hidden"></div>
      <div id="outBox" class="out-box hidden"></div>
    </div>
    <div class="r-actions">
      <button class="btn ghost sm" id="prevP" ${idx === 0 ? 'disabled' : ''}>${I('chevL')} Prev</button>
      <button class="btn ghost sm" id="nextP" ${idx >= list.length - 1 ? 'disabled' : ''}>Next ${I('chevR')}</button>
    </div>
  </section>${navBar('topics')}`);
      bindNav();
      var editor = document.getElementById('editor');
      document.getElementById('runBtn').addEventListener('click', function () {
        var out = document.getElementById('outBox');
        out.classList.remove('hidden');
        out.innerHTML = '<p class="hint">Running…</p>';
        runUserCode(editor.value, p.test, 3000).then(function (res) {
          var pass = !!res.ok;
          out.className = 'out-box ' + (pass ? 'pass' : 'fail');
          out.innerHTML = (res.logs.length ? '<pre class="logs">' + esc(res.logs.join('\n')) + '</pre>' : '') +
            (res.error ? '<pre class="err">' + esc(res.error) + '</pre>' : '') +
            '<p class="verdict">' + (pass ? I('check') + ' Correct! Practice solved.' : I('x') + ' Not yet — see output above.') + '</p>';
          if (pass && !S.solved[p.id]) {
            S.solved[p.id] = true;
            kvSet('state', S);
            toast('Practice solved (' + solvedCount(t.id) + '/' + t.practices + ')', 'check');
          }
        });
      });
      document.getElementById('hintBtn').addEventListener('click', function () {
        var hb = document.getElementById('hintBox');
        hb.classList.toggle('hidden');
        hb.innerHTML = I('bulb') + ' <code>' + esc(p.hint) + '</code>';
      });
      document.getElementById('solBtn').addEventListener('click', function () {
        editor.value = p.solution;
        toast('Solution loaded — press Run & test', 'eye');
      });
      document.getElementById('prevP').addEventListener('click', function () { if (idx > 0) go('practice', { id: screen.id, idx: idx - 1 }); });
      document.getElementById('nextP').addEventListener('click', function () { if (idx < list.length - 1) go('practice', { id: screen.id, idx: idx + 1 }); });
    });
  }

  /* ---------------------------- playground ------------------------------- */
  function renderPlayground() {
    h(topBar() + `
  <section class="screen">
    <h1 class="screen-title">${I('code')} Try it yourself</h1>
    <p class="screen-sub">Write any JavaScript and run it live — right here, offline. console.log output appears below.</p>
    <div class="card">
      <textarea id="editor" class="editor tall" spellcheck="false">// Try it yourself!
console.log("Hello, world!");

for (let i = 1; i <= 5; i++) {
  console.log(i, "squared is", i * i);
}</textarea>
      <div class="r-actions">
        <button class="btn" id="runBtn">${I('play')} Run</button>
        <button class="btn ghost sm" id="clearBtn">${I('refresh')} Clear output</button>
      </div>
      <div id="outBox" class="out-box"></div>
    </div>
  </section>${navBar('playground')}`);
    bindNav();
    var editor = document.getElementById('editor');
    var out = document.getElementById('outBox');
    document.getElementById('runBtn').addEventListener('click', function () {
      out.classList.remove('hidden');
      out.innerHTML = '<p class="hint">Running…</p>';
      runUserCode(editor.value, null, 3000).then(function (res) {
        out.className = 'out-box ' + (res.error ? 'fail' : 'pass');
        out.innerHTML = (res.logs.length ? '<pre class="logs">' + esc(res.logs.join('\n')) + '</pre>' : '<p class="hint">No output.</p>') +
          (res.error ? '<pre class="err">' + esc(res.error) + '</pre>' : '');
      });
    });
    document.getElementById('clearBtn').addEventListener('click', function () { out.classList.add('hidden'); out.innerHTML = ''; });
  }

  /* ------------------------------- quiz ---------------------------------- */
  function renderQuiz() {
    var t = topicById(screen.id);
    if (!t) { goTab('topics'); return; }
    var qs = t.quiz.map(function (q, qi) {
      var opts = [q[1]].concat(q[2]);
      for (var i = opts.length - 1; i > 0; i--) { var j = (qi * 7 + i * 3) % (i + 1); var tmp = opts[i]; opts[i] = opts[j]; opts[j] = tmp; }
      return { q: q[0], opts: opts, a: opts.indexOf(q[1]) };
    });
    h(topBar() + `
  <section class="screen">
    <button class="back" data-back>${I('chevL')} ${esc(t.title)}</button>
    <h1 class="screen-title">${I('target')} Topic quiz</h1>
    <p class="screen-sub">8 questions — you need 5 correct to pass and unlock the next topic. Best score: ${S.quiz[t.id] != null ? S.quiz[t.id] + '/8' : '—'}</p>
    <div id="quizBox"></div>
    <button class="btn big" id="submitQuiz">${I('check')} Submit quiz</button>
  </section>${navBar('topics')}`);
    bindNav();
    var box = document.getElementById('quizBox');
    box.innerHTML = qs.map(function (q, qi) {
      return `<div class="card quiz-q"><b>Q${qi + 1}. ${esc(q.q)}</b>
        ${q.opts.map(function (o, oi) {
          return `<label class="opt"><input type="radio" name="q${qi}" value="${oi}"> <span>${esc(o)}</span></label>`;
        }).join('')}</div>`;
    }).join('');
    document.getElementById('submitQuiz').addEventListener('click', function () {
      var score = 0, unanswered = 0;
      qs.forEach(function (q, qi) {
        var sel = box.querySelector('input[name="q' + qi + '"]:checked');
        if (!sel) { unanswered++; return; }
        if (+sel.value === q.a) score++;
      });
      if (unanswered) { toast('Answer all questions first (' + unanswered + ' left)', 'help'); return; }
      if (score > (S.quiz[t.id] || 0)) { S.quiz[t.id] = score; kvSet('state', S); }
      var pass = score >= 5;
      toast(pass ? 'Quiz passed: ' + score + '/8' : 'Quiz: ' + score + '/8 — need 5 to pass', pass ? 'trophy' : 'x');
      go('quizResult', { id: t.id, score: score, pass: pass });
    });
  }
  function renderQuizResult() {
    var t = topicById(screen.id);
    h(topBar() + `
  <section class="screen">
    <div class="card results">
      <span class="r-icon">${I(screen.pass ? 'trophy' : 'target')}</span>
      <h1 class="r-title">${screen.score}/8</h1>
      <p class="screen-sub">${screen.pass ? 'Passed! The next topic is unlocked.' : 'You need 5/8 — review the lesson and retry.'}</p>
      <div class="r-actions">
        <button class="btn" data-back>${I('chevL')} Back to topic</button>
        ${screen.pass ? '<button class="btn ghost" id="nextTopic">Next topic ' + I('chevR') + '</button>' : '<button class="btn ghost" id="retry">Retry quiz</button>'}
      </div>
    </div>
  </section>${navBar('topics')}`);
    bindNav();
    if (screen.pass) {
      document.getElementById('nextTopic').addEventListener('click', function () {
        var i = COURSE.topics.findIndex(function (x) { return x.id === t.id; });
        var nxt = COURSE.topics[i + 1];
        if (nxt) go('topic', { id: nxt.id }); else goTab('topics');
      });
    } else {
      document.getElementById('retry').addEventListener('click', function () { go('quiz', { id: t.id }); });
    }
  }

  /* ------------------------------- exam ---------------------------------- */
  function renderExam() {
    if (!allDone()) { toast('Complete all 50 topics first', 'lock'); goTab('topics'); return; }
    if (S.exam) { go('certificate'); return; }
    // 50 questions: one per topic, options shuffled deterministically
    var qs = [];
    COURSE.topics.forEach(function (t, ti) {
      var q = t.quiz[ti % t.quiz.length];
      var opts = [q[1]].concat(q[2]);
      for (var i = opts.length - 1; i > 0; i--) { var j = (ti * 5 + i * 11) % (i + 1); var tmp = opts[i]; opts[i] = opts[j]; opts[j] = tmp; }
      qs.push({ q: q[0], opts: opts, a: opts.indexOf(q[1]) });
    });
    h(topBar() + `
  <section class="screen">
    <button class="back" data-back>${I('chevL')} Home</button>
    <h1 class="screen-title">${I('award')} Final exam</h1>
    <p class="screen-sub">50 questions, one per topic. You need 70% (35/50) to earn the certificate.</p>
    <div id="quizBox"></div>
    <button class="btn big" id="submitQuiz">${I('check')} Submit exam</button>
  </section>${navBar('home')}`);
    bindNav();
    var box = document.getElementById('quizBox');
    box.innerHTML = qs.map(function (q, qi) {
      return `<div class="card quiz-q"><b>Q${qi + 1}. ${esc(q.q)}</b>
        ${q.opts.map(function (o, oi) { return `<label class="opt"><input type="radio" name="q${qi}" value="${oi}"> <span>${esc(o)}</span></label>`; }).join('')}</div>`;
    }).join('');
    document.getElementById('submitQuiz').addEventListener('click', function () {
      var score = 0, unanswered = 0;
      qs.forEach(function (q, qi) {
        var sel = box.querySelector('input[name="q' + qi + '"]:checked');
        if (!sel) { unanswered++; return; }
        if (+sel.value === q.a) score++;
      });
      if (unanswered) { toast('Answer all 50 questions first (' + unanswered + ' left)', 'help'); return; }
      var pct = Math.round(score / qs.length * 100);
      S.exam = pct; kvSet('state', S);
      if (pct >= 70) { toast('Exam passed: ' + pct + '% — certificate unlocked!', 'award'); go('certificate'); }
      else { toast('Exam: ' + pct + '% — need 70%. Retry anytime.', 'x'); goTab('home'); }
    });
  }

  /* ---------------------------- certificate ------------------------------ */
  function renderCertificate() {
    var done = COURSE.topics.filter(topicDone).length;
    var canPrint = !!(S.exam && S.exam >= 70);
    var dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    h(topBar() + `
  <section class="screen">
    <h1 class="screen-title">${I('award')} Certificate</h1>
    <p class="screen-sub">${canPrint ? 'Congratulations — print your certificate of completion.' : 'Pass the final exam (70%+) to unlock the printable certificate.'}</p>
    ${canPrint ? '' : `<div class="r-actions"><button class="btn" id="goExam">${I('award')} Take the final exam</button></div>`}
    <div id="certificate" class="certificate ${canPrint ? '' : 'locked-cert'}">
      <div class="cert-border">
        <div class="cert-head">
          ${I('code', 'cert-logo')}
          <div class="cert-brand">JS MASTERY</div>
          <div class="cert-sub">Certificate of Completion</div>
        </div>
        <p class="cert-line">This certifies that</p>
        <div class="cert-name">${esc(S.name || '_______________________')}</div>
        <p class="cert-line">has successfully completed the full interactive course</p>
        <div class="cert-course">JavaScript — from Absolute Beginner to Advanced</div>
        <p class="cert-line">covering ${COURSE.count} topics and ${COURSE.totalPractices.toLocaleString()} practice problems, with a final exam score of <b>${S.exam}%</b></p>
        <div class="cert-foot">
          <div><span class="cert-sig">${esc(APP_AUTHOR)}</span><span class="cert-sig-label">Course author</span></div>
          <div><span class="cert-sig">${esc(dateStr)}</span><span class="cert-sig-label">Date issued</span></div>
          <div class="cert-sealbox">${I('medal', 'cert-medal')}</div>
        </div>
      </div>
    </div>
    ${canPrint ? `
    <div class="card">
      <div class="set-row"><span>${I('bulb')} Your name on the certificate</span>
        <input id="nameInput" class="trans-sel" maxlength="40" value="${esc(S.name)}" placeholder="e.g. Emmanuel Suah"></div>
      <div class="r-actions">
        <button class="btn big" id="printBtn">${I('print')} Print certificate</button>
      </div>
    </div>` : ''}
  </section>${navBar('certificate')}`);
    bindNav();
    if (!canPrint) {
      document.getElementById('goExam').addEventListener('click', function () { go('exam'); });
      return;
    }
    var nameInput = document.getElementById('nameInput');
    nameInput.addEventListener('change', function () {
      S.name = nameInput.value.trim();
      kvSet('state', S);
      renderCertificate();
      toast('Name saved', 'check');
    });
    document.getElementById('printBtn').addEventListener('click', function () {
      if (window.Android && window.Android.printPage) window.Android.printPage();
      else window.print();
    });
  }

  /* ------------------------------- boot ---------------------------------- */
  Promise.all([loadCourse(), kvGet('state')]).then(function (r) {
    if (r[1]) S = Object.assign(defaultState(), r[1]);
    try { render(); } catch (e) {
      dismissSplash();
      app.innerHTML = '<div class="card" style="margin:40px 16px"><h2 class="screen-title">Could not start</h2>' +
        '<pre style="white-space:pre-wrap;font-size:12px">' + esc(String((e && e.stack) || e)) + '</pre></div>';
    }
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { esc: esc };
  }
})();
