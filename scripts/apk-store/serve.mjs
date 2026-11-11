// Dependency-free static preview. Serves only the download website, not repo files.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../downloads/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };
const port = Number(process.env.PORT || 4173);
http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    let pathname = decodeURIComponent(new URL(req.url, 'http://preview').pathname);
    const prefix = '/APK-Maker/downloads';
    if (pathname === prefix) { res.writeHead(302, { Location: `${prefix}/` }); return res.end(); }
    if (pathname.startsWith(prefix + '/')) pathname = pathname.slice(prefix.length);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const relative = pathname.slice(1);
    const allowed = /^(index\.html|styles\.css|app\.js|catalog\.js|apps\.json|assets\/(fonts\.css|dm-sans\.ttf|OFL\.txt|favicon\.svg))$/;
    if (!allowed.test(relative)) { res.writeHead(404); return res.end('Not found'); }
    const file = path.join(root, relative);
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '0.0.0.0', () => console.log(`APK-Maker download website listening on 0.0.0.0:${port}`));
