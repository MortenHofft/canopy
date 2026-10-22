// A static server for the built demo site (site-dist/) that follows vercel.json's URL rules, so the browser checks see what Vercel
// serves: trailingSlash false (/x/ redirects to /x with 308), cleanUrls (/x serves x.html or x/index.html), 404 otherwise.
//   import { serveSite } from './static-site.mjs';  const { url, close } = await serveSite('site-dist');
//   node tests/browser/scripts/static-site.mjs [dir] [--port 5312]   (to look at the build by hand)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gz': 'application/gzip',
  '.map': 'application/json',
};

export function serveSite(dir, port = 0) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = decodeURIComponent(u.pathname);
    if (p.length > 1 && p.endsWith('/')) {
      res.writeHead(308, { Location: p.slice(0, -1) + u.search });
      return res.end();
    }
    const file = [p, p + '.html', path.join(p, 'index.html')]
      .map((q) => path.join(root, q))
      .find((f) => f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile());
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
    }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': TYPES[ext] ?? (p.startsWith('/data/') ? 'text/plain; charset=utf-8' : 'application/octet-stream') });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const dir = a[0] && !a[0].startsWith('--') ? a[0] : 'site-dist';
  const { url } = await serveSite(dir, a.includes('--port') ? Number(a[a.indexOf('--port') + 1]) : 5312);
  console.log(`serving ${dir} at ${url}`);
}
