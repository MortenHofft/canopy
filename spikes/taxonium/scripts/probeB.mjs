// usage: node probeB.mjs <path under /data> <label> [colour]
import { launch } from './lib.mjs';
import fs from 'node:fs';
const OUT = new URL('../../results/taxonium/probes/', import.meta.url).pathname;
const [path, label] = [process.argv[2], process.argv[3]];
const base = 'http://127.0.0.1:5207/';
const res = { label, path };
const { browser, page, logs } = await launch({ viewport: { width: 1280, height: 800 } });
await page.goto(base);
await page.waitForFunction(() => window.__spike);
const heapMB = () => page.evaluate(() => { gc(); return performance.memory.usedJSHeapSize / 1048576; });
const workerMB = async () => { const w = page.workers()[0]; if (!w) return null; try { return await w.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null); } catch (e) { return 'err'; } };
res.heapBeforeMB = await heapMB();
const t0 = Date.now();
const r = await Promise.race([
  page.evaluate(async (p) => {
    const t = performance.now();
    const text = await (await fetch('/data/' + p)).text();
    const fetchMs = performance.now() - t;
    const m = await window.__spike.mount({ treeId: 'syn-yule-1000', newick: text, layout: 'rectangular', branchLengths: true, size: { width: 800, height: 520 } });
    return { fetchMs, ...m, notes: m.notes?.slice(0, 200) };
  }, path),
  new Promise((_, rej) => setTimeout(() => rej(new Error('mount timeout 300 s')), 300000)),
]).catch((e) => ({ error: String(e.message).slice(0, 200) }));
res.mount = r;
res.wallMs = Date.now() - t0;
if (!r.error) {
  await page.waitForTimeout(2500);
  res.heapAfterMB = await heapMB();
  res.workerHeapMB = await workerMB();
  res.stats = (await page.evaluate(() => window.__spike.getStats())).custom;
  // colour a clade (cost of the O(tips) colour map)
  const clade = await page.evaluate(() => { const t = window.__taxoniumDebug.tree; let best = -1; for (let i = 1; i < t.nodeCount; i++) { const c = t.tipCountOf(i); if (c >= 200 && c <= 2000) { best = i; break; } } return best < 0 ? null : 'n' + best; });
  if (clade) {
    const tc = Date.now();
    await page.evaluate((id) => window.__spike.setColouredClades([{ nodeId: id, colour: '#d62728' }]), clade);
    res.colourCommitWallMs = Date.now() - tc;
    await page.waitForTimeout(1500);
    res.colourBuildMs = (await page.evaluate(() => window.__spike.getStats())).custom?.lastColourBuildMs;
    // long-task style probe: how long is the main thread blocked for one more colour change
    const lt = await page.evaluate(async (id) => { let max = 0; let last = performance.now(); const iv = setInterval(() => { const n = performance.now(); max = Math.max(max, n - last); last = n; }, 5); await window.__spike.setColouredClades([]); await new Promise((r) => setTimeout(r, 1500)); clearInterval(iv); return max; }, clade);
    res.maxMainThreadGapAfterClearMs = lt;
  }
  // click a tip after focusing (latency incl. worker details)
  const tip = await page.evaluate(() => window.__taxoniumDebug.tree.tipLabels[Math.floor(window.__taxoniumDebug.tree.tipCount * 0.4)]);
  await page.evaluate((t) => window.__spike.focusTip(t), tip);
  await page.waitForTimeout(3000);
  const p = await page.evaluate((t) => window.__spike.locate({ kind: 'tip', id: t }), tip);
  res.tipLocated = !!p;
  if (p) {
    await page.evaluate(() => window.__spike.clearEvents());
    const tt = Date.now();
    await page.mouse.click(p.x, p.y);
    for (let i = 0; i < 100; i++) { await page.waitForTimeout(100); if ((await page.evaluate(() => window.__spike.getEvents())).length) break; }
    res.clickToEventMs = Date.now() - tt;
    res.clickEvents = (await page.evaluate(() => window.__spike.getEvents())).map((e) => ({ type: e.type, tip: e.tipIds[0] === tip }));
  }
  await page.screenshot({ path: OUT + `pb-${label}.png` });
  // unmount: worker memory retained?
  await page.evaluate(() => window.__spike.unmount());
  await page.waitForTimeout(1500);
  res.afterUnmountHeapMB = await heapMB();
  res.afterUnmountWorkerHeapMB = await workerMB();
}
res.logsTail = logs.filter((l) => !/Failed to load resource/.test(l)).slice(-5);
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync(OUT + `probeB-${label}.json`, JSON.stringify(res, null, 1));
await browser.close();
