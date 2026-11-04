/* Music Downloader — app logic (runs inside the APK WebView).
 *
 * Search: Internet Archive advancedsearch API (mediatype:audio), metadata
 * API per item to list the downloadable audio files (mp3/ogg/flac/wav/m4a...).
 * Download: native bridge (MusicDLNative.startDownload) streams the file in
 * Java and saves it to Music/MusicDownloader via MediaStore; progress events
 * arrive via window.MusicDL.onEvent. Playback of finished downloads is served
 * locally by the app at /dl/<id>.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    form: $('searchForm'), input: $('searchInput'), status: $('searchStatus'),
    tabSearch: $('tabSearch'), tabDownloads: $('tabDownloads'),
    results: $('results'), downloads: $('downloads'), dlCount: $('dlCount'),
    playerBar: $('playerBar'), pbAudio: $('pbAudio'), pbTitle: $('pbTitle'), pbSub: $('pbSub'), pbClose: $('pbClose'),
  };
  var N = window.MusicDLNative;

  var state = {
    tab: 'search',
    metaCache: {},   // identifier -> {files:[{name,url,size,format,mime}], error}
    expanded: {},    // identifier -> bool
    progress: {},    // id -> event
  };

  var AUDIO_EXT = ['.mp3', '.ogg', '.opus', '.flac', '.m4a', '.wav', '.wma', '.aac', '.aiff'];
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

  /* --------------------------- search --------------------------- */
  function setStatus(msg, cls) {
    els.status.textContent = msg;
    els.status.className = 'status' + (cls ? ' ' + cls : '');
  }

  function search(q) {
    setStatus('searching archive.org for "' + q + '"...', 'busy');
    var query = 'mediatype:audio AND (' + q + ')';
    var url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(query)
      + '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=duration&fl[]=item_size&fl[]=format'
      + '&rows=40&page=1&output=json';
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var docs = (j.response && j.response.docs) || [];
      setStatus(docs.length + ' result(s)', 'ok');
      renderResults(docs);
    }).catch(function (e) {
      setStatus('search failed: ' + (e && e.message ? e.message : e) + ' — check your internet connection', 'err');
    });
  }

  function renderResults(docs) {
    els.results.innerHTML = '';
    if (!docs.length) {
      els.results.innerHTML = '<li><div class="item-title">No results</div><div class="item-sub">Try a different artist, song or genre.</div></li>';
      return;
    }
    docs.forEach(function (d) {
      var id = d.identifier;
      var li = document.createElement('li');
      var title = Array.isArray(d.title) ? d.title[0] : (d.title || id);
      var creator = Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || '');
      var formats = Array.isArray(d.format) ? d.format.join(', ') : (d.format || '');
      var top = document.createElement('div');
      top.className = 'item-top';
      top.innerHTML = '<div class="item-meta"><div class="item-title">' + esc(title) + '</div>'
        + '<div class="item-sub">' + esc(creator) + (fmtDur(d.duration) ? ' · ' + fmtDur(d.duration) : '')
        + (d.item_size ? ' · ' + fmtBytes(d.item_size) : '') + (formats ? ' · ' + esc(formats) : '') + '</div></div>';
      var actions = document.createElement('div');
      actions.className = 'item-actions';
      var filesBtn = document.createElement('button');
      filesBtn.className = 'btn';
      filesBtn.textContent = state.expanded[id] ? 'Hide files' : 'Show audio files';
      filesBtn.addEventListener('click', function () { toggleFiles(id, li); });
      actions.appendChild(filesBtn);
      top.appendChild(actions);
      li.appendChild(top);
      var files = document.createElement('div');
      files.className = 'files hidden';
      files.id = 'files-' + cssId(id);
      li.appendChild(files);
      els.results.appendChild(li);
    });
  }

  function cssId(id) { return String(id).replace(/[^A-Za-z0-9_-]/g, '_'); }

  function toggleFiles(id, li) {
    state.expanded[id] = !state.expanded[id];
    var box = li.querySelector('.files');
    if (state.expanded[id]) {
      box.classList.remove('hidden');
      if (!state.metaCache[id]) loadMeta(id, box);
      else renderFiles(id, box);
    } else {
      box.classList.add('hidden');
    }
    var btn = li.querySelector('.item-actions .btn');
    if (btn) btn.textContent = state.expanded[id] ? 'Hide files' : 'Show audio files';
  }

  function loadMeta(id, box) {
    box.innerHTML = '<div class="item-sub">loading files from archive.org...</div>';
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
        // prefer mp3, then ogg, then others; bigger quality first within same ext rank
        var rank = { '.mp3': 0, '.ogg': 1, '.opus': 1, '.flac': 2, '.m4a': 3, '.aac': 3, '.wav': 4, '.wma': 5, '.aiff': 4 };
        files.sort(function (a, b) {
          var ra = rank[extOf(a.name)] != null ? rank[extOf(a.name)] : 9;
          var rb = rank[extOf(b.name)] != null ? rank[extOf(b.name)] : 9;
          return ra - rb || b.size - a.size;
        });
        state.metaCache[id] = { files: files.slice(0, 8) };
        renderFiles(id, box);
      })
      .catch(function (e) {
        state.metaCache[id] = { error: String(e && e.message ? e.message : e) };
        box.innerHTML = '<div class="item-sub st-error">metadata failed: ' + esc(e && e.message ? e.message : e) + '</div>';
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
      var dlId = 'dl-' + id + '-' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
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
        var title = (els.results.querySelector('li') || {}).textContent || f.name;
        N.startDownload(dlId, f.url, f.name, f.name, '', f.mime);
        state.progress[dlId] = { type: 'progress', id: dlId, status: 'downloading', pct: 0, filename: f.name };
        switchTab('downloads');
        renderDownloads();
      });
      row.appendChild(prev);
      row.appendChild(dl);
      box.appendChild(row);
    });
  }

  /* --------------------------- downloads --------------------------- */
  window.MusicDL = {
    onEvent: function (ev) {
      if (!ev || !ev.id) return;
      state.progress[ev.id] = ev;
      if (ev.type === 'done' || ev.type === 'error') {
        try { refreshDownloadsFromNative(); } catch (e) { /* ignore */ }
      }
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
            message: reg[id].message || '',
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
      var li = document.createElement('li');
      var st = ev.status || 'downloading';
      var top = document.createElement('div');
      top.className = 'item-top';
      top.innerHTML = '<div class="item-meta"><div class="item-title">' + esc(ev.title || ev.filename || id) + '</div>'
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
    els.pbAudio.play().catch(function () { /* autoplay may need a tap on the controls */ });
  }
  els.pbClose.addEventListener('click', function () {
    els.pbAudio.pause();
    els.pbAudio.removeAttribute('src');
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
    if (q) search(q);
  });

  if (N && N.log) N.log('Music Downloader web UI loaded, platform=' + N.platform());
  refreshDownloadsFromNative();
  renderDownloads();
})();
