#!/usr/bin/env node
// Does a host serve a Parquet file the way web/reader.js needs it?
//
//   node spikes/parquet-experiment/check-host.mjs https://host/path/to/nodes.parquet [--origin https://www.gbif.org]
//
// Sends the same kind of requests the reader sends (GET with `Range: bytes=a-b` and an `Origin`
// header, no preflight) and reports what the host answers. Exit code 0 when every hard
// requirement passes, 1 otherwise. Pure Node (>= 18), no dependencies.
//
// Hard requirements (the reader does not work without them):
//   R1  a ranged GET answers 206 with a matching Content-Range (not 200 with the whole object)
//   R2  Access-Control-Allow-Origin covers the origin (the page on gbif.org fetches cross-origin)
//   R3  the transfer is not content-encoded (gzip on the wire would break byte offsets)
// Soft observations (reported, not required): whether Content-Range is exposed to JS (the reader
// takes byte lengths from manifest.json, so it does not need it), cache status of a second identical
// range, ETag, Cache-Control, Vary, whether a range past the end answers 416, response times.

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const origin = args.includes('--origin') ? args[args.indexOf('--origin') + 1] : 'https://www.gbif.org';
if (!url) {
  console.error('usage: check-host.mjs <url> [--origin <origin>]');
  process.exit(2);
}

const results = [];
function report(id, ok, text) {
  results.push({ id, ok });
  console.log(`${ok === null ? ' i ' : ok ? ' ok' : 'BAD'} ${id}  ${text}`);
}

async function get(range, extra = {}) {
  const headers = { Origin: origin, ...extra };
  if (range) headers.Range = `bytes=${range}`;
  const t0 = performance.now();
  const res = await fetch(url, { headers, redirect: 'follow' });
  const body = new Uint8Array(await res.arrayBuffer());
  const ms = Math.round(performance.now() - t0);
  return { res, body, ms, h: (k) => res.headers.get(k) };
}

function cacheStatus(h) {
  for (const k of ['x-cache', 'cf-cache-status', 'x-vercel-cache', 'x-cache-status', 'x-served-by']) {
    if (h(k)) return `${k}=${h(k)}`;
  }
  return h('age') != null ? `age=${h('age')}` : 'no cache header';
}

console.log(`url     ${url}\norigin  ${origin}\n`);

// Size by HEAD (optional) and by a small range.
const head = await fetch(url, { method: 'HEAD', headers: { Origin: origin }, redirect: 'follow' }).catch(() => null);
if (head) report('HEAD', null, `${head.status}  content-length=${head.headers.get('content-length')}  accept-ranges=${head.headers.get('accept-ranges')}`);

const a = await get('0-1023');
const cr = a.h('content-range');
const total = cr && /\/(\d+)$/.exec(cr) ? Number(/\/(\d+)$/.exec(cr)[1]) : null;
report('R1 206 on bytes=0-1023', a.res.status === 206 && a.body.length === 1024, `status=${a.res.status} bytes=${a.body.length} content-range=${cr} ${a.ms} ms`);
report('info object size', null, `total=${total ?? 'unknown (no Content-Range)'}; the reader uses the sizes in manifest.json`);

const acao = a.h('access-control-allow-origin');
report('R2 CORS allow-origin', acao === '*' || acao === origin, `access-control-allow-origin=${acao}  vary=${a.h('vary')}`);

const expose = (a.h('access-control-expose-headers') || '').toLowerCase();
// Content-Length is CORS-safelisted; Content-Range is not, so a browser only sees it when exposed.
report('info Content-Range visible to JS', null, expose === '*' || expose.includes('content-range') ? `yes (expose-headers=${expose})` : 'no (not needed: byte lengths come from manifest.json)');
report('R3 no Content-Encoding on ranges', !a.h('content-encoding'), `content-encoding=${a.h('content-encoding') || 'none'}`);

report('info accept-ranges', null, `${a.h('accept-ranges')}  etag=${a.h('etag')}  cache-control=${a.h('cache-control')}  content-type=${a.h('content-type')}`);

// Footer read: the reader's first request on every file is the last ~64 KB.
if (total) {
  const lo = Math.max(0, total - 65536);
  const f = await get(`${lo}-${total - 1}`);
  report('tail range (footer)', f.res.status === 206 && f.body.length === total - lo, `status=${f.res.status} bytes=${f.body.length} ${f.ms} ms  cache=${cacheStatus(f.h)}`);
  const f2 = await get(`${lo}-${total - 1}`);
  report('same tail again', null, `status=${f2.res.status} ${f2.ms} ms  cache=${cacheStatus(f2.h)}  (HIT here means the CDN caches ranges as objects)`);
  const mid = Math.floor(total / 2);
  const m = await get(`${mid}-${mid + 65535}`);
  report('mid range', m.res.status === 206, `status=${m.res.status} bytes=${m.body.length} ${m.ms} ms  cache=${cacheStatus(m.h)}`);
  const past = await get(`${total + 10}-${total + 20}`);
  report('info range past end', null, `status=${past.res.status} (416 is the correct answer)`);
  // Does a plain GET (no Range) stream the whole thing, or is it refused? Only reads the first bytes.
  const plain = await fetch(url, { headers: { Origin: origin }, redirect: 'follow' });
  report('info plain GET', null, `status=${plain.status} content-length=${plain.headers.get('content-length')} content-encoding=${plain.headers.get('content-encoding') || 'none'}${plain.headers.get('content-encoding') ? '  -> compressed transfer breaks byte offsets; serve Parquet with no Content-Encoding' : ''}`);
  await plain.body?.cancel();
}

const hard = results.filter((r) => r.ok !== null);
const bad = hard.filter((r) => !r.ok);
console.log(`\n${bad.length === 0 ? 'PASS' : 'FAIL'}: ${hard.length - bad.length}/${hard.length} hard checks${bad.length ? ' (' + bad.map((r) => r.id).join(', ') + ')' : ''}`);
process.exit(bad.length ? 1 : 0);
