// S13 by hand: second instance replaces the first; 5 mount/unmount cycles; DOM and heap. Needs the demo on 127.0.0.1:5305.
// Paths assume the repository at /home/user/gbif-phylo.
import { open } from './lib.mjs';
const { browser, page } = await open('http://127.0.0.1:5305/?tree=syn-yule-200');
await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 60000 });
const r = await page.evaluate(async () => {
  const out = {};
  const txt = await (await fetch('/data/synthetic/newick/yule_1000.nwk')).text();
  const cont = (i) => document.querySelector(i === 0 ? '[data-testid=tree-container]' : '[data-testid=tree-container-1]');
  const snap = (i) => { const c = cont(i); return c ? { svgs: c.querySelectorAll('svg:not(.aptx-glyph)').length, labels: c.querySelectorAll('g.node').length, panel: c.querySelectorAll('.aptx-panel').length, w: c.clientWidth, h: c.clientHeight } : null; };
  out.before = [snap(0), snap(1)];
  let t;
  try { t = await window.__spike2.mount({ treeId: 'syn-yule-1000', newick: txt, layout: 'rectangular', branchLengths: true, size: { width: 340, height: 240 } }); out.mount2 = t.tips; } catch (e) { out.mount2err = String(e).slice(0, 200); }
  await new Promise(r => setTimeout(r, 600));
  out.after = [snap(0), snap(1)];
  out.bodyPanels = document.querySelectorAll('.aptx-panel').length;
  out.globalMenus = document.querySelectorAll('.aptx-node-menu, .aptx-tip').length;
  // unmount instance 1 -> does instance 0 survive?
  await window.__spike2.unmount(); await new Promise(r => setTimeout(r, 300));
  out.afterUnmount2 = [snap(0), snap(1)];
  // mount/unmount x5 on instance 0
  const heap = []; const dom = [];
  for (let i = 0; i < 5; i++) {
    await window.__spike.unmount();
    const r = await window.__spike.mount({ treeId: 'syn-yule-1000', newick: txt, layout: 'rectangular', branchLengths: true, size: { width: 834, height: 549 } });
    dom.push(document.querySelectorAll('*').length);
    if (window.gc) window.gc();
    heap.push(Math.round(performance.memory.usedJSHeapSize / 1e5) / 10);
  }
  out.cycles = { dom, heap };
  out.docListeners = typeof getEventListeners === 'function' ? 'n/a' : 'n/a';
  out.styleEls = document.querySelectorAll('style#aptx-panel-styles, style[id^=aptx]').length;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await page.screenshot({ path: process.env.SP + '/s13.png' });
await browser.close();
