// focus by Ctrl+G + vertical zoom steps (the implementation that shipped). Needs the demo on 127.0.0.1:5305 (production build).
// Paths assume the repository at /home/user/gbif-phylo.
import fs from 'node:fs';
import { open } from './lib.mjs';
import { parseNewick } from '/home/user/gbif-phylo/spikes/shared/newick.ts';
const file = process.argv[2]; const label = process.argv[3]; const rowTarget = Number(process.argv[4] || 16);
const newick = fs.readFileSync(file, 'utf8'); const t = parseNewick(newick);
const { browser, page } = await open('http://127.0.0.1:5305/?tree=edge-quoted-labels', { w: 1440, h: 900 });
await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 60000 });
const size = await page.evaluate(() => { const el = document.querySelector('.main'); return { width: el.clientWidth, height: el.clientHeight }; });
await page.evaluate(() => window.__spike.unmount());
await page.evaluate(([newick, size]) => window.__spike.mount({ treeId: 'syn-yule-1000', newick, layout: 'rectangular', branchLengths: true, size }), [newick, size]);
await page.waitForTimeout(1000);
const tip = t.tipLabels[Math.floor(t.tipCount * 0.37)];
const res = await page.evaluate(async ([tip, rowTarget]) => {
  const out = {};
  const v = window.__aptx.viewer; const root = window.__aptx.ltree;
  const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: !!o.shift, bubbles: true, cancelable: true }));
  const t0 = performance.now();
  v.applyViewState({ ...v.getViewState(), searchA: { field: 'Node Name', mode: 'regex', value: '^(' + tip + ')$' } });
  out.afterSearchMs = Math.round(performance.now() - t0);
  // row pitch from the layout
  let mn = Infinity, mx = -Infinity, nt = 0; const st = [root];
  while (st.length) { const n = st.pop(); if (!n.children) { nt++; if (n.x < mn) mn = n.x; if (n.x > mx) mx = n.x; } else for (const c of n.children) st.push(c); }
  const pitch = (mx - mn) / Math.max(1, nt - 1); out.pitch = pitch;
  const steps = Math.max(0, Math.ceil(Math.log(rowTarget / pitch) / Math.log(1.1))); out.steps = steps;
  const t1 = performance.now();
  key('g');
  for (let i = 0; i < steps; i++) key('ArrowUp', { shift: true });
  out.syncMs = Math.round(performance.now() - t1);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  out.toSecondFrameMs = Math.round(performance.now() - t1);
  await new Promise(r => setTimeout(r, 300));
  out.labels = document.querySelectorAll('g.node').length;
  const svg = document.querySelector('rect.basebackground').parentElement;
  out.tr = svg.querySelector(':scope > g').getAttribute('transform');
  return out;
}, [tip, rowTarget]);
res.loc = await page.evaluate((tip) => window.__spike.locate({ kind: 'tip', id: tip }), tip);
res.tipLabel = tip;
console.log('RESULT ' + label + ' ' + JSON.stringify(res));
await page.screenshot({ path: process.env.SP + '/zf-' + label + '.png' });
await browser.close();
