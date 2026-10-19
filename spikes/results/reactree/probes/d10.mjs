import { open, sleep } from './lib.mjs';
const S = process.env.S;
const { browser, page, errs } = await open();
const log = (k, v) => console.log(k.padEnd(26), typeof v === 'string' ? v : JSON.stringify(v));
try {
  const r = await page.evaluate(async () => {
    const el = document.querySelector('.main'); const size = { width: el.clientWidth, height: el.clientHeight };
    const m = await window.__spike.mount({ treeId: 'x', newick: '((A1:1,A10:1):1,(B:1,C:1):1);', layout: 'rectangular', branchLengths: true, size });
    await window.__spike.setColumns([{ id: 'aln', kind: 'alignment', header: 'x', values: { A10: 'AAAAAAAAAA', B: 'TTTTTTTTTT', C: 'GGGGGGGGGG' }, width: 100 }]);
    await new Promise((r) => setTimeout(r, 600));
    const cv = document.querySelector('canvas.Reactree_alnCanvas'); const cr = cv.getBoundingClientRect(); const ctx = cv.getContext('2d');
    const out = {};
    for (const id of ['A1', 'A10', 'B', 'C']) { const p = await window.__spike.locate({ kind: 'tip', id }); const y = Math.round(p.y - cr.top); const d = ctx.getImageData(20, y, 1, 1).data; out[id] = [d[0], d[1], d[2]].join(','); }
    return { m: m.tips, out, dpr: devicePixelRatio, cvSize: [cv.width, cv.height, cr.height] };
  });
  log('fuzzy FASTA match', r);
  // heap over mount/unmount cycles
  const heap = [];
  for (let i = 0; i < 8; i++) {
    await page.evaluate(async () => { const el = document.querySelector('.main'); const size = { width: el.clientWidth, height: el.clientHeight }; const t = await window.__spikeData.loadTree('syn-yule-1000'); await window.__spike.mount({ treeId: 'syn-yule-1000', newick: t.newick, layout: 'rectangular', branchLengths: true, size }); await new Promise((r) => setTimeout(r, 300)); await window.__spike.unmount(); });
    heap.push(await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 200)); gc(); gc(); return Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10; }));
  }
  log('heap MB per cycle', heap);
  log('dom after', await page.evaluate(() => document.querySelectorAll('*').length));
  log('leftover portals', await page.evaluate(() => document.body.querySelectorAll(':scope > [class*=Reactree_]').length));
  log('data-theme left', await page.evaluate(() => document.documentElement.getAttribute('data-theme')));
  log('errors', errs);
} catch (e) { console.log('ERR', e); }
await browser.close();
