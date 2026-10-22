// Browser check of the node menu and the tree operations on the React example (examples/react; start it with `npm run dev` there,
// which serves on port 5307).
//   node tests/browser/scripts/check-node-menu.mjs [--port 5307] [--url <page URL, default http://127.0.0.1:<port>/>]
// --url also runs it against a deployed build of the example.
// On the 6-tip edge-case tree: the menu opens on a tip and on a clade with the expected actions and takes focus; arrows move,
// Escape closes it and returns focus to the canvas; Tab out, an outside click and zooming close it; reroot, rotate, remove
// and ladderise change the tip order as expected and focus is on the new canvas afterwards; a clade colour that is no longer
// a clade after a reroot (rerooted inside it) is removed, or kept on its node with a warning, and undo restores it; a menu near the bottom edge stays inside the pane; reset
// restores the tree as published; a clade click highlights nothing; collapse by support is a view (a lower threshold or
// unticking brings branches back, colours survive); midpoint on a dated tree says the root already is the midpoint.
// On the tree with repeated labels: a click highlights only the clicked tip, and it stays highlighted through ladderise, undo,
// a focused clade and Back. Undo within a memory budget (?undo-budget): the oldest action dropped first, reset only for a tree larger
// than the budget (#44).
import { createRequire } from 'node:module';
import { chromiumPath } from './chromium.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { PNG } = require('pngjs');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const port = Number(args.port || 5307);
const url = args.url || `http://127.0.0.1:${port}/`;
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
page.setDefaultTimeout(8000);
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  failures++;
});
await page.goto(`${url}?tree=edge-internal-support&cpu=1`);
await page.waitForSelector('[role=toolbar]', { timeout: 60000 });
await page.waitForTimeout(800);

const pane = page.locator('.card').first();
const status = () => page.locator('p[aria-live]').innerText();
const menuOpen = async () => (await page.locator('[role=menu]').count()) > 0;
const items = async () => (await page.locator('[role=menuitem]').allInnerTexts()).map((s) => s.split('\n')[0]);
const order = async () =>
  (await pane.locator('a[data-tip-id]').evaluateAll((as) => as.map((a) => [a.dataset.tipId, a.getBoundingClientRect().top])))
    .sort((a, b) => a[1] - b[1])
    .map((x) => x[0])
    .join('');
const dot = async (id) => {
  const b = await pane.locator(`a[data-tip-id="${id}"]`).boundingBox();
  return { x: b.x - 5, y: b.y + b.height / 2 };
};
const canvasFocused = () =>
  page.evaluate(() => {
    const a = document.activeElement;
    return !!a && a.tagName === 'DIV' && a.tabIndex === 0 && !!a.querySelector('canvas');
  });
const openOn = async (p) => {
  await page.mouse.click(p.x, p.y);
  await page.waitForSelector('[role=menu]');
};
const act = async (id) => {
  await page.locator(`[data-action=${id}]`).click();
  await page.waitForTimeout(500);
};
/** A point on the clade joining two sibling tips: walk left along the row between them until the tooltip names a 2-tip clade. */
const cladeOf = async (a, b) => {
  const p = await dot(a),
    q = await dot(b);
  const y = (p.y + q.y) / 2;
  for (let x = Math.max(p.x, q.x) - 6; x > 30; x -= 3) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(30);
    const tt = page.locator('[role=tooltip]');
    if ((await tt.count()) && /Clade, 2 tips/.test(await tt.first().innerText())) return { x, y };
  }
  throw new Error(`no clade found between ${a} and ${b}`);
};

ok((await order()) === 'ABCDEF', `loaded: ${await order()}`);

// tip menu
await openOn(await dot('C'));
ok((await items()).join('|') === 'Reroot here|Remove this tip', `tip menu: ${(await items()).join(' | ')}`);
ok(await canvasFocused(), 'a pointer-opened menu leaves focus on the canvas (a tap would otherwise close it, see TreeView)');
await act('reroot');
ok((await order()) === 'CDABEF' && /reroot/.test(await status()), `reroot on C: ${await order()}`);
ok(await canvasFocused(), 'focus is on the new canvas after the action');

// clade menu, keyboard
const ef = await cladeOf('E', 'F');
await openOn(ef);
ok((await items()).join('|') === 'Rotate|Reroot here|Show only this clade|Collapse|Colour this clade', `clade menu: ${(await items()).join(' | ')}`);
await page.keyboard.press('Escape');
ok(!(await menuOpen()), 'Escape closes a pointer-opened menu');
// from the keyboard: Enter on the canvas opens the menu of the keyboard cursor's node, with focus on its first item
const focusedText = () =>
  page.evaluate(() => (document.activeElement?.getAttribute('role') === 'menuitem' ? document.activeElement.textContent : null));
await page.keyboard.press('Enter');
await page.waitForSelector('[role=menu]');
const first = await focusedText();
ok(first !== null, `a keyboard-opened menu focuses its first item (${first})`);
await page.keyboard.press('ArrowDown');
const second = await focusedText();
ok(second !== null && second !== first, `ArrowDown moves to the next item (${second})`);
await page.keyboard.press('Escape');
ok(!(await menuOpen()) && (await canvasFocused()), 'Escape closes and returns focus to the canvas');
await page.keyboard.press('Enter');
await page.waitForSelector('[role=menu]');
await page.keyboard.press('Shift+Tab');
await page.keyboard.press('Shift+Tab');
ok(!(await menuOpen()), 'Tab out of the menu closes it');
await openOn(ef);
await page.mouse.click(5, 5);
ok(!(await menuOpen()), 'outside click closes it');
await openOn(ef);
await page.mouse.move(ef.x - 20, ef.y - 80); // wheel zoom: a viewport change without a pointer press
await page.mouse.wheel(0, 200); // out: a 6-tip tree already fits at more than maxTipSpacing per row, so it cannot zoom in
await page.waitForTimeout(300);
ok(!(await menuOpen()), 'zooming (a viewport change) closes it');
const pb = await pane.boundingBox();
await page.mouse.dblclick(pb.x + 300, pb.y + 12); // double click on empty space fits the tree again (animated, under the shared controlled viewport)
await page.waitForTimeout(400);
await openOn(await cladeOf('E', 'F'));
await act('rotate');
ok((await order()) === 'CDABFE', `rotate (E,F): ${await order()}`);

// remove a tip, ladderise
await openOn(await dot('A'));
await act('remove');
ok((await order()) === 'CDBFE', `remove A: ${await order()}`);
await page.getByRole('button', { name: 'Ladderise ↑' }).click();
await page.waitForTimeout(400);
ok(/ladderise/.test(await status()), `ladderise: ${await order()}`);

// colours follow tips: colour (A,B), reroot on C keeps it; reroot on A (inside it) puts A and B on both sides of the new root, so by
// default the colour is removed (undo restores it); with 'keep on its node' it stays on the node, with a warning
await page.getByRole('button', { name: 'Reset' }).click();
await page.waitForTimeout(400);
await openOn(await cladeOf('A', 'B'));
await act('colour');
ok(/1 coloured clades/.test(await status()), 'colour (A,B)');
await openOn(await dot('C'));
await act('reroot');
ok(/1 coloured clades/.test(await status()), `reroot on C keeps the (A,B) colour: ${await status()}`);
await openOn(await dot('A'));
await act('reroot');
ok(/0 coloured clades/.test(await status()) && /colour was removed/.test(await status()), `reroot on A (inside it) removes it: ${await status()}`);
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(400);
ok(/1 coloured clades/.test(await status()), `undo restores the colour: ${await status()}`);
// the other rule: keep the colour on its node, with a warning that the node now holds other tips
const splitRule = page.getByRole('combobox', { name: "When a colour's tips are no longer one clade" });
await splitRule.selectOption('node');
await openOn(await dot('A'));
await act('reroot');
ok(
  /1 coloured clades/.test(await status()) && /⚠ a colour stayed on its node, which now holds \d+ tips instead of 2/.test(await status()),
  `keep on node: ${await status()}`,
);
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(400);
await splitRule.selectOption('remove');

// a menu opened near the bottom edge stays inside the pane (clamped to its measured height)
await openOn(await cladeOf('E', 'F'));
const mb = await page.locator('[role=menu]').boundingBox();
const pb2 = await pane.boundingBox();
ok(
  mb.y + mb.height <= pb2.y + pb2.height && mb.y >= pb2.y,
  `menu inside the pane (menu ${Math.round(mb.y)}..${Math.round(mb.y + mb.height)}, pane ${Math.round(pb2.y)}..${Math.round(pb2.y + pb2.height)})`,
);
await page.keyboard.press('Escape');

await page.getByRole('button', { name: 'Reset' }).click();
await page.waitForTimeout(400);
ok((await order()) === 'ABCDEF' && /tree as published/.test(await status()), `reset: ${await order()}`);

// a clade click highlights nothing (it used to highlight the clade's first five tips: a green band across the pane on their rows);
// a tip click highlights that tip. Read at the pane's left edge on tip E's row, where only the band can paint.
const bandAt = async (id) => {
  const p = await dot(id);
  const pb = await pane.boundingBox();
  const png = PNG.sync.read(await page.screenshot({ clip: { x: pb.x + 4, y: Math.round(p.y), width: 1, height: 1 } }));
  return png.data[0] !== png.data[1] || png.data[1] !== png.data[2]; // not grey or white: tinted
};
ok(!(await bandAt('E')), 'nothing highlighted before');
await openOn(await cladeOf('E', 'F'));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
ok(!(await bandAt('E')), 'a clade click highlights no tips');
await page.mouse.click((await dot('E')).x, (await dot('E')).y);
await page.waitForTimeout(200);
ok(await bandAt('E'), 'a tip click highlights that tip');
await page.keyboard.press('Escape');

// collapse by support is a view: a colour on the collapsed clade survives, a lower threshold or unticking brings the branch back
await openOn(await cladeOf('A', 'B'));
// reset restores the colours from before the first change, so (A,B) may be coloured already
if ((await items()).includes('Colour this clade')) await act('colour');
else await page.keyboard.press('Escape');
const collapseBox = page.getByRole('checkbox');
const threshold = page.getByRole('spinbutton', { name: 'Minimum support' });
await threshold.fill('70');
await collapseBox.check();
await page.waitForTimeout(500);
const label = () => page.locator('label', { has: collapseBox }).innerText();
ok(/1 collapsed/.test(await label()) && /1 coloured clades/.test(await status()), `collapse < 70: ${await label()} · ${await status()}`);
let restored = true;
try {
  await cladeOf('A', 'B');
  restored = true;
} catch {
  restored = false;
}
ok(!restored, 'the 0.95-support clade (A,B) is collapsed into the root');
await threshold.fill('0.5');
await page.waitForTimeout(500);
ok(!/collapsed/.test(await label()), `threshold 0.5: nothing collapsed (${await label()})`);
await threshold.fill('70');
await page.waitForTimeout(300);
await collapseBox.uncheck();
await page.waitForTimeout(500);
await openOn(await cladeOf('A', 'B'));
ok(/Remove colour/.test((await items()).join('|')) && /1 coloured clades/.test(await status()), 'unticked: (A,B) is back, still coloured');
await page.keyboard.press('Escape');

// collapse a clade: the viewer draws it as one triangle on one row (the tree is not changed, so the node keeps its id) and its menu
// offers Expand, which brings E and F back
if (await page.getByRole('button', { name: 'Reset' }).isEnabled()) {
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.waitForTimeout(400);
}
const rows = () => page.evaluate(() => window.__panes()[0].layout.rows);
/** A point inside the triangle of the collapsed clade above tip `tip` (client px), from the viewer's own bounds for it. */
const triangleOf = (tip) =>
  page.evaluate((tip) => {
    const r = window.__panes()[0];
    const b = r.nodeBounds(r.getTree().parent[r.tipNode(tip)]);
    return b ? { x: b.x + b.width * 0.8, y: b.y + b.height / 2 } : null;
  }, tip);
ok((await rows()) === 6, `six rows before: ${await rows()}`);
await openOn(await cladeOf('E', 'F'));
await act('collapse');
const labels = () => pane.locator('a[data-tip-id]').evaluateAll((as) => as.map((a) => a.dataset.tipId));
ok(
  !(await labels()).includes('F') && !(await labels()).includes('E') && (await rows()) === 5,
  `collapse (E,F): ${(await labels()).join(', ')}, ${await rows()} rows`,
);
{
  const p = await triangleOf('E');
  const px = PNG.sync.read(await page.screenshot({ clip: { x: Math.round(p.x), y: Math.round(p.y), width: 1, height: 1 } })).data;
  ok(px[0] < 245 && px[1] < 245, `the triangle is drawn on the clade (pixel ${px[0]},${px[1]},${px[2]})`);
}
await openOn(await triangleOf('E'));
ok((await items())[0] === 'Expand', `collapsed clade menu: ${(await items()).join(' | ')}`);
await act('expand');
ok((await labels()).includes('E') && (await labels()).includes('F') && (await rows()) === 6, 'expand brings E and F back');

// collapse uncoloured: with (A,B) coloured, (C,D) and (E,F) are collapsed; expand all undoes it
await openOn(await cladeOf('A', 'B'));
if ((await items()).includes('Colour this clade')) await act('colour');
else await page.keyboard.press('Escape');
await page.getByRole('button', { name: /Collapse uncoloured/ }).click();
await page.waitForTimeout(400);
ok((await labels()).sort().join(',') === 'A,B' && (await rows()) === 4, `collapse uncoloured: ${(await labels()).join(', ')}, ${await rows()} rows`);
await page.getByRole('button', { name: 'Expand all' }).click();
await page.waitForTimeout(400);
ok((await order()) === 'ABCDEF', `expand all: ${await order()}`);

// show only a clade, then back and up one level (also from the menu of the clade's root)
await openOn(await cladeOf('C', 'D'));
await act('subtree');
ok((await order()) === 'CD' && /showing only a clade of 2 tips/.test(await status()), `show only (C,D): ${await order()}`);
ok(!/change/.test(await status()), 'showing a clade is not a change in the undo history');
const backBtn = page.getByRole('button', { name: '← Back' });
const upBtn = page.getByRole('button', { name: '↑ Up one level' });
await upBtn.click();
await page.waitForTimeout(400);
ok((await order()) === 'ABCDEF' && /whole tree/.test(await status()), `up one level from (C,D): ${await order()}`);
await backBtn.click();
await page.waitForTimeout(400);
ok((await order()) === 'CD', `back: ${await order()}`);
{
  // the root of the shown clade offers Up one level and Back
  const cb = await dot('C'),
    db = await dot('D');
  let hitRoot = null;
  for (let x = Math.min(cb.x, db.x) - 6; x > (await pane.boundingBox()).x + 4; x -= 3) {
    await page.mouse.move(x, (cb.y + db.y) / 2);
    await page.waitForTimeout(30);
    const tt = page.locator('[role=tooltip]');
    if ((await tt.count()) && /Clade, 2 tips/.test(await tt.first().innerText())) {
      hitRoot = { x, y: (cb.y + db.y) / 2 };
      break;
    }
  }
  await openOn(hitRoot);
  ok((await items()).slice(0, 2).join('|') === 'Up one level|Back', `menu of the shown root: ${(await items()).join(' | ')}`);
  ok(await page.locator('[data-action=collapse]').isDisabled(), 'Collapse is disabled on the root of the clade shown');
  await act('back');
}
ok((await order()) === 'ABCDEF' && !(await backBtn.isEnabled()), `back to the whole tree: ${await order()}`);

// a collapsed clade stays collapsed when collapse by support would contract its node: (A,B) has support 0.95, below 70
await openOn(await cladeOf('A', 'B'));
await act('collapse');
await page.getByRole('spinbutton', { name: 'Minimum support' }).fill('70');
await page.getByRole('checkbox').check();
await page.waitForTimeout(500);
ok(
  (await rows()) === 5 && !(await labels()).includes('A'),
  `collapsed (A,B) kept under collapse support < 70: ${(await labels()).join(', ')}, ${await rows()} rows`,
);
await page.getByRole('checkbox').uncheck();
await page.getByRole('button', { name: 'Expand all' }).click();
await page.waitForTimeout(400);

// touch: a tap opens the menu and a tap on an item runs it (the browser's compatibility mousedown after a tap used to close the menu)
{
  const tctx = await browser.newContext({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const tp = await tctx.newPage();
  tp.setDefaultTimeout(8000);
  await tp.goto(`${url}?tree=edge-internal-support&cpu=1`);
  await tp.waitForSelector('[role=toolbar]', { timeout: 60000 });
  await tp.waitForTimeout(800);
  const lb = await tp.locator('.card').first().locator('a[data-tip-id="C"]').boundingBox();
  await tp.touchscreen.tap(lb.x - 5, lb.y + lb.height / 2);
  await tp.waitForTimeout(400);
  ok((await tp.locator('[role=menu]').count()) === 1, 'touch: a tap on a tip opens the menu');
  const it = await tp.locator('[data-action=reroot]').boundingBox();
  await tp.touchscreen.tap(it.x + 20, it.y + it.height / 2);
  await tp.waitForTimeout(500);
  ok(/reroot/.test(await tp.locator('p[aria-live]').innerText()), 'touch: a tap on Reroot here reroots');
  await tctx.close();
}

// midpoint on a dated (ultrametric) tree: the root already is the midpoint, and the status says so
// the axis label is canvas text: remember the last axis title drawn
await page.addInitScript(() => {
  const ft = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    if (/^(time before tips|distance from root)/.test(String(text))) window.__axis = String(text);
    return ft.call(this, text, ...rest);
  };
});
await page.goto(`${url}?tree=rich-fish-carangaria-135&cpu=1`);
await page.waitForSelector('[role=toolbar]', { timeout: 60000 });
await page.getByRole('button', { name: 'Midpoint root' }).click();
await page.waitForTimeout(300);
ok(/root already is the midpoint/.test(await status()), `midpoint on a dated tree: ${await status()}`);

// a new tree goes to the same renderers (setTree) and the panes keep the view: zoom both panes into a stretch of the tree, reroot on a tip in
// it, and the viewers are the same objects, still in sync, and not back at the fitted view; Undo returns to the same view
console.log('a new tree keeps the renderers and the view');
const panes = () =>
  page.evaluate(() =>
    window.__panes().map((v) => {
      const w = v.getViewport();
      return { ...w, tips: v.getTree().tipCount, destroyed: v.isDestroyed() };
    }),
  );
await page.evaluate(() => {
  window.__keep = window.__panes();
  window.__treeChanges = 0;
  window.__keep.forEach((v) => v.on('treechange', () => window.__treeChanges++));
  window.__panes()[0].setViewport({ x0: 0, x1: 1, y0: 50, y1: 100 });
});
await page.waitForTimeout(300);
const sameView = (a, b) => ['x0', 'x1', 'y0', 'y1'].every((k) => Math.abs(a[k] - b[k]) < 1e-6);
let [va, vb] = await panes();
ok(sameView(va, vb) && Math.abs(va.y1 - va.y0 - 50) < 1e-6, `zoomed in, the panes in sync (rows ${va.y0.toFixed(2)} to ${va.y1.toFixed(2)})`);
const tipPos = await page.evaluate(() => {
  const v = window.__panes()[0];
  const t = v.getTree();
  window.__tip = t.tipLabels[60];
  return v.locateNode(t.tipNode[60]);
});
await openOn(tipPos);
await act('reroot');
[va, vb] = await panes();
ok(
  await page.evaluate(() => window.__panes().every((v, i) => v === window.__keep[i] && !v.isDestroyed())),
  'a reroot hands the new tree to the same two renderers',
);
ok((await page.evaluate(() => window.__treeChanges)) === 2, 'each emitted treechange once');
ok(sameView(va, vb), 'the two panes stay in sync after the reroot');
ok(
  await page.evaluate(() => {
    const v = window.__panes()[0];
    const w = v.getViewport();
    const r = v.getTree().tipLabels.indexOf(window.__tip);
    return r + 0.5 >= w.y0 && r + 0.5 <= w.y1;
  }),
  'the tip that was rerooted on is still in view',
);
ok(va.y1 - va.y0 < va.tips * 0.6, `and do not jump to the fitted view (${(va.y1 - va.y0).toFixed(1)} of ${va.tips} rows)`);
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(500);
[va, vb] = await panes();
ok(sameView(va, vb) && va.y1 - va.y0 < va.tips * 0.6, 'Undo: still in sync, still zoomed');
ok(await page.evaluate(() => window.__panes().every((v, i) => v === window.__keep[i])), 'and still the same renderers');

// collapsing a clade of a dated tree keeps the axis "time before tips": the viewer ends the triangle at the clade's tips, where a collapsed
// copy of the tree (collapseClades) ended the new tip at the clade's node and flipped the axis to "distance from root", issue #19
{
  const axis = () => page.evaluate(() => window.__axis);
  ok(/^time before tips/.test(await axis()), `dated tree: axis "${await axis()}"`);
  // no tip is labelled at this size: hover along rows of the tree until the tooltip names a clade of 3 to 10 tips
  const box = await pane.locator('canvas').first().boundingBox();
  let hit = null;
  for (let y = box.y + box.height * 0.3; y < box.y + box.height * 0.7 && !hit; y += 7) {
    for (let x = box.x + box.width * 0.6; x > box.x + 20 && !hit; x -= 4) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
      const tt = page.locator('[role=tooltip]');
      if ((await tt.count()) && /Clade, ([3-9]|10) tips/.test(await tt.first().innerText())) hit = { x, y };
    }
  }
  ok(hit !== null, 'found a clade to collapse');
  await page.evaluate(() => (window.__axis = null)); // a stale title must not pass
  const height = () => page.evaluate(() => window.__panes().map((v) => v.getViewport().y1 - v.getViewport().y0));
  const h0 = await height();
  await openOn(hit);
  await act('collapse');
  ok(await page.getByRole('button', { name: /Expand all/ }).isEnabled(), 'the clade is collapsed (Expand all is offered)');
  ok(
    (await height()).every((h, i) => Math.abs(h - h0[i]) < 1e-6),
    `collapsing does not change the zoom (rows in view ${h0.map((h) => h.toFixed(1))})`,
  );
  ok(/^time before tips/.test(await axis()), `after a collapse the axis stays: "${await axis()}"`);
}

// a tip click highlights that tip only, also when the tree repeats its label (here Homo_sapiens x3), and the highlight follows the tip
// through a tree operation. The tip is told apart by its branch length (0.02, 0.03, 0.04).
{
  await page.goto(`${url}?tree=edge-duplicate-labels&cpu=1`);
  await page.waitForSelector('[role=toolbar]', { timeout: 60000 });
  await page.waitForTimeout(800);
  const left = page.locator('.card').first();
  const lit = () =>
    page.evaluate(() => {
      const v = window.__panes()[0];
      const t = v.getTree();
      return v.getHighlighted().map((n) => (typeof n === 'number' ? ['number', t.labels[n], Number(t.length[n].toFixed(2))] : [typeof n, n, 0]));
    });
  const homo = left.locator('a[data-tip-id="Homo_sapiens"]');
  ok((await homo.count()) === 3, `the tree repeats Homo_sapiens (${await homo.count()} tips)`);
  const b = await homo.nth(1).boundingBox();
  await page.mouse.click(b.x - 5, b.y + b.height / 2);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const one = await lit();
  ok(
    one.length === 1 && one[0][0] === 'number' && one[0][1] === 'Homo_sapiens',
    `a click on one of three Homo_sapiens highlights one node: ${JSON.stringify(one)}`,
  );
  await page.getByRole('button', { name: 'Ladderise ↓' }).click();
  await page.waitForTimeout(400);
  const after = await lit();
  ok(
    after.length === 1 && after[0][1] === 'Homo_sapiens' && after[0][2] === one[0][2],
    `after a ladderise the same tip is highlighted: ${JSON.stringify(after)}`,
  );
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(400);
  const undone = await lit();
  ok(
    undone.length === 1 && undone[0][1] === 'Homo_sapiens' && undone[0][2] === one[0][2],
    `after Undo the same tip is highlighted: ${JSON.stringify(undone)}`,
  );
  // show only the clade of the two sister Homo_sapiens (the first two rows, as published), click one of them
  const rowsY = (await homo.evaluateAll((as) => as.map((a) => a.getBoundingClientRect().top))).sort((a, b) => a - b);
  const hb = await homo.first().boundingBox();
  const ys = [rowsY[0], rowsY[1]].map((t) => t + hb.height / 2);
  const y = (ys[0] + ys[1]) / 2;
  let spot = null;
  for (let x = hb.x + 40; x > 30 && !spot; x -= 3) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(30);
    const tt = page.locator('[role=tooltip]');
    if ((await tt.count()) && /Clade, 2 tips/.test(await tt.first().innerText())) spot = { x, y };
  }
  ok(spot !== null, 'found the clade of the two sister Homo_sapiens');
  await openOn(spot);
  await act('subtree');
  const hf = await homo.evaluateAll((as) => as.map((a) => a.getBoundingClientRect().top));
  ok(hf.length === 2, `only the two sisters are shown (${hf.length} Homo_sapiens tips)`);
  const f = await homo.first().boundingBox();
  await page.mouse.click(f.x - 5, f.y + f.height / 2);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const inFocus = await lit();
  ok(
    inFocus.length === 1 && inFocus[0][1] === 'Homo_sapiens' && [0.02, 0.03].includes(inFocus[0][2]),
    `a click in a focused clade highlights one tip: ${JSON.stringify(inFocus)}`,
  );
  await page.getByRole('button', { name: /Back/ }).click();
  await page.waitForTimeout(400);
  const back = await lit();
  ok(
    (await homo.count()) === 3 && back.length === 1 && back[0][2] === inFocus[0][2],
    `after Back to the whole tree the same tip is highlighted: ${JSON.stringify(back)}`,
  );
}

console.log('undo within a memory budget (#44)');
{
  const tips = () => page.evaluate(() => window.__panes()[0].getTree().tipLabels.join(','));
  // tree-ops treeBytes of the current tree (the model, not the viewer's snapshot), the same count as packages/tree-ops/src/bytes.ts
  // (keep the two in step): its typed arrays, and 8 bytes per element of its plain arrays
  const bytes = () =>
    page.evaluate(() => {
      let b = 0;
      for (const a of Object.values(window.__tree())) b += ArrayBuffer.isView(a) ? a.byteLength : Array.isArray(a) ? a.length * 8 : 0;
      return b;
    });
  const go = async (extra) => {
    await page.goto(`${url}?tree=rich-fish-carangaria-135&cpu=1${extra}`);
    await page.waitForSelector('[role=toolbar]', { timeout: 60000 });
    await page.waitForFunction(() => typeof window.__panes === 'function' && window.__panes().length > 0 && window.__panes()[0]);
    await page.waitForTimeout(300);
  };
  const lad = (dir) =>
    page
      .getByRole('button', { name: `Ladderise ${dir}` })
      .click()
      .then(() => page.waitForTimeout(250));
  const undoBtn = page.getByRole('button', { name: 'Undo' });
  const resetBtn = page.getByRole('button', { name: 'Reset' });
  await go('');
  const b = await bytes();
  // room for two trees between the one as published and the current one: four actions drop the first
  await go(`&undo-budget=${Math.round(b * 2.5)}`);
  const o = [await tips()];
  for (const dir of ['↓', '↑', '↓', '↑']) {
    await lad(dir);
    o.push(await tips());
  }
  ok(o.every((x, i) => i === 0 || x !== o[i - 1]) && /4 changes/.test(await status()), `four actions, each changes the tree: ${await status()}`);
  await undoBtn.click();
  await page.waitForTimeout(200);
  await undoBtn.click();
  await page.waitForTimeout(200);
  ok((await tips()) === o[2] && /2 changes/.test(await status()), `undo twice goes back two actions: ${await status()}`);
  ok(
    (await undoBtn.count()) === 0 && (await resetBtn.isEnabled()) && (await page.getByText('Older steps were dropped').count()) === 1,
    'the oldest action was dropped: undo stops there (hidden, with a note), reset stays',
  );
  await resetBtn.click();
  await page.waitForTimeout(200);
  ok((await tips()) === o[0] && /tree as published/.test(await status()), `reset goes back to the tree as published: ${await status()}`);
  // a tree larger than the budget: reset only, with a note
  await go(`&undo-budget=${Math.floor(b / 2)}`);
  ok((await undoBtn.count()) === 0 && (await page.getByText('Undo is off').count()) === 1, 'a tree larger than the budget: no undo, a note says why');
  await lad('↓');
  await lad('↑');
  ok((await tips()) === o[2] && (await undoBtn.count()) === 0 && (await resetBtn.isEnabled()), 'after two actions only reset is offered');
  await resetBtn.click();
  await page.waitForTimeout(200);
  ok((await tips()) === o[0] && /tree as published/.test(await status()), `reset goes back to the tree as published: ${await status()}`);
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nOK');
process.exit(failures ? 1 : 0);
