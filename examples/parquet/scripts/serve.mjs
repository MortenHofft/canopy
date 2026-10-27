#!/usr/bin/env node
// A static file server with HTTP Range support, CORS, an optional network model and a request log, to serve the generated Parquet files
// (and, with a second root, the built page) on one origin.
//   node scripts/serve.mjs --root DIR[,DIR2] [--port 5210] [--latency 0] [--mbps 0] [--connect-rtts 2]
// The network model (off by default): every response waits `latency` ms before its first byte, a new connection pays `connect-rtts` extra
// latencies once, and all response bytes share one token bucket of `mbps` megabit/s (0 = unlimited). Not modelled: TCP slow start, loss,
// HTTP/2 multiplexing, CDN misses. Change it while running: GET /__cfg?latency=150&mbps=9. GET /__log lists the requests, GET /__reset clears it.
// The port 0 asks the OS for a free one.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.parquet': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
};
const HDR = 400; // bytes a response's headers count for in the bandwidth model
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {{ roots: string[], port?: number, latency?: number, mbps?: number, connectRtts?: number }} o */
export function startServer(o) {
  const roots = o.roots.map((r) => path.resolve(r));
  const cfg = { latency: o.latency ?? 0, mbps: o.mbps ?? 0, connect: o.connectRtts ?? 2 };
  let log = [];
  let linkFree = 0;
  const resolveFile = (urlPath) => {
    const rel = decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html';
    for (const r of roots) {
      const f = path.resolve(r, rel);
      if (f.startsWith(r + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
    return null;
  };
  async function send(res, fd, start, end, rec) {
    const CH = 16384;
    const buf = Buffer.allocUnsafe(CH);
    for (let pos = start; pos < end;) {
      const n = Math.min(CH, end - pos);
      if (cfg.mbps > 0) {
        const now = performance.now();
        const t = Math.max(now, linkFree);
        linkFree = t + (n * 8) / (cfg.mbps * 1000);
        if (t - now > 1) await sleep(t - now);
      }
      const { bytesRead } = await fd.read(buf, 0, n, pos);
      if (!bytesRead) break;
      if (!res.write(Buffer.from(buf.subarray(0, bytesRead)))) await new Promise((r) => res.once('drain', r));
      pos += bytesRead;
    }
    res.end();
    rec.done = performance.now();
  }
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'range, if-match');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'content-range, content-length, etag');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
      log.push({ url: u.pathname, method: 'OPTIONS', status: 204, bytes: 0 }); // a logged OPTIONS: the browser sent a CORS preflight
      res.writeHead(204);
      return res.end();
    }
    if (u.pathname === '/__cfg') {
      for (const [k, key] of [
        ['latency', 'latency'],
        ['mbps', 'mbps'],
        ['connect', 'connect'],
      ])
        if (u.searchParams.has(k)) cfg[key] = +u.searchParams.get(k);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(cfg));
    }
    if (u.pathname === '/__log') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(log));
    }
    if (u.pathname === '/__reset') {
      log = [];
      res.setHeader('Content-Type', 'application/json');
      return res.end('{}');
    }
    const f = resolveFile(u.pathname);
    if (!f) {
      res.writeHead(404);
      return res.end('not found');
    }
    const size = fs.statSync(f).size;
    const fresh = !req.socket._seen;
    req.socket._seen = true;
    const wait = cfg.latency + (fresh ? cfg.connect * cfg.latency : 0);
    if (wait > 0) await sleep(wait);
    let start = 0;
    let end = size;
    let status = 200;
    const rg = req.headers.range;
    if (rg) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rg);
      if (!m || (m[1] === '' && m[2] === '')) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      if (m[1] === '') start = Math.max(0, size - +m[2]);
      else {
        start = +m[1];
        end = m[2] === '' ? size : Math.min(size, +m[2] + 1);
      }
      if (start >= size || start >= end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      status = 206;
    }
    const headers = { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream', 'Content-Length': end - start };
    if (status === 206) headers['Content-Range'] = `bytes ${start}-${end - 1}/${size}`;
    res.writeHead(status, headers);
    const rec = { url: u.pathname, range: rg ?? null, status, bytes: end - start, fresh, done: 0 };
    log.push(rec);
    if (cfg.mbps > 0) {
      const now = performance.now();
      const t = Math.max(now, linkFree);
      linkFree = t + (HDR * 8) / (cfg.mbps * 1000);
      if (t - now > 1) await sleep(t - now);
    }
    const fd = await fs.promises.open(f, 'r');
    try {
      await send(res, fd, start, end, rec);
    } finally {
      await fd.close();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port ?? 0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        cfg,
        log: () => log,
        reset: () => (log = []),
        close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values: A } = parseArgs({
    options: {
      root: { type: 'string' },
      port: { type: 'string', default: '5210' },
      latency: { type: 'string', default: '0' },
      mbps: { type: 'string', default: '0' },
      'connect-rtts': { type: 'string', default: '2' },
    },
  });
  const s = await startServer({
    roots: (A.root ?? '.').split(','),
    port: +A.port,
    latency: +A.latency,
    mbps: +A.mbps,
    connectRtts: +A['connect-rtts'],
  });
  console.log(`range server on ${s.url}  roots=${A.root ?? '.'}  network=${JSON.stringify(s.cfg)}`);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => s.close().then(() => process.exit(0)));
}
