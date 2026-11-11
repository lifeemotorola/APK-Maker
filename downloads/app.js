import { REPO, RELEASE_API, CATEGORIES, escapeHTML as esc, validateApps, publishedAssets, formatSize, selectApps } from './catalog.js';
const $ = id => document.getElementById(id);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const drawings = {
  choirtune: '<path d="M3 10v4m4-8v12m5-16v20m5-16v12m4-8v4"/>',
  piano: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18m5-18v18m5-18v18M7 4v9m10-9v9"/><path stroke-width="3.5" d="M7 4v8m10-8v8"/>',
  book: '<path d="M12 6c-3-3-6-3-10-2v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-4-1-7-1-10 2Zm0 0v15"/>',
  camera: '<rect x="2" y="6" width="20" height="15" rx="3"/><path d="m7 6 2-3h6l2 3"/><circle cx="12" cy="13" r="4"/>',
  code: '<path d="m7 6-6 6 6 6m10-12 6 6-6 6M14 3l-4 18"/>',
  feather: '<path d="M20 3C9 0 3 10 7 17c7 4 17-2 13-14ZM3 22 16 9m-9 8h7m-2-5V7"/>',
  wave: '<path d="M2 12h3l3-8 5 16 3-12 3 4h3"/>',
  headphones: '<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><rect x="2" y="11" width="5" height="10" rx="2"/><rect x="17" y="11" width="5" height="10" rx="2"/>',
  layout: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 9h20M8 9v12m3-8h7m-7 4h5"/>',
  shop: '<path d="M3 10v11h18V10M2 10l3-7h14l3 7M8 21v-7h8v7M2 10c2 3 4 3 6 0 2 3 6 3 8 0 2 3 4 3 6 0"/>',
};
const appIcon = app => `<div class="app-icon ${esc(app.color)}"><svg viewBox="0 0 24 24" aria-hidden="true">${drawings[app.icon] || drawings.layout}</svg></div>`;
const params = new URLSearchParams(location.search);
const state = {
  apps: [], published: new Map(), releaseState: 'loading', category: CATEGORIES.some(c => c.id === params.get('category')) ? params.get('category') : 'all',
  query: (params.get('q') || '').slice(0, 200), savedOnly: params.get('view') === 'saved', saved: new Set(),
  sort: ['featured', 'updated', 'name', 'size'].includes(params.get('sort')) ? params.get('sort') : 'featured', activeDialog: null,
};
let toastTimer, fetching = false;
try { const saved = JSON.parse(localStorage.getItem('apk-maker.saved') || '[]'); if (Array.isArray(saved)) state.saved = new Set(saved.filter(x => typeof x === 'string')); } catch { /* Storage is optional. */ }
function toast(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function saveURL() {
  const p = new URLSearchParams();
  if (state.category !== 'all') p.set('category', state.category);
  if (state.query) p.set('q', state.query);
  if (state.savedOnly) p.set('view', 'saved');
  if (state.sort !== 'featured') p.set('sort', state.sort);
  history.replaceState(null, '', location.pathname + (p.size ? `?${p}` : '') + location.hash);
}
function downloadButton(app, detail = false) {
  const build = state.published.get(app.id);
  const className = `download-button${detail ? ' dialog-download' : ''}`;
  return build ? `<a class="${className}" href="${esc(build.url)}" data-download="${app.id}" download="${esc(app.file)}" aria-label="Download ${esc(app.name)} APK">${icon('download')}Download APK</a>` : `<button class="${className}" disabled>${icon('download')}${state.releaseState === 'loading' ? 'Checking build...' : state.releaseState === 'error' ? 'Check unavailable' : 'Not published yet'}</button>`;
}
function card(app) {
  const build = state.published.get(app.id), saved = state.saved.has(app.id);
  const category = CATEGORIES.find(c => c.id === app.category);
  return `<article class="app-card" data-app="${app.id}">
    <div class="app-card-top">${appIcon(app)}<button class="bookmark-button" data-save="${app.id}" aria-pressed="${saved}" aria-label="${saved ? 'Unsave' : 'Save'} ${esc(app.name)}">${icon('bookmark')}</button></div>
    <div class="category-tag">${esc(category.name)}</div><h3><button class="card-title" data-detail="${app.id}">${esc(app.name)}</button></h3>
    <p class="app-description">${esc(app.description)}</p><div class="tags">${app.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    <div class="card-meta"><span>${build?.version ? `v${esc(build.version)}` : `v${esc(app.version)} source`}</span><span class="meta-dot"></span><span>${build ? formatSize(build.size) : 'Build pending'}</span><span>Android 6.0+</span></div>
    <div class="card-actions">${downloadButton(app)}<button class="details-button" data-detail="${app.id}" aria-label="Details for ${esc(app.name)}">${icon('info')}</button></div></article>`;
}
function render() {
  const selected = selectApps(state.apps, { category: state.category, query: state.query, savedOnly: state.savedOnly, saved: state.saved, sort: state.sort, published: state.published });
  $('app-grid').innerHTML = selected.map(card).join('');
  $('app-grid').setAttribute('aria-busy', 'false');
  $('empty-state').hidden = selected.length > 0;
  $('heading-count').textContent = String(selected.length);
  $('result-count').textContent = `${selected.length} ${selected.length === 1 ? 'app' : 'apps'} to explore`;
  $('collection-heading').firstChild.textContent = state.savedOnly ? 'Your saved apps ' : 'The app collection ';
  $('nav-count').textContent = String(state.apps.length);
  $('collection-total').textContent = `${state.apps.length} purposeful apps`;
  $('saved-count').textContent = String([...state.saved].filter(id => state.apps.some(a => a.id === id)).length);
  $('sort').value = state.sort;
  $('search').value = state.query;
  $('filters').innerHTML = [{ id: 'all', name: 'All apps' }, ...CATEGORIES].map(c => `<button class="filter-chip${state.category === c.id ? ' active' : ''}" data-category="${c.id}" aria-pressed="${state.category === c.id}">${esc(c.name)}<span>${state.apps.filter(a => c.id === 'all' || c.id === a.category).length}</span></button>`).join('');
  $('side-categories').innerHTML = CATEGORIES.map(c => `<button class="category-link${state.category === c.id ? ' active' : ''}" data-category="${c.id}" aria-pressed="${state.category === c.id}">${icon(c.icon)}${esc(c.name)}</button>`).join('');
  for (const id of ['nav-all', 'nav-saved', 'nav-latest']) {
    const active = id === 'nav-saved' ? state.savedOnly : id === 'nav-latest' ? !state.savedOnly && state.sort === 'updated' : !state.savedOnly && state.sort !== 'updated';
    $(id).classList.toggle('active', active);
    if (active) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
  }
}
function dateLabel(date) { return date ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date)) : 'Not available'; }
function showDetails(id) {
  const app = state.apps.find(a => a.id === id); if (!app) return;
  state.activeDialog = id;
  const build = state.published.get(id);
  $('dialog-content').innerHTML = `<div class="dialog-app-heading">${appIcon(app)}<div><h2 id="dialog-title">${esc(app.name)}</h2><p>${esc(app.tagline)}</p></div></div>
    <p class="dialog-description">${esc(app.description)}</p>
    <dl class="dialog-metadata"><div><dt>${build ? 'Published version' : 'Source version'}</dt><dd>${esc(build?.version || app.version)}${build && !build.version ? ' (source; build version unlisted)' : ''}</dd></div><div><dt>Download size</dt><dd>${build ? formatSize(build.size) : 'Not published yet'}</dd></div><div><dt>Platform</dt><dd>Android 6.0+</dd></div><div><dt>Asset updated</dt><dd>${dateLabel(build?.date)}</dd></div></dl>
    <section class="dialog-section"><h3>Before you install</h3><p>${esc(app.requirements)}</p></section>
    ${build?.sha256 ? `<section class="dialog-section"><h3>File integrity · SHA-256</h3><code class="hash">${build.sha256}</code><button class="text-button" id="copy-hash">Copy checksum</button><p>A matching hash verifies the file bytes, not app safety.</p></section>` : ''}
    <a class="dialog-source" href="https://github.com/${REPO}/tree/${build?.commit || 'main'}/${app.project}" target="_blank" rel="noopener noreferrer">App source &amp; documentation ${icon('external')}</a>
    ${downloadButton(app, true)}${!build ? `<p class="dialog-warning">${state.releaseState === 'error' ? 'Availability could not be checked. Retry or view' : 'A public APK has not been published for this app yet. Follow'} <a href="https://github.com/${REPO}/actions/workflows/build-apk.yml" target="_blank" rel="noopener noreferrer">the repository build status</a>. No sign-in is needed once a public APK is published.</p>` : ''}`;
  if (!$('app-dialog').open) $('app-dialog').showModal();
}
async function loadRelease() {
  if (fetching) return;
  fetching = true; state.releaseState = 'loading'; $('retry').hidden = true;
  $('release-status').className = 'release-status'; $('release-message').textContent = 'Checking for published APKs...'; render();
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 12000);
  try {
    const response = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, signal: abort.signal, cache: 'no-store', credentials: 'omit' });
    if (response.status === 404) {
      state.published = new Map(); state.releaseState = 'empty';
    } else {
      if (!response.ok) throw new Error('Release lookup failed');
      state.published = publishedAssets(await response.json(), state.apps); state.releaseState = state.published.size ? 'ready' : 'empty';
    }
    $('release-status').className = `release-status ${state.releaseState === 'ready' ? 'ready' : ''}`;
    $('release-message').textContent = state.published.size ? `${state.published.size} of ${state.apps.length} APKs published. Downloads go directly to GitHub release files.` : 'First public APKs are not published yet. Successful main-branch builds will appear here automatically.';
    $('retry').textContent = 'Refresh'; $('retry').hidden = false;
  } catch {
    state.published = new Map(); state.releaseState = 'error';
    $('release-status').className = 'release-status error';
    $('release-message').textContent = 'Could not check downloads. GitHub may be offline or rate-limited. No broken download links are shown.';
    $('retry').textContent = 'Try again'; $('retry').hidden = false;
  } finally {
    clearTimeout(timer); fetching = false; render();
    if ($('app-dialog').open && state.activeDialog) showDetails(state.activeDialog);
  }
}
document.addEventListener('click', event => {
  const target = event.target.closest('button,a'); if (!target) return;
  if (target.dataset.save) {
    const id = target.dataset.save;
    if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id);
    try { localStorage.setItem('apk-maker.saved', JSON.stringify([...state.saved])); } catch { toast('Your shortlist is available for this visit. Browser storage is unavailable.'); }
    render(); saveURL(); document.querySelector(`[data-save="${id}"]`)?.focus();
  }
  if (target.dataset.category) { state.category = target.dataset.category; state.savedOnly = false; render(); saveURL(); }
  if (target.dataset.detail) showDetails(target.dataset.detail);
  if (target.dataset.download) toast('Download requested. Open the APK on your Android phone to install it.');
  if (target.id === 'copy-hash') {
    const hash = state.published.get(state.activeDialog)?.sha256;
    if (hash && navigator.clipboard?.writeText) navigator.clipboard.writeText(hash).then(() => toast('Checksum copied.')).catch(() => toast('Copy the checksum displayed above.'));
    else if (hash) toast('Copy the checksum displayed above.');
  }
});
$('search').addEventListener('input', event => { state.query = event.target.value.slice(0, 200); render(); saveURL(); });
$('sort').addEventListener('change', event => { state.sort = event.target.value; render(); saveURL(); });
function reset() { state.savedOnly = false; state.category = 'all'; state.query = ''; state.sort = 'featured'; render(); saveURL(); }
$('reset').addEventListener('click', reset);
$('nav-all').addEventListener('click', reset);
$('nav-saved').addEventListener('click', () => { state.savedOnly = true; state.category = 'all'; state.query = ''; render(); saveURL(); $('collection').scrollIntoView({ behavior: 'smooth' }); });
$('nav-latest').addEventListener('click', () => { reset(); state.sort = 'updated'; render(); saveURL(); $('collection').scrollIntoView({ behavior: 'smooth' }); });
$('retry').addEventListener('click', loadRelease);
$('close-dialog').addEventListener('click', () => $('app-dialog').close());
$('app-dialog').addEventListener('click', event => {
  if (event.target !== $('app-dialog')) return;
  const box = $('app-dialog').getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $('app-dialog').close();
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('app-dialog').open) { event.preventDefault(); $('search').focus(); }
});
$('featured-icon').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${drawings.choirtune}</svg>`;
for (let n = 0; n < 42; n++) { const bar = document.createElement('span'); bar.style.height = `${6 + Math.abs(Math.sin(n * 0.77) * Math.cos(n * 0.19)) * 41}px`; $('hero-wave').append(bar); }
try {
  const response = await fetch('apps.json'); if (!response.ok) throw new Error('Catalog unavailable');
  state.apps = validateApps(await response.json());
  state.saved = new Set([...state.saved].filter(id => state.apps.some(a => a.id === id)));
  render(); await loadRelease();
} catch {
  $('app-grid').setAttribute('aria-busy', 'false'); $('release-message').textContent = 'The app catalog could not be loaded. Reload this page or visit the GitHub repository.';
  $('release-status').classList.add('error'); $('result-count').textContent = 'Collection unavailable';
}
