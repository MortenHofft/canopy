// Scale probe for generated trees (5k, 25k, 50k tips; not in the catalogue). Needs the PRODUCTION build served on 127.0.0.1:5305 (npm run build; vite preview). Usage: node scale.mjs <newick file> <label> 5305 10 [x] [both|pan|zoom]. Generated with: python3 -I data/synthetic/generate.py --out <dir> --sizes 5000,25000,50000 --shapes yule
// Paths assume the repository at /home/user/gbif-phylo.
// Scale probe for custom trees (mirrors runner S1: mount via window.__spike, click latency, 10 s wheel+drag with the shell's rAF sampler).
import fs from 'node:fs';
import { open } from './lib.mjs';
import { parseNewick } from '/home/user/gbif-phylo/spikes/shared/newick.ts';
const file = process.argv[2]; const label = process.argv[3] || file; const port = process.argv[4] || '5305'; const secs = Number(process.argv[5] || 10);
const columns = process.argv[6] === 'cols';
const MODE = process.argv[7] || 'both'; // both | pan | zoom
const newick = fs.readFileSync(file, 'utf8');
const t = parseNewick(newick);
const { browser, page } = await open(`http://127.0.0.1:${port}/?tree=edge-quoted-labels`, { w: 1440, h: 900 });
await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 60000 });
const cdp = await browser.newBrowserCDPSession();
const cpu = async () => { const r = await cdp.send('SystemInfo.getProcessInfo'); const o = {}; for (const p of r.processInfo) o[p.type] = (o[p.type] || 0) + p.cpuTime; return o; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { label, tips: t.tipCount, load: await page.evaluate(() => 0) };
const size = await page.evaluate(() => { const el = document.querySelector('.main'); return { width: Math.max(200, el.clientWidth), height: Math.max(200, el.clientHeight) }; });
await page.evaluate(() => window.__spike.unmount());
const cpu0 = await cpu();
const t0 = Date.now();
const mount = await page.evaluate(([newick, size]) => window.__spike.mount({ treeId: 'syn-yule-1000', newick, layout: 'rectangular', branchLengths: true, size }), [newick, size]);
out.wallMountMs = Date.now() - t0; out.parseMs = mount.parseMs; out.firstRenderMs = mount.firstRenderMs; out.reportedTips = mount.tips; out.sharedParseMs = mount.sharedParseMs;
await page.waitForTimeout(1500);
const cpu1 = await cpu();
out.cpuMountSec = { renderer: +(cpu1.renderer - cpu0.renderer).toFixed(2), gpu: +((cpu1.gpu || 0) - (cpu0.gpu || 0)).toFixed(2), browser: +((cpu1.browser || 0) - (cpu0.browser || 0)).toFixed(2) };
out.heapAfterMountMB = await page.evaluate(() => { const h = window.__spikeMetrics.heap(true); return h && Math.round(h.usedMB * 10) / 10; });
out.stats = await page.evaluate(() => window.__spike.getStats());
if (columns) { /* not used for custom trees */ }
// click latency on a few big clades at the fit view
const cand = []; for (let i = 1; i < t.nodeCount; i++) { const n = t.leafEnd[i] - t.leafStart[i]; if (t.childCount[i] > 0 && n >= Math.max(5, t.tipCount * 0.01) && n <= t.tipCount * 0.4) cand.push(i); }
cand.sort((a, b) => (t.leafEnd[b] - t.leafStart[b]) - (t.leafEnd[a] - t.leafStart[a]));
const rect = await page.locator('[data-testid=tree-container]').boundingBox();
const lat = []; let tried = 0;
for (const i of cand.slice(0, 12)) {
  const p = await page.evaluate((id) => window.__spike.locate({ kind: 'node', id }), t.nodeId(i));
  if (!p) continue; tried++;
  await page.evaluate(() => window.__spike.clearEvents());
  await page.mouse.move(p.x, p.y); await sleep(60);
  await page.mouse.click(p.x, p.y); await sleep(250);
  const r = await page.evaluate(async () => ({ ev: (await window.__spike.getEvents()).filter(e => e.type === 'nodeClick' || e.type === 'tipClick'), pd: window.__spikeMetrics.input.pointerDown }));
  if (r.ev.length) lat.push({ ms: Math.round(r.ev[0].t - r.pd), right: r.ev[0].nodeId === t.nodeId(i), tips: r.ev[0].tipIds.length === t.leafEnd[i] - t.leafStart[i] });
  await page.keyboard.press('Escape');
  if (lat.length >= 5) break;
}
out.click = { tried, samples: lat };
// scripted wheel + drag
const cpu2 = await cpu();
await page.evaluate(() => { window.__lt = []; try { new PerformanceObserver((l) => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] }); } catch (e) {} window.__spikeMetrics.startSampler(); });
const cx = rect.x + rect.width * 0.4, cy = rect.y + rect.height * 0.5; const ts = Date.now(); let k = 0;
while (Date.now() - ts < secs * 1000) {
  let phase = k++ % 4; if (MODE === 'pan') phase = k % 2 ? 1 : 3; if (MODE === 'zoom') phase = k % 2 ? 0 : 2; const x = cx + (k % 3) * 40, y = cy + (k % 5) * 20;
  await page.mouse.move(x, y);
  if (phase === 0 || phase === 2) { const dir = phase === 0 ? -120 : 120; for (let i = 0; i < 6 && Date.now() - ts < secs * 1000; i++) { await page.mouse.wheel(0, dir); await sleep(16); } }
  else { const sign = phase === 1 ? -1 : 1; await page.mouse.down(); await page.mouse.move(x + sign * 160, y + sign * 70, { steps: 10 }); await page.mouse.up(); }
}
const fps = await page.evaluate(() => window.__spikeMetrics.stopSampler());
const cpu3 = await cpu();
out.cpuInteractSec = { renderer: +(cpu3.renderer - cpu2.renderer).toFixed(2), gpu: +((cpu3.gpu || 0) - (cpu2.gpu || 0)).toFixed(2), wallSec: secs };
out.mode = MODE; out.fps = { median: Math.round(fps.medianFps * 10) / 10, p5: Math.round(fps.p5Fps * 10) / 10, p5ByFrame: Math.round(fps.p5FpsByFrame * 10) / 10, maxGapMs: Math.round(fps.maxIntervalMs), frames: fps.frames };
out.longTasks = await page.evaluate(() => { const a = window.__lt.slice().sort((x, y) => x - y); return { n: a.length, medianMs: a[a.length >> 1] ?? 0, maxMs: a[a.length - 1] ?? 0, totalMs: a.reduce((x, y) => x + y, 0) }; });
out.heapAfterInteractionMB = await page.evaluate(() => { const h = window.__spikeMetrics.heap(true); return h && Math.round(h.usedMB * 10) / 10; });
out.statsAfter = await page.evaluate(() => window.__spike.getStats());
out.errors = await page.evaluate(() => window.__spikeMetrics.errors.slice(0, 5));
out.loadAvg = fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
console.log('RESULT ' + JSON.stringify(out));
await browser.close();
