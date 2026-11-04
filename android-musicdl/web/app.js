/* Music Downloader — app logic (runs inside the APK WebView).
 *
 * Search: Internet Archive advancedsearch API (mediatype:audio), metadata API
 * per item for the downloadable audio files (mp3/ogg/flac/wav/m4a...). Cover
 * art comes from https://archive.org/services/img/<identifier>.
 * Download: native bridge (MusicDLNative.startDownload) streams the file in
 * Java and saves it to Music/MusicDownloader via MediaStore; progress events
 * arrive via window.MusicDL.onEvent. Finished downloads play locally at
 * /dl/<id>. Extras: quick-search chips, search history, random "Surprise me"
 * discovery, animated equalizer player bar, online/offline indicator.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    netBanner: $('netBanner'), netPill: $('netPill'),
    form: $('searchForm'), input: $('searchInput'), status: $('searchStatus'),
    surpriseBtn: $('surpriseBtn'), quickChips: $('quickChips'), historyChips: $('historyChips'),
    tabSearch: $('tabSearch'), tabDownloads: $('tabDownloads'),
    results: $('results'), downloads: $('downloads'), dlCount: $('dlCount'),
    playerBar: $('playerBar'), pbAudio: $('pbAudio'), pbTitle: $('pbTitle'), pbSub: $('pbSub'),
    pbClose: $('pbClose'), eq: $('eq'),
  };
  var N = window.MusicDLNative;

  var state = {
    tab: 'search',
    metaCache: {},   // identifier -> {files:[...], error}
    expanded: {},    // identifier -> bool
    progress: {},    // download id -> last event
  };

  var AUDIO_EXT = ['.mp3', '.ogg', '.opus', '.flac', '.m4a', '.wav', '.wma', '.aac', '.aiff'];
  var QUICK = [
    { label: 'Live concerts', q: 'collection:etree' },
    { label: 'Jazz', q: 'jazz' },
    { label: 'Gospel', q: 'gospel' },
    { label: 'Classical', q: 'classical music' },
    { label: 'Afrobeat', q: 'afrobeat' },
    { label: 'Public domain 78s', q: 'collection:georgeblood' },
  ];
  var HIST_KEY = 'musicdl-history';

  function extOf(name) {
    var n = (name || '').toLowerCase();
    for (var i = 0; i < AUDIO_EXT.length; i++) if (n.endsWith(AUDIO_EXT[i])) return AUDIO_EXT[i];
    return '';
  }
  function mimeOf(name) {
    var e = extOf(name);
    return { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
             '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.wma': 'audio/x-ms-wma', '.aac': 'audio/aac',
             '.aiff': 'audio/aiff' }[e] || 'audio/mpeg';
  }
  function fmtBytes(n) {
    if (!n || n < 0) return '?';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(n >= 100 || i === 0 ? 0 : 1) + ' ' + u[i];
  }
  function fmtDur(sec) {
    sec = parseInt(sec, 10);
    if (!sec) return '';
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function coverUrl(id) { return 'https://archive.org/services/img/' + encodeURIComponent(id); }
  function cssId(id) { return String(id).replace(/[^A-Za-z0-9_-]/g, '_'); }

  /* --------------------------- net status --------------------------- */
  function updateNet() {
    var on = navigator.onLine !== false;
    els.netPill.textContent = on ? 'online' : 'offline';
    els.netPill.classList.toggle('off', !on);
    els.netBanner.classList.toggle('hidden', on);
  }
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);

  /* --------------------------- chips / history --------------------------- */
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

  /* --------------------------- search --------------------------- */
  function setStatus(msg, cls) {
    els.status.textContent = msg;
    els.status.className = 'status' + (cls ? ' ' + cls : '');
  }

  function searchApi(query, rows, extra) {
    var q = 'mediatype:audio AND (' + query + ')';
    var url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q)
      + '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=duration&fl[]=item_size&fl[]=format'
      + '&rows=' + (rows || 40) + '&page=1&output=json' + (extra || '');
    return fetch(url).then(function (r) { return r.json(); });
  }

  function doSearch(query) {
    if (navigator.onLine === false) { setStatus('you are offline — connect to the internet to search', 'err'); return; }
    pushHistory(query);
    setStatus('searching archive.org for "' + query + '"...', 'busy');
    searchApi(query, 40).then(function (j) {
      var docs = (j.response && j.response.docs) || [];
      setStatus(docs.length + ' result(s)', 'ok');
      renderResults(docs);
    }).catch(function (e) {
      setStatus('search failed: ' + (e && e.message ? e.message : e) + ' — check your internet connection', 'err');
    });
  }

  /* Surprise me: random item from the live-music / public-domain collections */
  function surpriseMe() {
    if (navigator.onLine === false) { setStatus('you are offline — connect to the internet first', 'err'); return; }
    setStatus('finding a random free track for you...', 'busy');
    searchApi('collection:(etree OR georgeblood OR audio_live_music)', 50, '&sort[]=downloads%20desc').then(function (j) {
      var docs = (j.response && j.response.docs) || [];
      if (!docs.length) { setStatus('no surprise found, try a normal search', 'err'); return; }
      var pick = docs[Math.floor(Math.random() * docs.length)];
      setStatus('surprise: ' + (Array.isArray(pick.title) ? pick.title[0] : pick.title) + ' — loading files...', 'ok');
      els.input.value = '';
      renderResults([pick]);
      // auto-expand and auto-preview the best file
      var id = pick.identifier;
      state.expanded[id] = true;
      loadMeta(id, function (files) {
        renderResults([pick]);
        if (files.length) playUrl(files[0].url, files[0].name, 'surprise stream from archive.org');
      });
    }).catch(function (e) {
      setStatus('surprise failed: ' + (e && e.message ? e.message : e), 'err');
    });
  }

  function renderResults(docs) {
    els.results.innerHTML = '';
    if (!docs.length) {
      els.results.innerHTML = '<div class="item-title" style="padding:8px">No results — try a different artist, song or genre.</div>';
      return;
    }
    docs.forEach(function (d) {
      var id = d.identifier;
      var title = Array.isArray(d.title) ? d.title[0] : (d.title || id);
      var creator = Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || '');
      var formats = Array.isArray(d.format) ? d.format.join(', ') : (d.format || '');

      var card = document.createElement('div');
      card.className = 'result-card';
      var cover = document.createElement('div');
      cover.className = 'cover';
      cover.innerHTML = '<div class="cover-fallback">MD</div>';
      var img = document.createElement('img');
      img.src = coverUrl(id);
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('load', function () {
        var fb = cover.querySelector('.cover-fallback');
        if (fb) fb.style.display = 'none';
      });
      img.addEventListener('error', function () { img.style.display = 'none'; });
      cover.appendChild(img);
      card.appendChild(cover);

      var body = document.createElement('div');
      body.className = 'rc-body';
      body.innerHTML = '<div class="rc-title" title="' + esc(title) + '">' + esc(title) + '</div>'
        + '<div class="rc-sub">' + esc(creator) + (fmtDur(d.duration) ? ' · ' + fmtDur(d.duration) : '') + (d.item_size ? ' · ' + fmtBytes(d.item_size) : '') + '</div>'
        + (formats ? '<div class="rc-formats">' + esc(formats) + '</div>' : '');
      var actions = document.createElement('div');
      actions.className = 'rc-actions';
      var filesBtn = document.createElement('button');
      filesBtn.className = 'btn';
      filesBtn.textContent = state.expanded[id] ? 'Hide files' : 'Files';
      filesBtn.addEventListener('click', function () { toggleFiles(id, card); });
      var allBtn = document.createElement('button');
      allBtn.className = 'btn ghost';
      allBtn.textContent = 'Get all';
      allBtn.title = 'Download every audio file in this item';
      allBtn.addEventListener('click', function () { downloadAll(id, title, creator); });
      actions.appendChild(filesBtn);
      actions.appendChild(allBtn);
      body.appendChild(actions);
      card.appendChild(body);

      var files = document.createElement('div');
      files.className = 'files hidden';
      files.style.padding = '0 10px 10px';
      files.id = 'files-' + cssId(id);
      card.appendChild(files);
      if (state.expanded[id] && state.metaCache[id]) renderFiles(id, files);

      els.results.appendChild(card);
    });
  }

  function toggleFiles(id, card) {
    state.expanded[id] = !state.expanded[id];
    var box = card.querySelector('.files');
    if (state.expanded[id]) {
      box.classList.remove('hidden');
      if (!state.metaCache[id]) loadMeta(id, function () { renderFiles(id, box); });
      else renderFiles(id, box);
    } else {
      box.classList.add('hidden');
    }
    var btn = card.querySelector('.rc-actions .btn');
    if (btn) btn.textContent = state.expanded[id] ? 'Hide files' : 'Files';
  }

  function loadMeta(id, done) {
    fetch('https://archive.org/metadata/' + encodeURIComponent(id)).then(function (r) { return r.json(); })
      .then(function (m) {
        var files = [];
        (m.files || []).forEach(function (f) {
          if (f.name && extOf(f.name) && f.name.indexOf('/') === -1) {
            files.push({
              name: f.name,
              url: 'https://archive.org/download/' + id + '/' + encodeURIComponent(f.name).replace(/%2F/gi, '/'),
              size: parseInt(f.size, 10) || 0,
              format: f.format || '',
              mime: mimeOf(f.name),
            });
          }
        });
        var rank = { '.mp3': 0, '.ogg': 1, '.opus': 1, '.flac': 2, '.m4a': 3, '.aac': 3, '.wav': 4, '.aiff': 4, '.wma': 5 };
        files.sort(function (a, b) {
          var ra = rank[extOf(a.name)] != null ? rank[extOf(a.name)] : 9;
          var rb = rank[extOf(b.name)] != null ? rank[extOf(b.name)] : 9;
          return ra - rb || b.size - a.size;
        });
        files = files.slice(0, 8);
        state.metaCache[id] = { files: files };
        if (done) done(files);
      })
      .catch(function (e) {
        state.metaCache[id] = { error: String(e && e.message ? e.message : e), files: [] };
        if (done) done([]);
      });
  }

  function renderFiles(id, box) {
    var cache = state.metaCache[id];
    box.innerHTML = '';
    if (cache.error) {
      box.innerHTML = '<div class="item-sub st-error">metadata failed: ' + esc(cache.error) + '</div>';
      return;
    }
    if (!cache.files.length) {
      box.innerHTML = '<div class="item-sub">no directly downloadable audio files in this item</div>';
      return;
    }
    cache.files.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = '<span class="file-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>'
        + '<span class="file-size">' + fmtBytes(f.size) + '</span>';
      var prev = document.createElement('button');
      prev.className = 'btn ghost';
      prev.textContent = 'Preview';
      prev.addEventListener('click', function () { playUrl(f.url, f.name, 'streaming from archive.org'); });
      var dl = document.createElement('button');
      dl.className = 'btn';
      dl.textContent = 'Download';
      dl.addEventListener('click', function () {
        dl.disabled = true;
        startOneDownload(id, f);
      });
      row.appendChild(prev);
      row.appendChild(dl);
      box.appendChild(row);
    });
  }

  function startOneDownload(identifier, f, title, creator) {
    var dlId = 'dl-' + identifier + '-' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
    N.startDownload(dlId, f.url, f.name, title || f.name, creator || '', f.mime, identifier);
    state.progress[dlId] = { type: 'progress', id: dlId, status: 'downloading', pct: 0, filename: f.name, title: title || f.name, creator: creator || '', identifier: identifier };
    switchTab('downloads');
    renderDownloads();
    return dlId;
  }

  function downloadAll(id, title, creator) {
    var cache = state.metaCache[id];
    var files = cache && cache.files ? cache.files : [];
    if (!files.length) {
      loadMeta(id, function (fs) {
        fs.forEach(function (f) { startOneDownload(id, f, title, creator); });
        setStatus('queued ' + fs.length + ' file(s) from ' + (title || id), 'ok');
      });
    } else {
      files.forEach(function (f) { startOneDownload(id, f, title, creator); });
      setStatus('queued ' + files.length + ' file(s) from ' + (title || id), 'ok');
    }
  }

  /* --------------------------- downloads --------------------------- */
  window.MusicDL = {
    onEvent: function (ev) {
      if (!ev || !ev.id) return;
      state.progress[ev.id] = ev;
      if (state.tab === 'downloads') renderDownloads();
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
            identifier: reg[id].identifier || '', message: reg[id].message || '',
          };
        }
      });
    } catch (e) { /* ignore */ }
  }

  function renderDownloads() {
    refreshDownloadsFromNative();
    var ids = Object.keys(state.progress);
    els.dlCount.textContent = String(ids.length);
    els.downloads.innerHTML = '';
    if (!ids.length) {
      els.downloads.innerHTML = '<li><div class="item-title">Nothing downloaded yet</div><div class="item-sub">Search above and press Download on any file.</div></li>';
      return;
    }
    ids.sort(function (a, b) { return (state.progress[b].done || 0) - (state.progress[a].done || 0); });
    ids.forEach(function (id) {
      var ev = state.progress[id];
      var st = ev.status || 'downloading';
      var li = document.createElement('li');
      var top = document.createElement('div');
      top.className = 'item-top';
      var coverHtml = ev.identifier
        ? '<img class="item-cover" loading="lazy" src="' + coverUrl(ev.identifier) + '" alt="" onerror="this.style.visibility=\'hidden\'" />'
        : '';
      top.innerHTML = coverHtml + '<div class="item-meta"><div class="item-title">' + esc(ev.title || ev.filename || id) + '</div>'
        + '<div class="item-sub"><span class="st-' + esc(st) + '">' + esc(st) + '</span>'
        + (ev.creator ? ' · ' + esc(ev.creator) : '')
        + ' · ' + esc(ev.filename || '')
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
      del.addEventListener('click', function () {
        N.deleteDownload(id);
        delete state.progress[id];
        renderDownloads();
      });
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
        lab.textContent = (ev.pct >= 0 ? ev.pct + '%' : '...') + (ev.size > 0 ? ' · ' + fmtBytes(ev.done || 0) + ' / ' + fmtBytes(ev.size) : '');
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

  /* --------------------------- tabs / form --------------------------- */
  function switchTab(tab) {
    state.tab = tab;
    els.tabSearch.classList.toggle('active', tab === 'search');
    els.tabDownloads.classList.toggle('active', tab === 'downloads');
    els.results.classList.toggle('hidden', tab !== 'search');
    els.downloads.classList.toggle('hidden', tab !== 'downloads');
    if (tab === 'downloads') renderDownloads();
  }
  els.tabSearch.addEventListener('click', function () { switchTab('search'); });
  els.tabDownloads.addEventListener('click', function () { switchTab('downloads'); });

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = els.input.value.trim();
    if (q) doSearch(q);
  });
  els.surpriseBtn.addEventListener('click', surpriseMe);

  if (N && N.log) N.log('Music Downloader web UI v2 loaded, platform=' + N.platform());
  updateNet();
  renderChips();
  refreshDownloadsFromNative();
  renderDownloads();
})();
