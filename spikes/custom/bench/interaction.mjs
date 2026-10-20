// Frame cost during a wheel/drag gesture, before/after the interaction-time degradation (2026-10).
//   node bench/interaction.mjs --port 5306 --tag after --tree file.nwk --layout radial --dsf 1 --cpu 1
// Drives real wheel events (24 steps, 16 ms apart) and drag moves; records every frame through onFrame-equivalent polling of
// getStats().frames (JS ms, primitives, reduced flag) and the rAF intervals; then waits for the refine frame.
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../runner/package.json'));
const { chromium } = require('playwright-core');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const port = Number(args.port || 5306), dsf = Number(args.dsf || 1), cpu = String(args.cpu ?? '1') === '1', layout = args.layout || 'radial';
const text = fs.readFileSync(args.tree, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-rasterization'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: dsf });
await ctx.addInitScript(`(() => { const o = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, a) { if (t === '2d') a = { ...(a || {}), willReadFrequently: ${cpu} }; return o.call(this, t, a); }; })();`);
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__spike);
await page.evaluate(async ({ text, layout }) => { await window.__spike.mount({ treeId: 'syn-yule-1000', newick: text, layout, branchLengths: true, size: { width: 1100, height: 640 } }); }, { text, layout });
const box = await page.evaluate(() => { const r = window.__customTree.handle().renderer().root.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
// record frames: wrap render through getStats polling at rAF
await page.evaluate(() => {
  window.__rec = []; const rd = window.__customTree.handle().renderer(); let lastF = rd.getStats().frames, last = performance.now();
  const loop = (t) => { const s = rd.getStats(); if (s.frames !== lastF) { window.__rec.push({ n: s.frames - lastF, js: s.frameMs, drawn: s.drawn, reduced: s.reduced, dt: t - last }); lastF = s.frames; } last = t; if (window.__recOn) requestAnimationFrame(loop); };
  window.__recOn = true; requestAnimationFrame(loop);
});
const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.5;
const run = async (name, fn) => {
  await page.evaluate(() => { window.__rec.length = 0; });
  const t0 = Date.now(); await fn(); const gest = Date.now() - t0;
  const rec = await page.evaluate(() => window.__rec.slice());
  await sleep(500);
  const fin = await page.evaluate(() => { const s = window.__customTree.stats(); return { reduced: s.reduced, drawn: s.drawn, js: s.frameMs }; });
  const dur = rec.filter((r) => r.dt > 0);
  const mean = (a) => a.reduce((p, q) => p + q, 0) / Math.max(1, a.length);
  const red = rec.filter((r) => r.reduced);
  const out = { name, load: os.loadavg()[0].toFixed(1), frames: rec.reduce((p, q) => p + q.n, 0), meanJs: +mean(rec.map((r) => r.js)).toFixed(2), maxJs: +Math.max(...rec.map((r) => r.js)).toFixed(1), meanDrawn: Math.round(mean(rec.map((r) => r.drawn))), reducedFrames: red.length, meanRafMs: +mean(dur.map((r) => r.dt)).toFixed(1), maxRafMs: +Math.max(...dur.map((r) => r.dt)).toFixed(0), gestureMs: gest, afterSettle: fin };
  console.log(args.tag, `dsf${dsf} cpu${+cpu} ${layout}`, JSON.stringify(out));
};
await page.mouse.move(cx, cy);
await run('wheel zoom in x24 then out x24', async () => { for (let k = 0; k < 24; k++) { await page.mouse.wheel(0, -100); await sleep(16); } for (let k = 0; k < 24; k++) { await page.mouse.wheel(0, 100); await sleep(16); } });
await run('drag 40 moves', async () => { await page.mouse.down(); for (let k = 0; k < 40; k++) { await page.mouse.move(cx + 3 * k, cy + 2 * k); await sleep(16); } await page.mouse.up(); });
await browser.close();
