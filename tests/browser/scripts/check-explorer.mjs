// Browser check of the explorer (examples/explorer; start it with `npm run dev` there, which serves on port 5309).
//   node tests/browser/scripts/check-explorer.mjs [--port 5309] [--url <page URL, default http://127.0.0.1:<port>/>]
// Every toolbar control is driven as a user would (clicks, the keyboard, the sliders) and its effect read back from the viewer
// (window.__explorer() returns the TreeViewer): Width / Height zoom the window, font and branch width reach the theme, layout and
// tree type the options, truncation the label format; search counts, highlights and steps; a tip click opens the inspector, a clade
// click collapses it and a click on the triangle expands it; colour, erase and the innermost-colour-wins order; reroot, flip, swap
// (siblings and not), midpoint, ladderise and undo (button and Ctrl+Z); export (PNG, Newick and NEXUS downloads); the transparent
// background leaves no trace of earlier frames; the innermost clade colour wins whatever the order;
// node labels (support, length); aligned labels (one x for the label anchors, a click on one opens the inspector); the alignment track and its legend; dark mode reaches the canvas; the resize handle.
/* global __v, __order, __tipAt, __clade, __inView -- helpers the page gets from HELPERS below, used inside page.evaluate */
import { createRequire } from 'node:module';
import { chromiumPath } from './chromium.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { PNG } = require('pngjs');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const port = Number(args.port || 5309);
const url = args.url || `http://127.0.0.1:${port}/`;
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
page.setDefaultTimeout(8000);
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  failures++;
});

// in-page helpers: the viewer, the tip order, where to click a tip or the first visible clade of a size
const HELPERS = () => {
  const v = () => window.__explorer();
  window.__v = v;
  window.__order = () => v().getTree().tipLabels.join(',');
  window.__tipAt = (label) => {
    const t = v().getTree();
    const r = t.tipLabels.indexOf(label);
    return r < 0 ? null : v().locateNode(t.tipNode[r]);
  };
  window.__clade = (lo, hi, skip = 0) => {
    const t = v().getTree();
    for (let i = 1; i < t.nodeCount; i++) {
      const c = t.leafEnd[i] - t.leafStart[i];
      if (v().layout.collapsed?.[i]) continue; // a collapsed clade is not a clade to collapse
      if (t.firstChild[i] >= 0 && c >= lo && c <= hi && skip-- <= 0) {
        const q = v().locateNode(i);
        if (q) return { node: i, tips: c, x: q.x, y: q.y };
      }
    }
    return null;
  };
};
const open = async (tree, extra = '') => {
  await page.goto(`${url}?tree=${tree}${extra}`);
  await page.waitForSelector('.ex-outer canvas', { timeout: 60000 });
  await page.waitForFunction(() => typeof window.__explorer === 'function' && window.__explorer() !== null);
  await page.evaluate(HELPERS);
  await page.waitForTimeout(400);
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const click = async (p) => {
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
};
const btn = (text) => page.locator('.ex-outer button', { hasText: text }).first();
const toast = async () => ((await page.locator('.ex-toast').count()) ? page.locator('.ex-toast').innerText() : '');

// ---------------------------------------------------------------- Carangaria (135 tips, dated)
// the axis label is canvas text: remember the last axis title drawn
await page.addInitScript(() => {
  const ft = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    if (/^(time before tips|distance from root)/.test(String(text))) window.__axis = String(text);
    // node labels are the only text drawn with the 'bottom' baseline in the rectangular layout (the radial scale bar has it too)
    if (this.textBaseline === 'bottom') (window.__nodeTexts ??= []).push(String(text));
    return ft.call(this, text, ...rest);
  };
});

console.log('Carangaria MCC: view settings');
await open('rich-fish-carangaria-135');
ok((await page.locator('.ex-row').count()) === 2, 'two toolbar rows');
const span = () =>
  ev(() => {
    const p = __v().getViewport();
    return { w: p.x1 - p.x0, h: p.y1 - p.y0 };
  });
const fit = await span();
await page.locator('input[aria-label=Width]').fill('2');
await page.locator('input[aria-label=Height]').fill('2');
await page.waitForTimeout(150);
const z = await span();
ok(
  Math.abs(z.w / fit.w - 0.5) < 0.02 && Math.abs(z.h / fit.h - 0.5) < 0.02,
  `Width / Height 2× halve the window (${(z.w / fit.w).toFixed(3)}, ${(z.h / fit.h).toFixed(3)})`,
);
await page.locator('.ex-slider-val').nth(0).click();
await page.locator('.ex-slider-val').nth(1).click();
await page.waitForTimeout(150);
const back = await span();
ok(Math.abs(back.w - fit.w) < 1e-6 && Math.abs(back.h - fit.h) < 1e-6, 'clicking the values resets to the fitted window');
await page.locator('input[aria-label="Font size"]').fill('2');
await page.locator('input[aria-label="Branch width"]').fill('3');
await page.waitForTimeout(150);
const th = await ev(() => __v().getTheme());
ok(th.labelSize === 23 && th.branchWidth === 3, `font and branch width reach the theme (${th.labelSize}, ${th.branchWidth})`);
await page.locator('button[title=Circular]').click();
await page.waitForTimeout(150);
ok((await ev(() => __v().options.layout)) === 'radial', 'Circular: radial layout');
ok(
  (await page.locator('input[aria-label=Height]').count()) === 0 && (await page.locator('.ex-slider-label', { hasText: 'Size' }).count()) === 1,
  'radial: Size slider, no Height',
);
await page.locator('button[title=Rectangular]').click();
await page.locator('button[title^=Cladogram]').click();
await page.waitForTimeout(150);
ok((await ev(() => __v().options.layout)) === 'rectangular' && (await ev(() => __v().options.branchLengths)) === false, 'Rectangular, Cladogram');
await page.locator('button[title^=Phylogram]').click();
const longest = await ev(() =>
  __v()
    .getTree()
    .tipLabels.reduce((a, b) => (b.length > a.length ? b : a)),
);
ok((await ev((l) => __v().options.formatLabel(l), longest)).endsWith('…'), 'Truncate (on by default) shortens long names');
await btn('Truncate').click();
ok((await ev((l) => __v().options.formatLabel(l), longest)) === longest.replace(/_/g, ' '), 'Full names: the whole name');

console.log('transparent background');
ok((await ev(() => __v().getTheme().background)) === 'transparent', 'the canvas background is transparent (the dotted grid shows)');
// painted pixels after fitting, after zooming in and panning, and after fitting again: with frames drawn over each other the count grows
const painted = () =>
  ev(() => {
    __v().renderNow();
    const c = __v().treeElement.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n / (c.width * c.height); // the painted share of the canvas
  });
await page.locator('.ex-btn[title="Fit tree"]').click();
await page.waitForTimeout(200);
const p0 = await painted();
const box = await page.locator('.phylo-tree').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 100, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.locator('.ex-btn[title="Fit tree"]').click();
await page.waitForTimeout(300);
const p1 = await painted();
ok(p0 > 0 && p0 < 0.5, `the canvas is see-through where nothing is drawn (${(p0 * 100).toFixed(1)}% painted)`);
ok(Math.abs(p1 - p0) < 0.002, `no trace of earlier frames (${(p0 * 100).toFixed(2)}% painted before zoom and pan, ${(p1 * 100).toFixed(2)}% after)`);
// switching to an opaque background and back at run time (the viewer changes canvas)
// setTheme replaces the page's overrides (font, branch width): pass the theme in force, only the background changed
const themeNow = await ev(() => __v().getTheme());
await ev((t) => __v().setTheme({ ...t, background: '#ffffff' }), themeNow);
const pOpaque = await painted();
await ev((t) => __v().setTheme(t), themeNow);
const pBack = await painted();
ok(
  pOpaque === 1 && Math.abs(pBack - p0) < 0.002,
  `opaque background at run time, then transparent again (${(pOpaque * 100).toFixed(1)}%, ${(pBack * 100).toFixed(2)}%)`,
);
// the renderer outlives edits now, so the theme set by hand above would stay: give the page's own overrides back (the font size slider
// sets them again)
await page.locator('input[aria-label="Font size"]').fill('1.5');
await page.locator('input[aria-label="Font size"]').fill('2');
await page.waitForTimeout(150);

console.log('search');
// how much the main canvas differs from its background colour: dimming what does not match removes most of it
const ink = () =>
  ev(() => {
    const c = __v().treeElement.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 4; i < d.length; i += 4) n += Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]);
    return n;
  });
const inkBefore = await ink();
await page.locator('button[aria-label="Search taxa"]').click();
await page.keyboard.type('bothus');
await page.waitForTimeout(200);
ok((await ev(() => __v().options.highlightStyle)) === 'dim', 'search uses the dim highlight style');
const inkDim = await ink();
ok(inkDim < inkBefore * 0.6, `the tips that do not match are dimmed (canvas ink ${inkBefore} → ${inkDim})`);
ok((await page.locator('.ex-search-count').innerText()) === '1 / 2', 'two matches, the first current');
ok((await ev(() => __v().getHighlighted().length)) === 2, 'matches highlighted');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
ok((await page.locator('.ex-search-count').innerText()) === '2 / 2', 'Enter: next match');
const cur = await ev(() => __v().getHighlighted()[1]);
const vp = await ev(() => __v().getViewport());
const rank = await ev((l) => __v().getTree().tipLabels.indexOf(l), cur);
ok(rank >= vp.y0 && rank <= vp.y1, 'the current match is in view');
await page.keyboard.press('Escape');
ok(
  (await page.locator('.ex-search').count()) === 0 && (await ev(() => __v().getHighlighted().length)) === 0,
  'Escape closes the search and clears the highlight',
);
await page.locator('.ex-btn[title="Fit tree"]').click();
await page.waitForTimeout(300);
ok(Math.abs((await ink()) - inkBefore) < inkBefore * 0.05, 'and the tree is back at full strength after the search');

console.log('inspector, collapse, expand');
const tip0 = await ev(() => __v().getTree().tipLabels[3]);
await page.locator('input[aria-label=Height]').fill('4');
await page.waitForTimeout(200);
await page.locator('.ex-btn[title="Fit tree"]').click();
await page.locator('.ex-slider-val').nth(1).click();
await page.waitForTimeout(200);
await click(await ev((l) => __tipAt(l), tip0));
ok(
  (await page.locator('.ex-info-name').count()) === 1 && (await page.locator('.ex-info-name').innerText()) === tip0.replace(/_/g, ' '),
  'a tip click opens the inspector',
);
ok((await page.locator('.ex-info-rows dt', { hasText: 'Root distance' }).count()) === 1, 'inspector: root distance');
await page.locator('.ex-info-head button').click();
// collapsing is the viewer's: the tree is the same object with the same tips, and the collapsed clade is one row
const rows = () => ev(() => __v().layout.rows);
const before = await rows();
const tips = await ev(() => __v().getTree().tipCount);
const c1 = await ev(() => __clade(4, 10));
await click(c1);
await page.waitForTimeout(200);
const after = await rows();
ok(after === before - c1.tips + 1, `a clade click collapses it (${before} → ${after} rows)`);
ok((await ev(() => __v().getTree().tipCount)) === tips, 'and the tree still has all its tips');
ok((await btn('Expand all').count()) === 1 && (await page.locator('.ex-expand .ex-count').innerText()) === '1', 'Expand all appears with the count');
const tri = await ev((n) => {
  const b = __v().nodeBounds(n);
  return b ? { x: b.x + b.width * 0.8, y: b.y + b.height / 2 } : null;
}, c1.node);
ok(tri !== null, 'the collapsed clade is one triangle with the id of the clade');
await click(tri);
await page.waitForTimeout(200);
ok((await rows()) === before && (await btn('Expand all').count()) === 0, 'a click on the triangle expands it');
await click(await ev(() => __clade(4, 10)));
await click(await ev(() => __clade(4, 10, 3)));
await click(await ev(() => __clade(2, 2)));
await click(await ev(() => __clade(2, 2, 2)));
const labs = await ev(() => __v().getTree().tipLabels);
ok(new Set(labs).size === labs.length && labs.length === tips, 'four collapsed clades: no tip label is made up, tip labels are still unique');
ok((await rows()) < before - 4, `four collapsed clades are four rows (${await rows()} of ${before})`);
await btn('Expand all').click();
await page.waitForTimeout(150);
ok((await rows()) === before, 'Expand all');

// the tree is dated and the triangle ends at the clade's tips, so the axis keeps its title ("time before tips", the viewer reads the
// tree as it is; collapsing a copy with tree-ops collapseClades flipped it to "distance from root" without { extend }, issue #19)
{
  const axis = () => ev(() => window.__axis);
  ok(/^time before tips/.test(await axis()), `dated tree: axis "${await axis()}"`);
  await ev(() => (window.__axis = null)); // a stale title must not pass
  // zoomed in on y: collapsing keeps the window's scale (it used to re-create the viewer and fit again)
  await page.locator('input[aria-label=Height]').fill('3');
  await page.waitForTimeout(150);
  const z0 = await span();
  await click(await ev(() => __clade(4, 10)));
  await page.waitForTimeout(200);
  ok((await rows()) < before, 'a clade is collapsed');
  const z1 = await span();
  ok(
    Math.abs(z1.h - z0.h) < 1e-9 && Math.abs(z1.w - z0.w) < 1e-9,
    `collapsing does not reset the zoom (${z0.h.toFixed(1)} rows in view before, ${z1.h.toFixed(1)} after)`,
  );
  ok(/^time before tips/.test(await axis()), `after a collapse the axis stays: "${await axis()}"`);
  await btn('Expand all').click();
  await page.locator('.ex-slider-val').nth(1).click();
  await page.waitForTimeout(150);
}

console.log('colour');
await btn('Color').click();
ok((await page.locator('.ex-palette .ex-swatch').count()) === 12, 'palette with 12 swatches');
await page.locator('button[aria-label=Pink]').click();
const big = await ev(() => __clade(20, 40));
await click(big);
await page.locator('button[aria-label=Teal]').click();
const small = await ev(
  ({ lo, hi }) => {
    const t = __v().getTree();
    for (let i = lo + 1; i < hi; i++) {
      const c = t.leafEnd[i] - t.leafStart[i];
      if (t.firstChild[i] >= 0 && c >= 3) {
        const q = __v().locateNode(i);
        if (q) return { node: i, x: q.x, y: q.y };
      }
    }
    return null;
  },
  { lo: big.node, hi: await ev((n) => __v().getTree().subtreeEnd[n], big.node) },
);
await click(small);
let cl = await ev(() => __v().getClades());
ok(cl.length === 2 && cl[0].node === big.node && cl[1].node === small.node, 'two nested clades coloured');
// which colour the canvas shows just right of the inner clade's node (its branches): pixels near teal versus near pink
const inner = () =>
  ev((p) => {
    const c = __v().treeElement.querySelector('canvas');
    const b = c.getBoundingClientRect();
    const k = c.width / b.width;
    const d = c
      .getContext('2d')
      .getImageData(Math.round((p.x - b.left) * k), Math.round((p.y - b.top - 6) * k), Math.round(10 * k), Math.round(12 * k)).data;
    const near = (i, [r, g, bb]) => Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - bb) < 90 && d[i + 3] > 200;
    let teal = 0;
    let pink = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (near(i, [20, 184, 166])) teal++;
      if (near(i, [236, 72, 153])) pink++;
    }
    return { teal, pink };
  }, small);
let px = await inner();
ok(px.teal > 0 && px.teal > px.pink, `the inner colour shows (teal ${px.teal}, pink ${px.pink})`);
await page.locator('.ex-erase').click();
await click(small);
cl = await ev(() => __v().getClades());
ok(cl.length === 1 && cl[0].node === big.node, 'Erase removes a clade colour');
// the other order: outer clade painted after the inner one, and still the innermost wins (the viewer, not the order)
await click(big);
await page.locator('button[aria-label=Teal]').click();
await click(small);
await page.locator('button[aria-label=Pink]').click();
await click(big);
cl = await ev(() => __v().getClades());
ok(cl.length === 2 && cl[0].node === small.node && cl[1].node === big.node, 'inner clade first, outer last');
px = await inner();
ok(px.teal > 0 && px.teal > px.pink, `the innermost colour still wins (teal ${px.teal}, pink ${px.pink})`);
await page.locator('.ex-erase').click();
await click(small);
await page.locator('.ex-outer').press('Escape');
ok((await page.locator('.ex-palette').count()) === 0, 'Escape leaves colour mode');
ok((await page.locator('.ex-color .ex-count').innerText()) === '1', 'Color shows the count');

console.log('tree operations');
// the earlier steps moved the view and an edit keeps it now: start from the whole tree
await page.locator('.ex-btn[title="Fit tree"]').click();
await page.waitForTimeout(200);
const o0 = await ev(() => __order());
await btn('Reroot').click();
const rt = await ev(() => __v().getTree().tipLabels[5]);
await click(await ev((l) => __tipAt(l), rt));
await page.waitForTimeout(200);
ok((await ev(() => __order())) !== o0 && (await btn('Undo').count()) === 1, 'reroot on a tip changes the tree, Undo appears');
await page.locator('.ex-outer').press('Escape');
await btn('Undo').click();
await page.waitForTimeout(200);
ok((await ev(() => __order())) === o0 && (await btn('Undo').count()) === 0, 'Undo restores the tree');
ok((await ev(() => __v().getClades().length)) === 1, 'and the colour');
await btn('Flip').click();
const f = await ev(() => __clade(2, 6));
await click(f);
await page.waitForTimeout(200);
const o1 = await ev(() => __order());
ok(o1 !== o0, 'Flip reverses a clade');
await page.keyboard.press('Escape');
await page.locator('.phylo-tree').focus();
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
ok((await ev(() => __order())) === o0, 'Ctrl+Z undoes');
// a new tree keeps the renderer and the view: zoom into a clade, Flip a clade inside it, and the same tips are in view; Undo returns to the same view
console.log('a new tree keeps the view');
const zoomed = await ev(() => {
  const t = __v().getTree();
  let big = null;
  for (let i = 1; i < t.nodeCount; i++) {
    const c = t.leafEnd[i] - t.leafStart[i];
    if (t.firstChild[i] >= 0 && c >= 30 && c <= 60) {
      big = i;
      break;
    }
  }
  window.__viewer = __v();
  window.__inView = () => {
    const t = __v().getTree();
    const w = __v().getViewport();
    return t.tipLabels
      .filter((_, r) => r + 0.5 >= w.y0 && r + 0.5 <= w.y1)
      .sort()
      .join(',');
  };
  __v().zoomToNode(big, false);
  return big !== null;
});
await page.waitForTimeout(300);
ok(zoomed, 'zoomed into a clade of 30 to 60 tips');
const vw0 = await ev(() => __v().getViewport());
const seen0 = await ev(() => __inView());
ok(
  vw0.y1 - vw0.y0 < 100 && seen0.split(',').length >= 30,
  `the view is a part of the tree (${vw0.y0.toFixed(1)} to ${vw0.y1.toFixed(1)}, ${seen0.split(',').length} tips)`,
);
const orderZ = await ev(() => __order());
await btn('Flip').click();
await click(await ev(() => __clade(4, 12)));
await page.waitForTimeout(300);
ok((await ev(() => __order())) !== orderZ, 'Flip reversed a clade inside the view');
ok(await ev(() => __v() === window.__viewer && !__v().isDestroyed()), 'the edit went to the same renderer (no new one)');
ok((await ev(() => __inView())) === seen0, 'the same tips are still in view after the Flip');
const vw1 = await ev(() => __v().getViewport());
ok(Math.abs(vw1.y1 - vw1.y0 - (vw0.y1 - vw0.y0)) < 1e-6, 'at the same scale');
await page.keyboard.press('Escape');
await btn('Undo').click();
await page.waitForTimeout(300);
const vw2 = await ev(() => __v().getViewport());
ok(
  (await ev(() => __order())) === orderZ && ['x0', 'x1', 'y0', 'y1'].every((k) => Math.abs(vw2[k] - vw0[k]) < 1e-6),
  'Undo returns the tree and the same view',
);
ok(await ev(() => __v() === window.__viewer), 'and still the same renderer');
await page.locator('.ex-btn[title="Fit tree"]').click();
await page.waitForTimeout(200);
// swap: the two children of a binary node, then two tips that are not siblings
const pair = await ev(() => {
  const t = __v().getTree();
  for (let i = 1; i < t.nodeCount; i++)
    if (t.childCount[i] === 2) {
      const a = t.firstChild[i];
      const b = t.nextSibling[a];
      const qa = __v().locateNode(a);
      const qb = __v().locateNode(b);
      if (qa && qb) return [qa, qb];
    }
  return null;
});
await btn('Swap').click();
await click(pair[0]);
ok((await page.locator('.ex-steps .done').count()) === 1, 'Swap: step 1 done');
await click(pair[1]);
await page.waitForTimeout(200);
ok((await ev(() => __order())) !== o0, 'Swap of two siblings');
const tl = await ev(() => __v().getTree().tipLabels);
await click(await ev((l) => __tipAt(l), tl[0]));
await click(await ev((l) => __tipAt(l), tl[tl.length - 1]));
ok((await toast()).includes('sibling'), 'Swap of non-siblings is refused with a message');
await page.keyboard.press('Escape');
await btn('Midpoint').click();
ok((await toast()).includes('nothing to change'), 'Midpoint on a dated tree: nothing to change');
const o2 = await ev(() => __order());
await page.locator('button[title^="Ladderize descending"]').click();
await page.waitForTimeout(150);
const o3 = await ev(() => __order());
await page.locator('button[title^="Ladderize ascending"]').click();
await page.waitForTimeout(150);
ok(o3 !== o2 && (await ev(() => __order())) !== o3, 'Ladderize both ways');

console.log('export');
await btn('Export').click();
ok((await page.locator('.ex-menu button').allInnerTexts()).map((s) => s.split('\n')[0]).join(',') === 'PNG,Newick,NEXUS', 'menu: PNG, Newick, NEXUS');
let dl = page.waitForEvent('download');
await page.locator('.ex-menu button', { hasText: 'PNG' }).click();
let d = await dl;
const png = await (await d.createReadStream()).toArray();
ok(d.suggestedFilename() === 'phylotree.png' && Buffer.concat(png).subarray(1, 4).toString() === 'PNG', 'PNG download');
const img = PNG.sync.read(Buffer.concat(png));
ok(img.data[3] === 255, 'the PNG is opaque (the pane colour under the transparent canvas)');
const cssSize = await ev(() => ({ w: __v().size.width, h: __v().size.height, dpr: Math.min(window.devicePixelRatio, __v().options.dprCap) }));
ok(
  img.width === Math.round(cssSize.w * cssSize.dpr) && img.height === Math.round(cssSize.h * cssSize.dpr),
  `the PNG is the view's size at the canvas scale (${img.width} x ${img.height})`,
);
const screenVsBlob = () =>
  ev(async () => {
    // the export equals the screen: the visible canvas (transparent background) against toBlob at the canvas scale, pixel by pixel
    const v = __v();
    v.renderNow();
    const screen = v.treeElement.querySelector('canvas');
    const bm = await createImageBitmap(await v.toBlob({ background: null }));
    const read = (src) => {
      const c = document.createElement('canvas');
      c.width = screen.width;
      c.height = screen.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(src, 0, 0);
      return x.getImageData(0, 0, c.width, c.height).data;
    };
    const A = read(screen),
      B = read(bm);
    let diff = 0,
      painted = 0;
    for (let i = 0; i < A.length; i += 4) {
      if (A[i + 3] > 0) painted++;
      if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) + Math.abs(A[i + 3] - B[i + 3]) > 2) diff++;
    }
    return { w: bm.width === screen.width && bm.height === screen.height, diff, painted };
  });
const same = await screenVsBlob();
ok(
  same.w && same.painted > 500 && same.diff === 0,
  `toBlob at the canvas scale equals the screen (${same.painted} painted pixels, ${same.diff} differ)`,
);
const exp2 = await ev(async () => {
  const b = await __v().toBlob({ scale: 2, background: null });
  const bm = await createImageBitmap(b);
  const c = document.createElement('canvas');
  c.width = bm.width;
  c.height = bm.height;
  const x = c.getContext('2d');
  x.drawImage(bm, 0, 0);
  const d = x.getImageData(0, 0, 1, 1).data;
  return { type: b.type, w: bm.width, h: bm.height, corner: d[3], W: __v().size.width, H: __v().size.height };
});
ok(exp2.type === 'image/png' && exp2.w === exp2.W * 2 && exp2.h === exp2.H * 2, `toBlob({ scale: 2 }) is twice the CSS size (${exp2.w} x ${exp2.h})`);
ok(exp2.corner === 0, 'toBlob({ background: null }) is transparent');
ok(
  await ev(() => {
    const el = document.querySelector('.phylo-tooltip');
    const cs = getComputedStyle(el);
    return el.classList.contains('phylo-tooltip--bare') && cs.paddingTop === '0px' && cs.boxShadow === 'none' && cs.borderTopStyle === 'none';
  }),
  'the tooltip box is bare (tooltipBare): no padding, border or shadow, and no CSS override in the example',
);
await btn('Export').click();
dl = page.waitForEvent('download');
await page.locator('.ex-menu button', { hasText: 'Newick' }).click();
d = await dl;
const nwk = Buffer.concat(await (await d.createReadStream()).toArray()).toString();
ok(nwk.startsWith('(') && nwk.trim().endsWith(';') && nwk.includes(tl[0]), 'Newick download of the current tree');
await btn('Export').click();
dl = page.waitForEvent('download');
await page.locator('.ex-menu button', { hasText: 'NEXUS' }).click();
d = await dl;
const nex = Buffer.concat(await (await d.createReadStream()).toArray()).toString();
ok(
  d.suggestedFilename() === 'phylotree.nex' && nex.startsWith('#NEXUS') && nex.includes('TRANSLATE') && nex.includes(`NTAX=${tl.length};`),
  'NEXUS download: taxa block, translate table and tree',
);

console.log('dark mode, resize');
const fg = await ev(() => __v().getTheme().branch);
await page.locator('.theme-toggle').click();
await page.waitForTimeout(200);
const fg2 = await ev(() => __v().getTheme().branch);
ok(fg2 !== fg, `dark mode reaches the canvas (branches ${fg} → ${fg2})`);
const h0 = (await page.locator('.ex-pane').boundingBox()).height;
const g = await page.locator('.ex-resize').boundingBox();
await page.mouse.move(g.x + g.width / 2, g.y + 7);
await page.mouse.down();
await page.mouse.move(g.x + g.width / 2, g.y + 107, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
ok(Math.abs((await page.locator('.ex-pane').boundingBox()).height - h0 - 100) < 2, 'the resize handle makes the pane taller');
ok(Math.abs((await ev(() => __v().size.height)) - h0 - 100) < 2, 'and the viewer follows');

// ---------------------------------------------------------------- support values, node labels
// the viewer draws them on the canvas (the `nodeLabels` option): read the node label texts of a fresh frame off fillText
console.log('node labels');
const drawn = async () => {
  await ev(() => {
    window.__nodeTexts = [];
    __v().invalidate();
    __v().renderNow();
  });
  return ev(() => window.__nodeTexts);
};
await open('edge-internal-support');
await btn('No labels').click();
await page.waitForTimeout(200);
ok((await ev(() => __v().options.nodeLabels)) === 'support', "Bootstrap sets nodeLabels to 'support' (no control of our own any more)");
let labels = await drawn();
ok(labels.includes('100') && labels.includes('0.95'), `Bootstrap: support values drawn (${labels.join(' ')})`);
ok(labels.length === 2, 'only the two numeric support values; node_EF and the root get none');
await btn('Bootstrap').click();
await page.waitForTimeout(200);
ok((await ev(() => __v().options.nodeLabels)) === 'length', 'Length sets nodeLabels to length');
labels = await drawn();
ok(labels.includes('0.3') && labels.includes('0.4') && labels.includes('0.1'), `Length: branch lengths drawn (${labels.join(' ')})`);
await btn('Length').click();
await page.waitForTimeout(200);
ok((await drawn()).length === 0 && (await ev(() => __v().options.nodeLabels)) === 'none', 'No labels');
// lengths on the HCV tree: every label is the length of an internal node
await open('rich-hcv-19');
for (let k = 0; k < 3 && (await ev(() => __v().options.nodeLabels)) !== 'length'; k++) {
  await page.locator('.ex-labels').click(); // None, (Bootstrap if the tree has support), Length
  await page.waitForTimeout(150);
}
labels = await drawn();
const hcvLengths = await ev(() => {
  const t = __v().getTree();
  const out = [];
  for (let i = 1; i < t.nodeCount; i++) if (t.firstChild[i] >= 0 && !Number.isNaN(t.length[i])) out.push(String(Number(t.length[i].toPrecision(3))));
  return out;
});
ok(
  labels.length > 0 && labels.every((l) => hcvLengths.includes(l)),
  `HCV: ${labels.length} branch lengths drawn, each the length of an internal node (${labels.slice(0, 6).join(' ')} ...)`,
);
// hcvZoomed in on x the short branches get room for their text, so more labels are drawn
await ev(() => {
  const v = __v();
  v.setViewport({ ...v.getViewport(), x1: 0.12 });
});
await page.waitForTimeout(300);
const hcvZoomed = await drawn();
ok(
  hcvZoomed.length > labels.length && hcvZoomed.every((l) => hcvLengths.includes(l)),
  `HCV zoomed in: ${hcvZoomed.length} labels (${labels.length} before)`,
);
// the export includes the node labels: toBlob equals the screen, labels and all (the same check as above, with labels on)
const sameLabelled = await screenVsBlob();
ok(
  hcvZoomed.length > 0 && sameLabelled.w && sameLabelled.painted > 500 && sameLabelled.diff === 0,
  `node labels on: toBlob equals the screen (${hcvZoomed.length} labels, ${sameLabelled.painted} painted pixels, ${sameLabelled.diff} differ)`,
);
// posterior on the BEAST MCC tree: the labels hold no support, the posterior is in [&posterior=...] (io annotations, supportFrom)
await open('rich-fish-carangaria-135');
ok((await drawn()).length === 0, 'Carangaria: no node labels by default');
await page.locator('.ex-labels').click();
await page.waitForTimeout(150);
ok((await page.locator('.ex-labels').innerText()).includes('Bootstrap'), 'the button offers Bootstrap on a tree whose support is an annotation');
// 135 tips in one view are under the density threshold: show the top of the tree
await ev(() => {
  const v = __v();
  const vp = v.getViewport();
  v.setViewport({ ...vp, y0: 0, y1: 18 });
});
await page.waitForTimeout(300);
labels = await drawn();
const nums = labels.map(Number);
ok(nums.length > 3 && nums.every((x) => x >= 0 && x <= 1), `Carangaria: posterior drawn (${labels.slice(0, 8).join(' ')} ...)`);
ok(labels.includes('1') && labels.some((l) => /^0\.\d{1,2}$/.test(l)), 'both 1 and a fraction rounded to 2 decimals');
// far zoomed out the labels would collide: none below the density threshold
await ev(() => __v().fit(false));
await page.waitForTimeout(200);
ok((await drawn()).length === 0, 'Carangaria at the fitted view: rows closer than the density threshold, no node labels');
await page.locator('.ex-outer').press('Control+f');
await page.waitForTimeout(100);
ok(
  (await page.locator('.ex-search input').count()) === 1 && (await ev(() => document.activeElement?.closest('.ex-search') !== null)),
  'Ctrl+F opens the search',
);

// ---------------------------------------------------------------- swap inside a polytomy
console.log('swap in a polytomy');
await open('edge-polytomy');
const tipOrder = () => ev(() => __order().split(','));
ok((await tipOrder()).slice(0, 5).join('') === 'ABCDE', 'the 5-way polytomy starts as A B C D E');
await btn('Swap').click();
await click(await ev(() => __tipAt('A')));
await click(await ev(() => __tipAt('D')));
await page.waitForTimeout(200);
const swapped = await tipOrder();
ok(swapped.slice(0, 5).join('') === 'DBCAE', 'Swap of A and D in the polytomy moves only those two');
ok(swapped.slice(5).join() === 'F,G,H,I,J', 'the rest of the tree is unchanged');
await page.keyboard.press('Escape');
await page.locator('.phylo-tree').focus();
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
ok((await tipOrder()).slice(0, 5).join('') === 'ABCDE', 'Ctrl+Z undoes the swap');

// ---------------------------------------------------------------- aligned labels
console.log('aligned labels');
await open('rich-hcv-19');
const alignBtn = page.locator('.ex-outer button', { hasText: /^\s*Align\s*$/ }); // not 'Alignment'
const anchorXs = () =>
  ev(() => [...document.querySelectorAll('.phylo-tree [data-tip-id]')].map((a) => Math.round(a.getBoundingClientRect().left * 10) / 10));
await page.waitForTimeout(300);
const ragged = await anchorXs();
ok(
  ragged.length > 5 && new Set(ragged).size > 3,
  `labels follow their tips by default (${ragged.length} anchors, ${new Set(ragged).size} different x)`,
);
ok((await alignBtn.isEnabled()) && (await ev(() => __v().options.alignLabels)) === false, 'the Align button is enabled, off by default');
await alignBtn.click();
await page.waitForTimeout(400);
const aligned = await anchorXs();
ok(aligned.length > 5 && new Set(aligned).size === 1, `Align: the label anchors share one x (${aligned.length} anchors at ${aligned[0]})`);
ok(
  (await ev(() => __v().options.alignLabels)) === true && (await alignBtn.getAttribute('aria-pressed')) === 'true',
  'Align sets the option and shows as pressed',
);
const sameAligned = await screenVsBlob();
ok(
  sameAligned.w && sameAligned.painted > 500 && sameAligned.diff === 0,
  `Align on: toBlob equals the screen, leaders included (${sameAligned.painted} painted pixels, ${sameAligned.diff} differ)`,
);
const lab = await page.evaluate(() => {
  const a = document.querySelector('.phylo-tree [data-tip-id]');
  const r = a.getBoundingClientRect();
  return { id: a.dataset.tipId, x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(lab.x, lab.y);
await page.waitForTimeout(300);
ok(
  (await page.locator('.ex-info-name').count()) === 1 && (await page.locator('.ex-info-name').innerText()) === lab.id.replace(/_/g, ' '),
  'clicking an aligned label opens the inspector of its tip',
);
await page.locator('.ex-info-head button').click();
await alignBtn.click();
await page.waitForTimeout(300);
ok(new Set(await anchorXs()).size > 3, 'Align off: the labels follow their tips again');

// ---------------------------------------------------------------- striped summaries
console.log('striped summaries');
await open('rich-hcv-19');
const stripesBtn = page.locator('.ex-outer button', { hasText: /^\s*Stripes\s*$/ });
ok(
  (await ev(() => __v().options.summaryStyle)) === 'striped' && (await stripesBtn.getAttribute('aria-pressed')) === 'true',
  'Stripes: on by default in this preview branch (the library default is solid)',
);
await stripesBtn.click();
await page.waitForTimeout(200);
ok(
  (await ev(() => __v().options.summaryStyle)) === 'solid' && (await stripesBtn.getAttribute('aria-pressed')) === 'false',
  'the Stripes toggle switches to solid',
);
await stripesBtn.click();
await page.waitForTimeout(200);
ok((await ev(() => __v().options.summaryStyle)) === 'striped', 'and back to striped');

// ---------------------------------------------------------------- alignment
console.log('alignment');
await open('rich-hcv-19');
await btn('Alignment').click();
await page.waitForTimeout(300);
const cell = await ev(() => __v().columnCell('alignment', 0));
ok(cell !== null && cell.width > 100, 'the alignment column is drawn');
ok((await page.locator('.ex-legend').innerText()).includes('18 of 19 tips matched'), 'legend says how many tips have a sequence');
// the legend is the canvas's own table: in dark mode, every swatch is a colour the cells are drawn in (and the cells use no other)
if ((await ev(() => document.documentElement.dataset.theme)) !== 'dark') {
  await page.locator('.theme-toggle').click();
  await page.waitForTimeout(300);
}
const swatches = await ev(() => [...document.querySelectorAll('.ex-legend-dot')].map((d) => getComputedStyle(d).backgroundColor));
ok(swatches.length === 4 && new Set(swatches).size === 4, `the nucleotide legend has four distinct swatches (${swatches.join(' ')})`);
ok(swatches[0] === 'rgb(74, 222, 128)', 'in dark mode they are the dark defaults (A is #4ade80)');
const cellColours = await ev(() => {
  const v = __v();
  const c = v.treeElement.querySelector('canvas');
  const b = c.getBoundingClientRect();
  const k = c.width / b.width;
  const seen = new Set();
  for (let r = 0; r < 6; r++) {
    const cell = v.columnCell('alignment', r);
    if (!cell) continue;
    for (let i = 0; i < 80; i++) {
      const x = Math.round((cell.x + ((i + 0.5) / 80) * cell.width - b.left) * k);
      const y = Math.round((cell.y + cell.height / 2 - b.top) * k);
      const d = c.getContext('2d').getImageData(x, y, 1, 1).data;
      if (d[3] === 255) seen.add(`rgb(${d[0]}, ${d[1]}, ${d[2]})`);
    }
  }
  return [...seen];
});
ok(
  swatches.every((s) => cellColours.includes(s)),
  `each legend swatch is the pixel colour of a residue cell (cells: ${cellColours.join(' ')})`,
);
await btn('Alignment').click();
await page.waitForTimeout(200);
ok((await ev(() => __v().columnCell('alignment', 0))) === null && (await page.locator('.ex-legend').count()) === 0, 'Alignment off');

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks pass');
process.exit(failures ? 1 : 0);
