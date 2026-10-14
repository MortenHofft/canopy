// Feature checks behind the claims in docs/results/phylocanvas-gl.md that the runner does not cover.
// Usage: node scripts/feature-checks.mjs http://127.0.0.1:5204/ out.json     (production build served by `vite preview --port 5204`)
// Library options are set through the demo's `?pc.<id>=<value>` URL overrides (adapter.tsx).
import fs from 'node:fs';
import { chromium } from '../../node_modules/playwright-core/index.mjs';

const [base, outFile] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-gpu-rasterization', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const results = {};

async function open(query) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route((u) => u.hostname !== '127.0.0.1' && u.hostname !== 'localhost', (r) => r.abort());
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', (m) => /context|webgl/i.test(m.text()) && !/ERR_FAILED/.test(m.text()) && msgs.push(m.text().slice(0, 160)));
  page.on('pageerror', (e) => msgs.push('pageerror ' + e.message.slice(0, 160)));
  await page.goto(base + query);
  await page.waitForFunction(() => !!window.__spike && !!window.__spikeData, null, { timeout: 30000 });
  return { ctx, page, msgs };
}
const mount = (page, id, size = { width: 960, height: 600 }) =>
  page.evaluate(async ([id, size]) => {
    const t = await window.__spikeData.loadTree(id);
    return window.__spike.mount({ treeId: id, newick: t.newick, layout: 'rectangular', branchLengths: true, size });
  }, [id, size]);

// 1. locate() and own hit-test agree for every node and tip, in all five library layouts (fit view, 200 tips)
results.layouts = {};
for (const type of ['rc', 'cr', 'rd', 'dg', 'hr']) {
  const { ctx, page } = await open(`?pc.treeType=${type}`);
  await mount(page, 'syn-yule-200');
  await page.waitForTimeout(1000);
  results.layouts[type] = await page.evaluate(async () => {
    const lib = window.__phylocanvas[0];
    const hit = window.__phylocanvasHit[0];
    const pre = lib.getGraphAfterLayout().preorderTraversal;
    const rect = document.querySelector('[data-testid=tree-container]').getBoundingClientRect();
    const o = { type: lib.getTreeType(), internal: 0, internalOk: 0, tips: 0, tipsOk: 0 };
    for (let k = 1; k < pre.length; k++) {
      const n = pre[k];
      const pt = await window.__spike.locate({ kind: n.isLeaf ? 'tip' : 'node', id: n.isLeaf ? n.id : 'n' + k });
      o[n.isLeaf ? 'tips' : 'internal']++;
      const h = pt && hit(pt.x - rect.left, pt.y - rect.top);
      if (h && h.node.preIndex === k) o[n.isLeaf ? 'tipsOk' : 'internalOk']++;
    }
    return o;
  });
  await ctx.close();
}

// 2. re-root view at the clicked clade, and click on a collapsed clade
{
  const { ctx, page } = await open('?pc.rootAtClicked=1');
  await mount(page, 'syn-yule-200');
  await page.waitForTimeout(1000);
  const node = await page.evaluate(() => {
    const pre = window.__phylocanvas[0].getGraphAfterLayout().preorderTraversal;
    let best = null;
    for (const n of pre) if (!n.isLeaf && n.preIndex > 0 && (!best || Math.abs(n.totalLeaves - 40) < Math.abs(best.totalLeaves - 40))) best = n;
    return { k: best.preIndex, tips: best.totalLeaves };
  });
  const pt = await page.evaluate((k) => window.__spike.locate({ kind: 'node', id: 'n' + k }), node.k);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(1500);
  results.rootAtClicked = { clicked: node, after: await page.evaluate(() => { const l = window.__phylocanvas[0]; return { rootId: l.props.rootId, visibleLeaves: l.getGraphAfterLayout().leaves.length }; }) };
  await ctx.close();
}
{
  const { ctx, page } = await open('?pc.collapse=20');
  await mount(page, 'syn-yule-200');
  await page.waitForTimeout(1000);
  const node = await page.evaluate(() => { const n = window.__phylocanvas[0].getGraphAfterLayout().preorderTraversal.find((x) => x.isCollapsed); return { k: n.preIndex, tips: n.totalLeaves }; });
  const pt = await page.evaluate((k) => window.__spike.locate({ kind: 'node', id: 'n' + k }), node.k);
  await page.evaluate(() => window.__spike.clearEvents());
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(1200);
  results.collapsedClick = { clade: node, events: (await page.evaluate(() => window.__spike.getEvents())).map((e) => [e.type, e.nodeId, e.tipIds.length, e.source]), collapsedClades: await page.evaluate(() => window.__phylocanvas[0].props.collapsedIds.length) };
  await ctx.close();
}

// 3. the library's own Newick parser on a quoted label with delimiters, versus the biojs object
for (const native of [0, 1]) {
  const { ctx, page } = await open(`?pc.nativeParser=${native}`);
  const nw = "((Cyanistes_caeruleus:1,Parus_major:1):1,('Poecile atricapillus (L.)':1.5,Ménétries_ñandú:1):0.5,(日本語_ラベル:1,Ünïcödé_Œuvre:2):1,'a,b(c)':1);";
  const r = await page.evaluate(async (nw) => window.__spike.mount({ treeId: 'x', newick: nw, layout: 'rectangular', branchLengths: true, size: { width: 760, height: 400 } }), nw);
  (results.parser ??= {})[native ? 'libraryNewick' : 'biojsObject'] = { expectedTips: 7, libraryTips: r.tips, notes: r.notes.match(/id mapping[^;]*/)?.[0] };
  await ctx.close();
}

// 4. mount/unmount cycles with and without the explicit context release; state of the GL context after destroy()
for (const release of [1, 0]) {
  const { ctx, page, msgs } = await open(`?pc.forceContextLoss=${release}`);
  const heap = [];
  for (let i = 0; i < 24; i++) {
    await mount(page, 'syn-yule-200', { width: 500, height: 400 });
    if (i === 0) await page.evaluate(() => { window.__gl = window.__phylocanvas[0].deck.animationLoop.gl; });
    await page.evaluate(() => window.__spike.unmount());
    if (i === 0) results[`contextLostAfterFirstUnmount_release${release}`] = await page.evaluate(() => window.__gl.isContextLost());
    if (i % 6 === 5) heap.push(await page.evaluate(() => { gc(); return Math.round(performance.memory.usedJSHeapSize / 1e5) / 10; }));
  }
  (results.cycles ??= {})[`release${release}`] = { cycles: 24, heapMB: heap, canvasesLeft: await page.evaluate(() => document.querySelectorAll('canvas').length), contextMessages: [...new Set(msgs)] };
  await ctx.close();
}

await browser.close();
fs.writeFileSync(outFile, JSON.stringify({ date: new Date().toISOString(), results }, null, 1));
console.log(JSON.stringify(results));
