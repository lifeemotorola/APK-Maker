/* Pastoral — sermon studio. State lives in the native app via window.Pastoral
 * (falls back to localStorage when opened in a plain browser, e.g. previews).
 * The KJV Bible is bundled as bibles/kjv.js -> global var bible_data.
 * Whole-sermon auto-generation lives in generate.js -> window.PastoralGen. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var N = window.Pastoral || null;
  var Gen = window.PastoralGen || null;

  // ---------------- state ----------------
  var state = { sermons: [], settings: { theme: 'dark' }, draft: null };

  function loadState() {
    var raw = null;
    try { raw = N ? N.loadState() : localStorage.getItem('pastoral.state'); } catch (e) { raw = null; }
    if (raw && raw !== '{}') {
      try {
        var s = JSON.parse(raw);
        if (s && s.sermons) state.sermons = s.sermons;
        if (s && s.settings) state.settings = s.settings;
      } catch (e) { /* keep defaults */ }
    }
  }

  function saveState() {
    var json = JSON.stringify({ sermons: state.sermons, settings: state.settings });
    if (N) { N.saveState(json); return; }
    try { localStorage.setItem('pastoral.state', json); } catch (e) { /* ignore */ }
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    setTimeout(function () { t.classList.add('hidden'); }, 2200);
  }

  window.PastoralEvents = {
    onError: function (msg) { toast('error: ' + msg); },
  };

  function uid() {
    return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------------- views ----------------
  var VIEWS = ['home', 'sermons', 'editor', 'scripture', 'series'];
  function show(view) {
    VIEWS.forEach(function (v) {
      $('view-' + v).classList.toggle('hidden', v !== view);
    });
    document.querySelectorAll('.tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    if (view === 'home') renderHome();
    if (view === 'sermons') renderSermonList();
    if (view === 'scripture') renderScripture();
    if (view === 'series') renderSeries();
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('.tab').forEach(function (b) {
    b.addEventListener('click', function () { show(b.getAttribute('data-view')); });
  });

  // ---------------- home ----------------
  function renderHome() {
    var now = new Date();
    var thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var monthCount = state.sermons.filter(function (s) { return (s.date || '').indexOf(thisMonth) === 0; }).length;
    var series = {};
    state.sermons.forEach(function (s) { if (s.series) series[s.series] = true; });
    var sorted = state.sermons.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var last = sorted[0];
    $('stats').innerHTML =
      '<div class="stat"><div class="n">' + state.sermons.length + '</div><div class="l">sermons</div></div>' +
      '<div class="stat"><div class="n">' + monthCount + '</div><div class="l">this month</div></div>' +
      '<div class="stat"><div class="n">' + Object.keys(series).length + '</div><div class="l">series</div></div>' +
      '<div class="stat"><div class="n">' + (last ? esc(last.title || '—').slice(0, 8) : '—') + '</div><div class="l">latest</div></div>';
    var rl = $('recentList');
    rl.innerHTML = sorted.slice(0, 3).map(function (s) {
      return '<div class="item" data-id="' + s.id + '"><div class="t">' + esc(s.title || 'Untitled') + '</div>' +
        '<div class="s">' + esc(s.ref || '') + (s.series ? ' · ' + esc(s.series) : '') + ' · ' + esc(s.date || '') + '</div></div>';
    }).join('') || '<div class="item"><div class="s">No sermons yet — create or auto-generate one.</div></div>';
    rl.querySelectorAll('.item[data-id]').forEach(function (el) {
      el.addEventListener('click', function () { openEditor(el.getAttribute('data-id')); });
    });
    $('themeBtn').textContent = 'Theme: ' + state.settings.theme;
  }

  // ---------------- sermon list ----------------
  function allSeries() {
    var m = {}, out = [];
    state.sermons.forEach(function (s) { if (s.series && !m[s.series]) { m[s.series] = 1; out.push(s.series); } });
    return out.sort();
  }

  function renderSeriesFilter() {
    var sel = $('seriesFilter');
    var cur = sel.value;
    sel.innerHTML = '<option value="">all series</option>' + allSeries().map(function (s) {
      return '<option>' + esc(s) + '</option>';
    }).join('');
    if (cur) sel.value = cur;
  }

  function renderSermonList() {
    renderSeriesFilter();
    var q = ($('searchInput').value || '').toLowerCase();
    var sf = $('seriesFilter').value;
    var list = state.sermons.filter(function (s) {
      if (sf && s.series !== sf) return false;
      if (!q) return true;
      return (s.title + ' ' + (s.series || '') + ' ' + (s.ref || '') + ' ' + (s.theme || '')).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var el = $('sermonList');
    el.innerHTML = list.map(function (s) {
      return '<div class="item" data-id="' + s.id + '">' +
        '<div class="t">' + esc(s.title || 'Untitled') + '</div>' +
        '<div class="s">' + esc(s.ref || 'no scripture') + (s.series ? ' · ' + esc(s.series) : '') + ' · ' + esc(s.date || '') + ' · ' + (s.points || []).length + ' pts</div>' +
        '<div class="actions">' +
        '<button class="btn act-edit">Edit</button>' +
        '<button class="btn act-dup">Duplicate</button>' +
        '<button class="btn act-share">Share</button>' +
        '<button class="btn act-del">Delete</button>' +
        '</div></div>';
    }).join('') || '<div class="item"><div class="s">No sermons match.</div></div>';
    el.querySelectorAll('.item[data-id]').forEach(function (row) {
      var id = row.getAttribute('data-id');
      row.querySelector('.act-edit').addEventListener('click', function (e) { e.stopPropagation(); openEditor(id); });
      row.querySelector('.act-dup').addEventListener('click', function (e) { e.stopPropagation(); duplicateSermon(id); });
      row.querySelector('.act-share').addEventListener('click', function (e) { e.stopPropagation(); shareSermon(id); });
      row.querySelector('.act-del').addEventListener('click', function (e) {
        e.stopPropagation();
        if (confirm('Delete this sermon?')) {
          state.sermons = state.sermons.filter(function (s) { return s.id !== id; });
          saveState(); renderSermonList(); toast('deleted');
        }
      });
      row.addEventListener('click', function () { openEditor(id); });
    });
  }

  $('searchInput').addEventListener('input', renderSermonList);
  $('seriesFilter').addEventListener('change', renderSermonList);

  // ---------------- editor ----------------
  function emptySermon() {
    return {
      id: uid(), title: '', series: state.settings.defaultSeries || '', date: today(),
      ref: '', keyVerse: '', theme: '', intro: '', points: [],
      illustration: '', application: '', conclusion: '', duration: 30, delivery: '',
    };
  }

  function openEditor(id) {
    var s = id ? state.sermons.filter(function (x) { return x.id === id; })[0] : null;
    state.draft = s ? JSON.parse(JSON.stringify(s)) : emptySermon();
    state.editingId = s ? s.id : null;
    $('editorTitle').textContent = s ? 'Edit sermon' : 'New sermon';
    $('fTitle').value = state.draft.title || '';
    $('fSeries').value = state.draft.series || '';
    $('fDate').value = state.draft.date || today();
    $('fRef').value = state.draft.ref || '';
    $('fKeyVerse').value = state.draft.keyVerse || '';
    $('fTheme').value = state.draft.theme || '';
    $('fIntro').value = state.draft.intro || '';
    $('fIllustration').value = state.draft.illustration || '';
    $('fApplication').value = state.draft.application || '';
    $('fConclusion').value = state.draft.conclusion || '';
    $('fDuration').value = state.draft.duration || 30;
    $('fDelivery').value = state.draft.delivery || '';
    $('fTopic').value = '';
    $('editorMsg').textContent = '';
    // series datalist
    $('seriesList').innerHTML = allSeries().map(function (s) { return '<option value="' + esc(s) + '">'; }).join('');
    renderPoints();
    show('editor');
  }

  function renderPoints() {
    var box = $('points');
    var pts = state.draft.points || (state.draft.points = []);
    box.innerHTML = pts.map(function (p, i) {
      return '<div class="point" data-i="' + i + '">' +
        '<div class="prow">' +
        '<input class="input p-head" placeholder="Point ' + (i + 1) + ' heading" value="' + esc(p.h || '') + '" />' +
        '<button class="mini p-up" title="up">up</button>' +
        '<button class="mini p-down" title="down">down</button>' +
        '<button class="mini p-del" title="remove">x</button>' +
        '</div>' +
        '<textarea class="input p-notes" rows="2" placeholder="notes / verses for this point">' + esc(p.notes || '') + '</textarea>' +
        '</div>';
    }).join('');
    box.querySelectorAll('.point').forEach(function (row) {
      var i = parseInt(row.getAttribute('data-i'), 10);
      row.querySelector('.p-head').addEventListener('input', function (e) { pts[i].h = e.target.value; });
      row.querySelector('.p-notes').addEventListener('input', function (e) { pts[i].notes = e.target.value; });
      row.querySelector('.p-up').addEventListener('click', function () {
        if (i > 0) { var t = pts[i - 1]; pts[i - 1] = pts[i]; pts[i] = t; renderPoints(); }
      });
      row.querySelector('.p-down').addEventListener('click', function () {
        if (i < pts.length - 1) { var t = pts[i + 1]; pts[i + 1] = pts[i]; pts[i] = t; renderPoints(); }
      });
      row.querySelector('.p-del').addEventListener('click', function () {
        pts.splice(i, 1); renderPoints();
      });
    });
  }

  $('addPointBtn').addEventListener('click', function () {
    state.draft.points = state.draft.points || [];
    state.draft.points.push({ h: '', notes: '' });
    renderPoints();
  });

  function collectDraft() {
    var d = state.draft;
    d.title = $('fTitle').value.trim();
    d.series = $('fSeries').value.trim();
    d.date = $('fDate').value || today();
    d.ref = $('fRef').value.trim();
    d.keyVerse = $('fKeyVerse').value;
    d.theme = $('fTheme').value.trim();
    d.intro = $('fIntro').value;
    d.illustration = $('fIllustration').value;
    d.application = $('fApplication').value;
    d.conclusion = $('fConclusion').value;
    d.duration = parseInt($('fDuration').value, 10) || 30;
    d.delivery = $('fDelivery').value;
    return d;
  }

  // ---------------- auto-generate ----------------
  function applyGenerated(g) {
    if (!state.draft) state.draft = emptySermon();
    var d = state.draft;
    d.title = g.title;
    d.ref = g.ref;
    d.keyVerse = g.keyVerse;
    d.theme = g.theme;
    d.intro = g.intro;
    d.points = g.points || [];
    d.illustration = g.illustration;
    d.application = g.application;
    d.conclusion = g.conclusion;
    d.delivery = g.delivery;
    if (g.duration) d.duration = g.duration;
    $('fTitle').value = d.title;
    $('fRef').value = d.ref;
    $('fKeyVerse').value = d.keyVerse;
    $('fTheme').value = d.theme;
    $('fIntro').value = d.intro;
    $('fIllustration').value = d.illustration;
    $('fApplication').value = d.application;
    $('fConclusion').value = d.conclusion;
    $('fDelivery').value = d.delivery;
    $('fDuration').value = d.duration;
    renderPoints();
    toast('whole sermon generated — review, edit, then save');
  }

  function generateNow() {
    if (!Gen) { toast('generator missing'); return; }
    if (state.editingId && state.draft && (state.draft.title || state.draft.intro)) {
      if (!confirm('Auto-generate will replace the current editor content. Continue?')) return;
    }
    if (!state.draft) openEditor(null);
    var g = Gen.generateSermon({
      ref: $('fRef').value,
      topic: $('fTopic').value,
      duration: parseInt($('fDuration').value, 10) || 30,
      bible: window.bible_data || [],
    });
    applyGenerated(g);
    show('editor');
  }

  $('genBtn').addEventListener('click', generateNow);
  $('genQuickBtn').addEventListener('click', function () { openEditor(null); $('fTopic').focus(); });
  $('genQuickBtn2').addEventListener('click', function () { openEditor(null); $('fTopic').focus(); });

  $('saveSermonBtn').addEventListener('click', function () {
    var d = collectDraft();
    if (!d.title) {
      $('editorMsg').textContent = 'Title is required.';
      $('editorMsg').className = 'msg';
      return;
    }
    if (state.editingId) {
      state.sermons = state.sermons.map(function (s) { return s.id === state.editingId ? d : s; });
    } else {
      state.sermons.push(d);
    }
    saveState();
    $('editorMsg').textContent = 'Saved.';
    $('editorMsg').className = 'msg ok';
    toast('sermon saved');
    setTimeout(function () { show('sermons'); }, 400);
  });

  $('cancelEditBtn').addEventListener('click', function () { show('sermons'); });
  $('shareSermonBtn').addEventListener('click', function () {
    var d = collectDraft();
    if (d.title) { state.draft = d; if (state.editingId) { state.sermons = state.sermons.map(function (s) { return s.id === state.editingId ? d : s; }); } else { state.sermons.push(d); } saveState(); }
    shareSermon(state.editingId || d.id);
  });

  function duplicateSermon(id) {
    var s = state.sermons.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    var copy = JSON.parse(JSON.stringify(s));
    copy.id = uid();
    copy.title = (s.title || 'Untitled') + ' (copy)';
    state.sermons.push(copy);
    saveState(); renderSermonList(); toast('duplicated');
  }

  function sermonText(s) {
    var L = [];
    L.push((s.title || 'Untitled sermon').toUpperCase() + (s.series ? '  —  ' + s.series : ''));
    L.push('Date: ' + (s.date || '') + (s.duration ? '   Target: ' + s.duration + ' min' : ''));
    if (s.ref) L.push('Scripture: ' + s.ref + (s.keyVerse ? '\n"' + s.keyVerse + '"' : ''));
    if (s.theme) L.push('Theme: ' + s.theme);
    L.push('');
    if (s.intro) L.push('INTRODUCTION\n' + s.intro + '\n');
    if (s.points && s.points.length) {
      L.push('OUTLINE');
      s.points.forEach(function (p, i) {
        L.push('  ' + ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][i] + '. ' + (p.h || '(point ' + (i + 1) + ')'));
        if (p.notes) L.push('     - ' + p.notes.replace(/\n/g, '\n     - '));
      });
      L.push('');
    }
    if (s.illustration) L.push('ILLUSTRATION\n' + s.illustration + '\n');
    if (s.application) L.push('APPLICATION\n' + s.application + '\n');
    if (s.conclusion) L.push('CONCLUSION\n' + s.conclusion + '\n');
    if (s.delivery) L.push('DELIVERY NOTES\n' + s.delivery);
    return L.join('\n');
  }

  function shareSermon(id) {
    var s = state.sermons.filter(function (x) { return x.id === id; })[0] || state.draft;
    if (!s) return;
    var text = sermonText(s);
    if (N) N.shareText(s.title || 'Sermon', text);
    else toast('share needs the app (bridge missing)');
  }

  // ---------------- scripture (bundled KJV) ----------------
  var BOOKS = [];
  function indexBible() {
    BOOKS = [];
    var seen = {};
    (window.bible_data || []).forEach(function (v) {
      var parts = (v.name || '').split(' ');
      var book = parts.slice(0, -1).join(' ');
      if (!seen[book]) { seen[book] = 1; BOOKS.push({ name: book, firstAri: v.ari }); }
    });
  }

  function versesOf(bookIdx, chapter) {
    var prefix = bookIdx + ':' + chapter + ':';
    return (window.bible_data || []).filter(function (v) { return (v.ari || '').indexOf(prefix) === 0; });
  }

  function chaptersOf(bookIdx) {
    var set = {}, out = [];
    (window.bible_data || []).forEach(function (v) {
      var p = (v.ari || '').split(':');
      if (parseInt(p[0], 10) === bookIdx && !set[p[1]]) { set[p[1]] = 1; out.push(parseInt(p[1], 10)); }
    });
    return out.sort(function (a, b) { return a - b; });
  }

  var pickMode = false;
  var lastAri = null;
  function renderScripture() {
    var bs = $('bookSel');
    if (!bs.options.length) {
      bs.innerHTML = BOOKS.map(function (b, i) { return '<option value="' + i + '">' + esc(b.name) + '</option>'; }).join('');
    }
    var bi = parseInt(bs.value || '0', 10);
    var cs = $('chapterSel');
    cs.innerHTML = chaptersOf(bi).map(function (c) { return '<option value="' + c + '">Chapter ' + c + '</option>'; }).join('');
    renderVerses();
    $('pickHint').classList.toggle('hidden', !pickMode);
  }

  function renderVerses() {
    var bi = parseInt($('bookSel').value || '0', 10);
    var ch = parseInt($('chapterSel').value || '1', 10);
    var vs = versesOf(bi, ch);
    renderVerseItems(vs);
  }

  function renderVerseItems(vs) {
    var box = $('verseList');
    box.innerHTML = vs.map(function (v) {
      return '<div class="item" data-ari="' + esc(v.ari) + '">' +
        '<div class="ref">' + esc(v.name) + '</div><div class="txt">' + esc(v.verse) + '</div></div>';
    }).join('') || '<div class="item"><div class="s">No verses.</div></div>';
    box.querySelectorAll('.item[data-ari]').forEach(function (el) {
      el.addEventListener('click', function () { pickVerse(el.getAttribute('data-ari')); });
    });
  }

  $('bookSel').addEventListener('change', renderScripture);
  $('chapterSel').addEventListener('change', renderVerses);

  $('verseSearchBtn').addEventListener('click', function () {
    var q = ($('verseSearch').value || '').trim().toLowerCase();
    if (!q) { renderVerses(); return; }
    var hits = (window.bible_data || []).filter(function (v) {
      return (v.verse || '').toLowerCase().indexOf(q) >= 0;
    }).slice(0, 60);
    renderVerseItems(hits);
  });

  function pickVerse(ari) {
    lastAri = ari;
    var v = (window.bible_data || []).filter(function (x) { return x.ari === ari; })[0];
    if (!v) return;
    if (pickMode && state.draft) {
      state.draft.ref = v.name;
      state.draft.keyVerse = v.verse;
      $('fRef').value = v.name;
      $('fKeyVerse').value = v.verse;
      pickMode = false;
      show('editor');
      toast('inserted ' + v.name);
    } else {
      toast(v.name + ' — ' + String(v.verse).slice(0, 60) + '...');
    }
  }

  $('pickRefBtn').addEventListener('click', function () {
    pickMode = true;
    show('scripture');
  });

  $('genFromVerseBtn').addEventListener('click', function () {
    if (!Gen) { toast('generator missing'); return; }
    if (!lastAri) { toast('tap a verse first, then auto-generate'); return; }
    var v = (window.bible_data || []).filter(function (x) { return x.ari === lastAri; })[0];
    openEditor(null);
    var g = Gen.generateSermon({ ref: v.name, topic: '', duration: 30, bible: window.bible_data || [] });
    applyGenerated(g);
    show('editor');
  });

  // ---------------- series ----------------
  function renderSeries() {
    var counts = {};
    state.sermons.forEach(function (s) { var k = s.series || '(no series)'; counts[k] = (counts[k] || 0) + 1; });
    var keys = Object.keys(counts).sort();
    var el = $('seriesList');
    el.innerHTML = keys.map(function (k) {
      return '<div class="item" data-series="' + esc(k) + '"><div class="t">' + esc(k) + '</div><div class="s">' + counts[k] + ' sermon(s) — tap to filter</div></div>';
    }).join('') || '<div class="item"><div class="s">No series yet.</div></div>';
    el.querySelectorAll('.item[data-series]').forEach(function (row) {
      row.addEventListener('click', function () {
        var s = row.getAttribute('data-series');
        $('seriesFilter').value = s === '(no series)' ? '' : s;
        show('sermons');
        renderSermonList();
      });
    });
  }

  // ---------------- backup / theme ----------------
  $('exportBtn').addEventListener('click', function () {
    var json = JSON.stringify({ app: 'pastoral', version: 1, sermons: state.sermons }, null, 2);
    if (N) N.shareText('Pastoral backup', json);
    else { navigator.clipboard && navigator.clipboard.writeText(json); toast('backup copied to clipboard'); }
  });

  $('importBtn').addEventListener('click', function () {
    var raw = prompt('Paste a Pastoral JSON backup:');
    if (!raw) return;
    try {
      var data = JSON.parse(raw);
      var sermons = data.sermons || (Array.isArray(data) ? data : null);
      if (!sermons) throw new Error('no sermons array');
      if (!confirm('Import ' + sermons.length + ' sermon(s)? This replaces the current list.')) return;
      state.sermons = sermons;
      saveState();
      toast('imported ' + sermons.length + ' sermons');
      show('sermons');
    } catch (e) {
      toast('import failed: ' + e.message);
    }
  });

  $('themeBtn').addEventListener('click', function () {
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    document.body.classList.toggle('light', state.settings.theme === 'light');
    saveState();
    renderHome();
  });

  // ---------------- boot ----------------
  $('newSermonBtn').addEventListener('click', function () { openEditor(null); });
  $('newSermonBtn2').addEventListener('click', function () { openEditor(null); });
  $('browseScriptureBtn').addEventListener('click', function () { pickMode = false; show('scripture'); });

  loadState();
  document.body.classList.toggle('light', state.settings.theme === 'light');
  indexBible();
  show('home');
})();
