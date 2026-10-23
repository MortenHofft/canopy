// Browser check of the table view (examples/table; start it with `npm run dev` there, which serves on port 5312).
//   node tests/browser/scripts/check-table.mjs [--port 5312] [--url <page URL, default http://127.0.0.1:<port>/>]
// The page is a TBrowse-like table on the public API (window.__table() returns the TreeViewer): it renders with the header row (Tree,
// Labels with its fields, MSA, gene location, the expression heatmap, Score) placed over the viewer's columns; the rows have the fixed
// height; the wheel over the tree, a column or the overview scrolls whole rows and never zooms (Ctrl or Shift and the wheel, the + key, a
// double click and the search focusing a tip do not zoom either) and stops at the first and last row; a header's handle resizes its
// column (and the Labels handle the tree area) and the URL keeps the width; hovering a row over the columns names its tip; a click on a
// clade collapses it to one row and a second click opens it; the field and column pickers add and remove columns; the other trees load
// (a nucleotide alignment, a tree without an alignment, 888 tips scrolled to the end).
import { createRequire } from 'node:module';
import { chromiumPath } from './chromium.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const port = Number(args.port || 5312);
const url = args.url || `http://127.0.0.1:${port}/`;
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(10000);
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  console.log('CONSOLE.ERROR', m.text().slice(0, 300));
  failures++;
});
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  failures++;
});

const open = async (query = '') => {
  await page.goto(url + query);
  await page.waitForFunction(() => window.__table?.() && document.querySelector('.table-head__cell--column:not([hidden])'));
  await page.waitForTimeout(300);
};
const view = () => page.evaluate(() => window.__table().getViewport());
const fitRows = () =>
  page.evaluate(() => {
    const f = window.__table().fitViewport();
    return f.y1 - f.y0;
  });
const rows = () => page.evaluate(() => window.__table().layout.rows);
const head = (id) =>
  page.evaluate((id) => {
    const el = document.querySelector(`.table-head__cell[data-col="${id}"]`);
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, w: r.width, y: r.top, h: r.height, text: el.textContent };
  }, id);
/** The client box of a cell of column `id` in the first row in view that has one. */
const cell = (id) =>
  page.evaluate((id) => {
    const v = window.__table();
    const { y0, y1 } = v.getViewport();
    for (let r = Math.ceil(y0); r < y1; r++) {
      const b = v.columnCell(id, r);
      if (b) return b;
    }
    return null;
  }, id);
const frameBox = () => page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector('#frame').getBoundingClientRect())));
const wheelAt = async (x, y, dy, mods = []) => {
  await page.mouse.move(x, y);
  for (const k of mods) await page.keyboard.down(k);
  await page.mouse.wheel(0, dy);
  for (const k of mods) await page.keyboard.up(k);
  await page.waitForTimeout(150);
};

console.log('render: Ensembl protein family (54 tips, protein alignment, members)');
await open();
const ids = ['tree', 'labels', 'f.species', 'msa', 'locus', 'expression', 'score'];
const cells = {};
for (const id of ids) cells[id] = await head(id);
ok(
  ids.every((id) => cells[id]),
  `the header row has Tree, Labels, Species, MSA, Gene location, Expression and Score (${ids.filter((id) => !cells[id]).join(', ') || 'all'})`,
);
ok(/2\/3 fields/.test(cells.labels?.text ?? ''), `the Labels header says how many fields it shows (${cells.labels?.text})`);
ok(/Brain.*Heart.*Liver.*Testis/.test(cells.expression?.text ?? ''), 'the heatmap header names its tissues');
ok(await page.evaluate(() => !!document.querySelector('.phylo-overview canvas')), 'the overview strip is there (the scrollbar)');
const fb = await frameBox();
ok(cells.tree && near(cells.tree.y, fb.top, 1) && near(cells.tree.h, 24, 1), 'the header row lies on the band above the plot');
for (const id of ['f.species', 'msa', 'expression']) {
  const c = await cell(id);
  ok(
    c && near(c.x, cells[id].x, 1.5) && near(c.width, cells[id].w, 1.5),
    `the ${id} header is over its column (${c?.x}/${cells[id]?.x}, ${c?.width}/${cells[id]?.w})`,
  );
}
const s = await cell('score');
ok(s && near(s.x - 2, cells.score.x, 1.5), 'the Score header is over its bars');
const c0 = await cell('msa');
ok(near(c0.height, 24, 0.01), `rows are 24 px (${c0.height})`);
const v0 = await view();
ok(near(v0.x0, 0) && near(v0.x1, 1) && near(v0.y0, 0), `the window starts at the first row, the whole tree wide (${JSON.stringify(v0)})`);
const h = await fitRows();
ok(near(v0.y1 - v0.y0, h), `the window is the fitted height (${h.toFixed(2)} rows)`);

console.log('\nthe wheel scrolls rows and never zooms');
const tree = { x: fb.left + 150, y: fb.top + 300 };
await wheelAt(tree.x, tree.y, 240);
let v = await view();
ok(
  near(v.y0, 10, 1e-3) && near(v.y1 - v.y0, h) && near(v.x0, 0) && near(v.x1, 1),
  `240 px of wheel over the tree scroll 10 rows (y0 ${v.y0.toFixed(3)})`,
);
await wheelAt(cells.expression.x + 20, tree.y, -120);
v = await view();
ok(near(v.y0, 5, 1e-3) && near(v.y1 - v.y0, h), `the wheel over the heatmap scrolls too (y0 ${v.y0.toFixed(3)})`);
const ov = await page.evaluate(() => JSON.parse(JSON.stringify(document.querySelector('.phylo-overview').getBoundingClientRect())));
await wheelAt(ov.left + ov.width / 2, ov.top + 200, 48);
v = await view();
ok(near(v.y0, 7, 1e-3) && near(v.y1 - v.y0, h), `the wheel over the overview scrolls (y0 ${v.y0.toFixed(3)})`);
for (const mods of [['Control'], ['Shift'], ['Alt']]) {
  await wheelAt(tree.x, tree.y, -120, mods);
  v = await view();
  ok(near(v.x0, 0) && near(v.x1, 1) && near(v.y1 - v.y0, h), `${mods[0]} and the wheel do not zoom (${JSON.stringify(v)})`);
}
await wheelAt(tree.x, tree.y, -100000);
v = await view();
ok(near(v.y0, 0), `the rows stop at the first (y0 ${v.y0})`);
await wheelAt(tree.x, tree.y, 100000);
v = await view();
const n = await rows();
ok(near(v.y1, n, 1e-6) && near(v.y1 - v.y0, h), `and at the last (y1 ${v.y1.toFixed(3)} of ${n} rows)`);
await page.locator('.phylo-tree').focus();
for (const key of ['+', '=', '-']) await page.keyboard.press(key);
v = await view();
ok(near(v.y1 - v.y0, h) && near(v.x1 - v.x0, 1), 'the + and - keys do not zoom');
await page.mouse.dblclick(tree.x, tree.y);
await page.waitForTimeout(400);
v = await view();
ok(near(v.y1 - v.y0, h) && near(v.x1 - v.x0, 1), 'a double click does not zoom');
await page.evaluate(() => window.__table().zoomBy(2, 3, 300, 300));
v = await view();
ok(near(v.y1 - v.y0, h) && near(v.x1 - v.x0, 1), 'a zoom from elsewhere (zoomBy) is put back to whole rows');
await page.locator('.phylo-search input').fill('ENSMSPP');
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
v = await view();
const r = await page.evaluate(() =>
  window
    .__table()
    .getTree()
    .tipLabels.findIndex((l) => l.startsWith('ENSMSPP')),
);
ok(near(v.y1 - v.y0, h) && r >= v.y0 && r < v.y1, `the search scrolls the tip into view without zooming (row ${r}, y0 ${v.y0.toFixed(2)})`);

console.log('\nresize');
await wheelAt(tree.x, tree.y, -100000);
await wheelAt(tree.x, tree.y, 72);
const grip = async (id) => {
  const b = await page.locator(`.table-head__cell[data-col="${id}"] .table-head__grip`).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const msa0 = (await head('msa')).w;
let g = await grip('msa');
await page.mouse.move(g.x, g.y);
await page.mouse.down();
await page.mouse.move(g.x + 20, g.y, { steps: 3 });
await page.mouse.move(g.x + 40, g.y, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(200);
const msa = await cell('msa');
const msa1 = Math.round(msa0 + 40);
ok(near(msa.width, msa1, 1), `dragging the MSA handle 40 px makes it ${msa1} px wide (${msa.width})`);
ok(near((await head('msa')).w, msa1, 1), 'and its header follows');
ok(new URL(page.url()).searchParams.get('cols')?.includes(`msa:${msa1}`), `the URL keeps the width (${page.url()})`);
const before = (await head('labels')).x + (await head('labels')).w;
g = await grip('labels');
await page.mouse.move(g.x, g.y);
await page.mouse.down();
await page.mouse.move(g.x - 60, g.y, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(200);
const tw = await page.evaluate(() => window.__table().options.treeWidth);
const after = (await head('labels')).x + (await head('labels')).w;
ok(
  typeof tw === 'number' && near(before - after, 60, 3),
  `the Labels handle narrows the tree area by 60 px (treeWidth ${tw}, ${before.toFixed(0)} -> ${after.toFixed(0)})`,
);
v = await view();
ok(near(v.y0, 3, 1e-3), `and the rows stay where they were scrolled (y0 ${v.y0.toFixed(3)})`);
const score0 = (await head('score')).w;
await page.locator('.table-head__cell[data-col="score"] .table-head__grip').focus();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(150);
ok(near((await head('score')).w, Math.round(score0) + 10, 1), 'a handle moves with the arrow keys');
await open(new URL(page.url()).search);
ok(near((await cell('msa')).width, msa1, 1), 'the widths come back from the URL');

console.log('\nreadouts, collapse, pickers');
const hc = await cell('expression');
await page.mouse.move(hc.x + 10, hc.y + hc.height / 2);
const row = await page.evaluate(() => {
  const v = window.__table();
  return v.getTree().tipLabels[Math.ceil(v.getViewport().y0)];
});
const hovered = await page.locator('#hover-row').innerText();
ok(hovered.includes(row), `hovering a row over the heatmap names its tip (${hovered})`);
const clade = await page.evaluate(() => {
  const v = window.__table();
  const t = v.getTree();
  for (let i = 1; i < t.nodeCount; i++) {
    const c = t.leafEnd[i] - t.leafStart[i];
    if (t.firstChild[i] >= 0 && c >= 3 && c <= 10) {
      const q = v.locateNode(i);
      if (q) return { node: i, tips: c, ...q };
    }
  }
  return null;
});
const n0 = await rows();
await page.mouse.click(clade.x, clade.y);
await page.waitForTimeout(200);
ok((await rows()) === n0 - clade.tips + 1, `a click on a clade of ${clade.tips} tips collapses it to one row (${n0} -> ${await rows()} rows)`);
v = await view();
ok(near(v.y1 - v.y0, h), 'the rows keep their height');
const q = await page.evaluate((node) => window.__table().locateNode(node), clade.node);
await page.mouse.click(q.x, q.y);
await page.waitForTimeout(200);
ok((await rows()) === n0, 'a click on the collapsed clade opens it');
ok(/Selected:/.test(await page.locator('#selected').innerText()), 'the selection is shown');
await page.locator('summary', { hasText: 'Label fields' }).click();
await page.locator('#fields-list input[data-col="f.gene"]').check();
ok(!!(await head('f.gene')) && /3\/3 fields/.test((await head('labels')).text), 'a field picked in Label fields gets its column');
await page.locator('summary', { hasText: 'Columns' }).click();
await page.locator('#columns-list input[data-col="msa"]').uncheck();
await page.waitForTimeout(150);
ok(!(await head('msa')) && !(await cell('msa')), 'a column unticked in Columns goes away');
ok(near((await cell('expression')).x, (await head('expression')).x, 1.5), 'the headers follow the columns that are left');

console.log('\nother trees');
await open('?tree=hcv-19');
ok(!!(await head('msa')) && !!(await cell('msa')) && !(await head('locus')), 'HCV: the alignment and no gene location');
ok((await page.locator('.table-head__cell[data-col="f.year"]').count()) === 1, 'HCV: a year field from the labels');
await open('?tree=otl-canidae-200');
ok(!(await head('msa')) && !!(await head('expression')) && !!(await head('f.ott')), 'Canidae: no alignment, the OTT id field and the sample columns');
await open('?tree=otl-testudines-1k&row=18');
ok(near((await cell('expression')).height, 18, 0.01), 'Testudines: rows of 18 px from the URL');
const ft = await frameBox();
await wheelAt(ft.left + 150, ft.top + 300, 1e6);
v = await view();
ok(near(v.y1, await rows(), 1e-6) && near(v.y1 - v.y0, await fitRows()), `Testudines: scrolled to the last of ${await rows()} rows without zooming`);

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks pass');
process.exit(failures ? 1 : 0);
