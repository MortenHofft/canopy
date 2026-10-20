// Before/after benchmark for the radial performance work (2026-10). Headless Chromium, no GPU (SwiftShader).
// Usage (one build served on a port, see docs/results/custom.md):
//   node bench/radial-perf.mjs --port 5306 --tag after --dsf 1 --cpu 1 --trees /path/to/newick-dir --sizes 1000,2000 --shapes yule --out out.json
//     --cpu 1: willReadFrequently forced on every 2D context (CPU-backed canvas); --cpu 0: forced off (accelerated canvas,
//     which here is GPU raster through SwiftShader, so absolute numbers are NOT representative of a real GPU)
//     --layouts rectangular,radial   --e2e 1 (measure forced-repaint rAF interval)   --cutoff <n|unlimited> (after build only)
// Per tree, layout and view (fit, 4x zoom) it records: JS ms per frame (cut + draw, mean of N forced frames), primitives, and
// hardware-independent canvas cost per frame (path segments, stroke/fill calls, text draws, state changes), plus an end-to-end
// number: mean rAF interval when every frame is repainted (includes raster back-pressure; JS time includes raster only for a
// CPU-backed canvas). One Chromium at a time.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../runner/package.json'));
const { chromium } = require('playwright-core');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const port = Number(args.port || 5306);
const dsf = Number(args.dsf || 1);
const cpu = String(args.cpu ?? '1') === '1';
const dir = args.trees;
const sizes = (args.sizes || '1000,2000,5000,10000,50000,100000').split(',');
const shapes = (args.shapes || 'yule,balanced,caterpillar').split(',');
const layouts = (args.layouts || 'rectangular,radial').split(',');
const frames = Number(args.frames || 15);
const e2e = String(args.e2e ?? '1') === '1';
const cutoff = args.cutoff || null; // after build: radial cut-off to set through the renderer options (default = build default)
const tag = args.tag || 'run';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox', '--enable-precise-memory-info', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', '--disable-gpu-rasterization', '--disable-frame-rate-limit'],
});
const out = { tag, dsf, cpu, port, cutoff, date: new Date().toISOString(), rows: [] };

const INIT = `
(() => {
  const CPU = ${cpu};
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, a) { if (t === '2d') a = { ...(a || {}), willReadFrequently: CPU }; return orig.call(this, t, a); };
  // call counters for the hardware-independent cost measure (installed only for the counting pass)
  const P = CanvasRenderingContext2D.prototype;
  const calls = ['moveTo', 'lineTo', 'arc', 'arcTo', 'rect', 'closePath', 'beginPath', 'stroke', 'fill', 'fillText', 'fillRect', 'strokeRect', 'clearRect', 'save', 'restore', 'setTransform', 'rotate', 'translate', 'clip', 'measureText', 'drawImage'];
  const props = ['fillStyle', 'strokeStyle', 'font', 'lineWidth', 'globalAlpha', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin'];
  const saved = {};
  let cnt = {};
  window.__cnt = {
    install() {
      for (const k of calls) { saved[k] = P[k]; P[k] = function (...a) { cnt[k] = (cnt[k] || 0) + 1; return saved[k].apply(this, a); }; }
      for (const k of props) {
        const d = Object.getOwnPropertyDescriptor(P, k); saved['p_' + k] = d;
        Object.defineProperty(P, k, { configurable: true, get() { return d.get.call(this); }, set(v) { cnt['set_' + k] = (cnt['set_' + k] || 0) + 1; d.set.call(this, v); } });
      }
    },
    uninstall() { for (const k of calls) P[k] = saved[k]; for (const k of props) Object.defineProperty(P, k, saved['p_' + k]); },
    reset() { cnt = {}; },
    read() { return { ...cnt }; },
  };
})();`;

const files = [];
for (const shape of shapes) for (const size of sizes) files.push({ shape, size, file: path.join(dir, 'newick', `${shape}_${size}.nwk`) });

for (const f of files) {
  if (!fs.existsSync(f.file)) { console.log('missing', f.file); continue; }
  const text = fs.readFileSync(f.file, 'utf8');
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: dsf });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__spike);
  for (const layout of layouts) {
    const res = await page.evaluate(
      async ({ text, layout }) => {
        const t0 = performance.now();
        const r = await window.__spike.mount({ treeId: 'syn-yule-1000', newick: text, layout, branchLengths: true, size: { width: 1100, height: 640 } });
        return { tips: r.tips, firstRenderMs: r.firstRenderMs, wallMs: performance.now() - t0 };
      },
      { text, layout },
    );
    for (const view of ['fit', 'z4']) {
      const m = await page.evaluate(
        async ({ view, frames, e2e, cutoff, layout }) => {
          const h = window.__customTree.handle();
          const rd = h.renderer();
          if (cutoff && rd.setOptions && 'radialMaxNodes' in rd.options) rd.setOptions({ radialMaxNodes: cutoff === 'unlimited' ? Infinity : Number(cutoff) });
          rd.fit(false);
          const f = rd.getViewport();
          if (view === 'z4') {
            if (layout === 'radial') { const w = (f.x1 - f.x0) / 4, hh = (f.y1 - f.y0) / 4; rd.setViewport({ x0: 0.75 - w / 2, x1: 0.75 + w / 2, y0: -hh / 2, y1: hh / 2 }); }
            else { const N = f.y1; rd.setViewport({ x0: 0.7, x1: 0.95, y0: N * 0.375, y1: N * 0.625 }); }
          }
          rd.renderNow();
          rd.benchmark(3); // warm up (JIT, font cache)
          const b = rd.benchmark(frames);
          const s = rd.getStats();
          // counting pass
          window.__cnt.install(); window.__cnt.reset();
          rd.benchmark(3);
          const c = window.__cnt.read(); window.__cnt.uninstall();
          for (const k in c) c[k] = +(c[k] / 3).toFixed(1);
          // end-to-end: repaint every rAF with a 1 px alternating pan (so contents change), mean interval
          let e = null;
          if (e2e) {
            e = await new Promise((resolve) => {
              const iv = [], js = [];
              let last = 0, n = 0;
              const v0 = rd.getViewport();
              const dx = (v0.x1 - v0.x0) / 1100;
              const loop = (t) => {
                if (last) iv.push(t - last);
                last = t;
                const t0 = performance.now();
                const v = rd.getViewport();
                rd.setViewport({ x0: v0.x0 + (n % 2) * dx, x1: v0.x1 + (n % 2) * dx, y0: v0.y0, y1: v0.y1 });
                rd.renderNow(true);
                js.push(performance.now() - t0);
                n++;
                if (n < 50 && t < (iv.length ? 0 : 1e12) + 1e12) requestAnimationFrame(loop);
                else {
                  const a = iv.slice(8), j = js.slice(8);
                  const mean = (x) => x.reduce((p, q) => p + q, 0) / Math.max(1, x.length);
                  const srt = a.slice().sort((p, q) => p - q);
                  resolve({ intervalMs: mean(a), p95IntervalMs: srt[Math.floor(srt.length * 0.95)], jsMs: mean(j) });
                }
              };
              requestAnimationFrame(loop);
            });
          }
          rd.setViewport(f);
          return { frameMs: b.meanMs, cutMs: b.cutMs, drawMs: b.drawMs, maxMs: b.maxMs, drawn: s.drawn, summaries: s.summaries, tipsDrawn: s.tips, labels: s.labels, visited: s.visited, minPxUsed: s.minPxUsed, retries: s.budgetRetries, truncated: s.truncated, calls: c, e2e: e, kx: s.kx };
        },
        { view, frames, e2e, cutoff, layout },
      );
      const row = { tag, shape: f.shape, size: Number(f.size), layout, view, dsf, cpu, tips: res.tips, firstRenderMs: res.firstRenderMs, ...m };
      out.rows.push(row);
      const segs = ['moveTo', 'lineTo', 'arc', 'rect'].reduce((p, k) => p + (m.calls[k] || 0), 0);
      console.log(`${tag} dsf${dsf} cpu${+cpu} ${f.shape}-${f.size} ${layout} ${view}: drawn ${m.drawn} (sum ${m.summaries}) js ${m.frameMs.toFixed(1)} (cut ${m.cutMs.toFixed(1)} draw ${m.drawMs.toFixed(1)}) segs ${segs} strokes ${m.calls.stroke || 0} fills ${m.calls.fill || 0} text ${m.calls.fillText || 0} e2e ${m.e2e ? m.e2e.intervalMs.toFixed(1) : '-'} minPx ${m.minPxUsed.toFixed(1)}`);
    }
  }
  await ctx.close();
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(out, null, 1));
}
await browser.close();
if (args.out) fs.writeFileSync(args.out, JSON.stringify(out, null, 1));
