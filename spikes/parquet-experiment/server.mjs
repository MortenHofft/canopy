#!/usr/bin/env node
// Static file server with HTTP Range support, per-request added latency, a shared bandwidth cap and request logging.
//   node server.mjs --root DIR[,DIR2] --port 5210 [--latency 20] [--mbps 30] [--connect-rtts 2]
// Runtime control (so one server serves all network profiles):
//   GET /__cfg?latency=150&mbps=9&connect=2   set the profile      GET /__log   request log   GET /__reset  clear log
// Model: every response waits `latency` ms before the first byte (one RTT; the request upstream is assumed free), every
// NEW TCP connection pays `connect-rtts` extra latencies once (TCP + TLS handshake), and all response bytes (headers counted as
// 400 B) share ONE token bucket of `mbps` megabit/s, i.e. one access link. mbps=0 means unlimited. CORS is open (Range allowed).
// Not modelled: TCP slow start, loss, HTTP/2 multiplexing, CDN edge cache misses.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: A } = parseArgs({ options: { root: { type: 'string' }, port: { type: 'string', default: '5210' }, latency: { type: 'string', default: '0' }, mbps: { type: 'string', default: '0' }, 'connect-rtts': { type: 'string', default: '2' } } });
const roots = (A.root ?? '.').split(',').map((r) => path.resolve(r));
const cfg = { latency: +A.latency, mbps: +A.mbps, connect: +A['connect-rtts'] };
let log = [];
let linkFree = 0; // ms timestamp when the shared link is next free
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.parquet': 'application/octet-stream', '.gz': 'application/gzip', '.nwk': 'text/plain', '.bin': 'application/octet-stream', '.zst': 'application/zstd', '.wasm': 'application/wasm', '.tsv': 'text/tab-separated-values' };
const HDR = 400;

function resolveFile(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  for (const r of roots) {
    const f = path.resolve(r, rel);
    if (f.startsWith(r + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendThrottled(res, fd, start, end, rec) {
  const CH = 16384;
  let pos = start;
  const buf = Buffer.allocUnsafe(CH);
  while (pos < end) {
    const n = Math.min(CH, end - pos);
    if (cfg.mbps > 0) {
      const now = performance.now();
      const t = Math.max(now, linkFree);
      linkFree = t + (n * 8) / (cfg.mbps * 1000); // ms
      if (t - now > 1) await sleep(t - now);
    }
    const { bytesRead } = await fd.read(buf, 0, n, pos);
    const ok = res.write(Buffer.from(buf.subarray(0, bytesRead)));
    pos += bytesRead;
    if (!ok) await new Promise((r) => res.once('drain', r));
    if (!bytesRead) break;
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
  if (req.method === 'OPTIONS') { log.push({ url: u.pathname, method: 'OPTIONS', range: req.headers['access-control-request-headers'] ?? null, status: 204, bytes: 0 }); res.writeHead(204); return res.end(); }  // a logged OPTIONS = the browser sent a CORS preflight
  if (u.pathname === '/__cfg') {
    if (u.searchParams.has('latency')) cfg.latency = +u.searchParams.get('latency');
    if (u.searchParams.has('mbps')) cfg.mbps = +u.searchParams.get('mbps');
    if (u.searchParams.has('connect')) cfg.connect = +u.searchParams.get('connect');
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(cfg));
  }
  if (u.pathname === '/__log') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(log)); }
  if (u.pathname === '/__reset') { log = []; res.setHeader('Content-Type', 'application/json'); return res.end('{}'); }
  const f = resolveFile(u.pathname);
  if (!f) { res.writeHead(404); return res.end('not found'); }
  const size = fs.statSync(f).size;
  const sock = req.socket;
  const fresh = !sock._seen;
  sock._seen = true;
  const t0 = performance.now();
  const wait = cfg.latency + (fresh ? cfg.connect * cfg.latency : 0);
  if (wait > 0) await sleep(wait);
  let start = 0, end = size, status = 200;
  const rg = req.headers.range;
  if (rg) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rg);
    if (!m || (m[1] === '' && m[2] === '')) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    if (m[1] === '') { start = Math.max(0, size - +m[2]); end = size; }
    else { start = +m[1]; end = m[2] === '' ? size : Math.min(size, +m[2] + 1); }
    if (start >= size || start >= end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    status = 206;
  }
  const headers = { 'Content-Type': MIME[path.extname(f)] ?? 'application/octet-stream', 'Content-Length': end - start };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end - 1}/${size}`;
  res.writeHead(status, headers);
  const rec = { url: u.pathname, range: rg ?? null, status, bytes: end - start, t0, fresh, done: 0 };
  log.push(rec);
  if (cfg.mbps > 0) { // headers consume link time too
    const now = performance.now(); const t = Math.max(now, linkFree); linkFree = t + (HDR * 8) / (cfg.mbps * 1000); if (t - now > 1) await sleep(t - now);
  }
  const fd = await fs.promises.open(f, 'r');
  try { await sendThrottled(res, fd, start, end, rec); } finally { await fd.close(); }
});
server.listen(+A.port, '127.0.0.1', () => console.log(`range server on http://127.0.0.1:${A.port} roots=${roots.join(',')} cfg=${JSON.stringify(cfg)}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
