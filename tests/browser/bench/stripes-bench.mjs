// Frame time of the summaries (background fill and stripes) at the fit view. Usage (test page served on 5306, see bench.mjs):
//   node bench/stripes-bench.mjs --tree <path.nwk[.gz]> [--minpx 3,12] [--frames 30]
// Prints, per layout and minCladePx, the mean draw time (the JS time of the draw calls; raster is not included) and frame time over two
// runs, the number of summaries drawn, and the stroke() and lineTo() calls per frame (counted on the context).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { chromiumPath } from '../scripts/chromium.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
let text = fs.readFileSync(args.tree);
if (args.tree.endsWith('.gz')) text = zlib.gunzipSync(text);
text = text.toString('utf8');
const minpxs = (args.minpx || '3,12').split(',').map(Number);
const frames = Number(args.frames || 30);
const port = args.port || 5306;
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-rasterization'],
});
for (const layout of ['rectangular', 'radial']) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__spike);
  await page.evaluate(
    ({ text, layout }) => window.__spike.mount({ treeId: 'bench', newick: text, layout, branchLengths: true, size: { width: 1100, height: 640 } }),
    { text, layout },
  );
  for (const minPx of minpxs) {
    const row = { layout, minCladePx: minPx };
    for (let run = 0; run < 2; run++) {
      const r = await page.evaluate(
        ({ minPx, frames }) => {
          const rd = window.__customTree.handle().renderer();
          rd.setOptions({ minCladePx: minPx });
          rd.fit(false);
          rd.renderNow();
          // count stroke() calls whose path is a stripe batch: wrap the context
          const ctx = rd.ctx;
          let strokes = 0,
            lines = 0;
          const origLine = ctx.lineTo;
          ctx.lineTo = function (...a) {
            lines++;
            return origLine.apply(this, a);
          };
          const orig = ctx.stroke;
          ctx.stroke = function (...a) {
            strokes++;
            return orig.apply(this, a);
          };
          rd.benchmark(5);
          strokes = 0;
          lines = 0;
          const b = rd.benchmark(frames);
          ctx.stroke = orig;
          ctx.lineTo = origLine;
          const s = rd.getStats();
          return { ...b, summaries: s.summaries, drawn: s.drawn, strokesPerFrame: strokes / frames, linesPerFrame: lines / frames };
        },
        { minPx, frames },
      );
      (row.runs ??= []).push(r);
    }
    const f = (a, k) => (a.reduce((s, x) => s + x[k], 0) / a.length).toFixed(2);
    console.log(
      JSON.stringify({
        layout,
        minCladePx: minPx,
        summaries: row.runs[0].summaries,
        drawn: row.runs[0].drawn,
        frameMs: f(row.runs, 'meanMs'),
        drawMs: f(row.runs, 'drawMs'),
        strokes: row.runs[0].strokesPerFrame,
        lineTo: row.runs[0].linesPerFrame,
      }),
    );
  }
  await page.close();
}
await browser.close();
