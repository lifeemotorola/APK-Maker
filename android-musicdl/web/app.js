/* Gospel MP3 Downloader (Music Downloader APK) — app logic, runs inside the APK
 * WebView and in the browser preview.
 *
 * ceenaija.com-style homepage: nav bar (HOME / TRENDING / GOSPEL / NAIJA /
 * HYMNS / ARTISTS / MY DOWNLOADS), curated sections (Trending Now, Latest
 * Gospel, Nigerian Gospel & Afrobeats, Hymns, Global Tunes) fed by
 * multi-website search (Wikimedia Commons + Openverse CC audio, or any
 * direct link), song cards with Preview + DOWNLOAD MP3, a
 * search view with sort/format filters, and a My-downloads library.
 *
 * Downloads go through the native bridge (MusicDLNative.startDownload):
 * streamed in Java and saved to Music/MusicDownloader via MediaStore;
 * progress events arrive via window.MusicDL.onEvent; finished files play at
 * /dl/<id>.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    netBanner: $('netBanner'), netPill: $('netPill'), mainNav: $('mainNav'),
    form: $('searchForm'), input: $('searchInput'), status: $('searchStatus'),
    surpriseBtn: $('surpriseBtn'), quickChips: $('quickChips'), historyChips: $('historyChips'),
    sourceChips: $('sourceChips'), sortSel: $('sortSel'), fmtChips: $('fmtChips'),
    directToggle: $('directToggle'), directPanel: $('directPanel'), directUrl: $('directUrl'), directName: $('directName'), directGo: $('directGo'),
    homeView: $('homeView'), searchView: $('searchView'), downloadsView: $('downloadsView'),
    results: $('results'), downloads: $('downloads'), dlCount: $('dlCount'),
    clearFinished: $('clearFinished'), toast: $('toast'),
    playerBar: $('playerBar'), pbAudio: $('pbAudio'), pbTitle: $('pbTitle'), pbSub: $('pbSub'),
    pbClose: $('pbClose'), eq: $('eq'),
  };
  var N = window.MusicDLNative;

  var state = {
    view: 'home',
    source: 'all',
    sort: 'relevance',
    format: 'all',
    expanded: {},
    progress: {},
    lastItems: [],
    homeLoaded: false,
  };

  var AUDIO_EXT = ['.mp3', '.ogg', '.opus', '.flac', '.m4a', '.wav', '.wma', '.aac', '.aiff'];
  var SOURCES = [
    { key: 'all', label: 'All websites' },
    { key: 'commons', label: 'Wikimedia Commons' },
    { key: 'openverse', label: 'Openverse CC audio' },
  ];
  var SOURCE_LABEL = { commons: 'Wikimedia', openverse: 'Openverse', link: 'Direct link' };
  /* ceenaija-style homepage sections (queries run against the free sources) */
  var SECTIONS = [
    { id: 'trending', title: 'Trending Now', q: 'gospel OR afrobeats OR naija', source: 'all', limit: 12 },
    { id: 'gospel', title: 'Latest Gospel Songs', q: 'gospel worship song', source: 'all', limit: 12 },
    { id: 'naija', title: 'Nigerian Gospel & Afrobeats', q: 'nigerian gospel OR afrobeat', source: 'all', limit: 12 },
    { id: 'hymns', title: 'Hymns & Praise', q: 'hymn praise worship', source: 'all', limit: 10 },
    { id: 'global', title: 'Global Tunes', q: 'african music OR world music', source: 'all', limit: 10 },
  ];
  var QUICK = [
    { label: 'Trending gospel', q: 'trending gospel songs' },
    { label: 'Sinach', q: 'sinach' },
    { label: 'Mercy Chinwo', q: 'mercy chinwo' },
    { label: 'Hillsong', q: 'hillsong worship' },
    { label: 'Afrobeat', q: 'afrobeat' },
    { label: 'Live music', q: 'live music concert' },
    { label: 'Classical', q: 'classical music' },
  ];
  var HIST_KEY = 'musicdl-history';
  var FORMATS = [
    { key: 'all', label: 'All' }, { key: '.mp3', label: 'MP3' }, { key: '.ogg', label: 'OGG' },
    { key: '.flac', label: 'FLAC' }, { key: '.wav', label: 'WAV' }, { key: '.m4a', label: 'M4A' },
  ];

  function extOf(name) {
    var n = (name || '').toLowerCase().split('?')[0].split('#')[0];
    for (var i = 0; i < AUDIO_EXT.length; i++) if (n.endsWith(AUDIO_EXT[i])) return AUDIO_EXT[i];
    return '';
  }
  function mimeOf(name) {
    var e = extOf(name);
    return { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
             '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.wma': 'audio/x-ms-wma', '.aac': 'audio/aac',
             '.aiff': 'audio/aiff' }[e] || 'application/octet-stream';
  }
  function fmtBytes(n) {
    if (!n || n < 0) return '?';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(n >= 100 || i === 0 ? 0 : 1) + ' ' + u[i];
  }
  function fmtDur(sec) {
    sec = parseFloat(sec);
    if (!sec || !isFinite(sec)) return '';
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function stripTags(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, '').trim(); }
  function baseName(url) {
    try {
      var p = decodeURIComponent(String(url).split('?')[0].split('#')[0]);
      return p.split('/').filter(Boolean).pop() || 'song';
    } catch (e) { return 'song'; }
  }

  /* --------------------------- net status --------------------------- */
  function updateNet() {
    var on = navigator.onLine !== false;
    els.netPill.textContent = on ? 'online' : 'offline';
    els.netPill.classList.toggle('off', !on);
    els.netBanner.classList.toggle('hidden', on);
  }
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);

  /* --------------------------- views / nav --------------------------- */
  function switchView(view) {
    state.view = view;
    els.homeView.classList.toggle('hidden', view !== 'home');
    els.searchView.classList.toggle('hidden', view !== 'search');
    els.downloadsView.classList.toggle('hidden', view !== 'downloads');
    var btns = els.mainNav.querySelectorAll('.nav-btn');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var active = (view === 'downloads' && b.dataset.nav === 'downloads') ||
                   (view === 'home' && b.dataset.nav === 'home') ||
                   (view === 'search' && b.dataset.nav === 'q' && b.dataset.q === els.input.value.trim());
      b.classList.toggle('active', !!active);
    }
    if (view === 'downloads') renderDownloads();
    if (view === 'home' && !state.homeLoaded) loadHome();
  }
  els.mainNav.addEventListener('click', function (e) {
    var b = e.target.closest('.nav-btn');
    if (!b) return;
    if (b.dataset.nav === 'home') { switchView('home'); return; }
    if (b.dataset.nav === 'downloads') { switchView('downloads'); return; }
    if (b.dataset.q) {
      els.input.value = b.dataset.q;
      doSearch(b.dataset.q);
    }
  });

  /* --------------------------- chips --------------------------- */
  function renderSourceChips() {
    els.sourceChips.innerHTML = '<span class="chip-label">Source</span>';
    SOURCES.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.source === s.key ? ' active' : '');
      b.textContent = s.label;
      b.addEventListener('click', function () {
        state.source = s.key;
        renderSourceChips();
        var q = els.input.value.trim();
        if (q) doSearch(q);
      });
      els.sourceChips.appendChild(b);
    });
  }
  function renderFmtChips() {
    els.fmtChips.innerHTML = '';
    FORMATS.forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.format === f.key ? ' active' : '');
      b.textContent = f.label;
      b.addEventListener('click', function () {
        state.format = f.key;
        renderFmtChips();
        var q = els.input.value.trim();
        if (q) doSearch(q); else renderResults(state.lastItems || []);
      });
      els.fmtChips.appendChild(b);
    });
  }
  function renderChips() {
    els.quickChips.innerHTML = '<span class="chip-label">Try</span>';
    QUICK.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = c.label;
      b.addEventListener('click', function () { els.input.value = c.q; doSearch(c.q); });
      els.quickChips.appendChild(b);
    });
    var surprise = document.createElement('button');
    surprise.type = 'button';
    surprise.className = 'chip surprise-chip';
    surprise.textContent = 'Surprise me';
    surprise.addEventListener('click', surpriseMe);
    els.quickChips.appendChild(surprise);

    var hist = [];
    try { hist = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { hist = []; }
    els.historyChips.innerHTML = '';
    if (hist.length) {
      els.historyChips.innerHTML = '<span class="chip-label">Recent</span>';
      hist.slice(0, 6).forEach(function (h) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = h;
        b.addEventListener('click', function () { els.input.value = h; doSearch(h); });
        els.historyChips.appendChild(b);
      });
    }
  }
  function pushHistory(q) {
    try {
      var hist = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
      hist = [q].concat(hist.filter(function (h) { return h !== q; })).slice(0, 8);
      localStorage.setItem(HIST_KEY, JSON.stringify(hist));
    } catch (e) { /* ignore */ }
    renderChips();
  }

  /* --------------------------- sources --------------------------- */
  function searchCommons(q) {
    var url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
      + '&generator=search&gsrsearch=' + encodeURIComponent('filetype:audio ' + q)
      + '&gsrnamespace=6&gsrlimit=30&prop=imageinfo&iiprop=url%7Csize%7Cmime&iiurlwidth=300';
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var pages = (j.query && j.query.pages) || {};
      return Object.keys(pages).map(function (k) { return pages[k]; }).map(function (p) {
        var ii = (p.imageinfo && p.imageinfo[0]) || {};
        var em = ii.extmetadata || {};
        var name = (p.title || 'audio').replace(/^File:/, '');
        return {
          source: 'commons', id: 'commons-' + p.pageid, title: name,
          creator: stripTags(em.Artist && em.Artist.value) || stripTags(em.Credit && em.Credit.value) || '',
          duration: 0, size: ii.size || 0,
          formats: (ii.mime || '').replace('audio/', ''),
          cover: ii.thumburl || ii.url || '',
          files: [{ name: name, url: ii.url, size: ii.size || 0, mime: ii.mime || mimeOf(name) }],
        };
      }).filter(function (it) { return it.files[0].url; });
    });
  }
  function searchOpenverse(q) {
    var url = 'https://api.openverse.org/v1/audio/?q=' + encodeURIComponent(q) + '&page_size=20';
    return fetch(url).then(function (r) {
      if (r.status === 429) throw new Error('Openverse rate limit reached — try again in a little while');
      return r.json();
    }).then(function (j) {
      return (j.results || []).map(function (a) {
        var name = baseName(a.url) || a.title || 'audio';
        if (!extOf(name)) name = name + '.mp3';
        return {
          source: 'openverse', id: 'ov-' + (a.id || name),
          title: a.title || name, creator: a.creator || '',
          duration: a.duration || 0, size: 0,
          formats: (a.license || '') + ' · ' + extOf(name).slice(1),
          cover: a.thumbnail || '',
          files: [{ name: name, url: a.url, size: 0, mime: mimeOf(name) }],
        };
      }).filter(function (it) { return it.files[0].url; });
    });
  }
  var SEARCHERS = { commons: searchCommons, openverse: searchOpenverse };

  function setStatus(msg, cls) {
    els.status.textContent = msg;
    els.status.className = 'status' + (cls ? ' ' + cls : '');
  }

  function doSearch(query) {
    if (navigator.onLine === false) { setStatus('you are offline — connect to the internet to search', 'err'); return; }
    pushHistory(query);
    switchView('search');
    var keys = state.source === 'all' ? ['commons', 'openverse'] : [state.source];
    setStatus('searching ' + (state.source === 'all' ? 'all websites' : SOURCE_LABEL[state.source]) + ' for "' + query + '"...', 'busy');
    renderSkeletons();
    var tasks = keys.map(function (k) {
      return SEARCHERS[k](query).then(function (items) { return { key: k, items: items, ok: true }; })
        .catch(function (e) { return { key: k, items: [], ok: false, err: e }; });
    });
    Promise.all(tasks).then(function (res) {
      var items = [];
      var failed = [];
      res.forEach(function (r) {
        if (r.ok) items = items.concat(r.items);
        else failed.push(SOURCE_LABEL[r.key] + (r.err && r.err.message ? ': ' + r.err.message : ''));
      });
      items = sortItems(items.filter(itemHasFormat));
      state.lastItems = items;
      setStatus(items.length + ' result(s) for "' + query + '" from ' + res.filter(function (r) { return r.ok; }).length + ' source(s)'
        + (failed.length ? ' — ' + failed.join('; ') : ''), items.length ? 'ok' : 'err');
      renderResults(items);
    });
  }

  function itemHasFormat(item) {
    if (state.format === 'all') return true;
    var hay = (item.formats || '') + ' ' + (item.files || []).map(function (f) { return extOf(f.name); }).join(' ');
    return hay.toLowerCase().indexOf(state.format) !== -1;
  }
  function sortItems(items) {
    if (state.sort === 'az') return items.slice().sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); });
    return items;
  }

  /* --------------------------- homepage sections --------------------------- */
  function loadHome() {
    state.homeLoaded = true;
    els.homeView.innerHTML = '';
    SECTIONS.forEach(function (sec) {
      var wrap = document.createElement('section');
      wrap.className = 'section card';
      wrap.innerHTML = '<div class="section-head"><h2><span class="dot">•</span> ' + esc(sec.title) + '</h2>'
        + '<button class="more">See all</button></div><div class="sec-status">loading...</div><div class="h-row"></div>';
      wrap.querySelector('.more').addEventListener('click', function () { els.input.value = sec.q; doSearch(sec.q); });
      els.homeView.appendChild(wrap);
      var row = wrap.querySelector('.h-row');
      var st = wrap.querySelector('.sec-status');
      var keys = sec.source === 'all' ? ['commons', 'openverse'] : [sec.source];
      Promise.all(keys.map(function (k) {
        return SEARCHERS[k](sec.q, sec.sort).then(function (items) { return items; }).catch(function () { return []; });
      })).then(function (parts) {
        var items = [];
        parts.forEach(function (p) { items = items.concat(p); });
        items = sortItems(items.filter(itemHasFormat)).slice(0, sec.limit);
        if (!items.length) { st.textContent = 'no results right now — try search'; row.innerHTML = ''; return; }
        st.textContent = items.length + ' songs';
        items.forEach(function (item) { row.appendChild(makeCard(item, true)); });
      });
    });
  }

  /* Surprise me */
  function surpriseMe() {
    if (navigator.onLine === false) { setStatus('you are offline — connect to the internet first', 'err'); return; }
    setStatus('finding a random free track for you...', 'busy');
    searchOpenverse('gospel OR afrobeat OR live music').then(function (items) {
      if (!items.length) throw new Error('nothing found');
      var item = items[Math.floor(Math.random() * items.length)];
      setStatus('surprise: ' + item.title + ' — playing preview', 'ok');
      els.input.value = '';
      switchView('search');
      renderResults([item]);
      if (item.files.length) playUrl(item.files[0].url, item.files[0].name, 'surprise stream from ' + SOURCE_LABEL[item.source]);
    }).catch(function (e) {
      setStatus('surprise failed: ' + (e && e.message ? e.message : e), 'err');
    });
  }

  /* --------------------------- cards --------------------------- */
  function makeCard(item, compact) {
    var card = document.createElement('div');
    card.className = 'result-card';
    var cover = document.createElement('div');
    cover.className = 'cover';
    cover.innerHTML = '<span class="rc-source">' + esc(SOURCE_LABEL[item.source] || item.source) + '</span><div class="cover-fallback">MD</div>';
    if (item.cover) {
      var img = document.createElement('img');
      img.src = item.cover;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('load', function () {
        var fb = cover.querySelector('.cover-fallback');
        if (fb) fb.style.display = 'none';
      });
      img.addEventListener('error', function () { img.style.display = 'none'; });
      cover.appendChild(img);
    }
    card.appendChild(cover);

    var body = document.createElement('div');
    body.className = 'rc-body';
    body.innerHTML = '<div class="rc-title" title="' + esc(item.title) + '">' + esc(item.title) + '</div>'
      + '<div class="rc-sub">' + esc(item.creator) + (fmtDur(item.duration) ? ' · ' + fmtDur(item.duration) : '') + (item.size ? ' · ' + fmtBytes(item.size) : '') + '</div>'
      + (item.formats ? '<div class="rc-formats">' + esc(item.formats) + '</div>' : '');
    var actions = document.createElement('div');
    actions.className = 'rc-actions';
    var mp3 = document.createElement('button');
    mp3.className = 'btn mp3';
    mp3.textContent = 'DOWNLOAD MP3';
    mp3.title = 'Download the best MP3 file of this song';
    mp3.addEventListener('click', function () { quickMp3(item); });
    var filesBtn = document.createElement('button');
    filesBtn.className = 'btn ghost';
    filesBtn.textContent = state.expanded[item.id] ? 'Hide' : 'Files';
    filesBtn.addEventListener('click', function () { toggleFiles(item, card); });
    actions.appendChild(mp3);
    actions.appendChild(filesBtn);
    if (!compact) {
      var allBtn = document.createElement('button');
      allBtn.className = 'btn ghost';
      allBtn.textContent = 'Get all';
      allBtn.addEventListener('click', function () { downloadAll(item); });
      actions.appendChild(allBtn);
    }
    body.appendChild(actions);
    card.appendChild(body);

    var files = document.createElement('div');
    files.className = 'files hidden';
    files.style.padding = '0 10px 10px';
    card.appendChild(files);
    if (state.expanded[item.id]) ensureFiles(item, files);
    return card;
  }

  function renderSkeletons() {
    els.results.innerHTML = '';
    for (var i = 0; i < 8; i++) {
      var card = document.createElement('div');
      card.className = 'result-card skeleton-card';
      card.innerHTML = '<div class="cover"></div><div class="rc-body"><div class="sk-line"></div><div class="sk-line short"></div><div class="sk-line short"></div></div>';
      els.results.appendChild(card);
    }
  }
  function renderResults(items) {
    els.results.innerHTML = '';
    if (!items.length) {
      els.results.innerHTML = '<div class="item-title" style="padding:8px">No results — try a different artist, song, genre or another source.</div>';
      return;
    }
    items.forEach(function (item) { els.results.appendChild(makeCard(item, false)); });
  }

  function toggleFiles(item, card) {
    state.expanded[item.id] = !state.expanded[item.id];
    var box = card.querySelector('.files');
    if (state.expanded[item.id]) { box.classList.remove('hidden'); ensureFiles(item, box); }
    else box.classList.add('hidden');
  }

  function ensureFiles(item, box) { renderFiles(item, box); }

  function renderFiles(item, box) {
    var files = item.files || [];
    box.innerHTML = '';
    if (!files.length) { box.innerHTML = '<div class="item-sub">no directly downloadable audio files in this item</div>'; return; }
    files.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = '<span class="file-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="file-size">' + fmtBytes(f.size) + '</span>';
      var prev = document.createElement('button');
      prev.className = 'btn ghost';
      prev.textContent = 'Preview';
      prev.addEventListener('click', function () { playUrl(f.url, f.name, 'streaming from ' + (SOURCE_LABEL[item.source] || item.source)); });
      var dl = document.createElement('button');
      dl.className = 'btn';
      dl.textContent = 'Download';
      dl.addEventListener('click', function () { dl.disabled = true; startOneDownload(item, f); });
      row.appendChild(prev); row.appendChild(dl);
      box.appendChild(row);
    });
  }

  /* DOWNLOAD MP3 quick button: best file, preferring .mp3 */
  function quickMp3(item) {
    var files = item.files || [];
    var mp3s = files.filter(function (f) { return extOf(f.name) === '.mp3'; });
    var pool = mp3s.length ? mp3s : files;
    if (!pool.length) { toast('no downloadable audio file found for this item', true); return; }
    startOneDownload(item, pool[0]);
    toast('Downloading MP3: ' + (item.title || pool[0].name));
  }

  function startOneDownload(item, f) {
    var dlId = 'dl-' + item.id + '-' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
    N.startDownload(dlId, f.url, f.name, item.title || f.name, item.creator || '', f.mime || mimeOf(f.name), item.cover || '');
    state.progress[dlId] = { type: 'progress', id: dlId, status: 'downloading', pct: 0, filename: f.name, title: item.title || f.name, creator: item.creator || '', cover: item.cover || '' };
    switchView('downloads');
    renderDownloads();
    return dlId;
  }

  function downloadAll(item) {
    var files = item.files || [];
    files.forEach(function (f) { startOneDownload(item, f); });
    setStatus('queued ' + files.length + ' file(s) from ' + item.title, 'ok');
  }

  /* --------------------------- direct link --------------------------- */
  els.directToggle.addEventListener('click', function () { els.directPanel.classList.toggle('hidden'); });
  els.directGo.addEventListener('click', function () {
    var url = els.directUrl.value.trim();
    if (!/^https?:\/\//i.test(url)) { setStatus('paste a full http(s) link to an audio file', 'err'); return; }
    if (navigator.onLine === false) { setStatus('you are offline — connect to the internet to download', 'err'); return; }
    var name = els.directName.value.trim() || baseName(url);
    if (!extOf(name)) name = name + '.mp3';
    var item = { source: 'link', id: 'link-' + Date.now(), title: name, creator: '', cover: '', files: [{ name: name, url: url, size: 0, mime: mimeOf(name) }] };
    setStatus('downloading ' + name + ' ...', 'busy');
    startOneDownload(item, item.files[0]);
  });

  /* --------------------------- downloads --------------------------- */
  var toastTimer = null;
  function toast(msg, isErr) {
    els.toast.textContent = msg;
    els.toast.className = 'toast' + (isErr ? ' err' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.add('hidden'); }, 4200);
  }

  window.MusicDL = {
    onEvent: function (ev) {
      if (!ev || !ev.id) return;
      var prev = state.progress[ev.id];
      var now = Date.now();
      if (ev.type === 'progress' && ev.status === 'downloading' && prev && prev._t) {
        var dt = (now - prev._t) / 1000;
        var dd = (ev.done || 0) - (prev.done || 0);
        if (dt > 0 && dd >= 0) ev._speed = dd / dt;
      }
      ev._t = now;
      state.progress[ev.id] = ev;
      if (ev.type === 'done') toast('Saved: ' + (ev.title || ev.filename) + ' -> Music/MusicDownloader');
      if (ev.type === 'error') toast('Download failed: ' + (ev.message || ev.id), true);
      if (state.view === 'downloads') renderDownloads();
    },
  };

  function refreshDownloadsFromNative() {
    try {
      var reg = JSON.parse(N.listDownloads() || '{}');
      Object.keys(reg).forEach(function (id) {
        if (!state.progress[id] || state.progress[id].status === 'downloading') {
          state.progress[id] = {
            type: 'progress', id: id, status: reg[id].status, pct: reg[id].pct || 0,
            done: reg[id].done || 0, size: reg[id].size || 0,
            filename: reg[id].filename, title: reg[id].title, creator: reg[id].creator,
            cover: reg[id].cover || '', message: reg[id].message || '',
          };
        }
      });
    } catch (e) { /* preview shim or bridge missing */ }
  }

  function renderDownloads() {
    refreshDownloadsFromNative();
    var ids = Object.keys(state.progress);
    els.dlCount.textContent = String(ids.length);
    els.downloads.innerHTML = '';
    if (!ids.length) {
      els.downloads.innerHTML = '<li><div class="item-title">Nothing downloaded yet</div><div class="item-sub">Browse the home sections or search, then press DOWNLOAD MP3.</div></li>';
      return;
    }
    ids.sort(function (a, b) { return (state.progress[b].done || 0) - (state.progress[a].done || 0); });
    ids.forEach(function (id) {
      var ev = state.progress[id];
      var st = ev.status || 'downloading';
      var li = document.createElement('li');
      var top = document.createElement('div');
      top.className = 'item-top';
      var coverHtml = ev.cover ? '<img class="item-cover" loading="lazy" src="' + esc(ev.cover) + '" alt="" onerror="this.style.visibility=\'hidden\'" />' : '';
      top.innerHTML = coverHtml + '<div class="item-meta"><div class="item-title">' + esc(ev.title || ev.filename || id) + '</div>'
        + '<div class="item-sub"><span class="st-' + esc(st) + '">' + esc(st) + '</span>'
        + (ev.creator ? ' · ' + esc(ev.creator) : '') + ' · ' + esc(ev.filename || '')
        + (ev.size > 0 ? ' · ' + fmtBytes(ev.done || 0) + ' / ' + fmtBytes(ev.size) : (ev.done ? ' · ' + fmtBytes(ev.done) : ''))
        + (ev.message ? ' · ' + esc(ev.message) : '') + '</div></div>';
      var actions = document.createElement('div');
      actions.className = 'item-actions';
      if (st === 'downloading') {
        var cancel = document.createElement('button');
        cancel.className = 'btn warn';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', function () { N.cancelDownload(id); });
        actions.appendChild(cancel);
      }
      if (st === 'done') {
        var play = document.createElement('button');
        play.className = 'btn';
        play.textContent = 'Play';
        play.addEventListener('click', function () { playUrl('/dl/' + encodeURIComponent(id), ev.title || ev.filename, 'from your device'); });
        actions.appendChild(play);
      }
      var del = document.createElement('button');
      del.className = 'btn ghost';
      del.textContent = 'Delete';
      del.addEventListener('click', function () { N.deleteDownload(id); delete state.progress[id]; renderDownloads(); });
      actions.appendChild(del);
      top.appendChild(actions);
      li.appendChild(top);
      if (st === 'downloading') {
        var p = document.createElement('div');
        p.className = 'prog';
        p.innerHTML = '<i style="width:' + Math.max(0, Math.min(100, ev.pct || 0)) + '%"></i>';
        li.appendChild(p);
        var lab = document.createElement('div');
        lab.className = 'prog-label';
        var extra = '';
        if (ev.size > 0 && ev._speed > 0 && ev.pct < 100) {
          var eta = Math.max(0, (ev.size - (ev.done || 0)) / ev._speed);
          extra = ' · ' + fmtBytes(ev._speed) + '/s · ETA ' + (eta >= 60 ? Math.ceil(eta / 60) + 'm' : Math.ceil(eta) + 's');
        }
        lab.textContent = (ev.pct >= 0 ? ev.pct + '%' : '...') + (ev.size > 0 ? ' · ' + fmtBytes(ev.done || 0) + ' / ' + fmtBytes(ev.size) : '') + extra;
        li.appendChild(lab);
      }
      els.downloads.appendChild(li);
    });
  }

  /* --------------------------- player bar --------------------------- */
  function playUrl(src, title, sub) {
    els.playerBar.classList.remove('hidden');
    els.pbTitle.textContent = title || '—';
    els.pbSub.textContent = sub || '';
    els.pbAudio.src = src;
    els.pbAudio.play().catch(function () { /* user can press play on the controls */ });
  }
  els.pbAudio.addEventListener('play', function () { els.eq.classList.add('playing'); });
  els.pbAudio.addEventListener('pause', function () { els.eq.classList.remove('playing'); });
  els.pbAudio.addEventListener('ended', function () { els.eq.classList.remove('playing'); });
  els.pbClose.addEventListener('click', function () {
    els.pbAudio.pause();
    els.pbAudio.removeAttribute('src');
    els.eq.classList.remove('playing');
    els.playerBar.classList.add('hidden');
  });

  /* --------------------------- form / misc --------------------------- */
  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = els.input.value.trim();
    if (q) doSearch(q);
  });
  els.surpriseBtn.addEventListener('click', surpriseMe);
  els.sortSel.addEventListener('change', function () {
    state.sort = els.sortSel.value;
    var q = els.input.value.trim();
    if (q) doSearch(q);
  });
  els.clearFinished.addEventListener('click', function () {
    Object.keys(state.progress).forEach(function (id) {
      var st = state.progress[id].status;
      if (st === 'done' || st === 'cancelled' || st === 'error') {
        try { N.deleteDownload(id); } catch (e) { /* ignore */ }
        delete state.progress[id];
      }
    });
    renderDownloads();
    toast('Finished downloads cleared from the list');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== els.input && document.activeElement !== els.directUrl && document.activeElement !== els.directName) {
      e.preventDefault();
      els.input.focus();
    }
  });

  if (N && N.log) N.log('Gospel MP3 Downloader web UI loaded, platform=' + N.platform());
  updateNet();
  renderSourceChips();
  renderFmtChips();
  renderChips();
  refreshDownloadsFromNative();
  renderDownloads();
  switchView('home');
})();
