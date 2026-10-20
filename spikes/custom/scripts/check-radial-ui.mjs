// Browser check of the radial cut-off in the real demo (needs the production build served: npm run build && npm run preview -- --port 5306).
//   node spikes/custom/scripts/check-radial-ui.mjs [--port 5306]
// Checks on a 10,000-tip Yule tree, radial: hover and click on a summarised clade (event carries the clade's tip count), clade colouring
// of a summarised clade, highlight and focus of a tip inside a summary, no tree redraw on hover, reduced frames during a wheel gesture
// and one full frame after it, a click right after a wheel hits what a full-quality frame shows, and progressive detail when zooming.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(path.join(root, 'spikes/runner/package.json'));
const { chromium } = require('playwright-core');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const port = Number(args.port || 5306);
const text = zlib.gunzipSync(fs.readFileSync(path.join(root, 'data/synthetic/newick/yule_10000.nwk.gz'))).toString('utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) failures++; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox', '--disable-gpu-rasterization'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
page.on('pageerror', (e) => { console.log('PAGEERR', e.message); failures++; });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__spike);
await page.evaluate(async (t) => { await window.__spike.mount({ treeId: 'syn-yule-10000', newick: t, layout: 'radial', branchLengths: true, size: { width: 1100, height: 640 } }); }, text);
const getBox = () => page.evaluate(() => { const r = window.__customTree.handle().renderer().root.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
let box = await getBox();
const stats = () => page.evaluate(() => window.__customTree.stats());
const rd = (fn, ...a) => page.evaluate(fn, ...a);

// ---- fit view: the cut-off is active and the notice shows
let s = await stats();
ok(s.budget === 2000 && s.drawn <= 2000 && s.forced > 0 && s.summaries > 0, `fit: drawn ${s.drawn} <= budget ${s.budget}, ${s.forced} clades summarised`);
const noticeText = await page.locator('[data-treeview] [role=status]').first().textContent();
ok(/clades? summarised, raise the limit in Library options/.test(noticeText ?? ''), `notice: "${noticeText}"`);

// ---- find a summary with room to click
const target = await rd(() => {
  const r = window.__customTree.handle().renderer(); const { list, tree, T, L } = r;
  for (let e = 0; e < list.count; e++) {
    if (list.kind[e] !== 2) continue;
    const i = list.node[e]; const r1 = L.XMAX[i] * T.k, r0 = L.X[i] * T.k, arc = (tree.leafEnd[i] - tree.leafStart[i]) * T.da * r1;
    if (arc < 2.5 || r1 - r0 < 10 || tree.leafEnd[i] - tree.leafStart[i] < 3) continue;
    const a = ((tree.leafStart[i] + tree.leafEnd[i]) / 2) * T.da, rr = r1 - 3;
    const x = T.cx + rr * Math.cos(a), y = T.cy + rr * Math.sin(a);
    if (x > 20 && y > 40 && x < T.W - 20 && y < T.H - 20) return { node: i, x, y, tips: tree.leafEnd[i] - tree.leafStart[i], start: tree.leafStart[i] };
  }
  return null;
});
ok(!!target, 'found a summarised clade to interact with');
box = await getBox();
const px = box.x + target.x, py = box.y + target.y;

// ---- hover: event with the clade's tip count
await page.evaluate(() => window.__spike.clearEvents());
await page.mouse.move(px - 40, py - 40); await page.mouse.move(px, py, { steps: 4 }); await sleep(150);
let ev = await page.evaluate(() => window.__spike.getEvents());
const hov = ev.filter((e) => e.type === 'nodeHover').pop();
ok(hov && hov.nodeId === 'n' + target.node && hov.tipIds.length === target.tips, `hover on a summary: ${hov?.nodeId}, ${hov?.tipIds.length} tips (expected n${target.node}, ${target.tips})`);

// ---- hover and selection never redraw the tree layer
const f0 = (await stats()).frames;
for (let k = 0; k < 40; k++) { await page.mouse.move(px + (k % 7) * 3, py + (k % 5) * 3); await sleep(12); }
await sleep(100);
const f1 = (await stats()).frames;
ok(f1 === f0, `40 pointer moves over the tree: ${f1 - f0} tree redraws`);

// ---- click: nodeClick with the tip set
await page.evaluate(() => window.__spike.clearEvents());
await page.mouse.click(px, py); await sleep(150);
ev = await page.evaluate(() => window.__spike.getEvents());
const clk = ev.filter((e) => e.type === 'nodeClick').pop();
ok(clk && clk.nodeId === 'n' + target.node && clk.tipIds.length === target.tips, `click on a summary: ${clk?.nodeId}, ${clk?.tipIds.length} tips`);
const lastEvent = await page.locator('[data-testid=last-event]').textContent();
ok(/nodeClick/.test(lastEvent ?? ''), `React state shows the event: ${(lastEvent ?? '').slice(0, 60)}`);

// ---- colouring a summarised clade: pixels at its fan turn red
const before = await rd(({ x, y }) => { const c = window.__customTree.handle().renderer().ctx; const d = c.getImageData(Math.round(x * (devicePixelRatio || 1)), Math.round(y * (devicePixelRatio || 1)), 1, 1).data; return [d[0], d[1], d[2]]; }, target);
await page.evaluate((id) => window.__spike.setColouredClades([{ nodeId: id, colour: '#e00000' }]), 'n' + target.node);
await sleep(100);
const after = await rd(({ x, y }) => { const c = window.__customTree.handle().renderer().ctx; const d = c.getImageData(Math.round(x * (devicePixelRatio || 1)), Math.round(y * (devicePixelRatio || 1)), 1, 1).data; return [d[0], d[1], d[2]]; }, target);
ok(after[0] > after[1] + 40 && after[0] > before[0] - 1, `clade colour: pixel ${before} -> ${after}`);
await page.evaluate(() => window.__spike.setColouredClades([]));

// ---- highlight and focus a tip inside a summary
const tipId = await rd((start) => window.__customTree.handle().renderer().tree.tipLabels[start + 1], target.start);
await page.evaluate((t) => window.__spike.highlightTips([t]), tipId);
await page.evaluate((t) => window.__spike.focusTip(t), tipId);
await sleep(200);
const loc = await page.evaluate((t) => window.__spike.locate({ kind: 'tip', id: t }), tipId);
s = await stats();
ok(!!loc && s.drawn <= 2000, `focusTip on a tip that was inside a summary: locate ${loc ? 'found' : 'null'}, drawn ${s.drawn}`);
await page.evaluate(() => window.__spike.highlightTips([]));

// ---- wheel gesture: reduced frames while it lasts, one full frame after, click right after hits the full-quality target
await rd(() => window.__customTree.handle().renderer().fit(false));
await sleep(200);
const cx = box.x + box.width * 0.45, cy = box.y + box.height * 0.5;
await page.mouse.move(cx, cy);
let sawReduced = false, maxReducedDrawn = 0;
for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, -120); await sleep(16); const q = await stats(); if (q.reduced) { sawReduced = true; maxReducedDrawn = Math.max(maxReducedDrawn, q.drawn); } }
ok(sawReduced && maxReducedDrawn <= 500, `during the wheel: reduced frames drawn (max ${maxReducedDrawn} <= 500)`);
await sleep(300);
s = await stats();
ok(!s.reduced && s.drawn <= 2000, `300 ms after the wheel: full frame (reduced=${s.reduced}, drawn ${s.drawn})`);

// ---- progressive detail: zoom in step by step, forced summaries fall to 0, budget respected
const series = [];
for (let k = 0; k < 14; k++) {
  for (let j = 0; j < 4; j++) { await page.mouse.wheel(0, -120); await sleep(16); }
  await sleep(220);
  const q = await stats();
  series.push([q.drawn, q.forced, +q.minPxUsed.toFixed(2), q.reduced]);
}
console.log('  zoom series [drawn, forced, minPx, reduced]:', JSON.stringify(series));
ok(series.every((q) => q[0] <= 2000 && !q[3]), 'drawn <= 2000 at every zoom step, all settled to full frames');
ok(series[series.length - 1][1] === 0, 'fully zoomed in: no forced summaries');

// ---- click immediately after a wheel hits what the full-quality frame shows
await rd(() => window.__customTree.handle().renderer().fit(false));
await sleep(200);
await page.evaluate(() => window.__spike.clearEvents());
for (let j = 0; j < 3; j++) { await page.mouse.wheel(0, -60); await sleep(10); }
const where = await rd(() => { const r = window.__customTree.handle().renderer(); r.renderNow(); const { list, tree, T, L } = r; for (let e = 0; e < list.count; e++) { if (list.kind[e] !== 1) continue; const i = list.node[e]; const x = T.cx + L.X[i] * T.k * L.COS[i], y = T.cy + L.X[i] * T.k * L.SIN[i]; if (x > 100 && y > 100 && x < T.W - 100 && y < T.H - 100) return { node: i, x, y }; } return null; });
if (where) {
  // after renderNow the frame is full quality; now disturb it with a fresh wheel step and click on the same spot at once
  await page.mouse.wheel(0, 0);
  await page.mouse.click(box.x + where.x, box.y + where.y); await sleep(100);
  ev = await page.evaluate(() => window.__spike.getEvents());
  const c2 = ev.filter((e) => e.type === 'tipClick' || e.type === 'nodeClick').pop();
  ok(!!c2, `click right after wheel input produced an event (${c2?.type} ${c2?.nodeId})`);
}
await browser.close();
console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
