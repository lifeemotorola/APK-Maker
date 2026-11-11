export const REPO = 'lifeemotorola/APK-Maker';
export const RELEASE_TAG = 'apk-downloads';
export const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/tags/${RELEASE_TAG}`;
export const CATEGORIES = [
  { id: 'music', name: 'Music & audio', icon: 'music' },
  { id: 'faith', name: 'Faith & inspiration', icon: 'book' },
  { id: 'tools', name: 'Creative tools', icon: 'tools' },
  { id: 'learning', name: 'Learning', icon: 'code' },
  { id: 'community', name: 'Community', icon: 'community' },
];
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export function validateApps(apps) {
  if (!Array.isArray(apps) || !apps.length) throw new Error('The app catalog is empty.');
  const ids = new Set(), files = new Set();
  for (const app of apps) {
    if (!app || !/^[a-z][a-z0-9-]*$/.test(app.id) || ids.has(app.id) || !/^[A-Za-z0-9-]+\.apk$/.test(app.file) || files.has(app.file)) throw new Error('Invalid app catalog identifiers.');
    if (!CATEGORIES.some(c => c.id === app.category) || !/^[a-z][a-z0-9-]*$/.test(app.project) || !Array.isArray(app.tags)) throw new Error('Invalid app catalog metadata.');
    for (const key of ['name', 'description', 'requirements', 'version', 'artifact', 'job']) if (typeof app[key] !== 'string' || !app[key]) throw new Error('Missing app catalog metadata.');
    ids.add(app.id); files.add(app.file);
  }
  return apps;
}
export function parseLabel(label = '') {
  const fields = Object.fromEntries(String(label).split(';').map(part => part.split('=')));
  return {
    version: /^[A-Za-z0-9][A-Za-z0-9._+-]{0,35}$/.test(fields.version || '') ? fields.version : null,
    sha256: /^[a-f0-9]{64}$/.test(fields.sha256 || '') ? fields.sha256 : null,
    commit: /^[a-f0-9]{40}$/.test(fields.commit || '') ? fields.commit : null,
  };
}
export function publishedAssets(release, apps) {
  const result = new Map();
  if (!release || release.draft || release.tag_name !== RELEASE_TAG || !Array.isArray(release.assets)) return result;
  for (const app of apps) {
    const asset = release.assets.find(a => a.name === app.file && a.state === 'uploaded' && Number.isSafeInteger(a.size) && a.size > 0);
    if (!asset) continue;
    const url = `https://github.com/${REPO}/releases/download/${RELEASE_TAG}/${encodeURIComponent(app.file)}`;
    // Never turn API/catalog-supplied arbitrary URLs into executable links.
    if (asset.browser_download_url !== url) continue;
    const meta = parseLabel(asset.label);
    if (!meta.sha256 && /^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) meta.sha256 = asset.digest.slice(7);
    result.set(app.id, { ...meta, url, size: asset.size, date: Number.isFinite(Date.parse(asset.updated_at)) ? asset.updated_at : null });
  }
  return result;
}
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Size pending';
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function selectApps(apps, { category = 'all', query = '', savedOnly = false, saved = new Set(), sort = 'featured', published = new Map() } = {}) {
  const q = query.toLowerCase().trim();
  const filtered = apps.filter(a => (category === 'all' || a.category === category) && (!savedOnly || saved.has(a.id)) && (!q || [a.name, a.description, a.tagline, ...a.tags, CATEGORIES.find(c => c.id === a.category)?.name].join(' ').toLowerCase().includes(q)));
  if (sort === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'updated') filtered.sort((a, b) => (Date.parse(published.get(b.id)?.date) || 0) - (Date.parse(published.get(a.id)?.date) || 0));
  if (sort === 'size') filtered.sort((a, b) => (published.get(a.id)?.size ?? Infinity) - (published.get(b.id)?.size ?? Infinity));
  return filtered;
}
