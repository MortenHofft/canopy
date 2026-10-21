// Vite plugin serving the repository's data/ directory at /data/ in dev and in `vite preview`, for the examples and the browser
// test page. Nothing from data/ is copied into a build. .gz files are sent as raw bytes (Content-Type application/gzip, no
// Content-Encoding) so the page inflates them itself with DecompressionStream.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(here, '../data');

const TYPES = {
  '.gz': 'application/gzip',
  '.json': 'application/json',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.nwk': 'text/plain; charset=utf-8',
  '.tre': 'text/plain; charset=utf-8',
  '.nex': 'text/plain; charset=utf-8',
  '.nhx': 'text/plain; charset=utf-8',
  '.fa': 'text/plain; charset=utf-8',
  '.fasta': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** Connect middleware mounted at /data. */
export function dataMiddleware(dataDir = DATA_DIR) {
  const root = path.resolve(dataDir);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try {
      rel = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.statusCode = 400;
      return res.end('bad path');
    }
    const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.statusCode = 403;
      return res.end('forbidden');
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        return res.end(`not found under data/: ${rel}`);
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('Content-Length', st.size);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  };
}

export function dataPlugin(dataDir = DATA_DIR) {
  const mw = dataMiddleware(dataDir);
  return {
    name: 'gbif-phylo-data',
    configureServer(server) {
      server.middlewares.use('/data', mw);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/data', mw);
    },
  };
}
