// Mount a custom Newick (any size) through window.__spike.mount, then scripted pan/zoom with the rAF sampler and a few node clicks.
// usage: PROBE_URL=http://127.0.0.1:5203/ node measure/probe-scale.mjs <newick file> <label> [seconds]
// trees of other sizes: python3 -I data/synthetic/generate.py --out <dir> --sizes 2000,5000,20000,50000 --shapes yule
import { Browser } from '../../runner/lib/session.mjs';
import { sleep } from '../../runner/lib/util.mjs';
import fs from 'node:fs';
import os from 'node:os';
// usage: node probe-scale.mjs <newick file> <label> [panzoom seconds]
const [file, label, secs] = process.argv.slice(2);
const newick = fs.readFileSync(file, 'utf8');
const b = new Browser(process.env.PROBE_URL || 'http://127.0.0.1:5203/', () => {});
await b.launch();
const out = { label, load: os.loadavg()[0].toFixed(1) };
try {
await b.withSession('scale', async (s) => {
  const size = await s.mainSize();
  const t0 = Date.now();
  const r = await s.page.evaluate(async ({ newick, size }) => {
    const t = performance.now();
    const res = await window.__spike.mount({ treeId: 'custom', newick, layout: 'rectangular', branchLengths: true, size });
    return { ...res, wall: performance.now() - t };
  }, { newick, size });
  out.mount = { tips: r.tips, parseMs: Math.round(r.parseMs), firstRenderMs: Math.round(r.firstRenderMs), wall: Math.round(r.wall), notes: r.notes?.slice(0, 80) };
  await s.settle(500);
  const st = await s.call('getStats');
  out.dom = st.domNodes; out.custom = st.custom;
  out.heapMB = await s.metrics(() => window.__spikeMetrics.heap(true)?.usedMB ?? null);
  // frame sampler during real pan/zoom
  const rect = await s.containerRect();
  const cx = rect.x + rect.width * 0.4, cy = rect.y + rect.height * 0.5;
  await s.metrics(() => window.__spikeMetrics.startSampler());
  const ms = Number(secs || 10) * 1000; const t1 = Date.now(); let k = 0;
  while (Date.now() - t1 < ms) {
    const phase = k++ % 4; const x = cx + (k % 3) * 40, y = cy + (k % 5) * 20;
    await s.page.mouse.move(x, y);
    if (phase === 0 || phase === 2) { for (let i = 0; i < 6 && Date.now() - t1 < ms; i++) { await s.page.mouse.wheel(0, phase === 0 ? -120 : 120); await sleep(16); } }
    else { const sign = phase === 1 ? -1 : 1; await s.page.mouse.down(); await s.page.mouse.move(x + sign * 160, y + sign * 70, { steps: 10 }); await s.page.mouse.up(); }
  }
  const f = await s.metrics(() => window.__spikeMetrics.stopSampler());
  out.fps = { median: +f.medianFps.toFixed(1), p5: +f.p5Fps.toFixed(1), maxGapMs: Math.round(f.maxIntervalMs), frames: f.frames };
  // click latency on internal nodes near the root at the fit view (pointerdown -> library event)
  const lat = [];
  for (let i = 0; i < 4; i++) {
    const nid = ['n1', 'n2', 'n3', 'n10', 'n20'][i];
    const p = await s.call('locate', { kind: 'node', id: nid });
    if (!p) continue;
    await s.call('clearEvents');
    await s.page.mouse.move(p.x, p.y); await s.page.mouse.click(p.x, p.y); await sleep(700);
    const im = await s.metrics(() => ({ ...window.__spikeMetrics.input }));
    const ev = await s.events();
    if (ev.some((e) => e.type.endsWith('Click'))) lat.push(Math.round(im.lastEvent - im.pointerDown));
  }
  out.clickMs = lat;
  out.errors = (await s.pageErrors()).slice(0, 3);
}, 400000);
} catch (e) { out.error = String(e.message).slice(0, 200); }
console.log(JSON.stringify(out));
await b.close();
