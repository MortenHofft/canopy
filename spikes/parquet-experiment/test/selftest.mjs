// Node self-test of the reader against the Range server: node test/selftest.mjs LAYOUT_DIR
// Checks (a) overview levels, (b) getRange equals a full local read, (c) getPath equals the parent chain, (d) request coalescing.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ParquetTreeSource } from '../web/reader.js';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { compressors as full } from 'hyparquet-compressors';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.argv[2] ?? path.join(here, '..', 'sample', 'yule1k'));
const port = 5210;
const srv = spawn('node', [path.join(here, '..', 'server.mjs'), '--root', path.dirname(dir), '--port', String(port)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 600));
let fails = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' ' + x : '')); if (!c) fails++; };
try {
  const base = `http://127.0.0.1:${port}/${path.basename(dir)}`;
  const src = await ParquetTreeSource.open(base);
  const ov = await src.getOverview(0);
  ok('overview level 0 has rows and typed arrays', ov.node.length > 0 && ov.tip_count instanceof Int32Array && ov.cum_len instanceof Float32Array, `${ov.node.length} rows, requests=${src.stats.requests}`);
  const reqAfterOv = src.stats.requests;
  ok('manifest + overview = 2 requests', reqAfterOv === 2);
  // full local truth
  const file = await asyncBufferFromFile(path.join(dir, 'nodes.parquet'));
  const truth = await parquetReadObjects({ file, compressors: full, columns: ['parent', 'subtree_end', 'tip_count', 'cum_len'] });
  const n = src.man.nodes;
  const lo = Math.floor(n * 0.3), hi = Math.min(n, lo + 3000);
  const got = await src.getRange(lo, hi, ['parent', 'subtree_end', 'tip_count', 'cum_len']);
  let same = got.parent.length === hi - lo;
  for (let i = lo; i < hi && same; i++) same = got.parent[i - lo] === truth[i].parent && got.subtree_end[i - lo] === truth[i].subtree_end && got.tip_count[i - lo] === truth[i].tip_count && got.cum_len[i - lo] === truth[i].cum_len;
  ok('getRange equals local full read', same, `rows ${lo}..${hi}`);
  const full0 = await src.getRange(0, n);
  ok('whole table via getRange has n rows', full0.parent.length === n);
  // path
  const par = full0.parent, se = full0.subtree_end;
  let allPath = true;
  for (const t of [n - 1, Math.floor(n / 2), Math.floor(n * 0.77), 5]) {
    const pp = await src.getPath(t); const p = pp.node;
    const chain = []; for (let i = t; ; i = par[i]) { chain.push(i); if (i === 0) break; }
    chain.reverse();
    if (JSON.stringify(p) !== JSON.stringify(chain)) allPath = false;
  }
  ok('getPath equals parent chain (4 nodes)', allPath);
  const ft = await src.focusTip(n - 5, 50);
  ok('focusTip returns a path ending at the tip, a clade >= 50 tips and a covering overview level', ft.path.node.at(-1) === n - 5 && ft.clade.tips >= 50 && ft.level >= 0, JSON.stringify({ depth: ft.path.node.length, clade: ft.clade, level: ft.level }));
  const tl = await src.getTips(0, src.man.tips, ['tip_label']);
  let rk = true; for (const r of [0, 17, Math.floor(src.man.tips / 2), src.man.tips - 1]) rk = rk && (await src.tipRankOf(tl.tip_label[r])) === r;
  ok('tipRankOf(label) returns the rank (4 tips) and -1 for an absent label', rk && (await src.tipRankOf('zzz_absent_label')) === -1);
  // overview deeper level
  const ov1 = await src.getOverview(1);
  ok('overview level 1 includes level 0 rows', ov1.node.length >= ov.node.length && ov1.node[0] === ov.node[0]);
  // coalescing: whole table in few requests
  const log = await (await fetch(`http://127.0.0.1:${port}/__log`)).json();
  ok('server log matches reader request count (excluding cache hits)', log.length === src.stats.requests, `${log.length} vs ${src.stats.requests}`);
} finally { srv.kill('SIGTERM'); }
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
