// The cost of highlighting many tips (#58): setHighlighted with 10k, 100k and 1M matches, then the next frame, then steady frames.
//   node bench/highlight-bench.mjs --tree <path.nwk[.gz]> [--port 5306] [--counts 10000,100000,1000000] [--frames 5]
// Needs the test page served (see bench.mjs). The tree file is handed to the page through a routed URL, not as an evaluate argument,
// so a tree of millions of tips loads. The matches are spread evenly over the tips (every k-th rank), passed as node ids (what the
// explorer passes) and as labels (what the playground passes). Per layout and highlight style it prints:
//   set   the JS time of the setHighlighted call (resolving ids or labels to ranks, sorting, the per-tip flags);
//   next  the JS time of the next frame (renderNow; with dimming this builds the O(tips) prefix);
//   fit / zoomed  the mean JS time of a frame redrawn with the highlights unchanged, at the fit view and zoomed in on the middle tip
//                 (focusTip: rows far enough apart for labels).
// It also times the label scans behind a search: Search's full count (indexOf over the lowercased labels) and one regular
// expression over the labels (the explorer's), for a common, a rare and a missing query.
// Headless Chromium without a GPU: the canvas is rasterised in software and the time measured is the JS time of the calls, not the
// raster, so the numbers compare highlight counts with each other and with no highlights; they are not frame rates.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromiumPath } from '../scripts/chromium.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const port = args.port || 5306;
const counts = (args.counts || '10000,100000,1000000').split(',').map(Number);
const frames = Number(args.frames || 5);
const body = fs.readFileSync(args.tree);
const gz = args.tree.endsWith('.gz');
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-rasterization'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await page.route('**/__bench-tree', (r) => r.fulfill({ body, contentType: 'application/octet-stream' }));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__spike);
const load = await page.evaluate(async (gz) => {
  const res = await fetch('./__bench-tree');
  const text = await (gz ? new Response(res.body.pipeThrough(new DecompressionStream('gzip'))) : res).text();
  const t0 = performance.now();
  const r = await window.__spike.mount({ treeId: 'bench', newick: text, layout: 'rectangular', size: { width: 1100, height: 640 } });
  return { tips: r.tips, mountMs: Math.round(performance.now() - t0) };
}, gz);
console.log(`tree ${args.tree}: ${load.tips.toLocaleString('en')} tips, mounted in ${load.mountMs} ms`);

const scans = await page.evaluate(() => {
  const labels = window.__customTree.handle().renderer().getTree().tipLabels;
  const t0 = performance.now();
  const lower = labels.map((l) => (l === undefined ? '' : l.replace(/_/g, ' ').toLowerCase()));
  const lowerMs = performance.now() - t0;
  const out = [];
  for (const q of ['a', 'pseudo', 'zzzq']) {
    let best = Infinity,
      bestRe = Infinity,
      total = 0,
      reTotal = 0;
    const re = new RegExp(q, 'i');
    for (let rep = 0; rep < 3; rep++) {
      let s = performance.now();
      total = 0;
      for (let r = 0; r < lower.length; r++) if (lower[r].indexOf(q) >= 0) total++;
      best = Math.min(best, performance.now() - s);
      s = performance.now();
      reTotal = 0;
      for (let r = 0; r < labels.length; r++) if (re.test(labels[r])) reTotal++;
      bestRe = Math.min(bestRe, performance.now() - s);
    }
    out.push({ q, total, reTotal, indexOfMs: +best.toFixed(1), regexMs: +bestRe.toFixed(1) });
  }
  return { lowerMs: +lowerMs.toFixed(1), out };
});
console.log(`lowercasing the labels once: ${scans.lowerMs} ms`);
for (const s of scans.out)
  console.log(
    `scan '${s.q}': ${s.total.toLocaleString('en')} matches, indexOf ${s.indexOfMs} ms; regex ${s.regexMs} ms (${s.reTotal.toLocaleString('en')} on the raw labels)`,
  );

const rows = [];
for (const layout of ['rectangular', 'radial']) {
  for (const style of ['band', 'dim']) {
    for (const kind of ['ids', 'labels']) {
      for (const n of [0, ...counts]) {
        const r = await page.evaluate(
          ({ layout, style, kind, n, frames }) => {
            const v = window.__customTree.handle().renderer();
            v.setOptions({ layout, highlightStyle: style });
            v.setHighlighted([]);
            v.fit(false);
            v.renderNow();
            const t = v.getTree();
            const N = t.tipCount;
            const m = Math.min(n, N);
            const ids = new Array(m);
            for (let k = 0; k < m; k++) {
              const rank = Math.floor((k * N) / m);
              ids[k] = kind === 'ids' ? t.tipNode[rank] : t.tipLabels[rank];
            }
            v.benchmark(3);
            let s = performance.now();
            v.setHighlighted(ids);
            const set = performance.now() - s;
            s = performance.now();
            v.renderNow();
            const next = performance.now() - s;
            const fit = v.benchmark(frames).meanMs;
            v.focusTip(Math.floor(N / 2), false);
            v.renderNow();
            const zoomed = v.benchmark(frames).meanMs;
            return { set, next, fit, zoomed, hl: v.getHighlighted().length };
          },
          { layout, style, kind, n, frames },
        );
        const f = (x) => x.toFixed(1);
        rows.push({ layout, style, kind, n, ...r });
        console.log(
          `${layout.padEnd(11)} ${style.padEnd(4)} ${kind.padEnd(6)} ${String(n).padStart(8)}  set ${f(r.set).padStart(7)}  next ${f(r.next).padStart(7)}  fit ${f(r.fit).padStart(6)}  zoomed ${f(r.zoomed).padStart(6)} ms`,
        );
      }
    }
  }
}
if (args.out) fs.writeFileSync(args.out, JSON.stringify({ tree: args.tree, ...load, scans, rows }, null, 1));
await browser.close();
