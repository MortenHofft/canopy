// Screenshots and draw timings of the unrooted layout spike page (tests/browser/unrooted.html, #42) in headless Chromium (no GPU, CPU
// canvas). Results in docs/design/unrooted.md.
//   cd tests/browser && npx vite --port 5306 --strictPort      (the page is served by the dev server only)
//   node bench/unrooted-shots.mjs [--url http://127.0.0.1:5306] [--out <dir>] [--runs 20]
// For each tree: open the page, wait for window.__unrooted, time `runs` redraws (median, pixels flushed), and with --out save a PNG of
// the canvas as <out>/unrooted-<name>.png.
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromiumPath } from '../scripts/chromium.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const argv = process.argv.slice(2);
const opt = (name, d) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : d);
const url = opt('url', 'http://127.0.0.1:5306');
const out = opt('out', null);
const runs = Number(opt('runs', 20));

// [file under data/, screenshot name or null (timing only), page size]
const TREES = [
  ['rich/hcv-2k-iqtree-alignment/2k1b_2k_ext_IQTree_midpoint.tre', 'hcv-19', 560],
  ['real-ladder/trees/otl-0200-canidae.nwk.gz', 'otl-0200-canidae', 760],
  ['real-ladder/trees/otl-1k-testudines.nwk.gz', 'otl-1k-testudines', 760],
  ['real-ladder/trees/gtdb-1k-nitrososphaeria.nwk.gz', 'gtdb-1k-nitrososphaeria', 760],
  ['real-ladder/trees/otl-10k-amphibia.nwk.gz', null, 760],
  ['real-ladder/trees/gtdb-10k-archaea.nwk.gz', null, 760],
  ['real-ladder/trees/gtdb-100k-bacteria-random.nwk.gz', null, 760],
];

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-rasterization'],
});
try {
  for (const [file, name, size] of TREES) {
    const page = await browser.newPage({ viewport: { width: size, height: size + 40 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('PAGEERR', e.message));
    await page.goto(`${url}/unrooted.html?tree=${encodeURIComponent(file)}&size=${size}`);
    await page.waitForFunction(() => window.__unrooted, null, { timeout: 120000 });
    const r = await page.evaluate((n) => {
      const a = window.__unrooted;
      return { tips: a.tips, nodes: a.nodes, usedLengths: a.usedLengths, layoutMs: a.layoutMs, drawMs: a.redraw(n) };
    }, runs);
    console.log(
      `${path.basename(file)}: ${r.tips} tips, ${r.nodes} nodes, ${r.usedLengths ? 'lengths' : 'unit'}, layout ${r.layoutMs.toFixed(1)} ms, draw median ${r.drawMs.toFixed(1)} ms (${runs} runs)`,
    );
    if (out && name) await page.locator('canvas').screenshot({ path: path.join(out, `unrooted-${name}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}
