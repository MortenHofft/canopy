// Functional check of ParquetSource + the renderer on a Parquet-converted tree, in headless Chromium, against the full tree parsed
// from the Newick (ground truth). Needs three things running:
//   1. the converted tree behind a Range server:  node spikes/parquet-experiment/server.mjs --root data/real-ladder/fetched/parquet --port 5210
//   2. the Vite dev server of spikes/custom (parquet.html is dev-only):  cd spikes/custom && npx vite --port 5307 --strictPort
//   3. the Newick the Parquet files were converted from (see docs/results/treesource-slice.md for the conversion command)
//   node --experimental-transform-types scripts/check-parquet-source.mjs [--name otl-1m-metazoa] [--tree PATH.nwk.gz] [--app http://127.0.0.1:5307] [--pq http://127.0.0.1:5210]
// Checks: (1) the first view needs only manifest + overview tail (request count and bytes printed); (2) X / XMAX / ROW and tip ranges of
// every overview row equal what computeLayout() gives on the full tree; (3) a click on a stub reports the true tip range and the labels
// read from tips.parquet are the true ones; (4) zooming into a small stub loads its row group(s) and the loaded rows equal the full
// tree's; (5) zooming into the biggest stub expands the next overview level; (6) the radial layout draws the stubs too. Exit 1 on failure.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const name = args.name || 'otl-1m-metazoa';
const treeFile = args.tree || path.join(root, 'data/real-ladder/fetched', name + '.nwk.gz');
const APP = args.app || 'http://127.0.0.1:5307', PQ = args.pq || 'http://127.0.0.1:5210';
const { parseNewick } = await import(path.join(root, 'spikes/shared/newick.ts'));
const { computeLayout } = await import(path.join(root, 'spikes/custom/src/core/layout.ts'));
const require = createRequire(path.join(root, 'spikes/runner/package.json'));
const { chromium } = require('playwright-core');

let failures = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) failures++; };

let raw = fs.readFileSync(treeFile);
if (treeFile.endsWith('.gz')) raw = zlib.gunzipSync(raw);
const truth = parseNewick(raw.toString('utf8'));
raw = null;
const TL = computeLayout(truth, false); // OTL has no branch lengths: cladogram
console.log(`ground truth: ${truth.tipCount} tips, ${truth.nodeCount} nodes`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const httpReqs = [];
page.on('request', (r) => { if (r.url().startsWith(PQ)) httpReqs.push({ url: r.url().split('/').pop(), range: r.headers().range ?? null }); });
page.on('response', (r) => { if (r.url().startsWith(PQ)) r.body().then((b) => { const q = httpReqs.find((x) => x.url === r.url().split('/').pop() && x.bytes === undefined); if (q) q.bytes = b.length; }, () => {}); });

const open = async (layout) => {
  httpReqs.length = 0;
  await page.goto(`${APP}/parquet.html?url=${PQ}/${name}&layout=${layout}`);
  await page.waitForFunction(() => window.__pq && window.__pq.handle() && window.__pq.handle().getStats().frames > 0, null, { timeout: 60000 });
  await page.waitForTimeout(500); // anything the first frame would trigger would show up here
};
const info = () => page.evaluate(() => { const q = window.__pq, s = q.source.stats; return { ...s, version: q.source.version, frame: q.handle().getStats() }; });
const settle = async (cond, arg, ms = 30000) => { await page.waitForFunction(cond, arg, { timeout: ms }); await page.waitForTimeout(300); };

// ---------------------------------------------------------------- (1) first view
await open('rectangular');
let s = await info();
const tot = httpReqs.reduce((a, r) => a + (r.bytes ?? 0), 0);
console.log(`first view: source says ${s.requests} requests, ${s.bytes} bytes; browser saw ${httpReqs.length} requests (${tot} bytes): ${httpReqs.map((r) => r.url + (r.range ? ' ' + r.range : '')).join(', ')}`);
console.log(`  snapshot ${s.rows} rows, ${s.stubs} stubs; first-frame cut ${s.frame.cutMs.toFixed(1)} ms, draw ${s.frame.drawMs.toFixed(1)} ms, drawn ${s.frame.drawn}, summaries ${s.frame.summaries}, snapshot build ${s.snapshotMs.toFixed(1)} ms`);
ok(httpReqs.length === 2 && httpReqs.every((r) => r.url === 'manifest.json' || r.url === 'overview.parquet'), 'first view: manifest.json + one overview range only');
ok(s.stubs > 100 && s.frame.summaries > 100, `stubs are drawn as summaries (${s.stubs} stubs, ${s.frame.summaries} summaries in the frame)`);
ok(s.loadedClades === 0 && s.requests === 2, 'nothing opened by itself in the first view (fitted view)');

// ---------------------------------------------------------------- (2) rollups vs full tree
const rows = await page.evaluate(() => {
  const q = window.__pq, sn = q.source.snapshot(), L = q.handle().renderer().layout;
  return { gid: Array.from(sn.globalId), stub: Array.from(sn.stub), ls: Array.from(sn.leafStart), le: Array.from(sn.leafEnd), X: Array.from(L.X), XMAX: Array.from(L.XMAX), ROW: Array.from(L.ROW), parent: Array.from(sn.parent) };
});
const compare = (rows, label) => {
  let bad = 0, wx = 0, wm = 0, wr = 0;
  for (let k = 0; k < rows.gid.length; k++) {
    const g = rows.gid[k];
    const dx = Math.abs(rows.X[k] - TL.X[g]), dm = Math.abs(rows.XMAX[k] - TL.XMAX[g]), dr = Math.abs(rows.ROW[k] - TL.ROW[g]);
    wx = Math.max(wx, dx); wm = Math.max(wm, dm); wr = Math.max(wr, dr);
    const parentOk = k === 0 || rows.gid[rows.parent[k]] === truth.parent[g];
    if (dx > 2e-6 || dm > 2e-6 || dr > 1e-3 || rows.ls[k] !== truth.leafStart[g] || rows.le[k] !== truth.leafEnd[g] || !parentOk) { if (bad++ < 3) console.log('    mismatch row', k, 'node', g, { dx, dm, dr, ls: rows.ls[k], tls: truth.leafStart[g], parentOk }); }
  }
  ok(bad === 0, `${label}: ${rows.gid.length} rows equal the full tree's X / XMAX / ROW / tip range / parent (worst |dX| ${wx.toExponential(1)}, |dXMAX| ${wm.toExponential(1)}, |dROW| ${wr.toExponential(1)})`);
};
compare(rows, 'overview rows');

// ---------------------------------------------------------------- (3) click on a stub
const stubs = rows.gid.map((g, k) => ({ g, k, tips: rows.le[k] - rows.ls[k], stub: rows.stub[k] })).filter((x) => x.stub === 1);
const byTips = stubs.slice().sort((a, b) => a.tips - b.tips);
const mid = byTips.find((x) => x.tips >= 40000) ?? byTips[byTips.length - 1]; // a stub tall enough to click inside its triangle at the fit view (0.5 px per 1000 tips)
const click = async (g) => {
  const b = await page.evaluate((g) => window.__pq.handle().renderer().nodeBounds(g), g);
  if (!b) return null;
  // inside the triangle: right part of the clade's box, vertical middle (the triangle widens to the right)
  await page.mouse.click(b.x + b.width * 0.95, b.y + b.height / 2);
  return b;
};
const ev0 = await page.evaluate(() => window.__pq.events.length);
const before = await info();
const bounds = await click(mid.g);
await settle((n) => window.__pq.events.length > n, ev0);
const ev = await page.evaluate(() => window.__pq.events.at(-1));
console.log(`click on stub node ${mid.g} (${mid.tips} tips) at box ${JSON.stringify(bounds && { w: Math.round(bounds.width), h: Math.round(bounds.height) })}: event ${JSON.stringify(ev)}`);
ok(ev && ev.kind === 'summary' && ev.node === mid.g, 'click on a triangle reports kind summary and the stub\'s node id (full-tree preorder id)');
ok(ev && ev.tipRange[0] === truth.leafStart[ev.node] && ev.tipRange[1] === truth.leafEnd[ev.node], `tip range [${ev?.tipRange}] equals the full tree's [${truth.leafStart[ev?.node]}, ${truth.leafEnd[ev?.node]}) for node ${ev?.node}`);
await page.waitForTimeout(500);
const after = await info();
console.log(`  the click (events + label read of tips.parquet) cost ${after.requests - before.requests} requests, ${after.bytes - before.bytes} bytes`);
const r0 = truth.leafStart[ev.node];
const got = await page.evaluate(([a]) => window.__pq.source.tipLabels(a, a + 3), [r0]);
ok(JSON.stringify(got) === JSON.stringify(truth.tipLabels.slice(r0, r0 + 3)), `tip labels of the clade read from tips.parquet are the true ones (${got.join(', ')})`);

// ---------------------------------------------------------------- (4) zoom into a small stub: ensureClade loads its rows
const small = byTips.find((x) => x.tips >= 300 && x.tips <= 3000);
const cladeRows = truth.subtreeEnd[small.g] - small.g;
const b4 = await info();
await page.evaluate((g) => window.__pq.handle().renderer().zoomToNode(g, false), small.g);
await settle((g) => { const sn = window.__pq.source.snapshot(); const i = sn.toLocal(g); return i >= 0 && sn.stub[i] === 0; }, small.g);
const a4 = await info();
console.log(`zoom into stub ${small.g} (${small.tips} tips, ${cladeRows} rows): ${a4.requests - b4.requests} requests, ${a4.bytes - b4.bytes} bytes; snapshot ${b4.rows} -> ${a4.rows} rows; rebuild ${a4.snapshotMs.toFixed(1)} ms; frame cut ${a4.frame.cutMs.toFixed(1)} ms draw ${a4.frame.drawMs.toFixed(1)} ms, tips drawn ${a4.frame.tips}, labels ${a4.frame.labels}`);
ok(a4.loadedClades >= 1, `the clade was loaded (${a4.loadedClades} clades loaded in total: stubs next to it that became tall enough open too)`);
const rows2 = await page.evaluate(() => {
  const q = window.__pq, sn = q.source.snapshot(), L = q.handle().renderer().layout;
  return { gid: Array.from(sn.globalId), stub: Array.from(sn.stub), ls: Array.from(sn.leafStart), le: Array.from(sn.leafEnd), X: Array.from(L.X), XMAX: Array.from(L.XMAX), ROW: Array.from(L.ROW), parent: Array.from(sn.parent) };
});
compare(rows2, 'snapshot with the loaded clade');
const inClade = rows2.gid.map((g, k) => k).filter((k) => rows2.gid[k] >= small.g && rows2.gid[k] < truth.subtreeEnd[small.g]);
ok(inClade.length === cladeRows && inClade.every((k) => rows2.stub[k] === 0), 'every row of the clade is present and none is a stub');
ok(a4.frame.tips > 50, `tips of the opened clade are drawn (${a4.frame.tips})`);

// ---------------------------------------------------------------- (5) the biggest stub: next overview level instead of the clade
const big = byTips[byTips.length - 1];
const b5 = await info();
await page.evaluate((g) => window.__pq.handle().renderer().zoomToNode(g, false), big.g);
await settle(() => window.__pq.source.stats.overviewLevel >= 1);
await page.waitForTimeout(1500); // the cascade (next level, then clades) settles
const a5 = await info();
console.log(`zoom into the biggest stub ${big.g} (${big.tips} tips, ${truth.subtreeEnd[big.g] - big.g} rows): overview level ${b5.overviewLevel} -> ${a5.overviewLevel}, ${a5.requests - b5.requests} requests, ${a5.bytes - b5.bytes} bytes; snapshot ${b5.rows} -> ${a5.rows} rows (${a5.stubs} stubs), loaded clades ${a5.loadedClades}; frame cut ${a5.frame.cutMs.toFixed(1)} ms draw ${a5.frame.drawMs.toFixed(1)} ms, snapshot build ${a5.snapshotMs.toFixed(1)} ms`);
ok(a5.overviewLevel > b5.overviewLevel && a5.rows > b5.rows, 'a clade too big for nodes.parquet is opened through the next overview level');
const rows3 = await page.evaluate(() => {
  const q = window.__pq, sn = q.source.snapshot(), L = q.handle().renderer().layout;
  return { gid: Array.from(sn.globalId), stub: Array.from(sn.stub), ls: Array.from(sn.leafStart), le: Array.from(sn.leafEnd), X: Array.from(L.X), XMAX: Array.from(L.XMAX), ROW: Array.from(L.ROW), parent: Array.from(sn.parent) };
});
compare(rows3, 'snapshot after the level change');
await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', `parquet-${name}-zoomed.png`) });

// ---------------------------------------------------------------- (6) radial
await open('radial');
s = await info();
console.log(`radial first view: ${s.requests} requests, ${s.bytes} bytes, ${s.stubs} stubs, summaries drawn ${s.frame.summaries}, cut ${s.frame.cutMs.toFixed(1)} ms`);
ok(s.requests === 2 && s.frame.summaries > 100, 'radial: first view from the overview only, stubs drawn as fans');
await page.screenshot({ path: path.join(process.env.SHOTS || '/tmp', `parquet-${name}-radial.png`) });

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close();
console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
