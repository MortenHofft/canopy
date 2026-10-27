// Browser check of the Parquet page (examples/parquet): a tree and its sidecar read with HTTP range requests. It makes a small dataset,
// serves it from another origin (CORS and Range, as a CDN would), opens the page on it and checks, in order: the first view is the manifest
// and one range of the overview (a fraction of the data), "Colour by" colours tips, clades and stubs the way the data says, zooming opens a
// clade by a range request and the colours follow it, and a click on a tip reads its row and its sequence. No page errors.
//   node tests/browser/scripts/check-parquet.mjs [--url http://127.0.0.1:5309/]   (dev server: npm run dev in examples/parquet)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromiumPath } from './chromium.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const parquet = path.resolve(here, '../../../examples/parquet/scripts');
const { generate } = await import(pathToFileURL(path.join(parquet, 'generate.mjs')).href);
const { startServer } = await import(pathToFileURL(path.join(parquet, 'serve.mjs')).href);

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const url = args.url || 'http://127.0.0.1:5309/';
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbif-phylo-parquet-check-'));
const TIPS = 20000;
await generate({
  tips: TIPS,
  seed: 5,
  seqLength: 200,
  rg: 4096,
  tipRg: 4096,
  labelRg: 1024,
  seqRg: 256,
  firstBudget: 512,
  out: path.join(tmp, 'ds'),
});
const data = await startServer({ roots: [tmp] });
const dataBytes = fs.readdirSync(path.join(tmp, 'ds')).reduce((a, f) => a + fs.statSync(path.join(tmp, 'ds', f)).size, 0);

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  failures++;
});
const ev = (fn, arg) => page.evaluate(fn, arg);

try {
  await page.goto(`${url}${url.includes('?') ? '&' : '?'}url=${data.url}/ds&cpu=1`);
  await page.waitForFunction(() => window.__parquet?.viewer.getStats().frames > 0, null, { timeout: 60000 });
  await sleep(300);

  // ---- first view
  const first = await ev(() => {
    const { ds, source } = window.__parquet;
    const st = source.stats;
    return { requests: ds.stats.requests, bytes: ds.stats.bytes, rows: st.rows, stubs: st.stubs, tips: ds.man.tips };
  });
  ok(first.requests === 2, `the first view is the manifest and one range of the overview (${first.requests} requests)`);
  ok(first.bytes < dataBytes * 0.1, `and a small part of the data (${first.bytes} of ${dataBytes} bytes)`);
  ok(
    first.stubs > 0 && first.rows < 1000 && first.tips === TIPS,
    `the tree is drawn from ${first.rows} rows of which ${first.stubs} are stubs, for ${first.tips} tips`,
  );
  const log0 = data.log();
  ok(
    log0.every((r) => r.method !== 'OPTIONS'),
    'no CORS preflight: the range requests are simple requests',
  );
  ok(
    log0.filter((r) => r.url.endsWith('.parquet')).every((r) => r.status === 206),
    'every Parquet request got a 206 range response',
  );

  // ---- colour by a sidecar column, checked against the data
  await page.locator('#colour-by').selectOption('country');
  await page.waitForFunction(() => !document.getElementById('legend-slot').hidden && window.__parquet.viewer.getClades().length > 0);
  await sleep(300);
  const legend = await ev(() => [...document.querySelectorAll('#legend-slot li')].map((e) => e.textContent));
  ok(
    legend.length >= 2 && legend.length <= 9,
    `the page's legend lists the most frequent countries and 'Other' (${legend.length} entries: ${legend.slice(0, 3)}...)`,
  );
  const consistent = () =>
    ev(() => {
      const { viewer, source, colouring } = window.__parquet;
      const c = colouring();
      const s = source.snapshot();
      let bad = 0;
      let tipsEntries = 0;
      let uniform = 0;
      let stubsOk = 0;
      for (const e of viewer.getClades()) {
        const row = s.toLocal(e.node);
        if (row < 0) {
          bad++;
          continue;
        }
        const a = s.leafStart[row];
        const b = s.leafEnd[row];
        const k = c.colours.indexOf(e.colour);
        if (s.stub[row]) {
          // a stub takes the class most of its tips have
          const h = new Map();
          for (let r = a; r < b; r++) h.set(c.cls[r], (h.get(c.cls[r]) ?? 0) + 1);
          let best = -1;
          let n = 0;
          for (const [cl, m] of h) if (cl >= 0 && m > n) [best, n] = [cl, m];
          if (best === k) stubsOk++;
          else bad++;
        } else {
          // a tip, or a clade of loaded rows: every tip below has this class
          if (c.runEnd[a] < b || c.cls[a] !== k) bad++;
          else if (b - a === 1) tipsEntries++;
          else uniform++;
        }
      }
      return { bad, tipsEntries, uniform, stubsOk, total: viewer.getClades().length };
    });
  const c1 = await consistent();
  ok(
    c1.bad === 0 && c1.stubsOk > 0,
    `every clade colour agrees with the column (${c1.stubsOk} stubs, ${c1.uniform} uniform clades, ${c1.tipsEntries} tips, ${c1.bad} wrong)`,
  );
  const swatchOk = await ev(() => [...document.querySelectorAll('#legend-slot .swatch')].every((s) => s.style.background !== ''));
  ok(swatchOk, 'the legend swatches have colours');

  // ---- zoom into the biggest stub: the viewer opens it with a range request, the colours follow
  const before = await ev(() => {
    const { source, viewer, ds } = window.__parquet;
    const s = source.snapshot();
    let best = -1;
    let size = 0;
    for (let i = 0; i < s.nodeCount; i++) if (s.stub[i] && s.leafEnd[i] - s.leafStart[i] > size) [best, size] = [i, s.leafEnd[i] - s.leafStart[i]];
    const g = s.globalId[best];
    viewer.zoomToNode(g, false);
    return { node: g, size, rows: s.nodeCount, requests: ds.stats.requests };
  });
  await page.waitForFunction(() => window.__parquet.source.stats.loadedClades >= 1, null, { timeout: 30000 });
  await sleep(600);
  const after = await ev((n) => {
    const { source, ds } = window.__parquet;
    const s = source.snapshot();
    const row = s.toLocal(n);
    return { rows: s.nodeCount, requests: ds.stats.requests, isRow: row >= 0 && s.stub[row] === 0, loaded: source.stats.loadedClades };
  }, before.node);
  ok(after.isRow && after.rows > before.rows, `zooming into a stub of ${before.size} tips opened it: ${before.rows} rows became ${after.rows}`);
  ok(
    after.requests > before.requests && after.requests - before.requests <= 3,
    `by ${after.requests - before.requests} requests (a footer and a range)`,
  );
  const c2 = await consistent();
  ok(
    c2.bad === 0 && c2.total > 0,
    `the colours follow the new rows (${c2.stubsOk} stubs, ${c2.uniform} uniform clades, ${c2.tipsEntries} tips, ${c2.bad} wrong)`,
  );

  // ---- click a tip: its sidecar row and its sequence
  const spot = await ev(() => {
    const { source, viewer } = window.__parquet;
    const s = source.snapshot();
    for (let i = 0; i < s.nodeCount; i++) {
      if (s.stub[i] || s.childCount[i] !== 0) continue;
      const p = viewer.nodePosition(s.globalId[i]);
      if (p) {
        const r = viewer.element.getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y, rank: s.tipRank[i] };
      }
    }
    return null;
  });
  ok(!!spot, 'a loaded tip is in view');
  if (spot) {
    await page.mouse.click(spot.x, spot.y);
    await page.waitForFunction(() => !document.getElementById('inspect').hidden, null, { timeout: 15000 });
    const txt = await page.locator('#inspect').textContent();
    ok(/country/.test(txt) && /year/.test(txt), `the tip's row of the sidecar is shown`);
    ok(/200 bases: [ACGT]{200}/.test(txt), 'and its sequence of 200 bases');
    const truth = await ev(async (r) => (await window.__parquet.ds.sequence(r)).length, spot.rank);
    ok(truth === 200, 'which is the tip that was clicked (the same rank reads a 200-base sequence)');
  }
  const end = await ev(() => ({ requests: window.__parquet.ds.stats.requests, bytes: window.__parquet.ds.stats.bytes }));
  ok(end.bytes < dataBytes * 0.5, `all of it read ${end.bytes} of ${dataBytes} bytes in ${end.requests} requests`);
} finally {
  await browser.close();
  await data.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
