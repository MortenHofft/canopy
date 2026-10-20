// RangeFile unit test with a mock fetch (no network, no ports): coalescing, de-duplication, caching, 200 fallback.
import { RangeFile } from '../web/reader.js';
const data = new Uint8Array(1_000_000).map((_, i) => i % 251);
let calls = [];
const mk = (honourRange = true) => (url, init) => {
  const m = /bytes=(\d+)-(\d+)/.exec(init.headers.Range); const s = +m[1], e = +m[2] + 1;
  calls.push([s, e]);
  const body = honourRange ? data.slice(s, e) : data;
  return Promise.resolve({ status: honourRange ? 206 : 200, arrayBuffer: () => Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)) });
};
let fails = 0; const ok = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
const same = (buf, s, e) => { const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) if (a[i] !== data[s + i]) return false; return a.length === e - s; };

let f = new RangeFile('http://x/f', data.length, { fetch: mk(), gap: 1000 });
let [a, b, c] = await Promise.all([f.slice(0, 100), f.slice(200, 300), f.slice(50_000, 50_100)]);
ok('requests within the gap are merged, far ones are not (2 fetches)', calls.length === 2 && calls[0][0] === 0 && calls[0][1] === 300 && calls[1][0] === 50_000);
ok('payloads are correct', same(a, 0, 100) && same(b, 200, 300) && same(c, 50_000, 50_100));
calls = [];
await f.slice(10, 50); await f.slice(250, 260);
ok('slices inside a fetched block are served from the cache (0 fetches)', calls.length === 0);
calls = [];
const p1 = f.slice(400_000, 400_100), p2 = f.slice(400_020, 400_050);
await Promise.all([p1, p2]);
ok('two overlapping requests in the same tick become one fetch', calls.length === 1);
calls = [];
const q1 = f.slice(600_000, 600_100); await new Promise((r) => setTimeout(r, 5)); const q2 = f.slice(600_010, 600_020);
await Promise.all([q1, q2]);
ok('a request inside an in-flight fetch waits for it (1 fetch)', calls.length === 1);
calls = [];
f = new RangeFile('http://x/g', data.length, { fetch: mk(false) });
const w = await f.slice(5, 10); await f.slice(900_000, 900_010);
ok('server answering 200 (no Range support): whole object kept, one fetch only', calls.length === 1 && same(w, 5, 10));
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
