// focusTip cost at scale with the first (Ctrl+Shift+E) implementation; kept as evidence. Needs the demo on 127.0.0.1:5305.
// Paths assume the repository at /home/user/gbif-phylo.
import fs from 'node:fs';
import { open } from './lib.mjs';
import { parseNewick } from '/home/user/gbif-phylo/spikes/shared/newick.ts';
const file = process.argv[2]; const label = process.argv[3];
const newick = fs.readFileSync(file, 'utf8'); const t = parseNewick(newick);
const { browser, page } = await open('http://127.0.0.1:5305/?tree=edge-quoted-labels', { w: 1440, h: 900 });
await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 60000 });
const size = await page.evaluate(() => { const el = document.querySelector('.main'); return { width: el.clientWidth, height: el.clientHeight }; });
await page.evaluate(() => window.__spike.unmount());
const m = await page.evaluate(([newick, size]) => window.__spike.mount({ treeId: 'syn-yule-1000', newick, layout: 'rectangular', branchLengths: true, size }), [newick, size]);
const tip = t.tipLabels[Math.floor(t.tipCount * 0.37)];
const cdp = await browser.newBrowserCDPSession();
const out = { label, tips: t.tipCount, firstRenderMs: Math.round(m.firstRenderMs) };
const r0 = await page.evaluate(() => performance.now());
const t0 = Date.now();
const res = await page.evaluate(async (tip) => { const s = window.__spike; const a = performance.now(); await s.focusTip(tip); const b = performance.now(); const p = await s.locate({ kind: 'tip', id: tip }); return { focusMs: Math.round(b - a), loc: p, stats: await s.getStats() }; }, tip);
out.focus = res; out.wall = Date.now() - t0;
out.heapMB = await page.evaluate(() => { const h = window.__spikeMetrics.heap(true); return h && Math.round(h.usedMB); });
await page.screenshot({ path: process.env.SP + '/focus-' + label + '.png' });
console.log('RESULT ' + JSON.stringify(out));
await browser.close();
