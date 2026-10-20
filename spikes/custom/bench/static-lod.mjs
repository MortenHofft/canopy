// Per-frame JS time (cut + draw) of the cut methods, alternating, in headless Chromium (CPU raster, no GPU).
// Usage (production build served on --port, default 5306; --base-port serves a build of the base commit for the default-path check):
//   node bench/static-lod.mjs --tree otl-2m [--methods current,static-global,static-tiles] [--rounds 5] [--frames 20] [--port 5306] [--base-port 5307]
// The tree is loaded through the demo shell (?tree=<id>&layout=radial); the large OTL trees are served from the main checkout's
// git-ignored data/real-ladder/fetched through a request route. For each round and method it sets the cut method on the live
// renderer, jumps to three views (fit, 8x and 64x on a point of the rim) and times `benchmark(frames)` after one warm-up frame
// (the first frame of a static method pays for the level tables; that is reported separately as "first"). Base build (no
// cutMethod option): only the default cut is measured, alternating with the new build to show the default path did not change.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../runner/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const treeId = args.tree || 'otl-91k';
const methods = (args.methods || 'current,static-global,static-tiles').split(',');
const rounds = Number(args.rounds || 5), frames = Number(args.frames || 20);
const port = args.port || 5306, basePort = args['base-port'] || '';
const budget = args.budget || '2000';
const fetched = '/home/user/gbif-phylo/data/real-ladder/fetched/';
const big = { 'otl-2m': ['otl-2m-full', fetched + 'otl-2m-full.nwk.gz'], 'otl-1m': ['otl-1m-metazoa', fetched + 'otl-1m-metazoa.nwk.gz'] };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] });

async function open(p) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => {
    const hit = Object.values(big).find(([k]) => r.request().url().includes(k));
    return hit ? r.fulfill({ status: 200, contentType: 'application/gzip', body: fs.readFileSync(hit[1]) }) : r.abort();
  });
  await page.goto(`http://127.0.0.1:${p}/?embed=1&tree=${treeId}&layout=radial&f.budget=${budget}&f.radialMax=${budget}&f.frameReadout=false`);
  await page.waitForFunction(() => window.__customTree && document.querySelector('[data-testid=tree-container] canvas'), null, { timeout: 240000 });
  await page.waitForTimeout(2000);
  return page;
}
const views = [['fit', 1], ['8x', 8], ['64x', 64]];
async function measure(page, method, z) {
  return page.evaluate(({ method, z, frames }) => {
    const rd = window.__customTree.handle().renderer();
    if (method) rd.setOptions({ cutMethod: method });
    rd.fit(false);
    const f = rd.getViewport();
    if (z > 1) {
      const a = (200 * Math.PI) / 180, px = 0.9 * Math.cos(a), py = 0.9 * Math.sin(a), w = (f.x1 - f.x0) / z, h = (f.y1 - f.y0) / z;
      window.__customTree.handle().setViewport({ x0: px - w / 2, x1: px + w / 2, y0: py - h / 2, y1: py + h / 2 });
    }
    const t0 = performance.now();
    rd.renderNow();
    const first = performance.now() - t0;
    const b = rd.benchmark(frames);
    const s = rd.getStats();
    return { first, mean: b.meanMs, cut: b.cutMs, draw: b.drawMs, drawn: s.drawn, minPx: s.minPxUsed, cutInfo: s.cutInfo ?? '' };
  }, { method, z, frames });
}
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const pages = [{ name: 'new', page: await open(port), methods }];
if (basePort) pages.push({ name: 'base', page: await open(basePort), methods: ['current'] });
const rec = {};
for (let r = 0; r < rounds; r++) {
  const order = r % 2 ? pages.slice().reverse() : pages;
  for (const pg of order) {
    for (const m of pg.methods) {
      for (const [vn, z] of views) {
        const res = await measure(pg.page, pg.name === 'base' ? null : m, z);
        const key = `${pg.name === 'base' ? 'base' : 'new'}/${m}/${vn}`;
        (rec[key] ??= []).push(res);
      }
    }
  }
}
console.log(`tree ${treeId}, budget ${budget}, ${rounds} rounds, ${frames} frames per measurement (median over rounds of the mean per-frame JS ms; cut = cut part only)`);
for (const key of Object.keys(rec)) {
  const v = rec[key];
  console.log(`${key.padEnd(28)} frame ${med(v.map((x) => x.mean)).toFixed(2).padStart(7)} ms (cut ${med(v.map((x) => x.cut)).toFixed(2)}, draw ${med(v.map((x) => x.draw)).toFixed(2)}), first frame ${med(v.map((x) => x.first)).toFixed(1)} ms, drawn ${v[0].drawn}, min clade ${v[0].minPx.toFixed(1)} px  ${v[0].cutInfo}`);
}
await browser.close();
