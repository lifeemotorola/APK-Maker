/* ============================================================================
 * Community Market — offline-first marketplace & services directory for
 * Monrovia, Liberia. All directory data ships inside the APK (assets/www/
 * data/*.json) and user data (favorites, own board posts) is cached in a
 * local SQLite database (WebSQL, backed by SQLite in the Android WebView,
 * with a localStorage fallback). No internet is ever required.
 * UI icons are inline SVG only (icons.js) — no emoji.
 * ==========================================================================*/
(function () {
  'use strict';

  var APP_VERSION = '1.0';
  var APP_AUTHOR = 'Emmanuel Suah';
  var LS_DATA = 'mk_data_v1';
  var LS_FAV = 'mk_fav_v1';
  var LS_POSTS = 'mk_posts_v1';

  /* ------------------------------ tiny dom ------------------------------- */
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
      d.innerHTML = '<b>Error</b> <span class="err-msg"></span><button class="err-x" aria-label="Dismiss">&times;</button>';
      d.querySelector('.err-msg').textContent = (e.message || e.type) + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno;
      d.querySelector('.err-x').addEventListener('click', function () { d.remove(); });
      d.addEventListener('click', function (ev) { if (ev.target === d) d.remove(); });
      document.body.appendChild(d);
      setTimeout(function () { d.remove(); }, 12000);
    } catch (ignore) {}
  });

  /* ------------------------------ modal ---------------------------------- */
  function openModal(html) {
    closeModal();
    var m = document.createElement('div');
    m.className = 'modal-back';
    m.innerHTML = '<div class="modal" role="dialog">' +
      '<button class="modal-x" aria-label="Close">' + I('x') + '</button>' +
      '<div class="modal-body">' + html + '</div></div>';
    m.querySelector('.modal-x').addEventListener('click', closeModal);
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    requestAnimationFrame(function () { m.classList.add('open'); });
    return m;
  }
  function closeModal() {
    $all('.modal-back').forEach(function (m) {
      m.classList.remove('open');
      setTimeout(function () { m.remove(); }, 250);
    });
  }

  /* --------------------------- local SQLite ------------------------------ */
  /* WebSQL in the Android WebView is backed by SQLite on disk — that is the
   * local database cache. If unavailable, fall back to localStorage. */
  var sqlDB = null, useFallback = false;
  function dbOpen() {
    return new Promise(function (resolve) {
      if (sqlDB || useFallback) return resolve();
      try {
        if (typeof window.openDatabase === 'function') {
          sqlDB = window.openDatabase('communitymarket', '1.0', 'Community Market local cache', 2 * 1024 * 1024);
          sqlDB.transaction(function (tx) {
            tx.executeSql('CREATE TABLE IF NOT EXISTS fav (type TEXT, id TEXT, PRIMARY KEY (type, id))');
            tx.executeSql('CREATE TABLE IF NOT EXISTS myposts (id TEXT PRIMARY KEY, title TEXT, body TEXT, area TEXT, tag TEXT, ts TEXT)');
          }, function () { useFallback = true; sqlDB = null; resolve(); }, function () { resolve(); });
        } else { useFallback = true; resolve(); }
      } catch (e) { useFallback = true; sqlDB = null; resolve(); }
    });
  }
  function lsGet(key, dflt) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; }
  }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  function favList() {
    return dbOpen().then(function () {
      if (useFallback) return Promise.resolve(lsGet(LS_FAV, []));
      return new Promise(function (res) {
        sqlDB.transaction(function (tx) {
          tx.executeSql('SELECT type, id FROM fav', [], function (t, rs) {
            var out = [];
            for (var i = 0; i < rs.rows.length; i++) out.push(rs.rows.item(i));
            res(out);
          });
        }, function () { res(lsGet(LS_FAV, [])); });
      });
    });
  }
  function favSet(type, id, on) {
    return dbOpen().then(function () {
      if (useFallback) {
        var f = lsGet(LS_FAV, []);
        var i = f.findIndex(function (x) { return x.type === type && x.id === id; });
        if (on && i < 0) f.push({ type: type, id: id });
        if (!on && i >= 0) f.splice(i, 1);
        lsSet(LS_FAV, f);
        return f;
      }
      return new Promise(function (res) {
        sqlDB.transaction(function (tx) {
          if (on) tx.executeSql('INSERT OR IGNORE INTO fav (type, id) VALUES (?, ?)', [type, id]);
          else tx.executeSql('DELETE FROM fav WHERE type = ? AND id = ?', [type, id]);
          tx.executeSql('SELECT type, id FROM fav', [], function (t, rs) {
            var out = [];
            for (var i = 0; i < rs.rows.length; i++) out.push(rs.rows.item(i));
            res(out);
          });
        }, function () { res(lsGet(LS_FAV, [])); });
      });
    });
  }
  function postList() {
    return dbOpen().then(function () {
      if (useFallback) return Promise.resolve(lsGet(LS_POSTS, []));
      return new Promise(function (res) {
        sqlDB.transaction(function (tx) {
          tx.executeSql('SELECT * FROM myposts ORDER BY ts DESC', [], function (t, rs) {
            var out = [];
            for (var i = 0; i < rs.rows.length; i++) out.push(rs.rows.item(i));
            res(out);
          });
        }, function () { res(lsGet(LS_POSTS, [])); });
      });
    });
  }
  function postAdd(p) {
    return dbOpen().then(function () {
      if (useFallback) {
        var l = lsGet(LS_POSTS, []); l.unshift(p); lsSet(LS_POSTS, l); return l;
      }
      return new Promise(function (res) {
        sqlDB.transaction(function (tx) {
          tx.executeSql('INSERT OR REPLACE INTO myposts (id, title, body, area, tag, ts) VALUES (?,?,?,?,?,?)',
            [p.id, p.title, p.body, p.area, p.tag, p.ts]);
        }, function () { res(lsGet(LS_POSTS, [])); }, function () { postList().then(res); });
      });
    });
  }
  function postDel(id) {
    return dbOpen().then(function () {
      if (useFallback) {
        lsSet(LS_POSTS, lsGet(LS_POSTS, []).filter(function (p) { return p.id !== id; }));
        return;
      }
      return new Promise(function (res) {
        sqlDB.transaction(function (tx) {
          tx.executeSql('DELETE FROM myposts WHERE id = ?', [id]);
        }, function () {}, function () { res(); });
      });
    });
  }

  /* ------------------------------ data ----------------------------------- */
  var DATA = { meta: null, businesses: [], routes: [], posts: [] };
  var CATS = {};   // id -> {name, icon}
  var CAT_ICON = { food: 'food', market: 'store', pharmacy: 'medical', clinic: 'medical', repair: 'wrench', money: 'money', education: 'cap', tailor: 'scissors', home: 'homeIco', salon: 'star' };
  var TAGS = { event: 'Event', lost: 'Lost & Found', job: 'Jobs', safety: 'Safety', announcement: 'Notice', sale: 'For Sale' };
  var TAG_ICON = { event: 'users', lost: 'search', job: 'tag', safety: 'shield', announcement: 'info', sale: 'tag' };

  function loadData() {
    // serve from the localStorage cache first (offline-first), then refresh
    // from the APK-bundled JSON (also local) — both work with zero network.
    try {
      var cached = localStorage.getItem(LS_DATA);
      if (cached) DATA = Object.assign(DATA, JSON.parse(cached));
    } catch (e) {}
    var files = { meta: '/data/meta.json', businesses: '/data/businesses.json', routes: '/data/routes.json', posts: '/data/posts.json' };
    return Promise.all(Object.keys(files).map(function (k) {
      return fetch(files[k]).then(function (r) {
        if (!r.ok) throw new Error(k + ' ' + r.status);
        return r.json();
      }).then(function (j) { DATA[k] = j; })
      .catch(function () { /* keep cached copy */ });
    })).then(function () {
      try { localStorage.setItem(LS_DATA, JSON.stringify(DATA)); } catch (e) {}
      (DATA.meta.categories || []).forEach(function (c) { CATS[c.id] = { name: c.name, icon: CAT_ICON[c.id] || 'store' }; });
      if (!Object.keys(CATS).length) {
        Object.keys(CAT_ICON).forEach(function (id) { CATS[id] = { name: id, icon: CAT_ICON[id] }; });
      }
    });
  }

  /* ------------------------------ router --------------------------------- */
  var screen = { name: 'home' };
  function go(name, params) {
    screen = Object.assign({ name: name }, params || {});
    render();
  }
  function render() {
    document.documentElement.dataset.theme = S.theme;
    switch (screen.name) {
      case 'home': renderHome(); break;
      case 'businesses': renderBusinesses(); break;
      case 'business': renderBusiness(); break;
      case 'routes': renderRoutes(); break;
      case 'route': renderRoute(); break;
      case 'board': renderBoard(); break;
      case 'saved': renderSaved(); break;
      case 'search': renderSearch(); break;
      default: renderHome();
    }
  }

  var S = { theme: (function () { try { return localStorage.getItem('mk_theme') || 'market'; } catch (e) { return 'market'; } })() };

  function topBar(active) {
    return '<header class="topbar">' +
      '<span class="brand">' + I('store', 'brand-ico') + '<b>Community Market</b></span>' +
      '<button class="icon-btn" id="themeBtn" title="Switch theme">' + I(S.theme === 'market' ? 'moon' : 'sun') + '</button>' +
    '</header>';
  }
  function navBar(active) {
    var items = [
      ['home', 'home', 'Home'],
      ['businesses', 'store', 'Shops'],
      ['routes', 'bus', 'Kehkeh'],
      ['board', 'board', 'Board'],
      ['saved', 'bookmark', 'Saved'],
    ];
    return '<nav class="navbar">' + items.map(function (it) {
      return '<button class="nav-btn' + (active === it[0] ? ' active' : '') + '" data-nav="' + it[0] + '">' +
        I(it[1]) + '<span>' + it[2] + '</span></button>';
    }).join('') + '</nav>';
  }
  function bindNav() {
    $all('[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () { go(b.dataset.nav); });
    });
    var tb = document.getElementById('themeBtn');
    if (tb) tb.addEventListener('click', function () {
      S.theme = S.theme === 'market' ? 'night' : 'market';
      try { localStorage.setItem('mk_theme', S.theme); } catch (e) {}
      render();
      toast(S.theme === 'market' ? 'Market day theme' : 'Night market theme', 'sun');
    });
  }
  function chipRow(items, sel, cls) {
    return '<div class="chip-row">' + items.map(function (it) {
      return '<button class="chip-btn' + (sel === it.id ? ' sel' : '') + ' ' + (cls || '') + '" data-pick="' + esc(it.id) + '">' +
        (it.icon ? I(it.icon) : '') + esc(it.name) + '</button>';
    }).join('') + '</div>';
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function catOf(b) { return CATS[b.cat] || { name: b.cat, icon: 'store' }; }
  function findBiz(id) { return DATA.businesses.find(function (b) { return b.id === id; }); }
  function findRoute(id) { return DATA.routes.find(function (r) { return r.id === id; }); }

  function favBtn(type, id, favs, cls) {
    var on = favs.some(function (f) { return f.type === type && f.id === id; });
    return '<button class="fav-btn' + (on ? ' on' : '') + (cls ? ' ' + cls : '') + '" data-fav="' + type + ':' + id + '" title="Save">' +
      I(on ? 'bookmarkFill' : 'bookmark') + '</button>';
  }
  function bindFavs() {
    favList().then(function (favs) {
      $all('[data-fav]').forEach(function (b) {
        var parts = b.dataset.fav.split(':');
        b.addEventListener('click', function () {
          var on = !favs.some(function (f) { return f.type === parts[0] && f.id === parts[1]; });
          favSet(parts[0], parts[1], on).then(function (nf) {
            favs = nf;
            toast(on ? 'Saved to your list' : 'Removed from saved', on ? 'bookmarkFill' : 'bookmark');
            render();
          });
        });
      });
    });
  }

  /* ------------------------------ home ----------------------------------- */
  function renderHome() {
    var cats = Object.keys(CATS).slice(0, 6).map(function (id) {
      return { id: id, name: CATS[id].name, icon: CATS[id].icon };
    });
    var featured = DATA.businesses.filter(function (b) { return b.featured; }).slice(0, 4);
    var latest = DATA.posts.slice().sort(function (a, b) { return b.ts < a.ts ? -1 : 1; }).slice(0, 3);
    var quickRoutes = DATA.routes.slice(0, 3);
    h(topBar('home') + `
  <section class="screen home">
    <figure class="hero-fig">
      <div class="hf-frame"><img src="/img/hero.jpg" alt="A busy Monrovia street market"></div>
      <figcaption><svg viewBox="0 0 8 8" class="dia"><path d="M4 0l4 4-4 4-4-4z"/></svg> Monrovia, Liberia <svg viewBox="0 0 8 8" class="dia"><path d="M4 0l4 4-4 4-4-4z"/></svg></figcaption>
    </figure>
    <h1 class="hero-title">Community Market</h1>
    <p class="hero-sub">Local businesses, kehkeh routes and community boards — everything works with <b>zero internet</b>.</p>
    <form class="searchbar" id="homeSearch">
      ${I('search', 'sb-ico')}
      <input id="homeSearchInput" placeholder="Search shops, routes, posts..." autocomplete="off">
      <button class="btn sm" type="submit">Go</button>
    </form>
    <div class="stat-strip">
      <span class="chip">${I('store')} ${DATA.businesses.length} businesses</span>
      <span class="chip">${I('bus')} ${DATA.routes.length} kehkeh routes</span>
      <span class="chip">${I('board')} ${DATA.posts.length} board posts</span>
      <span class="chip">${I('wifiOff')} offline</span>
    </div>
    <h3 class="group-label">Browse by category</h3>
    <div class="cat-grid">
      ${cats.map(c => `<button class="cat-cell" data-cat="${c.id}">${I(c.icon, 'cat-ico')}<span>${esc(c.name)}</span></button>`).join('')}
    </div>
    ${featured.length ? `<h3 class="group-label">Featured</h3>
    <div class="card-list">${featured.map(bizCard).join('')}</div>` : ''}
    <h3 class="group-label">Kehkeh quick routes</h3>
    <div class="card-list">${quickRoutes.map(routeCard).join('')}</div>
    <h3 class="group-label">Latest on the board</h3>
    <div class="card-list">${latest.map(postCard).join('')}</div>
    <footer class="credit">by ${APP_AUTHOR} &middot; v${APP_VERSION} &middot; data cached locally in SQLite</footer>
  </section>${navBar('home')}`);
    bindNav();
    $all('[data-cat]').forEach(function (b) {
      b.addEventListener('click', function () { go('businesses', { cat: b.dataset.cat }); });
    });
    var f = document.getElementById('homeSearch');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      go('search', { q: document.getElementById('homeSearchInput').value.trim() });
    });
    bindCards(); bindFavs();
  }

  /* --------------------------- businesses ------------------------------- */
  function bizCard(b) {
    var c = catOf(b);
    return `<button class="card biz-card" data-biz="${b.id}">
      <span class="biz-ico">${I(c.icon)}</span>
      <span class="biz-main">
        <b class="biz-name">${esc(b.name)}</b>
        <span class="biz-meta">${I('pin')} ${esc(b.area)} &middot; ${esc(b.landmark)}</span>
        <span class="biz-meta">${I('clock')} ${esc(b.hours)}</span>
      </span>
      <span class="biz-side">${I('chevR')}</span>
    </button>`;
  }
  function renderBusinesses() {
    var cat = screen.cat || 'all';
    var area = screen.area || 'all';
    var q = (screen.q || '').toLowerCase();
    var list = DATA.businesses.filter(function (b) {
      if (cat !== 'all' && b.cat !== cat) return false;
      if (area !== 'all' && b.area !== area) return false;
      if (q && (b.name + ' ' + b.area + ' ' + b.desc + ' ' + b.services.join(' ') + ' ' + b.landmark).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var catItems = [{ id: 'all', name: 'All', icon: 'store' }].concat(Object.keys(CATS).map(function (id) {
      return { id: id, name: CATS[id].name, icon: CATS[id].icon };
    }));
    var areaItems = [{ id: 'all', name: 'All areas' }].concat((DATA.meta.areas || []).map(function (a) { return { id: a, name: a }; }));
    h(topBar('businesses') + `
  <section class="screen">
    <h1 class="screen-title">Businesses &amp; services</h1>
    <form class="searchbar" id="bizSearch">
      ${I('search', 'sb-ico')}
      <input id="bizSearchInput" placeholder="Search name, area, service..." value="${esc(screen.q || '')}" autocomplete="off">
    </form>
    ${chipRow(catItems, cat)}
    <div class="sel-row">
      <label>Area ${I('pin')}
        <select id="areaSel" class="trans-sel">${areaItems.map(a => `<option value="${esc(a.id)}" ${area === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      </label>
      <span class="count">${list.length} found</span>
    </div>
    <div class="card-list">${list.map(bizCard).join('') || '<p class="hint">No matches. Try another area or category.</p>'}</div>
  </section>${navBar('businesses')}`);
    bindNav();
    $all('[data-pick]').forEach(function (b) {
      b.addEventListener('click', function () { go('businesses', { cat: b.dataset.pick, area: screen.area, q: screen.q }); });
    });
    document.getElementById('areaSel').addEventListener('change', function (e) {
      go('businesses', { cat: cat, area: e.target.value, q: screen.q });
    });
    var sf = document.getElementById('bizSearch');
    var si = document.getElementById('bizSearchInput');
    var t = null;
    si.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { go('businesses', { cat: cat, area: area, q: si.value.trim() }); }, 250);
    });
    sf.addEventListener('submit', function (e) { e.preventDefault(); go('businesses', { cat: cat, area: area, q: si.value.trim() }); });
    bindCards(); bindFavs();
  }
  function renderBusiness() {
    var b = findBiz(screen.id);
    if (!b) { go('businesses'); return; }
    var c = catOf(b);
    favList().then(function (favs) {
      h(topBar('businesses') + `
  <section class="screen">
    <button class="back" data-nav="businesses">${I('chevL')} All businesses</button>
    <div class="card detail">
      <div class="detail-head">
        <span class="biz-ico big">${I(c.icon)}</span>
        <div>
          <h1 class="screen-title">${esc(b.name)}</h1>
          <div class="chip-row"><span class="chip">${esc(c.name)}</span><span class="chip">${I('pin')} ${esc(b.area)}</span></div>
        </div>
        ${favBtn('biz', b.id, favs)}
      </div>
      <p class="desc">${esc(b.desc)}</p>
      <h3 class="group-label">Services</h3>
      <div class="chip-row">${b.services.map(s => `<span class="chip">${I('tag')} ${esc(s)}</span>`).join('')}</div>
      <div class="info-rows">
        <div class="info-row">${I('clock')}<span>Hours</span><b>${esc(b.hours)}</b></div>
        <div class="info-row">${I('pin')}<span>Find it</span><b>${esc(b.landmark)}, ${esc(b.area)}</b></div>
        <div class="info-row">${I('phone')}<span>Phone</span><b>${esc(b.phone)}</b></div>
      </div>
      <div class="r-actions">
        <a class="btn" href="tel:${esc(b.phone.replace(/[^+\d]/g, ''))}">${I('phone')} Call</a>
        <button class="btn ghost" id="copyPhone">${I('copy')} Copy number</button>
      </div>
    </div>
  </section>${navBar('businesses')}`);
      bindNav(); bindFavs();
      document.getElementById('copyPhone').addEventListener('click', function () {
        var num = b.phone;
        function done() { toast('Number copied', 'check'); }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(num).then(done, done);
        else done();
      });
    });
  }

  /* ------------------------------ routes --------------------------------- */
  function routeCard(r) {
    return `<button class="card route-card" data-route="${r.id}">
      <span class="biz-ico">${I('bus')}</span>
      <span class="biz-main">
        <b class="biz-name">${esc(r.frm)} ${I('arrowR')} ${esc(r.to)}</b>
        <span class="biz-meta">${I('clock')} ${esc(r.first)} – ${esc(r.last)} &middot; ${esc(r.freq)}</span>
      </span>
      <span class="fare">${esc(r.fare)}</span>
    </button>`;
  }
  function renderRoutes() {
    var q = (screen.q || '').toLowerCase();
    var list = DATA.routes.filter(function (r) {
      if (!q) return true;
      return (r.name + ' ' + r.frm + ' ' + r.to + ' ' + r.stops.join(' ') + ' ' + r.notes).toLowerCase().indexOf(q) >= 0;
    });
    h(topBar('routes') + `
  <section class="screen">
    <h1 class="screen-title">Kehkeh &amp; transport</h1>
    <p class="screen-sub">Shared-taxi (kehkeh) routes around Monrovia. Fares in Liberian dollars (LRD).</p>
    <form class="searchbar" id="routeSearch">
      ${I('search', 'sb-ico')}
      <input id="routeSearchInput" placeholder="Search route or stop..." value="${esc(screen.q || '')}" autocomplete="off">
    </form>
    <div class="card-list">${list.map(routeCard).join('') || '<p class="hint">No routes match.</p>'}</div>
    <div class="card note-card">
      ${I('info')}
      <p>Kehkeh cars run from garages at junctions — wave them down or board at the garage. Okada (motorbike) haggles from LRD 50. Fares rise slightly after dark.</p>
    </div>
  </section>${navBar('routes')}`);
    bindNav();
    bindCards();
    var sf = document.getElementById('routeSearch');
    var si = document.getElementById('routeSearchInput');
    var t = null;
    si.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { go('routes', { q: si.value.trim() }); }, 250);
    });
    sf.addEventListener('submit', function (e) { e.preventDefault(); go('routes', { q: si.value.trim() }); });
  }
  function renderRoute() {
    var r = findRoute(screen.id);
    if (!r) { go('routes'); return; }
    favList().then(function (favs) {
      h(topBar('routes') + `
  <section class="screen">
    <button class="back" data-nav="routes">${I('chevL')} All routes</button>
    <div class="card detail">
      <div class="detail-head">
        <span class="biz-ico big">${I('bus')}</span>
        <div>
          <h1 class="screen-title">${esc(r.frm)} ${I('arrowR')} ${esc(r.to)}</h1>
          <div class="chip-row"><span class="chip fare">${esc(r.fare)} ${esc(r.fareNote || '')}</span></div>
        </div>
        ${favBtn('route', r.id, favs)}
      </div>
      <div class="info-rows">
        <div class="info-row">${I('clock')}<span>First / last</span><b>${esc(r.first)} / ${esc(r.last)}</b></div>
        <div class="info-row">${I('bus')}<span>Frequency</span><b>${esc(r.freq)}</b></div>
      </div>
      <h3 class="group-label">Stops</h3>
      <ol class="stops">
        ${r.stops.map(function (s, i) { return `<li><b>${i + 1}</b><span>${esc(s)}</span></li>`; }).join('')}
      </ol>
      ${r.notes ? `<p class="desc">${I('info')} ${esc(r.notes)}</p>` : ''}
    </div>
  </section>${navBar('routes')}`);
      bindNav(); bindFavs();
    });
  }

  /* ------------------------------- board --------------------------------- */
  function postCard(p, own) {
    var tag = TAGS[p.tag] || p.tag;
    return `<div class="card post-card" data-post="${esc(p.id)}">
      <div class="post-top">
        <span class="tag-chip tag-${esc(p.tag)}">${I(TAG_ICON[p.tag] || 'info')} ${esc(tag)}</span>
        ${own ? `<button class="fav-btn del" data-del="${esc(p.id)}" title="Delete my post">${I('trash')}</button>` : ''}
      </div>
      <b class="post-title">${esc(p.title)}</b>
      <p class="post-body">${esc(p.body)}</p>
      <div class="post-meta">${I('pin')} ${esc(p.area)} &middot; ${esc(p.author || 'Community')} &middot; ${fmtDate(p.ts)}</div>
    </div>`;
  }
  function renderBoard() {
    var tag = screen.tag || 'all';
    var area = screen.area || 'all';
    postList().then(function (mine) {
      var all = DATA.posts.concat(mine.map(function (p) { p.own = true; return p; }))
        .sort(function (a, b) { return b.ts < a.ts ? -1 : 1; });
      var list = all.filter(function (p) {
        if (tag !== 'all' && p.tag !== tag) return false;
        if (area !== 'all' && p.area !== area) return false;
        return true;
      });
      var tagItems = [{ id: 'all', name: 'All', icon: 'board' }].concat(Object.keys(TAGS).map(function (t) {
        return { id: t, name: TAGS[t], icon: TAG_ICON[t] };
      }));
      var areaItems = [{ id: 'all', name: 'All areas' }].concat((DATA.meta.areas || []).map(function (a) { return { id: a, name: a }; }));
      h(topBar('board') + `
  <section class="screen">
    <div class="row-between">
      <h1 class="screen-title">Community board</h1>
      <button class="btn sm" id="newPost">${I('plus')} New post</button>
    </div>
    <p class="screen-sub">Saved offline in the app's local database — visible even with no network.</p>
    ${chipRow(tagItems, tag)}
    <div class="sel-row">
      <label>Area ${I('pin')}
        <select id="areaSel" class="trans-sel">${areaItems.map(a => `<option value="${esc(a.id)}" ${area === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      </label>
      <span class="count">${list.length} posts</span>
    </div>
    <div class="card-list">${list.map(function (p) { return postCard(p, !!p.own); }).join('') || '<p class="hint">Nothing here yet — add the first post.</p>'}</div>
  </section>${navBar('board')}`);
      bindNav();
      $all('[data-pick]').forEach(function (b) {
        b.addEventListener('click', function () { go('board', { tag: b.dataset.pick, area: screen.area }); });
      });
      document.getElementById('areaSel').addEventListener('change', function (e) {
        go('board', { tag: tag, area: e.target.value });
      });
      $all('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          var m = openModal('<h2 class="screen-title">Delete this post?</h2><p class="screen-sub">It is stored only in this app\'s local database.</p>' +
            '<div class="r-actions"><button class="btn danger" id="delYes">Delete</button><button class="btn ghost" id="delNo">Cancel</button></div>');
          m.querySelector('#delNo').addEventListener('click', closeModal);
          m.querySelector('#delYes').addEventListener('click', function () {
            postDel(b.dataset.del).then(function () { closeModal(); toast('Post deleted', 'trash'); render(); });
          });
        });
      });
      document.getElementById('newPost').addEventListener('click', function () {
        var areas = DATA.meta.areas || [];
        var tags = Object.keys(TAGS);
        var m = openModal(`
          <h2 class="screen-title">New board post</h2>
          <form id="postForm" class="post-form">
            <input id="pfTitle" class="search-input" placeholder="Title" maxlength="90" required>
            <textarea id="pfBody" class="search-input" rows="4" placeholder="Details..." required></textarea>
            <div class="sel-row">
              <label>Area <select id="pfArea" class="trans-sel">${areas.map(a => `<option>${esc(a)}</option>`).join('')}</select></label>
              <label>Type <select id="pfTag" class="trans-sel">${tags.map(t => `<option value="${t}">${esc(TAGS[t])}</option>`).join('')}</select></label>
            </div>
            <button class="btn big" type="submit">${I('plus')} Post to board</button>
          </form>`);
        m.querySelector('#postForm').addEventListener('submit', function (e) {
          e.preventDefault();
          var p = {
            id: 'u' + Date.now(),
            title: m.querySelector('#pfTitle').value.trim(),
            body: m.querySelector('#pfBody').value.trim(),
            area: m.querySelector('#pfArea').value,
            tag: m.querySelector('#pfTag').value,
            ts: new Date().toISOString(),
            author: 'You',
          };
          if (!p.title || !p.body) return;
          postAdd(p).then(function () { closeModal(); toast('Posted to the board (saved offline)', 'check'); render(); });
        });
      });
    });
  }

  /* ------------------------------- saved --------------------------------- */
  function renderSaved() {
    Promise.all([favList(), postList()]).then(function (r) {
      var favs = r[0], mine = r[1];
      var fb = favs.filter(function (f) { return f.type === 'biz'; }).map(function (f) { return findBiz(f.id); }).filter(Boolean);
      var fr = favs.filter(function (f) { return f.type === 'route'; }).map(function (f) { return findRoute(f.id); }).filter(Boolean);
      h(topBar('saved') + `
  <section class="screen">
    <h1 class="screen-title">Saved</h1>
    <p class="screen-sub">Stored in the app's local SQLite cache — available offline.</p>
    <h3 class="group-label">Businesses (${fb.length})</h3>
    <div class="card-list">${fb.map(bizCard).join('') || '<p class="hint">Tap the bookmark on any business to save it here.</p>'}</div>
    <h3 class="group-label">Kehkeh routes (${fr.length})</h3>
    <div class="card-list">${fr.map(routeCard).join('') || '<p class="hint">Tap the bookmark on any route to save it here.</p>'}</div>
    <h3 class="group-label">My board posts (${mine.length})</h3>
    <div class="card-list">${mine.map(function (p) { return postCard(p, true); }).join('') || '<p class="hint">Posts you create on the Board appear here.</p>'}</div>
    <div class="card about-card">
      <div class="set-row"><span>${I('store')} Community Market v${APP_VERSION}</span><b>by ${APP_AUTHOR}</b></div>
      <div class="set-row"><span>${I('wifiOff')} Offline-first</span><b>SQLite cache</b></div>
      <div class="set-row"><span>${I(S.theme === 'market' ? 'moon' : 'sun')} Theme</span><button class="btn ghost sm" id="themeBtn2">${S.theme === 'market' ? 'Night market' : 'Market day'}</button></div>
    </div>
  </section>${navBar('saved')}`);
      bindNav(); bindCards(); bindFavs();
      var t2 = document.getElementById('themeBtn2');
      if (t2) t2.addEventListener('click', function () {
        S.theme = S.theme === 'market' ? 'night' : 'market';
        try { localStorage.setItem('mk_theme', S.theme); } catch (e) {}
        render();
      });
    });
  }

  /* ------------------------------ search --------------------------------- */
  function renderSearch() {
    var q = (screen.q || '').trim().toLowerCase();
    var biz = q ? DATA.businesses.filter(function (b) {
      return (b.name + ' ' + b.area + ' ' + b.desc + ' ' + b.services.join(' ')).toLowerCase().indexOf(q) >= 0;
    }) : [];
    var routes = q ? DATA.routes.filter(function (r) {
      return (r.name + ' ' + r.stops.join(' ') + ' ' + r.notes).toLowerCase().indexOf(q) >= 0;
    }) : [];
    var posts = q ? DATA.posts.filter(function (p) {
      return (p.title + ' ' + p.body + ' ' + p.area).toLowerCase().indexOf(q) >= 0;
    }) : [];
    h(topBar('home') + `
  <section class="screen">
    <button class="back" data-nav="home">${I('chevL')} Home</button>
    <h1 class="screen-title">Search</h1>
    <form class="searchbar" id="sForm">
      ${I('search', 'sb-ico')}
      <input id="sInput" value="${esc(screen.q || '')}" placeholder="Search shops, routes, posts..." autocomplete="off">
    </form>
    ${q ? `
    <h3 class="group-label">Businesses (${biz.length})</h3>
    <div class="card-list">${biz.map(bizCard).join('') || '<p class="hint">None</p>'}</div>
    <h3 class="group-label">Kehkeh routes (${routes.length})</h3>
    <div class="card-list">${routes.map(routeCard).join('') || '<p class="hint">None</p>'}</div>
    <h3 class="group-label">Board (${posts.length})</h3>
    <div class="card-list">${posts.map(function (p) { return postCard(p, false); }).join('') || '<p class="hint">None</p>'}</div>
    ` : '<p class="hint">Type something to search the offline directory.</p>'}
  </section>${navBar('home')}`);
    bindNav(); bindCards(); bindFavs();
    var f = document.getElementById('sForm');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      go('search', { q: document.getElementById('sInput').value.trim() });
    });
  }

  /* --------------------------- card wiring ------------------------------- */
  function bindCards() {
    $all('[data-biz]').forEach(function (b) {
      b.addEventListener('click', function () { go('business', { id: b.dataset.biz }); });
    });
    $all('[data-route]').forEach(function (b) {
      b.addEventListener('click', function () { go('route', { id: b.dataset.route }); });
    });
  }

  /* ------------------------------- boot ---------------------------------- */
  loadData().then(function () {
    try { render(); } catch (e) {
      dismissSplash();
      app.innerHTML = '<div class="card" style="margin:40px 16px"><h2 class="screen-title">Could not start</h2>' +
        '<pre style="white-space:pre-wrap;font-size:12px">' + esc(String((e && e.stack) || e)) + '</pre></div>';
    }
  });

  /* --------------------------- node test hook ---------------------------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { esc: esc, fmtDate: fmtDate, TAGS: TAGS };
  }
})();
