/* Music Downloader — app logic (runs inside the APK WebView).
 *
 * Multi-source music search over the internet — not only archive.org:
 *   - Internet Archive (advancedsearch + metadata APIs, lazy file lists)
 *   - Wikimedia Commons (w/api.php filetype:audio search, direct file URLs)
 *   - Openverse CC audio (api.openverse.org/v1/audio, keyless)
 *   - plus a "paste a direct link" mode for a file hosted on ANY website.
 *
 * Downloads go through the native bridge (MusicDLNative.startDownload):
 * streamed in Java and saved to Music/MusicDownloader via MediaStore;
 * progress events arrive via window.MusicDL.onEvent. Finished downloads
 * play locally at /dl/<id>. Extras: cover-art cards, quick-search chips,
 * search history, random "Surprise me", animated equalizer player bar,
 * online/offline indicator.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    netBanner: $('netBanner'), netPill: $('netPill'),
    form: $('searchForm'), input: $('searchInput'), status: $('searchStatus'),
    surpriseBtn: $('surpriseBtn'), quickChips: $('quickChips'), historyChips: $('historyChips'),
    sourceChips: $('sourceChips'), sortSel: $('sortSel'), fmtChips: $('fmtChips'),
    clearFinished: $('clearFinished'), toast: $('toast'),
    directToggle: $('directToggle'), directPanel: $('directPanel'), directUrl: $('directUrl'), directName: $('directName'), directGo: $('directGo'),
    tabSearch: $('tabSearch'), tabDownloads: $('tabDownloads'),
    results: $('results'), downloads: $('downloads'), dlCount: $('dlCount'),
    playerBar: $('playerBar'), pbAudio: $('pbAudio'), pbTitle: $('pbTitle'), pbSub: $('pbSub'),
    pbClose: $('pbClose'), eq: $('eq'),
  };
  var N = window.MusicDLNative;

  var state = {
    tab: 'search',
    source: 'all',
    sort: 'relevance',
    format: 'all',
    metaCache: {},   // archive identifier -> {files:[...], error}
    expanded: {},    // item id -> bool
    progress: {},    // download id -> last event
  };

  var AUDIO_EXT = ['.mp3', '.ogg', '.opus', '.flac', '.m4a', '.wav', '.wma', '.aac', '.aiff'];
  var SOURCES = [
    { key: 'all', label: 'All websites' },
    { key: 'archive', label: 'Internet Archive' },
    { key: 'commons', label: 'Wikimedia Commons' },
    { key: 'openverse', label: 'Openverse CC audio' },
  ];
  var SOURCE_LABEL = { archive: 'Internet Archive', commons: 'Wikimedia', openverse: 'Openverse', link: 'Direct link' };
  var QUICK = [
    { label: 'Live concerts', q: 'collection:etree' },
    { label: 'Jazz', q: 'jazz' },
    { label: 'Gospel', q: 'gospel' },
    { label: 'Classical', q: 'classical music' },
    { label: 'Afrobeat', q: 'afrobeat' },
    { label: 'Public domain 78s', q: 'collection:georgeblood' },
  ];
  var HIST_KEY = 'musicdl-history';
  var FORMATS = [
    { key: 'all', label: 'All' }, { key: '.mp3', label: 'MP3' }, { key: '.ogg', label: 'OGG' },
    { key: '.flac', label: 'FLAC' }, { key: '.wav', label: 'WAV' }, { key: '.m4a', label: 'M4A' },
  ];
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
  function itemHasFormat(item) {
    if (state.format === 'all') return true;
    var hay = (item.formats || '') + ' ' + (item.files || []).map(function (f) { return extOf(f.name); }).join(' ');
    if (item.source === 'archive' && !item.files) {
      // formats string from archive fl[]=format, e.g. "MP3, OGG"
      return hay.toLowerCase().indexOf(state.format.slice(1)) !== -1;
    }
    return hay.toLowerCase().indexOf(state.format) !== -1;
  }
  function sortItems(items) {
    if (state.sort === 'az') {
      return items.slice().sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); });
    }
    return items;
  }

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
  function stripTags(s) {
    return String(s == null ? '' : s).replace(/<[^>]*>/g, '').trim();
  }
  function baseName(url) {
    try {
      var p = decodeURIComponent(String(url).split('?')[0].split('#')[0]);
      var seg = p.split('/').filter(Boolean).pop() || '';
      return seg || 'song';
    } catch (e) { return 'song'; }
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

  /* --------------------------- source chips --------------------------- */
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

  /* --------------------------- sources --------------------------- */
  var ARCHIVE_SORT = {
    relevance: '',
    popular: '&sort[]=downloads%20desc',
    newest: '&sort[]=date%20desc',
  };
  function searchArchive(q) {
    var query = 'mediatype:audio AND (' + q + ')';
    var url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(query)
      + '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=duration&fl[]=item_size&fl[]=format'
      + '&rows=40&page=1&output=json' + (ARCHIVE_SORT[state.sort] || '');
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      return ((j.response && j.response.docs) || []).map(function (d) {
        var id = d.identifier;
        return {
          source: 'archive', id: id,
          title: Array.isArray(d.title) ? d.title[0] : (d.title || id),
          creator: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
          duration: d.duration || 0, size: d.item_size || 0,
          formats: Array.isArray(d.format) ? d.format.join(', ') : (d.format || ''),
          cover: coverUrl(id), files: null, // lazy: fetched from the metadata API
        };
      });
    });
  }

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
          source: 'commons', id: 'commons-' + p.pageid,
          title: name,
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
          title: a.title || name,
          creator: a.creator || '',
          duration: a.duration || 0, size: 0,
          formats: (a.license || '') + ' · ' + extOf(name).slice(1),
          cover: a.thumbnail || '',
          files: [{ name: name, url: a.url, size: 0, mime: mimeOf(name) }],
        };
      }).filter(function (it) { return it.files[0].url; });
    });
  }

  var SEARCHERS = { archive: searchArchive, commons: searchCommons, openverse: searchOpenverse };

  function setStatus(msg, cls) {
    els.status.textContent = msg;
    els.status.className = 'status' + (cls ? ' ' + cls : '');
  }

  function doSearch(query) {
    if (navigator.onLine === false) { setStatus('you are offline — connect to the internet to search', 'err'); return; }
    pushHistory(query);
    var keys = state.source === 'all' ? ['archive', 'commons', 'openverse'] : [state.source];
    setStatus('searching ' + (state.source === 'all' ? 'all websites' : SOURCE_LABEL[state.source]) + ' for "' + query + '"...', 'busy');
    renderSkeletons();
    var tasks = keys.map(function (k) {
      return SEARCHERS[k](query).then(function (items) {
        return { key: k, items: items, ok: true };
      }).catch(function (e) {
        return { key: k, items: [], ok: false, err: e };
      });
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
      setStatus(items.length + ' result(s) from ' + res.filter(function (r) { return r.ok; }).length + ' source(s)'
        + (failed.length ? ' — ' + failed.join('; ') : ''), items.length ? 'ok' : 'err');
      renderResults(items);
    });
  }

  /* Surprise me: random item from archive.org live/public-domain collections */
  function surpriseMe() {
    if (navigator.onLine === false) { setStatus('you are offline — connect to the internet first', 'err'); return; }
    setStatus('finding a random free track for you...', 'busy');
    searchArchive('collection:(etree OR georgeblood OR audio_live_music)').then(function (items) {
      // archive search above lacks the downloads-sort; re-query with sort for popularity
      return fetch('https://archive.org/advancedsearch.php?q=' + encodeURIComponent('mediatype:audio AND collection:(etree OR georgeblood OR audio_live_music)')
        + '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=duration&fl[]=item_size&rows=50&page=1&output=json&sort[]=downloads%20desc')
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var docs = (j.response && j.response.docs) || [];
          if (!docs.length) throw new Error('nothing found');
          var d = docs[Math.floor(Math.random() * docs.length)];
          var id = d.identifier;
          var item = {
            source: 'archive', id: id,
            title: Array.isArray(d.title) ? d.title[0] : (d.title || id),
            creator: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
            duration: d.duration || 0, size: d.item_size || 0,
            formats: '', cover: coverUrl(id), files: null,
          };
          setStatus('surprise: ' + item.title + ' — loading files...', 'ok');
          els.input.value = '';
          renderResults([item]);
          state.expanded[id] = true;
          loadMeta(id, function (files) {
            renderResults([item]);
            if (files.length) playUrl(files[0].url, files[0].name, 'surprise stream from archive.org');
          });
        });
    }).catch(function (e) {
      setStatus('surprise failed: ' + (e && e.message ? e.message : e), 'err');
    });
  }

  /* --------------------------- results --------------------------- */
  function renderSkeletons() {
    els.results.innerHTML = '';
    for (var i = 0; i < 8; i++) {
      var card = document.createElement('div');
      card.className = 'result-card skeleton-card';
      card.innerHTML = '<div class="cover"></div><div class="rc-body">'
        + '<div class="sk-line"></div><div class="sk-line short"></div><div class="sk-line short"></div></div>';
      els.results.appendChild(card);
    }
  }
  function renderResults(items) {
    els.results.innerHTML = '';
    if (!items.length) {
      els.results.innerHTML = '<div class="item-title" style="padding:8px">No results — try a different artist, song, genre or another source.</div>';
      return;
    }
    items.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'result-card';
      var cover = document.createElement('div');
      cover.className = 'cover';
      cover.innerHTML = '<span class="rc-source">' + esc(SOURCE_LABEL[item.source] || item.source) + '</span>'
        + '<div class="cover-fallback">MD</div>';
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
      var filesBtn = document.createElement('button');
      filesBtn.className = 'btn';
      filesBtn.textContent = state.expanded[item.id] ? 'Hide files' : 'Files';
      filesBtn.addEventListener('click', function () { toggleFiles(item, card); });
      var allBtn = document.createElement('button');
      allBtn.className = 'btn ghost';
      allBtn.textContent = 'Get all';
      allBtn.title = 'Download every audio file in this item';
      allBtn.addEventListener('click', function () { downloadAll(item); });
      actions.appendChild(filesBtn);
      actions.appendChild(allBtn);
      body.appendChild(actions);
      card.appendChild(body);

      var files = document.createElement('div');
      files.className = 'files hidden';
      files.style.padding = '0 10px 10px';
      card.appendChild(files);
      if (state.expanded[item.id]) ensureFiles(item, files);

      els.results.appendChild(card);
    });
  }

  function toggleFiles(item, card) {
    state.expanded[item.id] = !state.expanded[item.id];
    var box = card.querySelector('.files');
    if (state.expanded[item.id]) {
      box.classList.remove('hidden');
      ensureFiles(item, box);
    } else {
      box.classList.add('hidden');
    }
    var btn = card.querySelector('.rc-actions .btn');
    if (btn) btn.textContent = state.expanded[item.id] ? 'Hide files' : 'Files';
  }

  /* files for an item: ready-made for commons/openverse, lazy metadata for archive */
  function ensureFiles(item, box) {
    if (item.files) { renderFiles(item, box); return; }
    if (!state.metaCache[item.id]) {
      box.innerHTML = '<div class="item-sub">loading files...</div>';
      loadMeta(item.id, function () { renderFiles(item, box); });
    } else {
      renderFiles(item, box);
    }
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

  function renderFiles(item, box) {
    var files = item.files || (state.metaCache[item.id] && state.metaCache[item.id].files) || [];
    var err = !item.files && state.metaCache[item.id] && state.metaCache[item.id].error;
    box.innerHTML = '';
    if (err) {
      box.innerHTML = '<div class="item-sub st-error">metadata failed: ' + esc(err) + '</div>';
      return;
    }
    if (!files.length) {
      box.innerHTML = '<div class="item-sub">no directly downloadable audio files in this item</div>';
      return;
    }
    files.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = '<span class="file-name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>'
        + '<span class="file-size">' + fmtBytes(f.size) + '</span>';
      var prev = document.createElement('button');
      prev.className = 'btn ghost';
      prev.textContent = 'Preview';
      prev.addEventListener('click', function () { playUrl(f.url, f.name, 'streaming from ' + (SOURCE_LABEL[item.source] || item.source)); });
      var dl = document.createElement('button');
      dl.className = 'btn';
      dl.textContent = 'Download';
      dl.addEventListener('click', function () {
        dl.disabled = true;
        startOneDownload(item, f);
      });
      row.appendChild(prev);
      row.appendChild(dl);
      box.appendChild(row);
    });
  }

  function startOneDownload(item, f) {
    var dlId = 'dl-' + item.id + '-' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
    N.startDownload(dlId, f.url, f.name, item.title || f.name, item.creator || '', f.mime || mimeOf(f.name), item.cover || '');
    state.progress[dlId] = { type: 'progress', id: dlId, status: 'downloading', pct: 0, filename: f.name, title: item.title || f.name, creator: item.creator || '', cover: item.cover || '' };
    switchTab('downloads');
    renderDownloads();
    return dlId;
  }

  function downloadAll(item) {
    var files = item.files || (state.metaCache[item.id] && state.metaCache[item.id].files) || [];
    if (!files.length && item.source === 'archive') {
      loadMeta(item.id, function (fs) {
        fs.forEach(function (f) { startOneDownload(item, f); });
        setStatus('queued ' + fs.length + ' file(s) from ' + item.title, 'ok');
      });
    } else {
      files.forEach(function (f) { startOneDownload(item, f); });
      setStatus('queued ' + files.length + ' file(s) from ' + item.title, 'ok');
    }
  }

  /* --------------------------- direct link (any website) --------------------------- */
  els.directToggle.addEventListener('click', function () {
    els.directPanel.classList.toggle('hidden');
  });
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
            cover: reg[id].cover || '', message: reg[id].message || '',
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
      els.downloads.innerHTML = '<li><div class="item-title">Nothing downloaded yet</div><div class="item-sub">Search above and press Download on any file — or paste a direct link.</div></li>';
      return;
    }
    ids.sort(function (a, b) { return (state.progress[b].done || 0) - (state.progress[a].done || 0); });
    ids.forEach(function (id) {
      var ev = state.progress[id];
      var st = ev.status || 'downloading';
      var li = document.createElement('li');
      var top = document.createElement('div');
      top.className = 'item-top';
      var coverHtml = ev.cover
        ? '<img class="item-cover" loading="lazy" src="' + esc(ev.cover) + '" alt="" onerror="this.style.visibility=\'hidden\'" />'
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
    if (e.key === '/' && document.activeElement !== els.input && document.activeElement !== $('directUrl') && document.activeElement !== $('directName')) {
      e.preventDefault();
      els.input.focus();
    }
  });
  els.tabDownloads.addEventListener('click', function () { switchTab('downloads'); });

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = els.input.value.trim();
    if (q) doSearch(q);
  });
  els.surpriseBtn.addEventListener('click', surpriseMe);

  if (N && N.log) N.log('Music Downloader web UI v3 (multi-source) loaded, platform=' + N.platform());
  updateNet();
  renderSourceChips();
  renderFmtChips();
  renderChips();
  refreshDownloadsFromNative();
  renderDownloads();
})();
