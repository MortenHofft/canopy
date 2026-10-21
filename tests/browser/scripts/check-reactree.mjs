// Browser check of the Reactree look-alike (examples/reactree; start it with `npm run dev` there, which serves on port 5309).
//   node tests/browser/scripts/check-reactree.mjs [--port 5309] [--url <page URL, default http://127.0.0.1:<port>/>]
// Every toolbar control is driven as a user would (clicks, the keyboard, the sliders) and its effect read back from the viewer
// (window.__reactree() returns the TreeViewer): Width / Height zoom the window, font and branch width reach the theme, layout and
// tree type the options, truncation the label format; search counts, highlights and steps; a tip click opens the inspector, a clade
// click collapses it and a click on the triangle expands it; colour, erase and the innermost-colour-wins order; reroot, flip, swap
// (siblings and not), midpoint, ladderise and undo (button and Ctrl+Z); export (PNG and Newick downloads, SVG and PDF disabled);
// node labels (support, length); the alignment track and its legend; dark mode reaches the canvas; the resize handle.
/* global __v, __order, __tipAt, __clade -- helpers the page gets from HELPERS below, used inside page.evaluate */
import { createRequire } from 'node:module';
import { chromiumPath } from './chromium.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
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
  const v = () => window.__reactree();
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
  await page.waitForSelector('.rt-outer canvas', { timeout: 60000 });
  await page.waitForFunction(() => typeof window.__reactree === 'function' && window.__reactree() !== null);
  await page.evaluate(HELPERS);
  await page.waitForTimeout(400);
};
const ev = (fn, arg) => page.evaluate(fn, arg);
const click = async (p) => {
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
};
const btn = (text) => page.locator('.rt-outer button', { hasText: text }).first();
const toast = async () => ((await page.locator('.rt-toast').count()) ? page.locator('.rt-toast').innerText() : '');

// ---------------------------------------------------------------- Carangaria (135 tips, dated)
console.log('Carangaria MCC: view settings');
await open('rich-fish-carangaria-135');
ok((await page.locator('.rt-row').count()) === 2, 'two toolbar rows');
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
await page.locator('.rt-slider-val').nth(0).click();
await page.locator('.rt-slider-val').nth(1).click();
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
  (await page.locator('input[aria-label=Height]').count()) === 0 && (await page.locator('.rt-slider-label', { hasText: 'Size' }).count()) === 1,
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

console.log('search');
await page.locator('button[aria-label="Search taxa"]').click();
await page.keyboard.type('bothus');
await page.waitForTimeout(200);
ok((await page.locator('.rt-search-count').innerText()) === '1 / 2', 'two matches, the first current');
ok((await ev(() => __v().getHighlighted().length)) === 2, 'matches highlighted');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
ok((await page.locator('.rt-search-count').innerText()) === '2 / 2', 'Enter: next match');
const cur = await ev(() => __v().getHighlighted()[1]);
const vp = await ev(() => __v().getViewport());
const rank = await ev((l) => __v().getTree().tipLabels.indexOf(l), cur);
ok(rank >= vp.y0 && rank <= vp.y1, 'the current match is in view');
await page.keyboard.press('Escape');
ok(
  (await page.locator('.rt-search').count()) === 0 && (await ev(() => __v().getHighlighted().length)) === 0,
  'Escape closes the search and clears the highlight',
);
await page.locator('.rt-btn[title="Fit tree"]').click();

console.log('inspector, collapse, expand');
const tip0 = await ev(() => __v().getTree().tipLabels[3]);
await page.locator('input[aria-label=Height]').fill('4');
await page.waitForTimeout(200);
await page.locator('.rt-btn[title="Fit tree"]').click();
await page.locator('.rt-slider-val').nth(1).click();
await page.waitForTimeout(200);
await click(await ev((l) => __tipAt(l), tip0));
ok(
  (await page.locator('.rt-info-name').count()) === 1 && (await page.locator('.rt-info-name').innerText()) === tip0.replace(/_/g, ' '),
  'a tip click opens the inspector',
);
ok((await page.locator('.rt-info-rows dt', { hasText: 'Root distance' }).count()) === 1, 'inspector: root distance');
await page.locator('.rt-info-head button').click();
const before = await ev(() => __v().getTree().tipCount);
const c1 = await ev(() => __clade(4, 10));
await click(c1);
await page.waitForTimeout(200);
const after = await ev(() => __v().getTree().tipCount);
ok(after === before - c1.tips + 1, `a clade click collapses it (${before} → ${after} tips)`);
ok((await btn('Expand all').count()) === 1 && (await page.locator('.rt-expand .rt-count').innerText()) === '1', 'Expand all appears with the count');
const tri = await ev(() => {
  const t = __v().getTree();
  for (let r = 0; r < t.tipCount; r++) if (/ taxa$/.test(t.tipLabels[r])) return __v().locateNode(t.tipNode[r]);
  return null;
});
ok(tri !== null, 'the collapsed clade is a tip labelled "N taxa"');
await click(tri);
await page.waitForTimeout(200);
ok((await ev(() => __v().getTree().tipCount)) === before && (await btn('Expand all').count()) === 0, 'a click on the triangle expands it');
await click(await ev(() => __clade(4, 10)));
await click(await ev(() => __clade(4, 10, 3)));
await btn('Expand all').click();
await page.waitForTimeout(150);
ok((await ev(() => __v().getTree().tipCount)) === before, 'Expand all');

console.log('colour');
await btn('Color').click();
ok((await page.locator('.rt-palette .rt-swatch').count()) === 12, 'palette with 12 swatches');
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
ok(cl.length === 2 && cl[0].node === big.node && cl[1].node === small.node, 'two clades, the outer first so the inner colour shows');
await page.locator('.rt-erase').click();
await click(small);
cl = await ev(() => __v().getClades());
ok(cl.length === 1 && cl[0].node === big.node, 'Erase removes a clade colour');
await page.locator('.rt-outer').press('Escape');
ok((await page.locator('.rt-palette').count()) === 0, 'Escape leaves colour mode');
ok((await page.locator('.rt-color .rt-count').innerText()) === '1', 'Color shows the count');

console.log('tree operations');
const o0 = await ev(() => __order());
await btn('Reroot').click();
const rt = await ev(() => __v().getTree().tipLabels[5]);
await click(await ev((l) => __tipAt(l), rt));
await page.waitForTimeout(200);
ok((await ev(() => __order())) !== o0 && (await btn('Undo').count()) === 1, 'reroot on a tip changes the tree, Undo appears');
await page.locator('.rt-outer').press('Escape');
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
ok((await page.locator('.rt-steps .done').count()) === 1, 'Swap: step 1 done');
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
ok(await page.locator('.rt-menu button', { hasText: 'SVG' }).isDisabled(), 'SVG disabled (canvas viewer)');
ok(await page.locator('.rt-menu button', { hasText: 'PDF' }).isDisabled(), 'PDF disabled');
let dl = page.waitForEvent('download');
await page.locator('.rt-menu button', { hasText: 'PNG' }).click();
let d = await dl;
const png = await (await d.createReadStream()).toArray();
ok(d.suggestedFilename() === 'phylotree.png' && Buffer.concat(png).subarray(1, 4).toString() === 'PNG', 'PNG download');
await btn('Export').click();
dl = page.waitForEvent('download');
await page.locator('.rt-menu button', { hasText: 'Newick' }).click();
d = await dl;
const nwk = Buffer.concat(await (await d.createReadStream()).toArray()).toString();
ok(nwk.startsWith('(') && nwk.trim().endsWith(';') && nwk.includes(tl[0]), 'Newick download of the current tree');

console.log('dark mode, resize');
const bg = await ev(() => __v().getTheme().background);
await page.locator('.theme-toggle').click();
await page.waitForTimeout(200);
const bg2 = await ev(() => __v().getTheme().background);
ok(bg2 !== bg, `dark mode reaches the canvas (${bg} → ${bg2})`);
const h0 = (await page.locator('.rt-pane').boundingBox()).height;
const g = await page.locator('.rt-resize').boundingBox();
await page.mouse.move(g.x + g.width / 2, g.y + 7);
await page.mouse.down();
await page.mouse.move(g.x + g.width / 2, g.y + 107, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(300);
ok(Math.abs((await page.locator('.rt-pane').boundingBox()).height - h0 - 100) < 2, 'the resize handle makes the pane taller');
ok(Math.abs((await ev(() => __v().size.height)) - h0 - 100) < 2, 'and the viewer follows');

// ---------------------------------------------------------------- support values, node labels
console.log('node labels');
await open('edge-internal-support');
await btn('No labels').click();
await page.waitForTimeout(200);
let labels = await page.locator('.rt-node-label--bootstrap').allInnerTexts();
ok(labels.includes('100') && labels.includes('0.95'), `Bootstrap: support values drawn (${labels.join(' ')})`);
await btn('Bootstrap').click();
await page.waitForTimeout(200);
labels = await page.locator('.rt-node-label--branchlength:visible').allInnerTexts();
ok(labels.includes('0.3') && labels.includes('0.2'), 'Length: branch lengths drawn');
await btn('Length').click();
await page.waitForTimeout(200);
ok((await page.locator('.rt-node-label:visible').count()) === 0, 'No labels');
await page.locator('.rt-outer').press('Control+f');
await page.waitForTimeout(100);
ok(
  (await page.locator('.rt-search input').count()) === 1 && (await ev(() => document.activeElement?.closest('.rt-search') !== null)),
  'Ctrl+F opens the search',
);

// ---------------------------------------------------------------- alignment
console.log('alignment');
await open('rich-hcv-19');
await btn('Alignment').click();
await page.waitForTimeout(300);
const cell = await ev(() => __v().columnCell('alignment', 0));
ok(cell !== null && cell.width > 100, 'the alignment column is drawn');
ok((await page.locator('.rt-legend').innerText()).includes('18 of 19 tips matched'), 'legend says how many tips have a sequence');
await btn('Alignment').click();
await page.waitForTimeout(200);
ok((await ev(() => __v().columnCell('alignment', 0))) === null && (await page.locator('.rt-legend').count()) === 0, 'Alignment off');

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks pass');
process.exit(failures ? 1 : 0);
