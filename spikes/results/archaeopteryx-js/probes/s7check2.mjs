// S7 setup replay: only the occ bar column, 8 wheel notches and a drag, then where the heat map is. Needs the demo (production build) on 127.0.0.1:5305.
// Paths assume the repository at /home/user/gbif-phylo.
import { open } from './lib.mjs';
const { browser, page } = await open('http://127.0.0.1:5305/?tree=syn-yule-1000');
await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 60000 });
await page.waitForTimeout(800);
const rect = await page.locator('[data-testid=tree-container]').boundingBox();
await page.evaluate(async () => {
  const d = window.__spikeData; const lt = await d.loadTree('syn-yule-1000');
  const meta = await (await fetch('/data/synthetic/meta/yule_1000.meta.tsv')).text();
  const rows = meta.trim().split('\n').slice(1).map(r => r.split('\t'));
  const values = {}; for (const r of rows) values[r[0]] = Number(r[1]);
  window.__occ = { id: 'occ', kind: 'bar', header: 'Occurrences', width: 90, values };
  await window.__spike.setColumns([window.__occ]);
});
await page.waitForTimeout(1500);
const scan = async (tag) => console.log(tag, JSON.stringify(await page.evaluate(async () => {
  const names = Object.keys(window.__occ.values).filter((_, k) => k % 3 === 0).slice(0, 300); let vis = 0, cells = 0; let first = null;
  for (const id of names) { const p = await window.__spike.locate({ kind: 'tip', id }); if (!p) continue; vis++; const c = await window.__spike.locateCell('occ', id); if (c) { cells++; first = first || c; } }
  const hm = document.querySelector('g.aptx-heatmap'); const fr = hm && hm.querySelector(':scope > rect[fill=none]'); const b = fr && fr.getBoundingClientRect();
  const cont = document.querySelector('[data-testid=tree-container]').getBoundingClientRect();
  return { vis, cells, first, heatmapScreen: b && [Math.round(b.left), Math.round(b.right), Math.round(b.top), Math.round(b.bottom)], container: [Math.round(cont.left), Math.round(cont.right), Math.round(cont.top), Math.round(cont.bottom)], rects: hm ? hm.children.length : 0 };
})));
await scan('fit');
const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
await page.mouse.move(cx, cy);
for (let k = 0; k < 8; k++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(30); }
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx - 40, cy + 90, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(600);
await scan('after zoom+pan');
await page.screenshot({ path: process.env.SP + '/s7check2.png' });
await browser.close();
