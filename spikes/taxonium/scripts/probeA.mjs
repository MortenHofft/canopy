import { launch } from './lib.mjs';
import fs from 'node:fs';
const OUT = new URL('../../results/taxonium/probes/', import.meta.url).pathname;
const base = 'http://127.0.0.1:5207/';
const res = {};
const { browser, page, logs } = await launch();
const reqs = [];
page.on('request', (r) => { const u = r.url(); if (/assets\/.*\.js/.test(u)) reqs.push(u.split('/').pop()); });
const t0 = Date.now();
await page.goto(base + '?tree=syn-yule-1000');
await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 90000 });
res.mountedMs = Date.now() - t0;
await page.waitForTimeout(1500);
res.jsChunksLoaded = reqs.length;
res.jbrowseChunkLoaded = reqs.some((u) => /JBrowsePanel/.test(u));
res.chunkNames = reqs.slice(0, 12);
const info = await page.evaluate(() => { const t = window.__taxoniumDebug.tree; const tip = t.tipLabels[600]; const par = t.parent[t.tipIndex(tip)]; return { tip, par: 'n' + par, parTips: t.tipCountOf(par) }; });
// highlight latency (library search path)
const hl = await page.evaluate(async (tip) => {
  const d = window.__taxoniumDebug; const deck = () => d.getInternals().deckRef.current.deck;
  const layer = () => deck().props.layers.find((l) => l?.id === 'main-search-scatter-gbifhl');
  const t0 = performance.now(); await window.__spike.highlightTips([tip]); const tCommit = performance.now() - t0;
  while (!(layer()?.props?.data?.length > 0) && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
  const ringMs = performance.now() - t0; const n = layer()?.props?.data?.length ?? 0;
  const vis = layer()?.props?.visible;
  const t1 = performance.now(); await window.__spike.highlightTips([]); const clearCommit = performance.now() - t1;
  return { commitMs: tCommit, ringMs, ringsDrawn: n, visible: vis, clearCommitMs: clearCommit, visibleAfterClear: layer()?.props?.visible };
}, info.tip);
res.highlight = hl;
// focus + colour when zoomed
await page.evaluate((t) => window.__spike.focusTip(t), info.tip);
await page.waitForTimeout(1500);
const b = await page.evaluate((id) => window.__spike.bounds({ kind: 'node', id }), info.par);
res.cladeBounds = b;
const clip = b ? { x: Math.max(0, b.x - 10), y: Math.max(0, b.y - 10), width: Math.min(400, b.width + 150), height: Math.min(300, b.height + 20) } : null;
const shot = async (name) => { if (clip) await page.screenshot({ path: OUT + name, clip }); };
await shot('pa-before.png');
const tc = Date.now();
await page.evaluate((id) => window.__spike.setColouredClades([{ nodeId: id, colour: '#d62728' }]), info.par);
res.colourCommitWallMs = Date.now() - tc;
await page.waitForTimeout(600);
await shot('pa-after.png');
res.customAfterColour = (await page.evaluate(() => window.__spike.getStats())).custom;
// hover: does the library show its tooltip, and do we get an event?
const p = await page.evaluate((t) => window.__spike.locate({ kind: 'tip', id: t }), info.tip);
await page.evaluate(() => window.__spike.clearEvents());
if (p) { await page.mouse.move(p.x - 30, p.y); await page.mouse.move(p.x, p.y); await page.waitForTimeout(500); }
res.hoverEvents = (await page.evaluate(() => window.__spike.getEvents())).length;
res.libraryTooltipText = await page.evaluate(() => { const el = [...document.querySelectorAll('.taxonium div')].find((e) => e.style.position === 'absolute' && e.style.zIndex === '1' && e.textContent); return el ? el.textContent.slice(0, 120) : null; });
await page.screenshot({ path: OUT + 'pa-hover.png', clip: { x: 0, y: 130, width: 840, height: 560 } });
// cladogram toggle cost
const tb = Date.now();
await page.evaluate(() => window.__spike.setBranchLengths(false));
res.cladogramCommitWallMs = Date.now() - tb;
await page.waitForTimeout(1500);
res.afterToggleStats = (await page.evaluate(() => window.__spike.getStats())).custom;
// worker memory retention
const worker = page.workers()[0];
res.workers = page.workers().length;
if (worker) res.workerMem = await worker.evaluate(() => ({ perfMem: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null })).catch((e) => String(e));
res.logsTail = logs.slice(-6);
console.log(JSON.stringify(res, null, 1));
fs.writeFileSync(OUT + 'probeA.json', JSON.stringify(res, null, 1));
await browser.close();
