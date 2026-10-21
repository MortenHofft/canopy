// Benchmark of the custom renderer in headless Chromium (no GPU, CPU raster, same flags as the runner).
// Usage (production build served on 5306):
//   cd spikes/custom && npm run build && npm run preview -- --port 5306 --strictPort &
//   node bench/bench.mjs --tree <path.nwk[.gz]> --label yule-100000 --layouts rectangular,radial [--out file.json]
// For each layout it mounts the tree through window.__spike.mount (parse by the shared parser, layout, first render),
// then forces n synchronous frames at three views (fit, 3% window, 0.03% window) and reports the JS time per frame
// (cut + draw; raster/compositing happen after and are not included), plus the draw-list statistics. Optionally a
// 6 s scripted wheel/drag run reports rAF frame rates. One Chromium at a time.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../runner/package.json'));
const { chromium } = require('playwright-core');

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []),
);
const file = args.tree;
const label = args.label || path.basename(file);
const layouts = (args.layouts || 'rectangular,radial').split(',');
const port = args.port || 5306;
const frames = Number(args.frames || 20);
const pan = !!args.pan;
let text = fs.readFileSync(file);
if (file.endsWith('.gz')) text = zlib.gunzipSync(text);
text = text.toString('utf8');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-precise-memory-info',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--js-flags=--expose-gc',
    '--disable-gpu-rasterization',
  ],
});
const out = { label, tips: null, machine: { cpus: 4 }, runs: [] };
for (const layout of layouts) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__spike);
  const res = await page.evaluate(
    async ({ text, layout, treeId }) => {
      const t0 = performance.now();
      const r = await window.__spike.mount({ treeId, newick: text, layout, branchLengths: true, size: { width: 1100, height: 640 } });
      return { mount: r, wallMs: performance.now() - t0 };
    },
    { text, layout, treeId: args.treeid || 'otl-91k' },
  );
  out.tips = res.mount.tips;
  const run = {
    layout,
    parseMs: res.mount.parseMs,
    sharedParseMs: res.mount.sharedParseMs,
    firstRenderMs: res.mount.firstRenderMs,
    wallMs: res.wallMs,
    views: {},
  };
  const measure = (_name, vpScript) =>
    page.evaluate(
      async ({ frames, vpScript }) => {
        const h = window.__customTree.handle();
        const rd = h.renderer();
        const v0 = rd.getViewport();
        const v = new Function('v0', 'rd', vpScript)(v0, rd);
        if (v) h.setViewport(v);
        rd.renderNow();
        const b = rd.benchmark(Number(frames));
        const s = rd.getStats();
        // hit-test build + query cost on the current frame
        rd.hit.invalidate();
        const t0 = performance.now();
        rd.hitTest(300, 300);
        const hitMs = performance.now() - t0;
        return {
          ...b,
          drawn: s.drawn,
          summaries: s.summaries,
          tips: s.tips,
          labels: s.labels,
          visited: s.visited,
          minPxUsed: s.minPxUsed,
          retries: s.budgetRetries,
          budgetHit: s.budgetHit,
          truncated: s.truncated,
          hitFirstQueryMs: hitMs,
          layoutMs: s.layoutMs,
          ky: s.ky,
          kx: s.kx,
        };
      },
      { frames, vpScript },
    );
  run.views.fit = await measure('fit', 'rd.fit(false); return null;');
  run.layoutMs = run.views.fit.layoutMs;
  // zoomed windows around the middle of the tree (rows for rectangular, a disc patch for radial)
  run.views.window3pct = await measure(
    'w3',
    'rd.fit(false); const f = rd.getViewport(); const cx=(f.x0+f.x1)/2, cy=(f.y0+f.y1)/2; const w=(f.x1-f.x0), h=(f.y1-f.y0); return rd.options.layout==="rectangular" ? {x0:0.2, x1:0.5, y0:h*0.4, y1:h*0.4+h*0.03} : {x0: 0.1, x1: 0.1+0.06, y0: -0.05, y1: -0.05+0.06};',
  );
  run.views.window003pct = await measure(
    'w003',
    'rd.fit(false); const f = rd.getViewport(); const h=(f.y1-f.y0); return rd.options.layout==="rectangular" ? {x0:0.6, x1:0.8, y0:h*0.4, y1:h*0.4+h*0.0003} : {x0: 0.3, x1: 0.3+0.0006, y0: 0.1, y1: 0.1+0.0006};',
  );
  await page.evaluate(() => window.__customTree.handle().renderer().fit(false));
  if (pan) {
    // real input for 6 s: wheel zoom in/out and drag, rAF frame intervals
    await page.evaluate(() => {
      window.__iv = [];
      let last = performance.now();
      const f = (t) => {
        window.__iv.push(t - last);
        last = t;
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
    const box = await page.locator('[data-testid=tree-container]').boundingBox();
    const cx = box.x + box.width * 0.4,
      cy = box.y + box.height * 0.5;
    const t0 = Date.now();
    let k = 0;
    while (Date.now() - t0 < 6000) {
      await page.mouse.move(cx + (k % 3) * 40, cy + (k % 5) * 20);
      if (k % 4 === 0 || k % 4 === 2)
        for (let i = 0; i < 6; i++) {
          await page.mouse.wheel(0, k % 4 === 0 ? -120 : 120);
          await new Promise((r) => setTimeout(r, 16));
        }
      else {
        const s = k % 4 === 1 ? -1 : 1;
        await page.mouse.down();
        await page.mouse.move(cx + s * 160, cy + s * 70, { steps: 10 });
        await page.mouse.up();
      }
      k++;
    }
    const iv = await page.evaluate(() => window.__iv);
    const sorted = iv.slice().sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    let tot = 0,
      acc = 0;
    for (const x of iv) tot += x;
    const desc = iv.slice().sort((a, b) => b - a);
    for (const x of desc) {
      acc += x;
      if (acc >= 0.05 * tot) {
        run.p5Fps = 1000 / x;
        break;
      }
    }
    run.pan = {
      frames: iv.length,
      medianFps: 1000 / med,
      p5Fps: run.p5Fps,
      maxGapMs: desc[0],
      customStats: await page.evaluate(() => window.__customTree.stats()),
    };
  }
  run.heapMB = await page.evaluate(() => {
    try {
      globalThis.gc();
    } catch {
      /* gc is only exposed with --expose-gc */
    }
    return performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
  });
  out.runs.push(run);
  console.log(
    JSON.stringify({
      label,
      layout,
      firstRenderMs: run.firstRenderMs,
      sharedParseMs: run.sharedParseMs,
      layoutMs: run.layoutMs,
      fit: run.views.fit,
      w3: run.views.window3pct,
      w003: run.views.window003pct,
      pan: run.pan && { med: run.pan.medianFps, p5: run.pan.p5Fps, gap: run.pan.maxGapMs },
      heapMB: run.heapMB,
    }),
  );
  await page.close();
}
await browser.close();
if (args.out) fs.writeFileSync(args.out, JSON.stringify(out, null, 1));
