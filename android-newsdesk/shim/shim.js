/* ============================================================================
 * NewsDesk Studio — Android in-app backend shim  (assets/www/__shim.js)
 *
 * Injected by MainActivity into every HTML page served from the APK. It
 * re-implements the whole server.py backend in pure JS so the bundled web app
 * runs fully offline inside the APK:
 *
 *   - window.fetch  is wrapped: /api/* requests are answered here (same routes,
 *     payloads and broadcast semantics as server.py); everything else passes
 *     through to the native asset server.
 *   - window.WebSocket is replaced by a fake backed by BroadcastChannel, so the
 *     control panel and the overlay (iframes of the same WebView) stay
 *     live-synced exactly like they do over the real /ws socket.
 *   - state + presets/lyrics persist in localStorage; uploads go through the
 *     native NewsDeskBridge into filesDir/uploads (served at /uploads/*).
 *   - the KJV bible (bible/kjv.dat, zlib-packed) is inflated with
 *     DecompressionStream and parsed with the same layout as bible.py.
 *
 * Camera-over-wifi / WHEP need the desktop server (WebRTC signalling, HTTPS
 * listener) and are stubbed with plain-language errors.
 * ========================================================================== */
(function () {
  if (window.__ndShim) return;
  var SHIM = { version: '1.5-apk' };
  window.__ndShim = SHIM;

  var APP_NAME = 'NewsDesk Studio';
  var APP_VERSION = '1.5';
  var MAINTAINER = 'Emmanuel Suah';
  var START = Date.now();
  var ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];
  var CAM_ERR = 'Camera-over-wifi needs the desktop server.py — not available in this APK build.';
  var VIDEO_EXT = ['.mp4', '.webm', '.m4v', '.mov', '.ogv'];
  var IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];
  var MAX_CHARS = 1200;

  var origFetch = window.fetch ? window.fetch.bind(window) : null;

  // ------------------------------------------------------------------
  // persistent store (localStorage, shared by all same-origin frames)
  // ------------------------------------------------------------------
  function lsGet(k) {
    try { var v = localStorage.getItem('nd_' + k); return v == null ? null : JSON.parse(v); }
    catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem('nd_' + k, JSON.stringify(v)); } catch (e) {}
  }

  var state = null;
  var presets = {};
  var lyrics = [];
  var storeReady = null;

  function ensureStore() {
    if (storeReady) return storeReady;
    storeReady = (async function () {
      var def = {};
      try { def = await (await origFetch('/state.json')).json(); } catch (e) {}
      state = Object.assign({}, def);
      var saved = lsGet('state');
      if (saved && typeof saved === 'object') state = Object.assign(state, saved);
      var p = {};
      try { p = await (await origFetch('/presets.json')).json(); } catch (e) {}
      var sp = lsGet('presets');
      if (sp && sp.presets) {
        presets = sp.presets;
        lyrics = sp.lyrics || [];
      } else {
        lyrics = (p && p._lyrics) || [];
        presets = {};
        for (var k in (p || {})) if (k !== '_lyrics') presets[k] = p[k];
      }
    })();
    return storeReady;
  }

  function snap() { return JSON.parse(JSON.stringify(state || {})); }
  function persist() {
    lsSet('state', state);
    lsSet('presets', { presets: presets, lyrics: lyrics });
  }

  // ------------------------------------------------------------------
  // fake WebSocket + cross-frame message bus (BroadcastChannel)
  // ------------------------------------------------------------------
  var myId = 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  var subs = [];          // FakeWebSocket instances living in THIS page
  var peers = {};         // remote shim instances: id -> {role, t}
  var bc = null;
  try { bc = new BroadcastChannel('newsdesk-ws'); } catch (e) { bc = null; }

  function dispatchToLocal(msg, role) {
    var payload = JSON.stringify(msg);
    subs.slice().forEach(function (s) {
      if (s.readyState !== 1) return;
      if (role && s.__role !== role) return;
      try { if (s.onmessage) s.onmessage({ data: payload }); } catch (e) {}
    });
  }
  function deliver(msg, role) {           // server broadcast(): role or all
    dispatchToLocal(msg, role || null);
    if (bc) { try { bc.postMessage({ __nd: 1, from: myId, role: role || null, msg: msg }); } catch (e) {} }
  }
  function sendTo(sock, msg) {
    try { if (sock.onmessage) sock.onmessage({ data: JSON.stringify(msg) }); } catch (e) {}
  }

  if (bc) {
    bc.onmessage = function (ev) {
      var d = ev.data;
      if (!d) return;
      if (d.__nd === 1) {
        if (d.from !== myId) dispatchToLocal(d.msg, d.role);
      } else if (d.__nd === 2) {
        peers[d.id] = { role: d.role, t: d.t };
      }
    };
  }
  function announce(role) {
    if (bc) { try { bc.postMessage({ __nd: 2, id: myId, role: role || null, t: Date.now() }); } catch (e) {} }
  }
  setInterval(function () {
    var now = Date.now();
    for (var k in peers) if (now - peers[k].t > 4000) delete peers[k];
  }, 1000);
  function myRole() {
    for (var i = 0; i < subs.length; i++) if (subs[i].readyState === 1) return subs[i].__role;
    return null;
  }
  setInterval(function () { announce(myRole()); }, 1500);

  function clientStats() {
    var total = 0, overlay = 0, control = 0;
    subs.forEach(function (s) {
      if (s.readyState !== 1) return;
      total++;
      if (s.__role === 'overlay') overlay++;
      else if (s.__role === 'control') control++;
    });
    for (var id in peers) {
      var r = peers[id].role;
      total++;
      if (r === 'overlay') overlay++;
      else if (r === 'control') control++;
    }
    return { total: total, overlay: overlay, control: control };
  }

  function FakeWebSocket(url) {
    this.url = String(url);
    this.readyState = 0;
    this.__role = 'unknown';
    this.__key = '';
    this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
    var self = this;
    subs.push(this);
    setTimeout(function () {
      if (self.readyState === 0) {
        self.readyState = 1;
        announce(self.__role === 'unknown' ? null : self.__role);
        try { if (self.onopen) self.onopen({}); } catch (e) {}
      }
    }, 0);
  }
  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSING = 2;
  FakeWebSocket.CLOSED = 3;
  FakeWebSocket.prototype.send = function (data) {
    var self = this;
    setTimeout(function () {
      if (self.readyState !== 1) return;
      var msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      handleWs(self, msg);
    }, 0);
  };
  FakeWebSocket.prototype.close = function () {
    if (this.readyState === 3) return;
    this.readyState = 3;
    var i = subs.indexOf(this);
    if (i >= 0) subs.splice(i, 1);
    try { if (this.onclose) this.onclose({}); } catch (e) {}
    announce(myRole());
    deliver({ type: 'clients', clients: clientStats() }, 'control');
  };
  window.WebSocket = FakeWebSocket;

  function handleWs(sock, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      var role = ['control', 'overlay', 'camera'].indexOf(msg.role) >= 0 ? msg.role : 'control';
      sock.__role = role;
      sock.__key = msg.key || '';
      announce(role);
      sendTo(sock, { type: 'state', state: snap(), clients: clientStats() });
      deliver({ type: 'clients', clients: clientStats() }, 'control');
    } else if (msg.type === 'patch') {
      var p = msg.patch || {};
      if (typeof p === 'object') {
        Object.assign(state, p);
        persist();
        deliver({ type: 'patch', patch: p, state: snap() }, null);
      }
    } else if (msg.type === 'get') {
      sendTo(sock, { type: 'state', state: snap(), clients: clientStats() });
    } else if (msg.type === 'sting') {
      deliver({ type: 'sting', kind: msg.kind || 'wipe' }, null);
    } else if (msg.type === 'reload') {
      deliver({ type: 'reload' }, null);
    }
    // cam-* WebRTC signalling: no camera server in the APK — ignored
  }

  // ------------------------------------------------------------------
  // fetch override -> /api/* handled in-page
  // ------------------------------------------------------------------
  function jsonRes(obj, code) {
    return new Response(JSON.stringify(obj), {
      status: code || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  window.fetch = function (input, init) {
    var urlStr = (typeof input === 'string') ? input : ((input && input.url) || String(input));
    var u;
    try { u = new URL(urlStr, location.href); } catch (e) { return origFetch(input, init); }
    var local = (u.host === location.host) || u.host === '127.0.0.1:8770' || u.host === 'localhost:8770';
    if (local && u.pathname.indexOf('/api/') === 0) {
      return Promise.resolve().then(function () {
        return handleApi((init && init.method) || 'GET', u, init);
      });
    }
    return origFetch(input, init);
  };

  async function readJson(init) {
    if (!init || !init.body) return {};
    if (typeof init.body === 'string') {
      try { return JSON.parse(init.body || '{}'); } catch (e) { return {}; }
    }
    return {};
  }

  function callBridge(method) {
    if (!window.NewsDeskBridge) return { ok: false, error: 'native bridge missing' };
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      var r = window.NewsDeskBridge[method].apply(window.NewsDeskBridge, args);
      return JSON.parse(r);
    } catch (e) {
      return { ok: false, error: 'bridge error: ' + e };
    }
  }
  function bridgeList() {
    var r = callBridge('listUploads');
    return Array.isArray(r) ? r : (r.files || []);
  }

  function pick(obj, keys) {
    var o = {};
    keys.forEach(function (k) { o[k] = obj ? obj[k] : undefined; });
    return o;
  }

  function applyPatch(patch, role) {   // STATE.update + save + broadcast
    Object.assign(state, patch);
    persist();
    deliver({ type: 'patch', patch: patch, state: snap() }, role === undefined ? null : role);
  }

  // ------------------------------------------------------------------
  // playlist runner (server.py PLAY_TIMER)
  // ------------------------------------------------------------------
  var PLAY = { timer: null, nextAt: 0, index: 0, playing: false };

  function playlistApplyItem(item) {
    var patch = {
      headline: item.headline || '',
      eyebrow: item.eyebrow || '',
      logoText: item.logoText || (state.logoText || 'NEWS'),
      showLowerThird: true
    };
    ['poster', 'posterMode', 'showPoster', 'showTicker2', 'ticker2'].forEach(function (k) {
      if (k in item && item[k] !== null && item[k] !== '') patch[k] = item[k];
    });
    if (!item.poster) patch.showPoster = false;
    applyPatch(patch, null);
  }

  function playlistEnd() {
    PLAY.playing = false;
    PLAY.nextAt = 0;
    if (PLAY.timer) { clearTimeout(PLAY.timer); PLAY.timer = null; }
    deliver({ type: 'playlist', index: PLAY.index, playing: false }, 'control');
  }

  function playlistStart(index, loop) {
    if (PLAY.timer) { clearTimeout(PLAY.timer); PLAY.timer = null; }
    PLAY.playing = false;
    var items = state.playlist || [];
    if (!items.length) return { ok: false, error: 'playlist is empty' };
    var idx = (index === null || index === undefined || index === '') ? PLAY.index : parseInt(index, 10);
    if (isNaN(idx)) idx = 0;
    idx = Math.max(0, Math.min(idx, items.length - 1));
    PLAY.playing = true;
    var i = idx;
    (function step() {
      if (!PLAY.playing) return;
      var itemsNow = state.playlist || [];
      if (!itemsNow.length) { playlistEnd(); return; }
      if (i >= itemsNow.length) {
        if (!loop) { playlistEnd(); return; }
        i = 0;
      }
      var item = itemsNow[i];
      PLAY.index = i;
      playlistApplyItem(item);
      deliver({ type: 'playlist', index: i, total: itemsNow.length, playing: true }, 'control');
      var dur = parseFloat(item.dur || 8);
      if (isNaN(dur) || dur <= 0) dur = 8;
      PLAY.nextAt = Date.now() / 1000 + dur;
      PLAY.timer = setTimeout(function () { i += 1; step(); }, dur * 1000);
    })();
    return { ok: true, index: idx };
  }

  function playlistStop() {
    var was = PLAY.index;
    playlistEnd();
    PLAY.index = was;
    return { ok: true };
  }

  function playlistJump(index) {
    var items = state.playlist || [];
    if (!items.length) return { ok: false, error: 'playlist is empty' };
    index = Math.max(0, Math.min(parseInt(index, 10) || 0, items.length - 1));
    playlistApplyItem(items[index]);
    PLAY.index = index;
    deliver({ type: 'playlist', index: index, playing: PLAY.playing }, 'control');
    return { ok: true, index: index };
  }

  // ------------------------------------------------------------------
  // countdown (server.py CD_TIMER)
  // ------------------------------------------------------------------
  var CD = { timer: null };

  function countdownExpire(deadline) {
    var live = state.countdownEndsAt || 0;
    if (Math.abs(live - deadline) > 0.5) return;   // stale timer
    CD.timer = null;
    state.showCountdown = false;
    state.countdownEndsAt = 0;
    state.countdown = 0;
    persist();
    var patch = { showCountdown: false, countdownEndsAt: 0, countdown: 0 };
    deliver({ type: 'patch', patch: patch, state: snap() }, null);
    deliver({ type: 'countdown-done' }, 'control');
  }

  function scheduleCountdown(seconds, label) {
    seconds = Math.max(0, Math.round(parseFloat(seconds || 0) || 0));
    if (CD.timer) { clearTimeout(CD.timer); CD.timer = null; }
    if (seconds <= 0) { state.countdownEndsAt = 0; return 0; }
    var deadline = Date.now() / 1000 + seconds;
    state.countdownEndsAt = deadline;
    state.countdown = seconds;
    if (label !== null && label !== undefined) state.countdownLabel = label;
    CD.timer = setTimeout(function () { countdownExpire(deadline); }, seconds * 1000);
    return deadline;
  }

  function countdownRemaining() {
    var ends = state.countdownEndsAt || 0;
    if (!ends) return 0;
    return Math.max(0, Math.round(ends - Date.now() / 1000));
  }

  // ------------------------------------------------------------------
  // KJV bible — port of bible.py over bible/kjv.dat (zlib, big-endian)
  // ------------------------------------------------------------------
  var BIBLE = { books: null, meta: null, index: null };

  async function inflate(u8) {
    var ds = new DecompressionStream('deflate');       // zlib wrapper (RFC 1950)
    var stream = new Blob([u8]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function loadBible() {
    if (BIBLE.books) return;
    var datP = origFetch('/bible/kjv.dat').then(function (r) { return r.arrayBuffer(); });
    var metaP = origFetch('/bible/kjv.json').then(function (r) { return r.json(); });
    var raw = await inflate(new Uint8Array(await datP));
    BIBLE.meta = await metaP;
    var pos = 0, dec = new TextDecoder('utf-8');
    function u8() { return raw[pos++]; }
    function u16() { var v = (raw[pos] << 8) | raw[pos + 1]; pos += 2; return v; }
    function str(n) { var s = dec.decode(raw.subarray(pos, pos + n)); pos += n; return s; }
    var nbooks = u16(), books = [];
    for (var i = 0; i < nbooks; i++) {
      var nlen = u8(), name = str(nlen), nch = u8(), chapters = [];
      for (var c = 0; c < nch; c++) {
        var nv = u16(), verses = [];
        for (var v = 0; v < nv; v++) { var vlen = u16(); verses.push(str(vlen)); }
        chapters.push(verses);
      }
      books.push({ name: name, chapters: chapters });
    }
    BIBLE.books = books;
  }

  var ROMAN_PREFIX = { i: 1, ii: 2, iii: 3, '1': 1, '2': 2, '3': 3, first: 1, second: 2, third: 3 };
  function expandRoman(text) {
    var t = String(text || '').trim().toLowerCase();
    t = t.replace(/^(first|second|third)\b/, function (m) { return String(ROMAN_PREFIX[m]); });
    t = t.replace(/\b(1st|2nd|3rd)\b/g, function (m) { return m.charAt(0); });
    var m = t.match(/^(iii|ii|i)\s+(.*)$/);
    if (m) t = String(ROMAN_PREFIX[m[1]]) + ' ' + m[2];
    return t;
  }
  function normalise(book) {
    var b = expandRoman(book).replace(/\./g, '').replace(/\u00a0/g, ' ');
    return b.replace(/\s+/g, '');
  }
  function findBook(raw) {
    var aliases = (BIBLE.meta && BIBLE.meta.aliases) || {};
    var key = normalise(raw);
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(aliases, key)) return aliases[key];
    for (var i = 0; i < BIBLE.books.length; i++) {
      if (normalise(BIBLE.books[i].name) === key) return i;
    }
    var names = (BIBLE.meta && BIBLE.meta.names) || [];
    var cands = [];
    for (var j = 0; j < names.length; j++) {
      if (normalise(names[j]).indexOf(key) === 0) cands.push(j);
    }
    if (cands.length === 1) return cands[0];
    return null;
  }

  var REF_RE = /^\s*((?:[1-3]|i{1,3}|first|second|third|1st|2nd|3rd)?\.?\s*[a-z][a-z\s]*?)\s*\.?\s*(?:(\d{1,3})(?:\s*[:.\s]\s*(\d{1,3})(?:\s*(?:-|\u2013|\u2014|to)\s*(\d{1,3}))?)?)?\s*$/i;
  var LAST_MISS = null;

  function refLabel(r) {
    if (r.chapter == null) return r.book;
    if (r.v1 == null) return r.book + ' ' + r.chapter;
    if (r.v2 && r.v2 !== r.v1) return r.book + ' ' + r.chapter + ':' + r.v1 + '-' + r.v2;
    return r.book + ' ' + r.chapter + ':' + r.v1;
  }
  function refDict(r) {
    return { book: r.book, chapter: r.chapter, verse1: r.v1, verse2: r.v2, label: refLabel(r) };
  }

  function parseOne(text) {
    var raw = String(text || '').trim();
    if (!raw) return null;
    var m = REF_RE.exec(raw);
    if (!m) return null;
    var bi = findBook(m[1] || '');
    if (bi === null) return null;
    LAST_MISS = null;
    var book = BIBLE.books[bi];
    var nch = book.chapters.length;
    var ch = parseInt(m[2] || '1', 10);
    if (ch < 1 || ch > nch) return null;
    var v1 = m[3] ? parseInt(m[3], 10) : null;
    var v2 = m[4] ? parseInt(m[4], 10) : (v1 != null ? v1 : null);
    var nv = book.chapters[ch - 1].length;
    if (v1 == null) return { bookIndex: bi, book: book.name, chapter: ch, v1: null, v2: null };
    if (v1 < 1 || v2 < 1 || v1 > nv || v2 > nv) {
      LAST_MISS = book.name + ' ' + ch + ' has ' + nv + ' verse' + (nv === 1 ? '' : 's') +
        ' — there is no verse ' + Math.max(v1, v2) + '.';
      return null;
    }
    return { bookIndex: bi, book: book.name, chapter: ch, v1: v1, v2: Math.max(v1, v2) };
  }

  function parseRefs(text) {
    var out = [];
    String(text || '').split(/[;\n]+/).forEach(function (chunk) {
      chunk = chunk.trim();
      if (!chunk) return;
      var parts = chunk.split(/,\s*/);
      var base = parseOne(parts[0]);
      if (base) out.push(base);
      if (parts.length > 1 && base) {
        for (var i = 1; i < parts.length; i++) {
          if (!base.chapter) continue;
          var sub = parseOne(base.book + ' ' + base.chapter + ':' + parts[i]);
          if (sub) out.push(sub);
        }
      }
    });
    return out;
  }

  function verseCount(bi, ch) { return BIBLE.books[bi].chapters[ch - 1].length; }
  function chapterCount(bi) { return BIBLE.books[bi].chapters.length; }

  function verseText(ref) {
    var verses = BIBLE.books[ref.bookIndex].chapters[ref.chapter - 1];
    if (ref.v1 == null) return verses.join(' ');
    var lo = ref.v1 - 1, hi = (ref.v2 || ref.v1);
    var picked = verses.slice(lo, hi);
    if (picked.length === 1) return picked[0];
    return picked.map(function (v, i) { return (lo + 1 + i) + ' ' + v; }).join(' ');
  }

  function explode(ref) {
    var bi = ref.bookIndex, book = ref.book, ch = ref.chapter == null ? 1 : ref.chapter;
    var last = verseCount(bi, ch);
    var lo = ref.v1 ? ref.v1 : 1;
    var hi = ref.v2 ? ref.v2 : (ref.v1 == null ? last : ref.v1);
    lo = Math.max(1, Math.min(lo, last));
    hi = Math.max(lo, Math.min(hi, last));
    var out = [];
    for (var v = lo; v <= hi; v++) out.push({ bookIndex: bi, book: book, chapter: ch, v1: v, v2: v });
    return out;
  }

  function bibleLookup(text, part, maxChars) {
    part = part || 0;
    maxChars = maxChars || MAX_CHARS;
    var refs = parseRefs(text);
    if (!refs.length) {
      var err = LAST_MISS || 'I could not find that reference. Try “John 3:16”.';
      LAST_MISS = null;
      return { ok: false, error: err };
    }
    for (var i = 0; i < refs.length; i++) {
      var r = refs[i];
      if (r.v1 == null || r.chapter == null) continue;
      var last = verseCount(r.bookIndex, r.chapter);
      if (r.v1 > last || (r.v2 && r.v2 > last)) {
        return { ok: false, error: r.book + ' ' + r.chapter + ' has ' + last + ' verse' +
          (last === 1 ? '' : 's') + ' — there is no verse ' + Math.max(r.v1, r.v2 || 0) + '.' };
      }
    }
    var verses = [];
    refs.forEach(function (r) {
      explode(r).forEach(function (rv) { verses.push([rv.v1, verseText(rv), r]); });
    });
    var numbered = verses.length > 1;
    var whole = verses.map(function (x) { return numbered ? (x[0] + ' ' + x[1]) : x[1]; }).join(' ').trim();
    var label = refs.map(refLabel).join('; ');
    if (whole.length <= maxChars) {
      return { ok: true, label: label, text: whole, refs: refs.map(refDict), translation: 'KJV',
               parts: 1, part: 0, more: false, continues: false };
    }
    var pages = [], cur = [];
    verses.forEach(function (v) {
      var trial = cur.concat([v]).map(function (x) { return x[0] + ' ' + x[1]; }).join(' ');
      if (cur.length && trial.length > maxChars) { pages.push(cur); cur = [v]; }
      else cur.push(v);
    });
    if (cur.length) pages.push(cur);
    part = Math.max(0, Math.min(parseInt(part, 10) || 0, pages.length - 1));
    var page = pages[part];
    var textOut = page.map(function (x) { return x[0] + ' ' + x[1]; }).join(' ').trim();
    return { ok: true, label: label, text: textOut, refs: refs.map(refDict), translation: 'KJV',
             parts: pages.length, part: part, more: part < pages.length - 1, continues: part > 0 };
  }

  function bibleRandom() {
    var bi = Math.floor(Math.random() * BIBLE.books.length);
    var c = Math.floor(Math.random() * BIBLE.books[bi].chapters.length) + 1;
    var v = Math.floor(Math.random() * BIBLE.books[bi].chapters[c - 1].length) + 1;
    return bibleLookup(BIBLE.books[bi].name + ' ' + c + ':' + v);
  }

  function bibleBooks() {
    var names = BIBLE.books.map(function (b) { return b.name; });
    var detail = names.map(function (n, i) {
      return { name: n, chapters: chapterCount(i), testament: i < 39 ? 'OT' : 'NT' };
    });
    return { ok: true, books: names, detail: detail, totalBooks: detail.length, totalVerses: 31102 };
  }

  function bibleChapter(q) {
    var ref = q.get('ref') || '';
    var book = q.get('book') || '';
    var chapter = parseInt(q.get('chapter') || '1', 10) || 1;
    if (book) ref = book + ' ' + chapter;
    var parsed = parseOne(ref);
    if (!parsed) return { ok: false, error: 'unknown reference', code: 404 };
    var bi = parsed.bookIndex;
    var ch = parsed.chapter || 1;
    var n = verseCount(bi, ch);
    var verses = [];
    for (var v = 1; v <= n; v++) {
      verses.push({ v: v, text: verseText({ bookIndex: bi, book: parsed.book, chapter: ch, v1: v, v2: v }) });
    }
    return { ok: true, book: parsed.book, bookIndex: bi, chapter: ch,
             chapters: chapterCount(bi), verses: verses, count: n };
  }

  var FAMOUS = {
    'john 3:16': 40, 'psalms 23:1': 34, 'psalms 23:4': 30, 'jeremiah 29:11': 34,
    'romans 8:28': 34, 'philippians 4:13': 34, 'proverbs 3:5': 30, 'isaiah 40:31': 30,
    'genesis 1:1': 26, 'romans 3:23': 26, 'romans 6:23': 26, 'john 14:6': 30,
    'acts 1:8': 24, 'hebrews 11:1': 28, 'james 1:5': 24, '1 corinthians 13:4': 34,
    '1 corinthians 13:13': 30, 'matthew 5:3': 20, 'matthew 28:19': 26,
    'psalms 46:1': 26, 'psalms 46:10': 30, 'psalms 91:1': 26, 'psalms 119:105': 30,
    'isaiah 41:10': 30, 'matthew 11:28': 30, 'john 10:10': 26, 'john 1:1': 24,
    'romans 10:9': 26, 'ephesians 2:8': 30, 'galatians 5:22': 28, '2 timothy 3:16': 26,
    '1 peter 5:7': 28, '1 john 4:8': 26, 'revelation 21:4': 30, 'joshua 1:9': 30,
    'psalms 27:1': 28, 'psalms 34:8': 22, 'lamentations 3:22': 24, 'zephaniah 3:17': 22
  };

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function buildSearchIndex() {
    if (BIBLE.index) return;
    var rows = [];
    BIBLE.books.forEach(function (book, bi) {
      book.chapters.forEach(function (verses, ci) {
        verses.forEach(function (text, vi) {
          rows.push([book.name, ci + 1, vi + 1, text.toLowerCase()]);
        });
      });
    });
    BIBLE.index = rows;
  }

  function bibleSearch(term, limit) {
    term = String(term || '').trim();
    if (!term) return [];
    limit = limit || 12;
    var direct = bibleLookup(term, 0);
    if (direct.ok && term.length < 32 && /\d/.test(term)) {
      return [{ ref: direct.label, text: direct.text, score: 1000 }];
    }
    buildSearchIndex();
    var words = term.toLowerCase().split(/[^a-z0-9']+/).filter(function (w) { return w.length > 1; });
    if (!words.length) return [];
    var hits = [];
    BIBLE.index.forEach(function (row) {
      var name = row[0], ci = row[1], vi = row[2], text = row[3];
      var score = 0, missing = 0;
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (text.indexOf(w) >= 0) {
          score += 10;
          if (new RegExp('\\b' + escapeRe(w)).test(text)) score += 6;
        } else missing++;
      }
      if (missing) return;
      score += Math.max(0, 26 - Math.floor(text.length / 10));
      score += FAMOUS[(name + ' ' + ci + ':' + vi).toLowerCase()] || 0;
      if (words.length > 1 && text.indexOf(term.toLowerCase()) >= 0) score += 18;
      hits.push([score, name, ci, vi, text]);
    });
    hits.sort(function (a, b) {
      return b[0] - a[0] || (a[4] < b[4] ? -1 : (a[4] > b[4] ? 1 : 0));
    });
    return hits.slice(0, limit).map(function (h) {
      var verse = bibleLookup(h[1] + ' ' + h[2] + ':' + h[3], 0);
      return { ref: verse.label || '', text: verse.text || '', score: h[0] };
    });
  }

  // scripture background plates (server.py scripture_plates())
  var PLATES = [
    ['01_dawn_rays', 'Dawn over the mountains'], ['02_rose_dusk', 'Rose dusk'],
    ['03_forest_light', 'Light through the forest'], ['04_starry_ridge', 'Stars over the ridge'],
    ['05_ocean_dusk', 'Ocean at dusk'], ['06_desert_dunes', 'Desert dunes'],
    ['07_golden_field', 'Golden field'], ['08_snow_peaks', 'Snow peaks'],
    ['09_waterfall_glen', 'Waterfall glen'], ['10_sunset_sea', 'Sunset sea'],
    ['11_autumn_forest', 'Autumn forest'], ['12_stone_chapel', 'Stone chapel'],
    ['13_glass_architecture', 'Church auditorium'], ['16_navy_bloom', 'Navy bloom'],
    ['17_steel_lines', 'Steel lines'], ['18_warm_dawn', 'Warm dawn'],
    ['19_bokeh', 'Bokeh lights'], ['20_linen', 'Linen paper'],
    ['21_concrete', 'Charcoal'], ['22_gold_streaks', 'Gold streaks']
  ].map(function (p) {
    return {
      file: p[0] + '.jpg',
      url: '/scripture/' + p[0] + '.jpg',
      thumb: '/scripture/thumbs/' + p[0] + '.jpg',
      label: p[1],
      light: p[0] === '20_linen'
    };
  });

  // ------------------------------------------------------------------
  // /api/* router
  // ------------------------------------------------------------------
  async function handleApi(method, u, init) {
    await ensureStore();
    var path = u.pathname, q = u.searchParams;
    method = String(method || 'GET').toUpperCase();

    if (method === 'GET') {
      if (path === '/api/state') {
        return jsonRes({ ok: true, app: APP_NAME, version: APP_VERSION, maintainer: MAINTAINER,
                         state: snap(), clients: clientStats() });
      }
      if (path === '/api/health') {
        return jsonRes({ ok: true, app: APP_NAME, version: APP_VERSION, maintainer: MAINTAINER,
                         clients: clientStats(), uptime: (Date.now() - START) / 1000 });
      }
      if (path === '/api/bible/lookup') {
        try { await loadBible(); } catch (e) { return jsonRes({ ok: false, error: String(e) }, 500); }
        return jsonRes(bibleLookup(q.get('ref') || '', parseInt(q.get('part') || '0', 10) || 0));
      }
      if (path === '/api/bible/chapter') {
        try { await loadBible(); } catch (e) { return jsonRes({ ok: false, error: String(e) }, 500); }
        var ch = bibleChapter(q);
        return jsonRes(ch, ch.code || 200);
      }
      if (path === '/api/bible/search') {
        try { await loadBible(); } catch (e) { return jsonRes({ ok: false, error: String(e) }, 500); }
        return jsonRes({ ok: true, results: bibleSearch(q.get('q') || '') });
      }
      if (path === '/api/bible/books') {
        try { await loadBible(); } catch (e) { return jsonRes({ ok: false, error: String(e) }, 500); }
        return jsonRes(bibleBooks());
      }
      if (path === '/api/bible/random') {
        try { await loadBible(); } catch (e) { return jsonRes({ ok: false, error: String(e) }, 500); }
        var r = bibleRandom();
        r.ok = true;
        return jsonRes(r);
      }
      if (path === '/api/bible/backgrounds') {
        return jsonRes({ ok: true, plates: PLATES });
      }
      if (path === '/api/uploads') {
        return jsonRes({ ok: true, files: bridgeList() });
      }
      if (path === '/api/lyrics') {
        return jsonRes({ ok: true, songs: lyrics, state: pick(state, ['showLyrics', 'lyricLines',
          'lyricIndex', 'lyricSong', 'lyricMode', 'lyricSize', 'lyricAlign']) });
      }
      if (path === '/api/presets') {
        return jsonRes({ ok: true, presets: presets });
      }
      if (path === '/api/playlist') {
        return jsonRes({ ok: true, items: state.playlist || [], index: PLAY.index,
                         playing: PLAY.playing, nextAt: PLAY.nextAt });
      }
      if (path === '/api/obs-url') {
        return jsonRes({ url: location.origin + '/overlay/overlay.html' });
      }
      if (path === '/api/camera') {
        return jsonRes({ ok: true, sessions: [],
          urls: { base: '', port: 0, httpPort: 0, secure: false, fingerprint: '', error: CAM_ERR, ice: ICE_SERVERS },
          state: pick(state, ['showCam', 'camRole', 'camFit', 'camMirror', 'camObjectPos', 'camMuted']) });
      }
      if (path === '/api/camera/qr') {
        return jsonRes({ ok: false, error: CAM_ERR }, 503);
      }
      if (path === '/api/camera/live') {
        return jsonRes({ ok: true, verdict: 'no-camera', hint: CAM_ERR, sessions: [],
          watchers: [], secure: false,
          urls: { base: '', port: 0, httpPort: 0, secure: false, fingerprint: '', error: CAM_ERR } });
      }
      if (path === '/api/camera/whep-probe') {
        return jsonRes({ ok: false, detail: CAM_ERR });
      }
      if (path === '/cam/config') {
        return jsonRes({ ok: false, error: 'unknown token' }, 403);
      }
      return jsonRes({ ok: false, error: 'no such endpoint' }, 404);
    }

    if (method === 'POST') {
      if (path === '/api/state') {
        var patch = await readJson(init);
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          return jsonRes({ ok: false, error: 'body must be an object' }, 400);
        }
        var restartCd = !!patch.countdownRestart || ('countdown' in patch && !!state.showCountdown);
        delete patch.countdownRestart;
        var cdSeconds = patch.countdown;
        Object.assign(state, patch);
        persist();
        if (restartCd && cdSeconds !== null && cdSeconds !== undefined) {
          scheduleCountdown(cdSeconds, patch.countdownLabel);
        }
        if (patch.showCountdown === false && !restartCd) {
          if (CD.timer) { clearTimeout(CD.timer); CD.timer = null; }
          state.countdownEndsAt = 0;
        }
        deliver({ type: 'patch', patch: patch, state: snap() }, 'overlay');
        return jsonRes({ ok: true, state: snap(), clients: clientStats() });
      }
      if (path === '/api/countdown/start') {
        var body = await readJson(init);
        var secs = body.seconds;
        if (secs === null || secs === undefined || secs === '') secs = state.countdown || 0;
        var deadline = scheduleCountdown(secs, body.label);
        state.showCountdown = !!(secs && parseInt(secs, 10) > 0);
        persist();
        deliver({ type: 'patch', patch: {
          showCountdown: state.showCountdown,
          countdownEndsAt: state.countdownEndsAt,
          countdown: state.countdown
        }, state: snap() }, null);
        return jsonRes({ ok: true, endsAt: deadline, remaining: countdownRemaining() });
      }
      if (path === '/api/countdown/stop') {
        if (CD.timer) { clearTimeout(CD.timer); CD.timer = null; }
        state.showCountdown = false;
        state.countdownEndsAt = 0;
        persist();
        deliver({ type: 'patch', patch: { showCountdown: false, countdownEndsAt: 0 }, state: snap() }, null);
        return jsonRes({ ok: true });
      }
      if (path === '/api/live') {
        var b = await readJson(init);
        var on = b.on === undefined ? true : !!b.on;
        var patch = {
          onAir: on, guides: false, demo: false, showBrand: true, showTicker: true,
          clock24: !!state.clock24
        };
        if (on) { patch.airStartedAt = Date.now() / 1000; patch.showCountdown = false; }
        else patch.airStartedAt = 0;
        Object.assign(state, patch);
        persist();
        if (!on) {
          if (CD.timer) { clearTimeout(CD.timer); CD.timer = null; }
          state.countdownEndsAt = 0;
        }
        deliver({ type: 'patch', patch: patch, state: snap() }, null);
        if (on) deliver({ type: 'go-live' }, 'overlay');
        return jsonRes({ ok: true, onAir: on, state: snap() });
      }
      if (path === '/api/sting') {
        var kind = q.get('kind') || 'wipe';
        deliver({ type: 'sting', kind: kind }, 'overlay');
        return jsonRes({ ok: true, kind: kind });
      }
      if (path === '/api/reload') {
        deliver({ type: 'reload' }, 'overlay');
        return jsonRes({ ok: true });
      }
      if (path === '/api/playlist/start') {
        var body = await readJson(init);
        var idx = body.index;
        var loop = body.loop === undefined ? true : !!body.loop;
        var res = playlistStart(idx === null || idx === undefined || idx === '' ? null : parseInt(idx, 10), loop);
        return jsonRes(res, res.ok ? 200 : 400);
      }
      if (path === '/api/playlist/stop') return jsonRes(playlistStop());
      if (path === '/api/playlist/next') {
        var items = state.playlist || [];
        return jsonRes(playlistJump((PLAY.index + 1) % Math.max(1, items.length)));
      }
      if (path === '/api/playlist/jump') {
        var body = await readJson(init);
        var res = playlistJump(parseInt(body.index, 10) || 0);
        return jsonRes(res, res.ok ? 200 : 400);
      }
      if (path === '/api/lyrics/save') {
        var body = await readJson(init);
        var title = String(body.title || '').trim();
        var lines = (body.lines || []).map(function (x) { return String(x).trim(); })
          .filter(function (x) { return x; });
        if (!title || !lines.length) {
          return jsonRes({ ok: false, error: 'Give the song a title and at least one line' }, 400);
        }
        var song = null;
        for (var i = 0; i < lyrics.length; i++) {
          if (lyrics[i].title.toLowerCase() === title.toLowerCase()) { song = lyrics[i]; break; }
        }
        if (song) song.lines = lines;
        else lyrics.push({ id: randHex(4), title: title, lines: lines });
        persist();
        deliver({ type: 'lyrics', songs: lyrics }, 'control');
        return jsonRes({ ok: true, songs: lyrics });
      }
      if (path === '/api/lyrics/delete') {
        var body = await readJson(init);
        var sid = String(body.id || '');
        lyrics = lyrics.filter(function (x) { return x.id !== sid; });
        persist();
        return jsonRes({ ok: true, songs: lyrics });
      }
      if (path === '/api/presets/save') {
        var body = await readJson(init);
        var name = String(body.name || '').trim();
        if (!name) return jsonRes({ ok: false, error: 'name required' }, 400);
        presets[name] = body.data || {};
        persist();
        deliver({ type: 'presets', presets: presets }, 'control');
        return jsonRes({ ok: true, presets: presets });
      }
      if (path === '/api/presets/delete') {
        var body = await readJson(init);
        var name = String(body.name || '').trim();
        delete presets[name];
        persist();
        deliver({ type: 'presets', presets: presets }, 'control');
        return jsonRes({ ok: true, presets: presets });
      }
      if (path === '/api/camera/new') return jsonRes({ ok: false, error: CAM_ERR });
      if (path === '/api/camera/stop') return jsonRes({ ok: true, sessions: [] });
      if (path === '/api/uploads/delete') {
        var body = await readJson(init);
        var target = String(body.url || '').trim();
        if (target.indexOf('/uploads/') !== 0) {
          return jsonRes({ ok: false, error: 'only /uploads/ files can be deleted' }, 400);
        }
        var cleared = {};
        ['poster', 'logoImage', 'ltLogoImage', 'pipImage', 'bgImage', 'sponsorImage'].forEach(function (k) {
          if (state[k] === target) { state[k] = ''; cleared[k] = ''; }
        });
        if (Object.keys(cleared).length) {
          persist();
          deliver({ type: 'patch', patch: cleared, state: snap() }, 'overlay');
        }
        return jsonRes(callBridge('deleteUpload', target));
      }
      if (path === '/api/upload') {
        // multipart/form-data (browser file input), field: file
        if (init && init.body && typeof FormData !== 'undefined' && init.body instanceof FormData) {
          var f = init.body.get('file');
          if (!f) return jsonRes({ ok: false, error: 'no file received' }, 400);
          var buf = await f.arrayBuffer();
          var res = callBridge('saveUpload', f.name || 'upload.png', f.type || '', abToB64(buf));
          return jsonRes(res);
        }
        // application/json {dataUrl, name}
        var body = await readJson(init);
        var dataUrl = body.dataUrl || '';
        if (dataUrl.indexOf('data:') === 0) {
          var comma = dataUrl.indexOf(',');
          var b64 = comma >= 0 ? dataUrl.substring(comma + 1) : '';
          var name = body.name || q.get('name') || 'upload.png';
          return jsonRes(callBridge('saveUpload', name, '', b64));
        }
        return jsonRes({ ok: false, error: 'no file received' }, 400);
      }
      return jsonRes({ ok: false, error: 'no such endpoint' }, 404);
    }

    return jsonRes({ ok: false, error: 'method not allowed' }, 405);
  }

  function randHex(n) {
    var s = '';
    for (var i = 0; i < n * 2; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  function abToB64(buf) {
    var bytes = new Uint8Array(buf);
    var bin = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  // test/debug handle
  window.__nd = {
    api: handleApi,
    ensureStore: ensureStore,
    loadBible: loadBible,
    lookup: function (ref, part) { return bibleLookup(ref, part || 0); },
    search: bibleSearch,
    chapter: bibleChapter,
    books: bibleBooks,
    random: bibleRandom,
    state: function () { return state; },
    deliver: deliver,
    clientStats: clientStats
  };
})();
