// Browser check of the explorer (examples/explorer; start it with `npm run dev` there, which serves on port 5309).
//   node tests/browser/scripts/check-explorer.mjs [--port 5309] [--url <page URL, default http://127.0.0.1:<port>/>]
// Every toolbar control is driven as a user would (clicks, the keyboard) and its effect read back from the viewer
// (window.__explorer() returns the TreeViewer): layout and
// tree type the options, truncation the label format; search counts, highlights, steps and the highlight style; with the click action Inspect a
// click opens the node menu (each kind of node: tip, clade, collapsed clade from its branch, root; Escape closes it; a plain click collapses nothing; a
// click on a collapsed clade's triangle expands it)
// and Collapse, Expand and Info are its items; the tip Info is on stays selected across Layout and Phylo/Clado switches (#61); the node the menu is for keeps its ring with the pointer in the menu, colour, erase and the innermost-colour-wins order; reroot, midpoint, ladderise (by tips, depth, height) and undo (Ctrl+Z; Reset in the menu); undo within a memory budget
// (?undo-budget: the oldest step dropped first, Reset only for a tree larger than the budget, #44); show only a clade, Up one level
// and Back to root; export (PNG at 1x, 2x and 4x, Newick and NEXUS downloads);
// the opaque background (the pane's grey, no dotted grid) leaves no trace of earlier frames; the page font is a system-ui stack and the
// inspector's numbers are monospace; Export stays in view at 1024 px; the innermost clade colour wins whatever the order;
// node labels (support and length from the ⋮ menu); aligned labels (one x for the label anchors, a click on one opens the menu; in
// radial one distance from the root, toBlob equal to the screen); the overview and legend controls; one action colour (--ex-primary) for active toggles, active tools and the hover box, in light and dark, and --ex-tooltip-bg / --ex-tooltip-text for the hover box (#74); dark mode reaches
// the canvas; the resize handle; one tree from each group of the playground's catalogue, a large one included; loading in the parse worker
// (frames go on while the 2.39M-tip tree parses, Cancel keeps the tree shown and terminates the worker, #4); a file of one's own (plain and gzipped) through the picker's file input; the drill-down on the 10k-tip GTDB archaea tree, its overview set through ?view=
// (#57: a click expands a collapsed clade in place, Show only jumps into one, Back to root returns); the debug panel (?debug=1)
// shows numbers, and Copy view's view comes back through ?view= (rectangular and radial).
/* global __v, __order, __tipAt, __clade, __inView, __stem -- helpers the page gets from HELPERS below, used inside page.evaluate */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // a catalogue tree with a remote copy is first asked for under data/real-ladder/fetched/ (made by fetch.sh, absent in CI): its 404 is
  // expected, as the page then loads the remote URL
  if (/\/data\/real-ladder\/fetched\//.test(m.location()?.url ?? '')) return;
  console.log('CONSOLE.ERROR', m.text().slice(0, 300));
  failures++;
});
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
  // a point on the branch into node n (rectangular): a click there is a 'branch' hit, which opens the menu of a collapsed clade
  window.__stem = (n) => {
    const t = v().getTree();
    const q = v().locateNode(n);
    const p = v().locateNode(t.parent[n]);
    return q && p ? { x: q.x - Math.min(4, (q.x - p.x) / 2), y: q.y } : null;
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
// the ⋮ menu (branch style, legend, minimap, align labels, truncate names, support, length, ladderize, export): open it, use an item; a toggle leaves it open, so close it
// Back to root: the whole tree again, from a clade shown alone
const toRoot = () => page.locator('.ex-group[aria-label="Clade shown"] button', { hasText: 'Back to root' }).click();
// Reset, in the ⋮ menu only once there is an edit: the tree as published
const hasReset = async () => {
  if (!(await moreMenu().count())) await moreButton().click();
  const n = await moreItem('Reset').count();
  await moreClose();
  return n === 1;
};
const resetEdits = () => more('Reset');
// Undo has no button: Ctrl+Z with the focus on the tree
const undo = async () => {
  await page.locator('.phylo-tree').focus();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
};
const moreButton = () => page.locator('button[aria-label="More options"]');
const moreMenu = () => page.locator('.ex-menu');
const moreItem = (name) => moreMenu().locator('[role^=menuitem]', { hasText: name });
const more = async (name) => {
  if (!(await moreMenu().count())) await moreButton().click();
  await moreItem(name).click();
};
const moreClose = async () => {
  if (await moreMenu().count()) await moreButton().click();
};
const moreToggle = async (name) => {
  await more(name);
  await moreClose();
};
const moreRead = async (name, how) => {
  if (!(await moreMenu().count())) await moreButton().click();
  const r = await how(moreItem(name));
  await moreClose();
  return r;
};
const moreChecked = (name) => moreRead(name, (i) => i.getAttribute('aria-checked').then((v) => v === 'true'));
const moreEnabled = (name) => moreRead(name, (i) => i.isEnabled());
const ladder = (dir) => more(`Ladderize ${dir}`);
const toast = async () => ((await page.locator('.ex-toast').count()) ? page.locator('.ex-toast').innerText() : '');
// the viewer's node menu (the export menu has role=menu too)
const menu = page.locator('.phylo-node-menu[role=menu]');
const menuItems = async () => (await menu.locator('.phylo-node-menu__item').allInnerTexts()).map((t) => t.split('\n')[0]);
const openMenu = async (p) => {
  await page.mouse.click(p.x, p.y);
  await menu.waitFor({ timeout: 3000 });
};
const act = async (id) => {
  await menu.locator(`[data-action="${id}"]`).click();
  await page.waitForTimeout(250);
};
/** How many of 16 points on the circle of the theme radius `token` around node `n` (or the page point `n`) are inked on the overlay canvas
 *  (the rings' canvas): 12 or more is a ring. */
const ringHits = (n, token) =>
  ev(
    ([n, token]) => {
      const v = __v();
      const p = typeof n === 'number' ? v.locateNode(n) : n;
      if (!p) return 0;
      const top = v.treeElement.querySelectorAll('canvas')[1];
      const r = top.getBoundingClientRect();
      const k = top.width / r.width;
      const rad = v.getTheme()[token];
      const data = top.getContext('2d').getImageData(0, 0, top.width, top.height).data;
      let hits = 0;
      for (let a = 0; a < 16; a++) {
        const x = Math.round((p.x - r.left + rad * Math.cos((a * Math.PI) / 8)) * k);
        const y = Math.round((p.y - r.top + rad * Math.sin((a * Math.PI) / 8)) * k);
        if (data[(y * top.width + x) * 4 + 3] > 100) hits++;
      }
      return hits;
    },
    [n, token],
  );
/** Collapse the clade at p through the node menu, as a user does. */
const collapseAt = async (p) => {
  await openMenu(p);
  await act('collapse');
};

// ---------------------------------------------------------------- Carangaria (135 tips, dated)
// the axis label is canvas text: remember the last axis title drawn
await page.addInitScript(() => {
  const ft = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    if (/^(time before tips|distance from root)/.test(String(text))) window.__axis = String(text);
    // the labels of collapsed clades (#57): 'Name · 12,345 tips' or '12,345 tips'
    if (/^(.+ · )?[\d,]+ tips?$/.test(String(text))) (window.__cladeLabels ??= new Set()).add(String(text));
    // node labels are the only text drawn with the 'bottom' baseline in the rectangular layout (the radial scale bar has it too)
    if (this.textBaseline === 'bottom') {
      (window.__nodeTexts ??= []).push(String(text));
      (window.__nodeTextAt ??= []).push({ text: String(text), x: rest[0], y: rest[1], align: this.textAlign });
    }
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
ok((await page.locator('input[type=range]').count()) === 0, 'no size, font or branch width sliders');
const th = await ev(() => __v().getTheme());
ok(th.supportColour !== '' && th.supportColour === th.lengthColour, `light: support and length labels share one colour (${th.supportColour})`);
{
  // one variable, --ex-node-label, sets both (#70)
  await ev(() => {
    document.documentElement.style.setProperty('--ex-node-label', 'rgb(1, 2, 3)');
    __v().refreshTheme();
  });
  await page.waitForTimeout(250);
  const t = await ev(() => __v().getTheme());
  ok(
    t.supportColour === t.lengthColour && /1, ?2, ?3|#010203/.test(t.supportColour),
    `--ex-node-label sets both label colours (${t.supportColour}, ${t.lengthColour})`,
  );
  await ev(() => {
    document.documentElement.style.removeProperty('--ex-node-label');
    __v().refreshTheme();
  });
  await page.waitForTimeout(250);
}
await page.locator('button[title=Circular]').click();
await page.waitForTimeout(150);
ok((await ev(() => __v().options.layout)) === 'radial', 'Circular: radial layout');
await page.locator('button[title=Rectangular]').click();
await moreToggle('Cladogram');
await page.waitForTimeout(150);
ok((await ev(() => __v().options.layout)) === 'rectangular' && (await ev(() => __v().options.branchLengths)) === false, 'Rectangular, Cladogram');
await moreToggle('Phylogram');
const longest = await ev(() =>
  __v()
    .getTree()
    .tipLabels.reduce((a, b) => (b.length > a.length ? b : a)),
);
ok((await ev((l) => __v().options.formatLabel(l), longest)).endsWith('…'), 'Truncate (on by default) shortens long names');
await moreToggle('Truncate names');
ok((await ev((l) => __v().options.formatLabel(l), longest)) === longest.replace(/_/g, ' '), 'Full names: the whole name');

console.log('opaque background, typography');
const paneBg = await ev(() => {
  const cs = getComputedStyle(document.querySelector('.ex-pane'));
  return { colour: cs.backgroundColor, image: cs.backgroundImage };
});
ok(paneBg.image === 'none', `no dot pattern on the pane (background-image: ${paneBg.image})`);
const themeBg = await ev(() => {
  const p = document.createElement('i');
  p.style.color = __v().getTheme().background;
  document.body.append(p);
  const c = getComputedStyle(p).color;
  p.remove();
  return c;
});
ok(themeBg === paneBg.colour && !/rgba|transparent/.test(themeBg), `the canvas background is the pane's grey, opaque (${themeBg})`);
ok(
  (await ev(() => getComputedStyle(document.querySelector('.ex-pane')).getPropertyValue('--phylo-dark'))) === '',
  'light: no --phylo-dark set by hand',
);
ok(
  await ev(
    () =>
      /system-ui/.test(getComputedStyle(document.body).fontFamily) &&
      /system-ui/.test(getComputedStyle(document.querySelector('.ex-outer')).fontFamily),
  ),
  'the page font is a system-ui stack',
);
ok(/system-ui/.test(await ev(() => __v().getTheme().fontFamily)), 'and so is the tree labels font (--phylo-font-family)');
// painted pixels (what differs from the background, the first pixel) after fitting, after zooming in and panning, and after fitting
// again: with frames drawn over each other the count grows
const painted = () =>
  ev(() => {
    __v().renderNow();
    const c = __v().treeElement.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 4; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 6) n++;
    return n / (c.width * c.height); // the drawn share of the canvas
  });
const opaqueShare = () =>
  ev(() => {
    const c = __v().treeElement.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n / (c.width * c.height);
  });
await page.locator('.ex-btn[title="Fit tree"]').click();
await page.waitForTimeout(200);
const p0 = await painted();
const box = await page.locator('.phylo-tree').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
await page.waitForTimeout(300);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 100, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.locator('.ex-btn[title="Fit tree"]').click();
await page.waitForTimeout(300);
const p1 = await painted();
ok(p0 > 0 && p0 < 0.5, `the canvas is the background where nothing is drawn (${(p0 * 100).toFixed(1)}% drawn)`);
ok((await opaqueShare()) === 1, 'the canvas is opaque');
ok(Math.abs(p1 - p0) < 0.002, `no trace of earlier frames (${(p0 * 100).toFixed(2)}% painted before zoom and pan, ${(p1 * 100).toFixed(2)}% after)`);
// switching to a transparent background and back at run time (the viewer changes canvas)
// updateTheme merges into the page's overrides (font, branch width); undefined gives the CSS background back
await ev(() => __v().updateTheme({ background: 'transparent' }));
const pClear = await ev(() => {
  __v().renderNow();
  const c = __v().treeElement.querySelector('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
  return n / (c.width * c.height);
});
await ev(() => __v().updateTheme({ background: undefined }));
const pBack = await painted();
ok(
  pClear < 0.5 && Math.abs(pBack - p0) < 0.002 && (await opaqueShare()) === 1,
  `transparent background at run time, then opaque again (${(pClear * 100).toFixed(1)}% painted, ${(pBack * 100).toFixed(2)}% drawn)`,
);
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
await page.locator('button[aria-label="Search tips"]').click();
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
const cur = await ev(() => __v().getHighlighted()[1]); // a node id: the matches are tips, not labels
const vp = await ev(() => __v().getViewport());
const rank = await ev((n) => __v().getTree().tipRank[n], cur);
ok(rank >= vp.y0 && rank <= vp.y1, 'the current match is in view');
await page.keyboard.press('Escape');
ok(
  (await page.locator('.ex-search').count()) === 0 && (await ev(() => __v().getHighlighted().length)) === 0,
  'Escape closes the search and clears the highlight',
);
await page.locator('.ex-btn[title="Fit tree"]').click();
await page.waitForTimeout(300);
ok(Math.abs((await ink()) - inkBefore) < inkBefore * 0.05, 'and the tree is back at full strength after the search');

console.log('node menu, inspector, collapse, expand');
const tip0 = await ev(() => __v().getTree().tipLabels[3]);
// the hover box of a tip: its full name, with support and branch length when the tree has them
await page.mouse.move(...Object.values(await ev((l) => __tipAt(l), tip0)));
await page.waitForTimeout(250);
{
  const box = await page.locator('.phylo-tooltip .ex-tip--node').innerText();
  const full = await ev((l) => l.replace(/_/g, ' '), tip0);
  ok(box.includes(full) && !box.includes('Click'), `the hover box of a tip gives its full name: "${box.replace(/\n/g, ' | ')}"`);
}
// a tip: Info, Reroot here, Colour…
await openMenu(await ev((l) => __tipAt(l), tip0));
ok((await menuItems()).join('|') === 'Info|Reroot here|Colour…', `a tip's menu: ${(await menuItems()).join(' | ')}`);
await act('info');
ok(
  (await page.locator('.ex-info-name').count()) === 1 && (await page.locator('.ex-info-name').innerText()) === tip0.replace(/_/g, ' '),
  'Info opens the inspector',
);
ok((await page.locator('.ex-info-rows dt', { hasText: 'Root distance' }).count()) === 1, 'inspector: root distance');
const infoFonts = await ev(() => [...document.querySelectorAll('.ex-info-rows dd')].map((d) => getComputedStyle(d).fontFamily));
ok(
  infoFonts.length >= 2 && infoFonts.every((f) => /ui-monospace|monospace/.test(f)),
  `the inspector's numbers are monospace (${infoFonts.length} values)`,
);
ok(/system-ui/.test(await ev(() => getComputedStyle(document.querySelector('.ex-info-rows dt')).fontFamily)), 'and its labels are the page font');
ok(
  await ev(() =>
    [...document.querySelectorAll('.ex-info, .ex-outer .ex-row')].every((el) =>
      [...el.querySelectorAll('*')].every((n) => Number(getComputedStyle(n).fontWeight) < 700),
    ),
  ),
  'nothing in the inspector or toolbar is bolder than 600',
);
// the selection (#61): the tip Info was opened on is selected, and it stays across Layout and Phylo/Clado switches, in view with its ring (the fitted view stays fitted, #56)
{
  const id = await ev((l) => __v().tipNode(l), tip0);
  ok((await ev(() => __v().getSelected())) === id, "the clicked tip is the viewer's selection");
  // the ring: some pixel of the overlay canvas on the circle of selectionRadius around the tip
  const ring = () =>
    ev((n) => {
      const v = __v();
      const p = v.locateNode(n);
      if (!p) return { inView: false, ring: false };
      const top = v.treeElement.querySelectorAll('canvas')[1];
      const r = top.getBoundingClientRect();
      const k = top.width / r.width;
      const rad = v.getTheme().selectionRadius;
      const data = top.getContext('2d').getImageData(0, 0, top.width, top.height).data;
      let hits = 0;
      for (let a = 0; a < 16; a++) {
        const x = Math.round((p.x - r.left + rad * Math.cos((a * Math.PI) / 8)) * k);
        const y = Math.round((p.y - r.top + rad * Math.sin((a * Math.PI) / 8)) * k);
        if (data[(y * top.width + x) * 4 + 3] > 100) hits++;
      }
      const pane = v.treeElement.getBoundingClientRect();
      return { inView: true, ring: hits >= 12, dx: (p.x - pane.left) / pane.width, dy: (p.y - pane.top) / pane.height };
    }, id);
  const keeps = async (what) => {
    await page.waitForTimeout(300);
    const r = await ring();
    const name = (await page.locator('.ex-info-name').count()) ? await page.locator('.ex-info-name').innerText() : '';
    ok(
      (await ev(() => __v().getSelected())) === id && name === tip0.replace(/_/g, ' ') && r.inView && r.ring,
      `${what}: the inspector still shows the tip, which is in view (at ${r.dx?.toFixed(2)}, ${r.dy?.toFixed(2)} of the pane) with its ring`,
    );
  };
  await keeps('selected');
  await page.locator('button[title=Circular]').click();
  await keeps('Circular');
  ok(await ev(() => __v().vs.fitted), 'Circular: the view is fitted, as it was: a switch does not go to the selection (#56)');
  await page.locator('button[title=Rectangular]').click();
  await keeps('back to Rectangular');
  await moreToggle('Cladogram');
  await keeps('Cladogram');
  await moreToggle('Phylogram');
  await keeps('back to Phylogram');
  await page.locator('.ex-btn[title="Fit tree"]').click();
  await page.waitForTimeout(200);
}
await page.locator('.ex-info-head button').click();
await ev(() => __v().setSelected(null));
ok((await page.locator('.ex-info').count()) === 0, 'closing the inspector');
// a clade: Info, Collapse, Show only, Reroot here, Colour…
const rows = () => ev(() => __v().layout.rows);
const before = await rows();
const tips = await ev(() => __v().getTree().tipCount);
const c1 = await ev(() => __clade(4, 10));
await openMenu(c1);
ok((await menuItems()).join('|') === 'Info|Collapse|Show only|Reroot here|Colour…', `a clade's menu: ${(await menuItems()).join(' | ')}`);
ok((await rows()) === before, 'a plain click on a clade collapses nothing (it opens the menu)');
// one line per item, no descriptions; a header with the name, a close button and a line under it (#68)
ok(
  (await menu.locator('.phylo-node-menu__hint').count()) === 0 &&
    (await menu.locator('.phylo-node-menu__item').allInnerTexts()).every((t) => !t.trim().includes('\n')),
  'the menu items are single lines, with no descriptions',
);
{
  const head = await ev(() => {
    const h = document.querySelector('.phylo-node-menu__head');
    const s = getComputedStyle(h);
    return {
      title: h.querySelector('.phylo-node-menu__title')?.textContent,
      close: h.querySelectorAll('.phylo-node-menu__close').length,
      line: s.borderBottomWidth,
    };
  });
  ok(
    head.title === `Clade, ${c1.tips} tips` && head.close === 1 && head.line === '1px',
    `the menu header: name, close button, a line under it (${JSON.stringify(head)})`,
  );
}
// the node the menu is for keeps a ring while the pointer is in the menu (#65): it is selected, and the selection ring stays
{
  const item = await menu.locator('.phylo-node-menu__item').nth(2).boundingBox();
  await page.mouse.move(item.x + item.width / 2, item.y + item.height / 2, { steps: 4 });
  await page.waitForTimeout(250);
  const hits = await ringHits(c1.node, 'selectionRadius');
  ok(
    (await menu.count()) === 1 && (await ev(() => __v().getSelected())) === c1.node && hits >= 12,
    `with the pointer in the menu, the clade it is for keeps its ring (${hits} of 16 points)`,
  );
}
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
ok((await menu.count()) === 0 && (await rows()) === before, 'Escape closes the menu');
await openMenu(c1);
await menu.locator('.phylo-node-menu__close').click();
await page.waitForTimeout(150);
ok(
  (await menu.count()) === 0 && (await rows()) === before && (await page.locator('.ex-info').count()) === 0,
  'the close button closes the menu, and does nothing else',
);
await openMenu(c1);
await page.mouse.click(8, 8);
await page.waitForTimeout(150);
ok((await menu.count()) === 0 && (await rows()) === before, 'a click outside closes the menu');
// the keyboard: the tree's cursor and Enter open the same menu
await page.locator('.phylo-tree').focus();
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
ok((await menu.count()) === 1 && (await menuItems()).includes('Info'), 'Enter on the keyboard cursor opens the node menu');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
// collapsing is the viewer's: the tree is the same object with the same tips, and the collapsed clade is one row
await collapseAt(c1);
const after = await rows();
ok(after === before - c1.tips + 1, `Collapse in the menu collapses the clade (${before} → ${after} rows)`);
ok((await ev(() => __v().getTree().tipCount)) === tips, 'and the tree still has all its tips');
ok((await btn('Expand all').count()) === 1 && (await page.locator('.ex-expand .ex-count').innerText()) === '1', 'Expand all appears with the count');
const tri = await ev((n) => {
  const b = __v().nodeBounds(n);
  return b ? { x: b.x + b.width * 0.8, y: b.y + b.height / 2 } : null;
}, c1.node);
ok(tri !== null, 'the collapsed clade is one triangle with the id of the clade');
// a click on the triangle expands it (drill-down, #57): no menu; a clade this small opens whole
await click(tri);
ok((await menu.count()) === 0 && (await rows()) === before && (await btn('Expand all').count()) === 0, 'a click on a collapsed clade expands it');
await collapseAt(c1);
// a collapsed clade's menu, from a click on its branch: Expand, Info, Show only, Colour…
await openMenu(await ev((n) => __stem(n), c1.node));
ok((await menuItems()).join('|') === 'Expand|Info|Show only|Colour…', `a collapsed clade's menu: ${(await menuItems()).join(' | ')}`);
await act('expand');
ok((await rows()) === before && (await btn('Expand all').count()) === 0, 'Expand in the menu opens it again');
await collapseAt(await ev(() => __clade(4, 10)));
await collapseAt(await ev(() => __clade(4, 10, 3)));
await collapseAt(await ev(() => __clade(2, 2)));
await collapseAt(await ev(() => __clade(2, 2, 2)));
const labs = await ev(() => __v().getTree().tipLabels);
ok(new Set(labs).size === labs.length && labs.length === tips, 'four collapsed clades: no tip label is made up, tip labels are still unique');
ok((await rows()) < before - 4, `four collapsed clades are four rows (${await rows()} of ${before})`);
await btn('Expand all').click();
await page.waitForTimeout(150);
ok((await rows()) === before, 'Expand all');
// the root: Info, Colour… (no Reroot)
await openMenu(
  await ev(() => {
    const q = __v().locateNode(0);
    return { x: q.x, y: q.y };
  }),
);
ok((await menuItems()).join('|') === 'Info|Colour…', `the root's menu: ${(await menuItems()).join(' | ')}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
// Colour… offers the palette for this clade
await openMenu(await ev(() => __clade(4, 10)));
await act('colour');
ok((await page.locator('.ex-palette[aria-label="Colour this clade"] .ex-swatch').count()) === 12, 'Colour… opens a palette of 12 swatches');
await page.locator('.ex-palette button[aria-label=Violet]').click();
ok(
  (await ev(() => __v().getClades().length)) === 1 && (await page.locator('.ex-palette').count()) === 0,
  'a swatch colours the clade and closes the palette',
);
await openMenu(await ev(() => __clade(4, 10)));
await act('colour');
await page.locator('.ex-palette .ex-erase').click();
ok((await ev(() => __v().getClades().length)) === 0, 'Erase in it removes the colour');
await ev(() => __v().fit(false));
await page.waitForTimeout(200);

// the tree is dated and the triangle ends at the clade's tips, so the axis keeps its title ("time before tips", the viewer reads the
// tree as it is; collapsing a copy with tree-ops collapseClades flipped it to "distance from root" without { extend }, issue #19)
{
  const axis = () => ev(() => window.__axis);
  ok(/^time before tips/.test(await axis()), `dated tree: axis "${await axis()}"`);
  await ev(() => (window.__axis = null)); // a stale title must not pass
  // zoomed in on y: collapsing keeps the window's scale (it used to re-create the viewer and fit again)
  await ev(() => {
    const f = __v().fitViewport();
    __v().setViewport({ ...f, y1: f.y0 + (f.y1 - f.y0) / 3 });
  });
  await page.waitForTimeout(150);
  const z0 = await span();
  await collapseAt(await ev(() => __clade(4, 10)));
  await page.waitForTimeout(200);
  ok((await rows()) < before, 'a clade is collapsed');
  const z1 = await span();
  ok(
    Math.abs(z1.h - z0.h) < 1e-9 && Math.abs(z1.w - z0.w) < 1e-9,
    `collapsing does not reset the zoom (${z0.h.toFixed(1)} rows in view before, ${z1.h.toFixed(1)} after)`,
  );
  ok(/^time before tips/.test(await axis()), `after a collapse the axis stays: "${await axis()}"`);
  await btn('Expand all').click();
  await ev(() => __v().fit(false));
  await page.waitForTimeout(150);
}

console.log('colour');
// a colour for one clade from the node menu's Colour… palette
const colourVia = async (pos, name) => {
  await openMenu(pos);
  await act('colour');
  await page.locator(`.ex-palette button[aria-label=${name}]`).click();
  await page.waitForTimeout(100);
};
const eraseVia = async (pos) => {
  await openMenu(pos);
  await act('colour');
  await page.locator('.ex-palette .ex-erase').click();
  await page.waitForTimeout(100);
};
const big = await ev(() => __clade(20, 40));
await colourVia(big, 'Pink');
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
await colourVia(small, 'Teal');
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
await eraseVia(small);
cl = await ev(() => __v().getClades());
ok(cl.length === 1 && cl[0].node === big.node, 'Erase removes a clade colour');
// the other order: outer clade painted after the inner one, and still the innermost wins (the viewer, not the order)
await eraseVia(big);
await colourVia(small, 'Teal');
await colourVia(big, 'Pink');
cl = await ev(() => __v().getClades());
ok(cl.length === 2 && cl[0].node === small.node && cl[1].node === big.node, 'inner clade first, outer last');
px = await inner();
ok(px.teal > 0 && px.teal > px.pink, `the innermost colour still wins (teal ${px.teal}, pink ${px.pink})`);
await eraseVia(small);
ok((await page.locator('.ex-palette').count()) === 0, 'the palette closes after a choice');
ok((await btn('Clear colours').locator('.ex-count').innerText()) === '1', 'Clear colours shows the count');
await btn('Clear colours').click();
ok((await ev(() => __v().getClades().length)) === 0 && (await btn('Clear colours').count()) === 0, 'Clear colours removes them all');

console.log('click actions');
{
  const sel = page.locator('select[aria-label="Click action"]');
  ok((await sel.inputValue()) === 'inspect', 'the click action starts as Inspect');
  const lit = () =>
    page
      .locator('.ex-select', { has: sel })
      .evaluate((e) => ({ active: e.classList.contains('ex-select--active'), bg: getComputedStyle(e).backgroundColor }));
  const primary = await ev(() => {
    const s = document.createElement('span');
    s.style.color = getComputedStyle(document.documentElement).getPropertyValue('--ex-primary');
    document.body.append(s);
    const c = getComputedStyle(s).color;
    s.remove();
    return c;
  });
  ok((await lit()).active === false && (await lit()).bg !== primary, 'Inspect: the select is not highlighted');
  ok(
    (await sel.locator('option').allInnerTexts()).join() === 'Inspect,Collapse,Subtree,Reroot,Colour',
    'the click actions: Inspect, Collapse, Subtree, Reroot, Colour',
  );
  const rows0 = await rows();
  await sel.selectOption('collapse');
  ok((await lit()).active && (await lit()).bg === primary, 'another click action: the select is blue');
  await click(await ev(() => __clade(4, 10)));
  ok((await rows()) < rows0 && (await menu.count()) === 0, 'Collapse: a click on a clade collapses it, and no menu opens');
  const rowsCollapsed = await rows();
  const stem = await ev(() => {
    const t = __v().getTree();
    for (let i = 1; i < t.nodeCount; i++) {
      if (!__v().layout.collapsed?.[i]) continue;
      const b = __v().nodeBounds(i);
      return { x: b.x + b.width * 0.8, y: b.y + b.height / 2 };
    }
    return null;
  });
  await click(stem);
  ok((await rows()) > rowsCollapsed, 'Collapse: a click on a collapsed clade opens it again');
  await sel.selectOption('subtree');
  await click(await ev(() => __clade(20, 40)));
  await page.waitForTimeout(300);
  ok(
    (await page.locator('.ex-group[aria-label="Clade shown"]').count()) === 1 && (await menu.count()) === 0,
    'Subtree: a click on a clade shows only that clade (Back to root is offered), and no menu opens',
  );
  await toRoot();
  await page.waitForTimeout(300);
  await sel.selectOption('reroot');
  const order0 = await ev(() => __order());
  await click(await ev((l) => __tipAt(l), await ev(() => __v().getTree().tipLabels[3])));
  await page.waitForTimeout(300);
  ok(
    JSON.stringify(await ev(() => __order())) !== JSON.stringify(order0) && (await menu.count()) === 0,
    'Reroot: a click on a tip roots the tree there, and no menu opens',
  );
  await page.locator('.ex-outer').press('Control+z');
  await page.waitForTimeout(300);
  await sel.selectOption('colour');
  const palette = await ev(() =>
    ['red', 'orange', 'amber', 'lime', 'emerald', 'teal'].map((n) =>
      getComputedStyle(document.documentElement).getPropertyValue(`--ex-palette-${n}`).trim(),
    ),
  );
  await click(await ev(() => __clade(20, 40)));
  await click(await ev((l) => __tipAt(l), await ev(() => __v().getTree().tipLabels[3])));
  const cc = await ev(() => __v().getClades());
  ok(
    cc.length === 2 && cc[0].colour === palette[0] && cc[1].colour === palette[5],
    `Colour: each click takes the colour 5 swatches on (${cc.map((c) => c.colour).join(' ')})`,
  );
  // a second click on a coloured clade takes its colour off, a third gives it a new one
  await click(await ev(() => __clade(20, 40)));
  ok((await ev(() => __v().getClades().length)) === 1, 'Colour: a click on a coloured clade takes its colour off');
  await click(await ev(() => __clade(20, 40)));
  const again = await ev(() => __v().getClades());
  ok(again.length === 2 && again[1].colour !== palette[0] && again[1].colour !== palette[5], 'and the next click gives it a new colour');
  await page.locator('.ex-outer').press('Escape');
  ok((await sel.inputValue()) === 'inspect', 'Escape goes back to Inspect');
  await btn('Clear colours').click();
  await colourVia(big, 'Pink'); // one colour stays for the Undo check below
}

console.log('tree operations');
// the earlier steps moved the view and an edit keeps it now: start from the whole tree
await page.locator('.ex-btn[title="Fit tree"]').click();
await page.waitForTimeout(200);
const o0 = await ev(() => __order());
const rt = await ev(() => __v().getTree().tipLabels[5]);
await openMenu(await ev((l) => __tipAt(l), rt));
await act('reroot');
await page.waitForTimeout(200);
ok((await ev(() => __order())) !== o0 && (await hasReset()), 'Reroot here on a tip changes the tree, Reset is offered in the menu');
await page.locator('.ex-outer').press('Escape');
await undo();
await page.waitForTimeout(200);
ok((await ev(() => __order())) === o0 && !(await hasReset()), 'Undo restores the tree');
ok((await ev(() => __v().getClades().length)) === 1, 'and the colour');
await openMenu(await ev((l) => __tipAt(l), await ev(() => __v().getTree().tipLabels[9])));
await act('reroot');
await page.waitForTimeout(200);
const o1 = await ev(() => __order());
ok(o1 !== o0, 'a second reroot changes the tree');
await page.keyboard.press('Escape');
await page.locator('.phylo-tree').focus();
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
ok((await ev(() => __order())) === o0, 'Ctrl+Z undoes');
// a new tree keeps the renderer: zoom into a clade, Ladderize; Undo returns the tree
console.log('a new tree keeps the renderer');
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
await ladder('descending');
await page.waitForTimeout(300);
ok((await ev(() => __order())) !== orderZ, 'Ladderize reordered the tree');
ok(await ev(() => __v() === window.__viewer && !__v().isDestroyed()), 'the edit went to the same renderer (no new one)');
await page.keyboard.press('Escape');
await undo();
await page.waitForTimeout(300);
ok((await ev(() => __order())) === orderZ, 'Undo returns the tree');
ok(await ev(() => __v() === window.__viewer), 'and still the same renderer');
await page.locator('.ex-btn[title="Fit tree"]').click();
await page.waitForTimeout(200);
await more('Midpoint root');
ok((await toast()).includes('nothing to change'), 'Midpoint on a dated tree: nothing to change');
const o2 = await ev(() => __order());
await ladder('descending');
await page.waitForTimeout(150);
const o3 = await ev(() => __order());
await ladder('ascending');
await page.waitForTimeout(150);
ok(o3 !== o2 && (await ev(() => __order())) !== o3, 'Ladderize both ways');

console.log('export');
await moreButton().click();
await moreItem('Export…').click();
ok(
  (await moreMenu().locator('.ex-menu-label').allInnerTexts()).join(',') === 'Back,PNG 1×,PNG 2×,PNG 4×,Newick,NEXUS',
  'Export… opens the export list in place of the menu: Back, PNG 1×, 2×, 4×, Newick, NEXUS',
);
await moreItem('Back').click();
ok((await moreItem('Export…').count()) === 1, 'Back returns to the main list');
await moreItem('Export…').click();
const pngSize = await ev(() => ({ w: __v().size.width, h: __v().size.height }));
const download = async (label) => {
  if ((await page.locator('.ex-menu[aria-label="Export"]').count()) === 0) {
    if ((await moreMenu().count()) === 0) await moreButton().click();
    await moreItem('Export…').click();
  }
  const dl = page.waitForEvent('download');
  await page.locator('.ex-menu button', { hasText: label }).click();
  const d = await dl;
  return { name: d.suggestedFilename(), data: Buffer.concat(await (await d.createReadStream()).toArray()) };
};
const png1 = await download('PNG 1×');
ok(png1.name === 'phylotree.png' && png1.data.subarray(1, 4).toString() === 'PNG', 'PNG 1× download');
const img = PNG.sync.read(png1.data);
ok(img.data[3] === 255, 'the PNG is opaque');
ok(
  `rgb(${img.data[0]}, ${img.data[1]}, ${img.data[2]})` === paneBg.colour,
  `the PNG's background is the pane's grey, with no background passed to toBlob (${img.data[0]}, ${img.data[1]}, ${img.data[2]})`,
);
ok(img.width === Math.round(pngSize.w) && img.height === Math.round(pngSize.h), `PNG 1× is the view's CSS size (${img.width} x ${img.height})`);
const p2 = await download('PNG 2×');
const img2 = PNG.sync.read(p2.data);
ok(
  p2.name === 'phylotree@2x.png' && img2.width === img.width * 2 && img2.height === img.height * 2,
  `PNG 2× is double the size (${img2.width} x ${img2.height} against ${img.width} x ${img.height})`,
);
const p4 = await download('PNG 4×');
const img4 = PNG.sync.read(p4.data);
ok(img4.width === img.width * 4 && img4.height === img.height * 4, `PNG 4× is four times the size (${img4.width} x ${img4.height})`);
const screenVsBlob = () =>
  ev(async () => {
    // the export equals the screen: the visible canvas against toBlob (the theme's background by default) at the canvas scale, pixel by pixel
    const v = __v();
    v.renderNow();
    const screen = v.treeElement.querySelector('canvas');
    const bm = await createImageBitmap(await v.toBlob());
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
      if (Math.abs(A[i] - A[0]) + Math.abs(A[i + 1] - A[1]) + Math.abs(A[i + 2] - A[2]) > 6) painted++;
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
ok(exp2.corner === 0, 'toBlob({ background: null }) is still transparent');
ok(
  await ev(() => {
    const el = document.querySelector('.phylo-tooltip');
    const cs = getComputedStyle(el);
    return el.classList.contains('phylo-tooltip--bare') && cs.paddingTop === '0px' && cs.boxShadow === 'none' && cs.borderTopStyle === 'none';
  }),
  'the tooltip box is bare (tooltipBare): no padding, border or shadow, and no CSS override in the example',
);
await moreButton().click();
await moreItem('Export…').click();
ok((await moreItem('Newick').locator('.ex-menu-desc').innerText()) === 'Tree', 'on the whole tree the export list says Tree');
const nwk = (await download('Newick')).data.toString();
const tl = await ev(() => __v().getTree().tipLabels);
ok(nwk.startsWith('(') && nwk.trim().endsWith(';') && nwk.includes(tl[0]), 'Newick download of the current tree');
const nexDl = await download('NEXUS');
const nex = nexDl.data.toString();
ok(
  nexDl.name === 'phylotree.nex' && nex.startsWith('#NEXUS') && nex.includes('TRANSLATE') && nex.includes(`NTAX=${tl.length};`),
  'NEXUS download: taxa block, translate table and tree',
);

// shown alone, a clade is what Newick and NEXUS give
{
  await openMenu(await ev(() => __clade(20, 40)));
  await act('subtree');
  await page.waitForTimeout(300);
  await moreButton().click();
  await moreItem('Export…').click();
  ok((await moreItem('Newick').locator('.ex-menu-desc').innerText()) === 'Subtree', 'on a subtree the export list says Subtree');
  const sub = await download('Newick');
  const subTips = await ev(() => __v().getTree().tipCount);
  ok(
    sub.name === 'subtree.nwk' && sub.data.length < nwk.length && sub.data.toString().split(',').length === subTips,
    `Newick of the subtree shown: subtree.nwk with its ${subTips} tips, not the whole tree`,
  );
  const subNex = await download('NEXUS');
  ok(subNex.name === 'subtree.nex' && subNex.data.toString().includes(`NTAX=${subTips};`), 'and NEXUS of it: subtree.nex');
  await toRoot();
  await page.waitForTimeout(300);
}

console.log('dark mode, resize');
const fg = await ev(() => __v().getTheme().branch);
await page.locator('.theme-toggle').click();
await page.waitForTimeout(200);
const fg2 = await ev(() => __v().getTheme().branch);
ok(fg2 !== fg, `dark mode reaches the canvas (branches ${fg} → ${fg2})`);
ok(await ev(() => __v().getTheme().dark === true), 'dark is derived from the opaque dark background (no --phylo-dark by hand)');
{
  const t = await ev(() => __v().getTheme());
  ok(t.supportColour !== '' && t.supportColour === t.lengthColour, `dark: support and length labels share one colour (${t.supportColour})`);
}
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
    window.__nodeTextAt = [];
    __v().invalidate();
    __v().renderNow();
  });
  return ev(() => window.__nodeTexts);
};
await open('edge-internal-support');
await moreToggle('Show support');
await page.waitForTimeout(200);
ok((await ev(() => __v().options.nodeLabels)) === 'support', "Show support sets nodeLabels to 'support'");
let labels = await drawn();
ok(labels.includes('100') && labels.includes('0.95'), `Show support: support values drawn (${labels.join(' ')})`);
ok(labels.length === 2, 'only the two numeric support values; node_EF and the root get none');
await moreToggle('Show branch length');
await page.waitForTimeout(200);
ok((await ev(() => __v().options.nodeLabels)) === 'length', 'Show branch length sets nodeLabels to length, and takes support off');
labels = await drawn();
ok(labels.includes('0.3') && labels.includes('0.4') && labels.includes('0.1'), `Length: branch lengths drawn (${labels.join(' ')})`);
await moreToggle('Show branch length');
await page.waitForTimeout(200);
ok((await drawn()).length === 0 && (await ev(() => __v().options.nodeLabels)) === 'none', 'Both off: no labels');
// lengths on the HCV tree: every label is the length of a node, and the long tip branches have theirs (#66)
await open('rich-hcv-19');
await moreToggle('Show branch length');
await page.waitForTimeout(150);
labels = await drawn();
const hcvLengths = await ev(() => {
  const t = __v().getTree();
  const out = [];
  for (let i = 1; i < t.nodeCount; i++) if (!Number.isNaN(t.length[i])) out.push(String(Number(t.length[i].toPrecision(3))));
  return out;
});
ok(
  labels.length > 0 && labels.every((l) => hcvLengths.includes(l)),
  `HCV: ${labels.length} branch lengths drawn, each the length of a node (${labels.slice(0, 6).join(' ')} ...)`,
);
// the long tip branches at the fitted view: one label each, centred on the branch (the visible part of it) within 1 px
for (const name of ['HCV-2k GB BID-G1242', 'PTR3874']) {
  const r = await ev((name) => {
    const v = __v();
    const t = v.getTree();
    let i = 1;
    while (i < t.nodeCount && !(t.firstChild[i] < 0 && t.tipLabels[t.tipRank[i]].replace(/_/g, ' ').startsWith(name))) i++;
    if (i === t.nodeCount) return null;
    const p = v.nodePosition(i),
      q = v.nodePosition(t.parent[i]);
    const text = String(Number(t.length[i].toPrecision(3)));
    const mine = window.__nodeTextAt.filter((l) => l.text === text && l.align === 'center' && Math.abs(l.y - p.y) < 6);
    return { text, mid: (p.x + q.x) / 2, xs: mine.map((l) => l.x) };
  }, name);
  ok(
    r && r.xs.length === 1 && Math.abs(r.xs[0] - r.mid) <= 1,
    `HCV: the tip branch of ${name} shows its length ${r?.text}, centred (${r?.xs.map((x) => x.toFixed(1)).join(',')} vs ${r?.mid.toFixed(1)})`,
  );
}
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
ok(await moreEnabled('Show support'), 'the menu offers Show support on a tree whose support is an annotation');
await moreToggle('Show support');
await page.waitForTimeout(150);
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

// ---------------------------------------------------------------- length labels sit on their branch (#53)
console.log('length labels on the branch');
await open('rich-fish-carangaria-135');
await moreToggle('Show branch length');
ok((await ev(() => __v().options.nodeLabels)) === 'length', 'lengths on');
// every drawn length is centred on the visible part of its own horizontal branch (the viewer's clip), at two zooms
const lengthLabelsOff = async (vp) =>
  ev(async (vp) => {
    const v = __v();
    const seen = [];
    const ft = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t, x, y, ...r) {
      if (this.textBaseline === 'bottom' && this.textAlign === 'center') seen.push({ t: String(t), x, y });
      return ft.call(this, t, x, y, ...r);
    };
    v.setViewport({ ...v.getViewport(), ...vp });
    await new Promise((r) => setTimeout(r, 400));
    CanvasRenderingContext2D.prototype.fillText = ft;
    const tree = v.getTree();
    const { proj } = v;
    const p = { x: 0, y: 0 },
      q = { x: 0, y: 0 };
    const off = [];
    for (const l of seen) {
      let best = Infinity;
      for (let i = 1; i < tree.nodeCount; i++) {
        if (String(Number(tree.length[i].toPrecision(3))) !== l.t) continue; // tips too (#66)
        proj.nodeXY(i, p);
        proj.parentXY(i, q);
        if (Math.abs(p.y - 2 - l.y) > 1) continue;
        const mid = (Math.max(q.x, proj.T.clipL) + Math.min(p.x, proj.T.clipR)) / 2;
        best = Math.min(best, Math.abs(mid - l.x));
      }
      if (!(best <= 1)) off.push(`${l.t}@${Math.round(l.x)} (${best})`);
    }
    return { n: seen.length, off };
  }, vp);
for (const [name, vp] of [
  ['top of the tree', { x0: 0, x1: 1, y0: 0, y1: 18 }],
  ['x zoomed in 2.5x on the right', { x0: 0.6, x1: 1, y0: 20, y1: 38 }],
  ['x zoomed in 1.7x on the left (long stems end past the plot)', { x0: 0, x1: 0.6, y0: 0, y1: 18 }],
]) {
  const r = await lengthLabelsOff(vp);
  ok(
    r.n >= 5 && r.off.length === 0,
    `length labels centred on their visible branch, ${name}: ${r.n} drawn, off by more than 1 px: ${r.off.join(' ') || 'none'}`,
  );
}

// ---------------------------------------------------------------- aligned labels
console.log('aligned labels');
await open('rich-hcv-19');
const anchorXs = () =>
  ev(() => [...document.querySelectorAll('.phylo-tree [data-tip-id]')].map((a) => Math.round(a.getBoundingClientRect().left * 10) / 10));
await page.waitForTimeout(300);
const ragged = await anchorXs();
ok(
  ragged.length > 5 && new Set(ragged).size > 3,
  `labels follow their tips by default (${ragged.length} anchors, ${new Set(ragged).size} different x)`,
);
ok((await moreEnabled('Align labels')) && (await ev(() => __v().options.alignLabels)) === false, 'Align labels is enabled, off by default');
await moreToggle('Align labels');
await page.waitForTimeout(400);
const aligned = await anchorXs();
ok(aligned.length > 5 && new Set(aligned).size === 1, `Align: the label anchors share one x (${aligned.length} anchors at ${aligned[0]})`);
ok((await ev(() => __v().options.alignLabels)) === true && (await moreChecked('Align labels')), 'Align sets the option and shows as checked');
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
await openMenu({ x: lab.x, y: lab.y });
await act('info');
ok(
  (await page.locator('.ex-info-name').count()) === 1 && (await page.locator('.ex-info-name').innerText()) === lab.id.replace(/_/g, ' '),
  'clicking an aligned label opens the node menu of its tip (Info shows the inspector)',
);
await page.locator('.ex-info-head button').click();
await moreToggle('Align labels');
await page.waitForTimeout(300);
ok(new Set(await anchorXs()).size > 3, 'Align off: the labels follow their tips again');

// ---------------------------------------------------------------- summaries
console.log('summaries');
await open('syn-yule-10000');
await page.waitForTimeout(1500);
// one look for every summary (#85): no Stripes toggle, the background and stripes are always drawn
ok((await page.locator('.ex-outer button', { hasText: /^\s*Stripes\s*$/ }).count()) === 0, 'no Stripes toggle');
ok((await ev(() => __v().options.minCladePx)) === 'auto', 'a big tree: the library’s smallest clade, auto (#115, #122)');
// the stripe checks need summaries tall enough to carry stripes: 14 px here (the explorer used it for big trees before #115)
await ev(() => {
  __v().setOptions({ minCladePx: 14 });
  __v().renderNow();
});
// count the stripe segments of a frame: lineTo calls while the stroke style is the summary colour, on the viewer's context
const stripeCount = (colour) =>
  ev((colour) => {
    const v = __v();
    v.setTheme({ ...v.getTheme(), summary: colour });
    const ctx = v.ctx;
    const orig = { stroke: ctx.stroke, lineTo: ctx.lineTo };
    let n = 0;
    ctx.lineTo = function (...a) {
      if (this.strokeStyle === colour) n++;
      return orig.lineTo.apply(this, a);
    };
    v.invalidate();
    v.renderNow();
    ctx.lineTo = orig.lineTo;
    return n;
  }, colour);
const withStripes = await stripeCount('#ff0000');
ok(withStripes > 20, `the frame draws stripe segments in the summary colour (${withStripes})`);
await ev(() => __v().setTheme({}));

// ---------------------------------------------------------------- show only a clade, Up one level, Back to root
console.log('show only this clade, Up one level, Back to root');
await open('rich-fish-carangaria-135');
const tipCount = () => ev(() => __v().getTree().tipCount);
const whole = await tipCount();
ok((await page.locator('.ex-group[aria-label="Clade shown"]').count()) === 0, 'no Back to root / Up while the whole tree is shown');
const c60 = await ev(() => __clade(20, 60));
await openMenu(c60);
await act('subtree');
ok((await tipCount()) === c60.tips, `Show only this clade shows its ${c60.tips} tips (${await tipCount()})`);
ok(
  (await page.locator('.ex-group[aria-label="Clade shown"] button', { hasText: 'Back to root' }).isEnabled()) &&
    (await btn('Up one level').isEnabled()),
  'Back to root and Up one level are enabled',
);
// on a phone the two buttons keep their icons and lose their words
await page.setViewportSize({ width: 400, height: 860 });
{
  const words = await page
    .locator('.ex-group[aria-label="Clade shown"] .ex-btn-text')
    .evaluateAll((es) => es.map((e) => getComputedStyle(e).display));
  const labels = await page.locator('.ex-group[aria-label="Clade shown"] button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
  ok(
    words.length === 2 && words.every((d) => d === 'none') && labels.join() === 'Back to root,Up one level',
    `at 400 px: icons only, still named (${labels.join(', ')})`,
  );
}
await page.setViewportSize({ width: 1280, height: 860 });
ok(await page.locator('.ex-group[aria-label="Clade shown"] .ex-btn-text').first().isVisible(), 'at 1280 px: with their words');
await page.waitForTimeout(300);
const rootPos = await ev(() => {
  const q = __v().locateNode(0);
  return { x: q.x, y: q.y };
});
await openMenu(rootPos);
ok(
  (await menuItems()).slice(0, 2).join('|') === 'Up one level|Back to root',
  `the root of the clade shown leads out of it: ${(await menuItems()).join(' | ')}`,
);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
await btn('Up one level').click();
await page.waitForTimeout(300);
const up = await tipCount();
ok(up > c60.tips, `Up one level shows the clade that contains it (${up} tips)`);
await toRoot();
await page.waitForTimeout(300);
ok(
  (await tipCount()) === whole && (await page.locator('.ex-group[aria-label="Clade shown"]').count()) === 0,
  'Back to root returns to the whole tree, and the two buttons go',
);
// an edit keeps the clade shown: Ladderize while a clade is shown alone
await openMenu(await ev(() => __clade(20, 60)));
await act('subtree');
await page.waitForTimeout(300);
await ladder('descending');
await page.waitForTimeout(300);
ok((await tipCount()) === c60.tips && (await hasReset()), 'Ladderize inside the clade shown keeps it shown');
await undo();
await page.waitForTimeout(300);
ok((await tipCount()) === c60.tips, 'and so does Undo');

// the crash path: the hover box is rendered with the last hover event, which held a node id of the tree shown before the change.
// Hover, then Show only / Up / Back to root with colours, a collapsed clade and the pointer moving over the new tree
// (any page error or console.error fails the run, see the handlers at the top)
console.log('Show only, Up, Back to root with hover, colours and collapse: no page errors');
{
  const errorsBefore = failures;
  await open('rich-fish-carangaria-135');
  await colourVia(await ev(() => __clade(20, 40)), 'Teal');
  await collapseAt(await ev(() => __clade(4, 10)));
  await page.waitForTimeout(300);
  for (const co of [false, true]) {
    const c = await ev((co) => {
      const v = __v();
      const t = v.getTree();
      for (let i = 1; i < t.nodeCount; i++)
        if (t.firstChild[i] >= 0 && t.leafEnd[i] - t.leafStart[i] >= 3 && !!v.layout.collapsed?.[i] === co) {
          const q = v.locateNode(i);
          if (q) return co ? __stem(i) : q; // a click on a collapsed clade's triangle expands it; its branch opens the menu
        }
      return null;
    }, co);
    if (!c) continue;
    await page.mouse.move(c.x, c.y);
    await page.waitForTimeout(150);
    await openMenu(c);
    await act('subtree');
    for (const step of [null, 'Up one level', 'Back to root']) {
      if (step) {
        const b = page.locator('.ex-group[aria-label="Clade shown"] button', { hasText: step });
        if (await b.count()) await b.click(); // Up one level can end on the whole tree, where there is no Back to root
      }
      for (let k = 0; k < 6; k++) await page.mouse.move(300 + k * 90, 300 + k * 20);
      await page.waitForTimeout(250);
    }
  }
  ok(failures === errorsBefore, 'no page error or console.error during Show only, Up and Back to root');
}

// the tooltip function was called on every render with the last hover event, also after the tree had changed and the box was hidden
console.log('a visible tooltip while the tree changes: no page errors');
{
  const errorsBefore = failures;
  await open('rich-fish-carangaria-135');
  const lastTip = () =>
    ev(() => {
      const v = __v();
      const t = v.getTree();
      const q = v.locateNode(t.tipNode[t.tipCount - 1]);
      return { x: q.x, y: q.y };
    });
  const hoverUntilTooltip = async (p) => {
    await page.mouse.move(p.x - 30, p.y);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    await page.waitForSelector('.phylo-tooltip:not([hidden])', { timeout: 3000 });
  };
  // the keyboard changes the tree while the pointer stays on the tip, so the tooltip is still showing when it does
  const pressOnButton = async (selector) => {
    await ev((sel) => document.querySelector(sel).focus(), selector);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
  };
  await hoverUntilTooltip(await lastTip());
  ok((await page.locator('.phylo-tooltip .ex-tip--node').count()) === 1, 'the tooltip of the last tip is showing');
  const c = await ev(() => __clade(20, 60));
  await page.mouse.move(c.x, c.y);
  await openMenu(c);
  await act('subtree');
  await page.waitForTimeout(300);
  const inClade = await ev(() => {
    const v = __v();
    const t = v.getTree();
    const q = v.locateNode(t.tipNode[2]);
    return { x: q.x, y: q.y };
  });
  await hoverUntilTooltip(inClade);
  await pressOnButton('.ex-group[aria-label="Clade shown"] button:last-child'); // Up one level, with the tooltip showing
  await hoverUntilTooltip(await lastTip().catch(() => inClade)).catch(() => {});
  await pressOnButton('.ex-group[aria-label="Clade shown"] button:first-child'); // Back to root
  ok(failures === errorsBefore, 'no page error or console.error with the tooltip showing during Show only, Up and Back to root');
}

// Reroot inside a clade shown alone would split it: the menu leaves it out
console.log('reroot inside a clade shown alone');
{
  await open('rich-fish-carangaria-135');
  const c = await ev(() => __clade(20, 60));
  await openMenu(c);
  await act('subtree');
  await page.waitForTimeout(400);
  const inner = await ev(() => __clade(3, 8));
  await openMenu(inner);
  ok(!(await menuItems()).includes('Reroot here'), `no Reroot here for a node strictly inside the clade shown (${(await menuItems()).join(' | ')})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // the root of the clade shown may be rooted on
  await openMenu(
    await ev(() => {
      const q = __v().locateNode(0);
      return { x: q.x, y: q.y };
    }),
  );
  ok((await menuItems()).includes('Reroot here'), 'the root of the clade shown still offers Reroot here');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // Undo does not undo navigation: Ladderize inside the clade, Back to root, Undo: still the whole tree
  await ladder('descending');
  await page.waitForTimeout(300);
  await toRoot();
  await page.waitForTimeout(300);
  const wholeTips = await tipCount();
  await undo();
  await page.waitForTimeout(400);
  ok((await tipCount()) === wholeTips && wholeTips > c.tips, `Undo leaves the navigation alone (the whole tree stays shown, ${wholeTips} tips)`);
}

// Colour… opens its palette where the click was and moves focus into it
console.log('Colour… palette');
{
  await open('rich-fish-carangaria-135');
  const c = await ev(() => __clade(4, 10));
  await openMenu(c);
  await act('colour');
  const pal = await page.locator('.ex-palette--near').boundingBox();
  const out = await page.locator('.ex-outer').boundingBox();
  ok(
    Math.abs(pal.x - Math.min(c.x, out.x + out.width - 262)) < 30 && pal.y > c.y - 40 - 0 && pal.y < c.y + 80,
    `the palette is near the click (palette ${Math.round(pal.x)},${Math.round(pal.y)}; click ${Math.round(c.x)},${Math.round(c.y)})`,
  );
  ok(await ev(() => document.activeElement?.closest('.ex-palette') !== null), 'focus is inside the palette');
  await page.keyboard.press('Escape');
  ok((await page.locator('.ex-palette').count()) === 0, 'Escape closes it');
}

// every popover has the one corner rounding of --ex-popover-radius, and what is inside one a smaller one from it (#68); the node menu
// is styled as the inspector: the same panel and header
console.log('one popover radius, the node menu styled as the inspector');
{
  await open('rich-fish-carangaria-135');
  const radius = (sel) => ev((q) => (document.querySelector(q) ? getComputedStyle(document.querySelector(q)).borderTopLeftRadius : null), sel);
  const r = {};
  const items = {};
  const c = await ev(() => __clade(4, 10));
  await page.mouse.move(c.x, c.y, { steps: 3 });
  await page.locator('.ex-tip').waitFor({ timeout: 3000 });
  r['hover box'] = await radius('.ex-tip');
  await openMenu(c);
  await act('info');
  await openMenu(c);
  r.inspector = await radius('.ex-info');
  r['node menu'] = await radius('.phylo-node-menu');
  items['node menu item'] = await radius('.phylo-node-menu__item');
  items['node menu close'] = await radius('.phylo-node-menu__close');
  items['inspector close'] = await radius('.ex-info-head button');
  const look = await ev(() => {
    const pick = (q, props) => {
      const s = getComputedStyle(document.querySelector(q));
      return props.map((k) => s[k]).join(' ; ');
    };
    const panel = ['backgroundColor', 'borderTopColor', 'borderTopWidth', 'boxShadow'];
    const head = ['paddingTop', 'paddingLeft', 'borderBottomWidth', 'borderBottomColor'];
    const title = ['fontFamily', 'fontSize', 'fontWeight', 'color'];
    return {
      panel: [pick('.ex-info', panel), pick('.phylo-node-menu', panel)],
      head: [pick('.ex-info-head', head), pick('.phylo-node-menu__head', head)],
      title: [pick('.ex-info-name', title), pick('.phylo-node-menu__title', title)],
    };
  });
  for (const [k, [a, b]] of Object.entries(look)) ok(a === b, `the node menu's ${k} looks like the inspector's (${b})`);
  // a different radius reaches every popover open now
  await ev(() => document.documentElement.style.setProperty('--ex-popover-radius', '4px'));
  const changed = [await radius('.ex-info'), await radius('.phylo-node-menu'), await radius('.phylo-node-menu__item')];
  await ev(() => document.documentElement.style.removeProperty('--ex-popover-radius'));
  ok(changed.join(',') === '4px,4px,2.4px', `--ex-popover-radius changes the popovers and their items (${changed.join(', ')})`);
  await page.keyboard.press('Escape'); // the menu, and the inspector with it
  await page.waitForTimeout(150);
  if (await page.locator('.ex-info').count()) await page.locator('.ex-info-head button').click();
  await openMenu(c);
  await act('colour');
  r.palette = await radius('.ex-palette');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await openMenu(c);
  await act('subtree'); // a toast says what is shown
  await page.locator('.ex-toast').waitFor({ timeout: 3000 });
  r.toast = await radius('.ex-toast');
  await page.locator('.ex-export button').first().click();
  await page.locator('.ex-menu').waitFor({ timeout: 3000 });
  r['toolbar menu'] = await radius('.ex-menu');
  items['toolbar menu item'] = await radius('.ex-menu button');
  await page.locator('.ex-export button').first().click();
  await page.locator('button[aria-label="Search tips"]').click();
  await page.locator('.ex-search').waitFor({ timeout: 3000 });
  r.search = await radius('.ex-search');
  items['search close'] = await radius('.ex-search-close');
  await page.keyboard.press('Escape');
  const one = new Set(Object.values(r));
  ok(one.size === 1 && !one.has(null) && !one.has('0px'), `one radius for every popover (${JSON.stringify(r)})`);
  const inner = new Set(Object.values(items));
  ok(
    inner.size === 1 && parseFloat([...inner][0]) < parseFloat([...one][0]) && parseFloat([...inner][0]) > 0,
    `a smaller one for what is inside them (${JSON.stringify(items)})`,
  );
}

// the toolbar keeps its two rows at 1280, 1024 and 600 px (below that it scrolls sideways)
console.log('toolbar rows');
for (const w of [1280, 1024, 600]) {
  await page.setViewportSize({ width: w, height: 860 });
  await open('rich-fish-carangaria-135');
  await page.waitForTimeout(200);
  const rows = await page.locator('.ex-row').evaluateAll((rs) => rs.map((r) => Math.round(r.getBoundingClientRect().height)));
  ok(rows.length === 2 && rows.every((h) => h < 50), `${w} px: two single-line rows (${rows.join(', ')} px)`);
  // Export and Search stay in view whatever the row scrolls; a row that overflows says so (data-end on the scroller, a fade)
  const vis = await ev(() =>
    ['.ex-export button', 'button[aria-label="Search tips"]'].map((q) => {
      const r = document.querySelector(q).getBoundingClientRect();
      const o = document.querySelector('.ex-outer').getBoundingClientRect();
      return r.width > 0 && r.left >= o.left && r.right <= o.right;
    }),
  );
  ok(vis[0] && vis[1], `${w} px: ⋮ and Search are inside the toolbar`);
  const row1 = await ev(() => {
    const r = document.querySelector('.ex-row');
    return { over: r.scrollWidth > r.clientWidth + 1, end: r.hasAttribute('data-end'), start: r.hasAttribute('data-start') };
  });
  ok(row1.over === row1.end && !row1.start, `${w} px: the View row ${row1.over ? 'overflows and shows the fade' : 'fits, no fade'}`);
  await moreButton().click();
  ok(
    (await page.locator('.ex-menu').count()) === 1 && (await page.locator('.ex-menu button').first().isVisible()),
    `${w} px: the ⋮ button is clickable and opens its menu`,
  );
  await moreButton().click();
}
await page.setViewportSize({ width: 260, height: 860 });
await open('rich-fish-carangaria-135');
// the View row scrolls sideways at this width, Search and ⋮ staying pinned at its right: scrolled to its end, the start fades
await page
  .locator('.ex-row')
  .first()
  .evaluate((r) => (r.scrollLeft = r.scrollWidth));
await page.waitForTimeout(150);
ok(
  (await ev(() => document.querySelectorAll('.ex-row')[0].hasAttribute('data-start'))) &&
    !(await ev(() => document.querySelectorAll('.ex-row')[0].hasAttribute('data-end'))),
  '260 px: the View row scrolled to its end fades at the start',
);
await page.mouse.click(
  ...Object.values(
    await ev(() => {
      const r = document.querySelector('.ex-export button').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  ),
);
ok((await page.locator('.ex-menu').count()) === 1, '260 px: a real click on ⋮ (after scrolling) opens the menu');
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 1280, height: 860 });

// every synthetic tree of the catalogue carries support (#55): Show support draws values
console.log('support on every synthetic tree');
{
  const catalogue = JSON.parse(
    fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../examples/shared/catalogue.json'), 'utf8'),
  );
  const synthetic = Object.keys(catalogue.synthetic);
  ok(synthetic.length >= 4, `the synthetic trees: ${synthetic.join(', ')}`);
  for (const id of synthetic) {
    await open(id);
    await moreToggle('Show support');
    await page.waitForTimeout(150);
    // labels need room: frame a clade of a few dozen tips, then stretch x (Shift + wheel) until a branch is long enough for one
    const at = await ev(() => {
      const t = __v().getTree();
      for (let i = 1; i < t.nodeCount; i++) {
        const c = t.leafEnd[i] - t.leafStart[i];
        if (t.firstChild[i] >= 0 && c >= 12 && c <= 40) {
          __v().zoomToNode(i);
          return __v().locateNode(i);
        }
      }
      return null;
    });
    let texts = await drawn();
    for (let k = 0; at && k < 30 && texts.length === 0; k++) {
      await ev(({ x, y }) => {
        const wheel = { deltaY: -300, shiftKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true };
        document.querySelector('.ex-outer canvas').dispatchEvent(new WheelEvent('wheel', wheel));
      }, at);
      texts = await drawn();
    }
    const hi = id.endsWith('-bootstrap') ? 100 : 1;
    ok(
      texts.length > 0 && texts.every((s) => Number(s) >= 0 && Number(s) <= hi),
      `${id}: Show support draws support values (${texts.slice(0, 6).join(' ')})`,
    );
  }
}

// ---------------------------------------------------------------- ladderise by tips (the menu's two items)
console.log('ladderise');
await open('rich-fish-carangaria-135');
const firstClade = () =>
  ev(() => {
    const t = __v().getTree();
    let n = t.tipNode[0]; // the clade under the root that holds the first tip
    while (t.parent[n] > 0) n = t.parent[n];
    return t.leafEnd[n] - t.leafStart[n];
  });
await ladder('descending');
await page.waitForTimeout(250);
const bigFirst = await firstClade();
await ladder('ascending');
await page.waitForTimeout(250);
const smallFirst = await firstClade();
ok(smallFirst < bigFirst, `ascending puts a smaller top-level clade first than descending (${smallFirst} < ${bigFirst})`);
await undo();
await undo();
await page.waitForTimeout(250);
// a tree without branch lengths (a Newick of our own, served in place of a small catalogue file): no "height" option, no phylogram
await page.route('**/data/rich/edge-cases/duplicate-tip-labels.nwk', (r) => r.fulfill({ contentType: 'text/plain', body: '((a,b),(c,(d,e)));' }));
await open('edge-duplicate-labels');
ok(!(await ev(() => window.__explorerTree().hasLengths)), 'the stand-in tree has no branch lengths');
await moreButton().click();
ok(
  (await moreItem('Show branch length').count()) === 0 &&
    (await moreItem('Show support').count()) === 0 &&
    (await moreItem('Midpoint root').count()) === 0,
  'without branch lengths and support the menu does not offer Show branch length, Show support or Midpoint root',
);
ok(
  (await moreItem('Phylogram').getAttribute('aria-checked')) === 'false' &&
    (await moreItem('Phylogram').isDisabled()) &&
    (await moreItem('Cladogram').getAttribute('aria-checked')) === 'true',
  'without branch lengths the menu shows Cladogram as the one in force, and Phylogram off',
);
await moreClose();
await page.unroute('**/data/rich/edge-cases/duplicate-tip-labels.nwk');

// ---------------------------------------------------------------- the ⋮ menu
console.log('the ⋮ menu');
await open('rich-fish-carangaria-135');
await moreButton().click();
ok(
  (await moreMenu().locator('.ex-menu-label').allInnerTexts()).join('|') ===
    'Phylogram|Cladogram|Legend|Minimap|Tooltips|Align labels|Truncate names|Show support|Show branch length|Ladderize ascending|Ladderize descending|Midpoint root|Export…',
  'the ⋮ menu: Phylogram and Cladogram, the toggles, Ladderize ascending and descending, Midpoint root, Export…',
);
ok(
  (await moreItem('Legend').getAttribute('aria-checked')) === 'true' && (await moreItem('Minimap').getAttribute('aria-checked')) === 'false',
  'the toggles show their state (Legend on, Minimap off)',
);
ok(
  (await moreItem('Phylogram').getAttribute('aria-checked')) === 'true' && (await moreItem('Cladogram').getAttribute('aria-checked')) === 'false',
  'Phylogram and Cladogram are radio items, Phylogram checked',
);
await moreItem('Cladogram').click();
ok(
  (await moreItem('Phylogram').getAttribute('aria-checked')) === 'false' &&
    (await moreItem('Cladogram').getAttribute('aria-checked')) === 'true' &&
    (await ev(() => __v().options.branchLengths)) === false,
  'choosing Cladogram unchecks Phylogram and drops the branch lengths',
);
await moreItem('Phylogram').click();
await moreItem('Minimap').click();
ok((await moreMenu().count()) === 1, 'a toggle leaves the menu open');
await page.waitForTimeout(200);
ok((await page.locator('.phylo-overview').count()) === 1 && (await moreItem('Minimap').getAttribute('aria-checked')) === 'true', 'Minimap on');
await moreItem('Minimap').click();
ok((await moreItem('Tooltips').getAttribute('aria-checked')) === 'true', 'Tooltips are on by default');
await moreItem('Tooltips').click();
await moreClose();
{
  const at = await ev(() => __tipAt(__v().getTree().tipLabels[3]));
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(300);
  ok((await page.locator('.phylo-tooltip:not([hidden]) .ex-tip--node').count()) === 0, 'Tooltips off: no hover box on a tip');
  await page.mouse.move(5, 5);
}
await moreToggle('Tooltips');
{
  const at = await ev(() => __tipAt(__v().getTree().tipLabels[3]));
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(300);
  ok((await page.locator('.phylo-tooltip .ex-tip--node').count()) === 1, 'Tooltips back on: the hover box shows again');
  await page.mouse.move(5, 5);
}
await moreButton().click();
ok(await ev(() => document.activeElement?.closest('.ex-menu') !== null), 'the focus goes into the ⋮ menu when it opens');
await moreItem('Export…').click();
ok(await ev(() => document.activeElement?.closest('.ex-menu') !== null), 'and stays in it when Export… swaps the list');
await page.keyboard.press('Escape');
ok(
  (await moreMenu().count()) === 0 && (await ev(() => document.activeElement?.getAttribute('aria-label'))) === 'More options',
  'Escape closes the menu and gives the focus back to the ⋮ button',
);
{
  // a short pane: the menu scrolls rather than being cut off
  await ev(() => (document.querySelector('.ex-pane').style.height = '160px'));
  await moreButton().click();
  const fit = await ev(() => {
    const m = document.querySelector('.ex-menu').getBoundingClientRect();
    const o = document.querySelector('.ex-outer').getBoundingClientRect();
    return {
      inside: m.bottom <= o.bottom + 1,
      scrolls: document.querySelector('.ex-menu').scrollHeight > document.querySelector('.ex-menu').clientHeight,
    };
  });
  ok(fit.inside && fit.scrolls, `in a short pane the menu stays inside it and scrolls (${JSON.stringify(fit)})`);
  await moreClose();
  await ev(() => (document.querySelector('.ex-pane').style.height = ''));
}
await moreButton().click();
await moreItem('Ladderize ascending').click();
ok((await moreMenu().count()) === 0, 'a ladderize item closes the menu');
await undo();
await moreButton().click();
await page.mouse.click(5, 5);
ok((await moreMenu().count()) === 0, 'a press outside closes it');

// ---------------------------------------------------------------- highlight style
console.log('highlight style');
await open('rich-fish-carangaria-135');
await page.locator('button[aria-label="Search tips"]').click();
await page.keyboard.type('bothus');
await page.waitForTimeout(200);
const hs = page.locator('select[aria-label="Highlight style"]');
ok((await hs.inputValue()) === 'dim', 'highlight style starts as dim');
for (const k of ['band', 'both', 'dim']) {
  await hs.selectOption(k);
  await page.waitForTimeout(150);
  ok((await ev(() => __v().options.highlightStyle)) === k, `highlight style ${k} reaches the viewer`);
}
await page.keyboard.press('Escape');

// ---------------------------------------------------------------- Align in radial
console.log('Align in radial');
await open('rich-hcv-19');
await page.locator('button[title=Circular]').click();
await page.waitForTimeout(200);
{
  // the distances from the root of the label anchors (their translate is the label's place, the vertical centre at half their height)
  const anchorRadii = () =>
    ev(() => {
      const T = __v().T;
      return [...document.querySelectorAll('.phylo-tree [data-tip-id]')]
        .filter((a) => a.style.display !== 'none' && !a.style.transform.includes('-9999px'))
        .map((a) => {
          const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(a.style.transform);
          return Math.round(Math.hypot(Number(m[1]) - T.cx, Number(m[2]) + parseFloat(a.style.height) / 2 - T.cy));
        });
    });
  ok(await moreEnabled('Align labels'), 'Align is enabled in the circular layout (#52)');
  const ragged = await anchorRadii();
  ok(ragged.length > 5 && new Set(ragged).size > 3, `circular: the label anchors follow their tips (${new Set(ragged).size} distances)`);
  await moreToggle('Align labels');
  await page.waitForTimeout(400);
  const radii = await anchorRadii();
  ok(
    radii.length > 5 && new Set(radii).size === 1 && (await moreChecked('Align labels')),
    `Align in circular: the label anchors are at one distance from the root (${radii.length} anchors at ${radii[0]} px)`,
  );
  const sameRadial = await screenVsBlob();
  ok(
    sameRadial.w && sameRadial.painted > 500 && sameRadial.diff === 0,
    `Align in circular: toBlob equals the screen, leaders included (${sameRadial.painted} painted pixels, ${sameRadial.diff} differ)`,
  );
  await moreToggle('Align labels');
  await page.waitForTimeout(300);
  ok(new Set(await anchorRadii()).size > 3, 'Align off: the circular labels follow their tips again');
  await page.locator('button[title=Rectangular]').click();
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------- overview and legend
console.log('overview and legend');
await open('rich-fish-carangaria-135');
ok((await page.locator('.phylo-overview').count()) === 0, 'no overview at first');
await moreToggle('Minimap');
await page.waitForTimeout(300);
ok((await page.locator('.phylo-overview').count()) === 1, 'Overview shows the viewer’s overview control');
await moreToggle('Minimap');
await page.waitForTimeout(200);
ok((await page.locator('.phylo-overview').count()) === 0, 'and hides it');
ok((await page.locator('.phylo-legend:visible').count()) === 0, 'the legend is hidden while no clade is coloured');
await colourVia(await ev(() => __clade(20, 40)), 'Teal');
await page.waitForTimeout(300);
ok((await page.locator('.phylo-legend:visible').count()) === 1, 'the legend shows the coloured clade');
ok(
  /\(\d+ tips\)|Clade of/.test(await page.locator('.phylo-legend').innerText()),
  `named by its clade: ${(await page.locator('.phylo-legend').innerText()).replace(/\n/g, ' / ')}`,
);
// the "Scroll to zoom" hint never overlaps a legend (#69): the viewer's clade legend, in either layout
const hintClear = () =>
  ev(() => {
    const h = document.querySelector('.ex-hint')?.getBoundingClientRect();
    if (!h) return true; // not drawn: nothing overlaps
    const e = document.querySelector('.phylo-legend');
    if (!e || e.hidden || getComputedStyle(e).display === 'none') return true;
    const r = e.getBoundingClientRect();
    return h.right <= r.left || h.left >= r.right || h.bottom <= r.top || h.top >= r.bottom;
  });
ok(await hintClear(), 'the hint does not overlap the clade legend (rectangular)');
await page.locator('button[title=Circular]').click();
await page.waitForTimeout(300);
ok(
  (await page.locator('.phylo-legend:visible').count()) === 1 && (await page.locator('.ex-hint').count()) === 1,
  'radial keeps its hint, with the legend shown',
);
ok(await hintClear(), 'the hint does not overlap the clade legend (radial)');
await page.locator('button[title=Rectangular]').click();
await page.waitForTimeout(300);
await moreToggle('Legend');
await page.waitForTimeout(200);
ok((await page.locator('.phylo-legend:visible').count()) === 0, 'Legend off hides it');
ok((await page.locator('.ex-hint').count()) === 1 && (await hintClear()), 'and the rectangular hint is back');

// the hint goes once the user zooms or pans, and stays gone (#69)
console.log('the hint goes after the first zoom or pan');
await open('rich-hcv-19');
ok((await page.locator('.ex-hint').count()) === 1, 'the hint is shown at first');
{
  const b = await ev(() => document.querySelector('.ex-pane').getBoundingClientRect().toJSON());
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(150);
  ok((await page.locator('.ex-hint').count()) === 1, 'a click does not remove it');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(200);
  ok((await page.locator('.ex-hint').count()) === 0, 'a wheel turn removes it');
  await page.locator('button[title=Circular]').click();
  await page.waitForTimeout(200);
  ok((await page.locator('.ex-hint').count()) === 0, 'and a new layout does not bring it back');
}
await open('rich-hcv-19');
{
  const b = await ev(() => document.querySelector('.ex-pane').getBoundingClientRect().toJSON());
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 10, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  ok((await page.locator('.ex-hint').count()) === 0, 'a drag removes it');
}
await open('rich-hcv-19');
{
  const b = await ev(() => document.querySelector('.ex-pane').getBoundingClientRect().toJSON());
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 1);
  await page.mouse.up();
  await page.waitForTimeout(100);
  ok((await page.locator('.ex-hint').count()) === 1, 'a jittery click does not remove it');
  await page.locator('.phylo-tree').focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(100);
  ok((await page.locator('.ex-hint').count()) === 1, 'an arrow key (it moves the active node) does not');
  await page.keyboard.press('+');
  await page.waitForTimeout(150);
  ok((await page.locator('.ex-hint').count()) === 0, 'the zoom key removes it');
}

// ---------------------------------------------------------------- the playground's catalogue
console.log('search: a label on several tips (#18)');
await open('edge-duplicate-labels');
// record the tips (as ranks) the explorer asks the viewer to focus (on 9 tips the whole tree is in view, so the viewport cannot tell)
await ev(() => {
  const v = __v();
  const focusTip = v.focusTip.bind(v);
  window.__focused = [];
  v.focusTip = (n, a) => (window.__focused.push(v.getTree().tipRank[n]), focusTip(n, a));
});
await page.locator('button[aria-label="Search tips"]').click();
await page.keyboard.type('homo');
await page.waitForTimeout(250);
ok((await page.locator('.ex-search-count').innerText()) === '1 / 3', 'Homo_sapiens is on three tips: three matches');
const hlDup = await ev(() => [...__v().hlRanks]);
ok(JSON.stringify(hlDup) === '[0,1,3]', `all three tips are highlighted (ranks ${JSON.stringify(hlDup)})`);
for (const k of [2, 3, 1]) {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  ok((await page.locator('.ex-search-count').innerText()) === `${k} / 3`, `Enter: match ${k} of 3`);
}
const focused = await ev(() => window.__focused.filter((r, i, a) => i === 0 || r !== a[i - 1]));
ok(JSON.stringify(focused.slice(-4)) === '[0,1,3,0]', `each step focuses the next of the three tips (ranks ${JSON.stringify(focused)})`);
await page.keyboard.press('Escape');

console.log('one action colour (#74)');
{
  await open('rich-fish-carangaria-135');
  // a CSS colour as the browser computes it, to compare with computed styles
  const computed = (c) =>
    ev((c) => {
      const s = document.createElement('span');
      s.style.color = c;
      document.body.append(s);
      const v = getComputedStyle(s).color;
      s.remove();
      return v;
    }, c);
  const colourOf = (loc, prop = 'color') => loc.evaluate((e, prop) => getComputedStyle(e)[prop], prop);
  // the hover box
  const states = async () => {
    const text = {};
    await page.mouse.move(...Object.values(await ev((l) => __tipAt(l), await ev(() => __v().getTree().tipLabels[3]))));
    await page.locator('.ex-tip--node').waitFor({ timeout: 3000 });
    await page.waitForTimeout(250);
    text['hover box'] = await colourOf(page.locator('.ex-tip--node'));
    await page.mouse.move(5, 5);
    return { text };
  };
  for (let pass = 0; pass < 2; pass++) {
    const theme = (await ev(() => document.documentElement.dataset.theme)) || 'light';
    const { text } = await states();
    // the hover box is white on #333 whatever the theme, from its own variables
    ok(
      text['hover box'] === (await computed('var(--ex-tooltip-text)')) && text['hover box'] === 'rgb(255, 255, 255)',
      `${theme}: the hover box has white text (${text['hover box']})`,
    );
    // a theme sets the hover box's own variables
    await ev(() => document.documentElement.style.setProperty('--ex-tooltip-text', 'rgb(200, 30, 30)'));
    await ev(() => document.documentElement.style.setProperty('--ex-tooltip-bg', 'rgb(10, 20, 30)'));
    const themed = await states();
    await ev(() => document.documentElement.style.removeProperty('--ex-tooltip-text'));
    await ev(() => document.documentElement.style.removeProperty('--ex-tooltip-bg'));
    ok(themed.text['hover box'] === 'rgb(200, 30, 30)', `${theme}: --ex-tooltip-text colours the hover box (${themed.text['hover box']})`);
    await page.locator('.theme-toggle').click();
    await page.waitForTimeout(300);
  }
}

console.log('undo within a memory budget (#44)');
{
  // tree-ops treeBytes of the current tree (the model, not the viewer's snapshot), the same count as packages/tree-ops/src/bytes.ts
  // (keep the two in step): its typed arrays, and 8 bytes per element of its plain arrays
  const bytes = () =>
    ev(() => {
      let b = 0;
      for (const a of Object.values(window.__explorerTree())) b += ArrayBuffer.isView(a) ? a.byteLength : Array.isArray(a) ? a.length * 8 : 0;
      return b;
    });
  const lad = (dir) => ladder(dir).then(() => page.waitForTimeout(250));
  const note = () => page.locator('.ex-undo-note');
  await open('rich-fish-carangaria-135');
  const b = await bytes();
  // room for two trees between the one as published and the current one: four edits drop the first
  await open('rich-fish-carangaria-135', `&undo-budget=${Math.round(b * 2.5)}`);
  const o = [await ev(() => __order())];
  for (const dir of ['descending', 'ascending', 'descending', 'ascending']) {
    await lad(dir);
    o.push(await ev(() => __order()));
  }
  ok(
    o.every((x, i) => i === 0 || x !== o[i - 1]),
    'four edits, each changes the tree',
  );
  ok((await hasReset()) && (await note().count()) === 0, 'Reset is offered, and no note: Undo (Ctrl+Z) works');
  await undo();
  ok((await ev(() => __order())) === o[3], 'Undo goes back one edit');
  await undo();
  ok((await ev(() => __order())) === o[2], 'and another');
  ok(
    (await note().count()) === 1 && (await hasReset()) && /dropped/.test(await note().innerText()),
    `the oldest step was dropped: Undo stops there, Reset stays, a note says why ("${(await note().count()) ? await note().innerText() : ''}")`,
  );
  await page.locator('.phylo-tree').focus();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  ok((await ev(() => __order())) === o[2], 'Ctrl+Z does nothing there');
  await resetEdits();
  await page.waitForTimeout(200);
  ok((await ev(() => __order())) === o[0] && !(await hasReset()), 'Reset goes back to the tree as published');
  // a tree larger than the budget: Reset only, with a note
  await open('rich-fish-carangaria-135', `&undo-budget=${Math.floor(b / 2)}`);
  await lad('descending');
  await lad('ascending');
  ok(
    (await ev(() => __order())) === o[2] && (await hasReset()) && /too large/.test(await note().innerText()),
    `a tree larger than the budget: Reset only ("${(await note().count()) ? await note().innerText() : ''}")`,
  );
  await page.locator('.phylo-tree').focus();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  ok((await ev(() => __order())) === o[2], 'and Ctrl+Z does nothing');
  await resetEdits();
  await page.waitForTimeout(200);
  ok((await ev(() => __order())) === o[0] && !(await hasReset()), 'Reset goes back to the tree as published');
}

console.log('every tree of the playground catalogue, one from each group');
const here = path.dirname(fileURLToPath(import.meta.url));
const catalogue = JSON.parse(fs.readFileSync(path.join(here, '../../../examples/shared/catalogue.json'), 'utf8'));
await open('edge-internal-support');
{
  const groups = await page
    .locator('.page-head select optgroup')
    .evaluateAll((gs) => gs.map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.value)]));
  const ids = new Set(groups.flatMap((g) => g[1]));
  const wanted = Object.values(catalogue).flatMap((g) => Object.keys(g));
  ok(
    wanted.length === 22 && wanted.every((id) => ids.has(id)),
    `the picker lists all ${wanted.length} trees of the playground catalogue (${ids.size} in all)`,
  );
  ok(
    ['edge-polytomy', 'otl-1k'].every((id) => ids.has(id)),
    'and the explorer’s own extras',
  );
  ok(
    Object.keys(catalogue).every((g) => groups.some((x) => x[0] === g)),
    `grouped as the playground: ${groups.map((g) => g[0]).join(' | ')}`,
  );
  const remote = await page.locator('.page-head select option[value="otl-2m-full"]').count();
  ok(remote === 1, 'the 2.4M-tip tree with a remote URL is on offer');
}

console.log('\na file of one’s own, through the picker’s file input (examples/shared)');
{
  ok(
    (await page.locator('.page-head select optgroup[label="your own"] option[value="__file"]').count()) === 1,
    'the picker ends with "your own": a file from your computer',
  );
  await page
    .locator('.page-head input[type=file]')
    .setInputFiles({ name: 'mine.nwk', mimeType: 'text/plain', buffer: Buffer.from('((a:1,b:2):1,(c:1,(d:1,e:1):2):1);') });
  await page.waitForFunction(() => window.__explorer?.()?.getTree().tipCount === 5, null, { timeout: 30000 });
  await page.evaluate(HELPERS);
  await page.waitForTimeout(300);
  ok(
    (await tipCount()) === 5 && (await page.locator('.page-head select').inputValue()) === '__file-shown',
    'the file is shown (5 tips) and the picker says so',
  );
  const gz = new Uint8Array(await new Response(new Blob(['(x:1,(y:1,z:1):1);']).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  await page.locator('.page-head input[type=file]').setInputFiles({ name: 'mine.nwk.gz', mimeType: 'application/gzip', buffer: Buffer.from(gz) });
  await page.waitForFunction(() => window.__explorer?.()?.getTree().tipCount === 3, null, { timeout: 30000 });
  ok(true, 'a gzipped file too (3 tips)');
  // the file option in the list opens the file dialog every time, and the same file loads again (the list names the file shown)
  for (const round of [1, 2]) {
    await page.evaluate(() => (window.__before = window.__explorer?.()));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.selectOption('.page-head select', '__file')]);
    await chooser.setFiles({ name: 'four.nwk', mimeType: 'text/plain', buffer: Buffer.from('((a,b),(c,d));') });
    await page.waitForFunction(() => {
      const v = window.__explorer?.();
      return v && v !== window.__before && v.getTree().tipCount === 4;
    });
    const sel = await page.locator('.page-head select').evaluate((s) => [s.value, s.selectedOptions[0].textContent]);
    ok(
      sel[0] === '__file-shown' && sel[1] === 'four.nwk',
      `the file option opens the file dialog, the file loads and the list names it (${round === 1 ? 'first time' : 'the same file again'})`,
    );
  }
  await page.evaluate(HELPERS);
}
// Drill-down (#57) on an overview set through ?view= (the clades collapsed, as the old Collapse to 50 clades button left them), a click on a collapsed clade expands it in place (its children
// in, with an overview of about 20 rows inside), Show only in its menu jumps into it with an overview there, and Back to root returns
const drillDown = async (tips) => {
  const collapsedNodes = () =>
    ev(() => {
      const t = __v().getTree();
      const out = [];
      for (let i = 1; i < t.nodeCount; i++) if (__v().layout.collapsed?.[i]) out.push(i);
      return out;
    });
  const largest = (skip) =>
    ev(
      ([skip]) => {
        const t = __v().getTree();
        const ids = [];
        for (let i = 1; i < t.nodeCount; i++) if (__v().layout.collapsed?.[i]) ids.push(i);
        ids.sort((a, b) => t.leafEnd[b] - t.leafStart[b] - (t.leafEnd[a] - t.leafStart[a]));
        const n = ids.filter((i) => !skip.includes(i))[0];
        const b = __v().nodeBounds(n);
        return { node: n, end: t.subtreeEnd[n], tips: t.leafEnd[n] - t.leafStart[n], tri: { x: b.x + b.width * 0.8, y: b.y + b.height / 2 } };
      },
      [skip],
    );
  await page.waitForTimeout(400);
  const r0 = await rows();
  const c0 = await collapsedNodes();
  ok(
    c0.length >= 10 && r0 <= 50 && r0 >= 40 && (await tipCount()) === tips,
    `an overview of the tree: ${r0} rows (40 to 50), ${c0.length} collapsed clades, all ${tips} tips kept`,
  );
  const labels = await ev(() => [...(window.__cladeLabels ?? [])]);
  ok(
    labels.some((l) => / · [\d,]+ tips$/.test(l)) && labels.some((l) => /^[\d,]+ tips$/.test(l)),
    `collapsed clades are labelled 'Name · N tips' or 'N tips': ${labels.slice(0, 3).join(' | ')}`,
  );
  const big = await largest([]);
  await page.mouse.move(big.tri.x, big.tri.y);
  await page.waitForTimeout(300);
  const facts = Object.fromEntries(
    await page.locator('.ex-tip--node .ex-tip-rows dt').evaluateAll((dts) => dts.map((d) => [d.textContent, d.nextElementSibling.textContent])),
  );
  ok(
    facts.Tips === big.tips.toLocaleString('en') && facts.First && facts.Last,
    `the hover box on a collapsed clade gives its tips and its first and last tip: ${JSON.stringify(facts)}`,
  );
  await click(big.tri);
  const r1 = await rows();
  const c1 = await collapsedNodes();
  // every child of the clade is drawn now, open or collapsed
  const kids = await ev((n) => {
    const t = __v().getTree();
    const out = [];
    for (let c = t.firstChild[n]; c >= 0; c = t.nextSibling[c]) out.push(__v().locateNode(c) !== null);
    return out;
  }, big.node);
  const inside = c1.filter((i) => i > big.node && i < big.end);
  ok(
    (await menu.count()) === 0 && !c1.includes(big.node) && r1 > r0 && r1 <= r0 - 1 + 20,
    `a click expands the largest collapsed clade (${big.tips} tips) in place: ${r0} → ${r1} rows, at most 19 more`,
  );
  ok(
    c0.every((i) => i === big.node || c1.includes(i)) && kids.every(Boolean) && inside.length > 0,
    `its children come in (${kids.length}), its large subclades collapsed (${inside.length}), the other collapsed clades stay`,
  );
  // jump into another collapsed clade: Show only from its menu (a click on its branch), with an overview inside; Back to root returns
  const other = await largest([big.node]);
  // its Info panel lists the named clades inside it
  await openMenu(await ev((n) => __stem(n), other.node));
  await act('info');
  const infoNames = await page.locator('.ex-info-inside li').allInnerTexts();
  ok(
    (await page.locator('.ex-info-rows dt', { hasText: 'Tips' }).count()) === 1 && infoNames.length > 0,
    `the Info panel of a collapsed clade lists the named clades inside it (${infoNames.length}: ${infoNames.slice(0, 2).join(', ').replace(/\n/g, ' ')})`,
  );
  await page.locator('.ex-info-head button').click();
  await openMenu(await ev((n) => __stem(n), other.node));
  await act('subtree');
  await page.waitForTimeout(400);
  const r2 = await rows();
  ok(
    (await tipCount()) === other.tips && r2 <= 50 && r2 >= 20,
    `Show only jumps into a collapsed clade of ${other.tips} tips, with its overview: ${r2} rows`,
  );
  await toRoot();
  await page.waitForTimeout(400);
  ok(
    (await tipCount()) === tips && (await rows()) === r1 && (await ev((n) => __v().layout.collapsed?.[n] === 1, other.node)),
    `Back to root returns to the tree as it was (${await rows()} rows, the clade jumped into collapsed again)`,
  );
  // Expand in the menu opens a collapsed clade whole, unlike the click (not the clade jumped into: the clades collapsed inside it stay)
  const whole = await ev((skip) => {
    const t = __v().getTree();
    let best = null;
    for (let i = 1; i < t.nodeCount; i++) {
      if (i === skip || !__v().layout.collapsed?.[i] || (best && t.leafEnd[i] - t.leafStart[i] <= best.tips)) continue;
      const stem = __stem(i);
      if (stem) best = { node: i, tips: t.leafEnd[i] - t.leafStart[i], stem };
    }
    return best;
  }, other.node);
  await openMenu(whole.stem);
  await act('expand');
  ok((await rows()) === r1 - 1 + whole.tips, `Expand in the menu opens a clade of ${whole.tips} tips whole (${r1} → ${await rows()} rows)`);
  await btn('Expand all').click();
  await page.waitForTimeout(300);
};
const loadVia = async (id) => {
  const t0 = Date.now();
  await page.evaluate(() => (window.__before = window.__explorer?.()));
  await page.selectOption('.page-head select', id);
  // the tree shown stays while the next one loads (in the parse worker): wait for the new viewer
  await page.waitForFunction(
    (i) =>
      document.querySelector('.page-head select').value === i &&
      !document.querySelector('.page-loading') &&
      window.__explorer?.() !== window.__before,
    id,
    { timeout: 90000 },
  );
  await page.waitForFunction(() => typeof window.__explorer === 'function' && window.__explorer() !== null);
  await page.evaluate(HELPERS);
  await page.waitForTimeout(400);
  return Date.now() - t0;
};
for (const [id, tipsWanted] of [
  ['rich-butterflies-496', 496],
  ['syn-yule-1000', 1000],
  ['gtdb-10k-archaea', 10122],
]) {
  const ms = await loadVia(id);
  const n = await tipCount();
  ok(n === tipsWanted, `${id}: ${n} tips shown (${ms} ms)`);
}
// the drill-down needs a tree whose clades are drawn as nodes at the fit zoom, to be clicked
{
  // the overview of the 10k-tip GTDB archaea: the frontier of the tree opened from the root, the largest clade first, until 45 rows. The
  // collapsed clades go in through ?view= (the debug panel's saved view, with its collapsed ids), the way a view is restored
  await open('gtdb-10k-archaea', '&debug=1');
  const frontier = await ev(() => {
    const t = __v().getTree();
    const open = [0];
    const size = (i) => t.leafEnd[i] - t.leafStart[i];
    while (open.length < 45) {
      let k = 0;
      for (let j = 1; j < open.length; j++) if (size(open[j]) > size(open[k])) k = j;
      const [v] = open.splice(k, 1);
      for (let c = t.firstChild[v]; c >= 0; c = t.nextSibling[c]) open.push(c);
    }
    return open.filter((i) => t.firstChild[i] >= 0);
  });
  const panel = page.locator('.ex-debug');
  await panel.locator('button', { hasText: 'Copy view' }).click();
  await panel.locator('textarea').waitFor();
  const saved = JSON.parse(await panel.locator('textarea').inputValue());
  saved.collapsed = frontier;
  saved.asLoaded = true;
  const encoded = Buffer.from(JSON.stringify(saved)).toString('base64url');
  await page.goto(`${url}?debug=1&view=${encoded}`);
  await page.waitForSelector('.ex-outer canvas', { timeout: 60000 });
  await page.waitForFunction(() => typeof window.__explorer === 'function' && window.__explorer() !== null);
  await page.evaluate(HELPERS);
  await page.waitForTimeout(400);
  await drillDown(10122);
}
{
  // a large tree: the Open Tree vertebrates, 91k tips; then the 190k-tip GTDB bacteria. Nothing is disabled on either
  const ms = await loadVia('otl-100k-vertebrata');
  const n = await tipCount();
  ok(n > 90000 && (await page.locator('.ex-note').count()) === 0, `otl-100k-vertebrata: ${n} tips (${ms} ms), `);
  // zoomed to rows of 20 px, the explorer's minCladePx 14 draws the same tips as the library's 3: the cherry of near-identical
  // Ochotona princeps subspecies and the single tip under Tribosphenomys keep their rows (#87)
  const tipsAt20 = await ev(() => {
    const v = __v();
    const t = v.getTree();
    const rank = t.tipLabels.findIndex((l) => l.startsWith('Ochotona_princeps_saxatilis'));
    if (rank < 0) return null;
    const counts = [];
    const was = v.options.minCladePx;
    for (const minCladePx of [14, 3]) {
      v.setOptions({ minCladePx });
      v.focusTip(t.tipNode[rank], false);
      v.renderNow();
      const q = v.nodePosition(t.tipNode[rank]);
      v.zoomBy(1, 20.5 / v.getStats().ky, q.x, q.y);
      v.renderNow();
      const s = v.getStats();
      counts.push({ minCladePx, rowPx: s.ky, tips: s.tips, summaries: s.summaries });
    }
    v.setOptions({ minCladePx: was });
    v.fit(false);
    v.renderNow();
    return counts;
  });
  ok(tipsAt20 !== null, 'the tip Ochotona princeps saxatilis is in the tree');
  ok(
    tipsAt20 !== null && tipsAt20.every((c) => c.rowPx >= 20 && c.summaries === 0) && tipsAt20[0].tips === tipsAt20[1].tips && tipsAt20[0].tips > 20,
    `rows of 20 px: minCladePx 14 draws the tips minCladePx 3 does, no summaries (${JSON.stringify(tipsAt20)})`,
  );
  await openMenu(
    await ev(() => {
      const t = __v().getTree();
      for (let i = 1; i < t.nodeCount; i++) {
        const c = t.leafEnd[i] - t.leafStart[i];
        if (t.firstChild[i] >= 0 && c >= 2000 && c < 20000) {
          const q = __v().locateNode(i);
          if (q) return { x: q.x, y: q.y };
        }
      }
      return null;
    }),
  );
  await act('subtree');
  await page.waitForTimeout(500);
  ok((await tipCount()) < 20000, `Show only works on it (${await tipCount()} tips)`);
  const ms2 = await loadVia('gtdb-190k-bacteria');
  const n2 = await tipCount();
  ok(n2 > 150000, `gtdb-190k-bacteria: ${n2} tips (${ms2} ms)`);
  ok(
    (await page.locator('.ex-note').count()) === 0 && (await moreEnabled('Midpoint root')) && (await moreButton().isEnabled()),
    'nothing is disabled on a large tree',
  );
  ok(await page.locator('select[aria-label="Click action"]').isEnabled(), 'and the click action is on');
  // the adaptive budget (#114): radial, GTDB 190k at the finest threshold, so the starting budget (2,000) cuts the view. Headless Chromium
  // has no GPU, so this checks the mechanism: the budget moves across settled frames and stays within its limits, a number stays fixed
  // and the 4 degree wedge limit is in force (or has given way, which the debug stats show) rather than frame rates
  await page.locator('button[title=Circular]').click();
  await page.waitForTimeout(500);
  const budgetStats = () =>
    ev(() => {
      const s = __v().getStats();
      return { budget: s.budget, forced: s.forced, minPx: s.minPxUsed, limit: s.minPxLimit, frameMs: s.frameMs, drawn: s.drawn, reduced: s.reduced };
    });
  const auto = await ev(() => {
    const v = __v();
    window.__minCladePx = v.options.minCladePx;
    v.setOptions({ minCladePx: 1, radialMaxNodes: 'auto', drawBudget: 'auto' });
    v.fit(false);
    v.renderNow();
    return { radialMaxNodes: v.options.radialMaxNodes, drawBudget: v.options.drawBudget, start: v.getStats().budget };
  });
  ok(auto.radialMaxNodes === 'auto' && auto.drawBudget === 'auto', "radialMaxNodes and drawBudget 'auto' (the defaults)");
  ok(auto.start >= 100 && auto.start <= 200000, `the first frame's budget is ${auto.start}`);
  const first = await budgetStats();
  ok(
    !Number.isFinite(first.limit) || first.minPx <= first.limit * (1 + 1e-9),
    `radial full view: the threshold ${first.minPx.toFixed(1)} px is within the 4 degree wedge limit (${first.limit.toFixed(1)} px)`,
  );
  let moved = null;
  for (let k = 0; k < 40 && moved === null; k++) {
    await page.waitForTimeout(250);
    const s = await budgetStats();
    if (s.budget !== auto.start) moved = s;
  }
  // holding is right when the cut already shows everything (nothing forced) or frames are in the dead zone (60-100% of the 25 ms target);
  // the budget must move only when the cut is short of it and frames are clearly fast (they vary with the machine's load)
  const mustMove = first.forced > 0 && first.frameMs < 8;
  ok(
    moved !== null || !mustMove,
    `after settled frames the budget moves when the cut is short of it and frames are fast (forced ${first.forced}, frame ${first.frameMs.toFixed(1)} ms: ${auto.start} -> ${moved ? moved.budget : 'held'})`,
  );
  await page.waitForTimeout(3000);
  const rest = await budgetStats();
  ok(
    rest.budget >= 100 && rest.budget <= 200000,
    `and stays within its limits: ${rest.budget} (forced ${rest.forced}, frame ${rest.frameMs.toFixed(1)} ms)`,
  );
  ok(
    !Number.isFinite(rest.limit) || rest.minPx <= rest.limit * (1 + 1e-9),
    `the wedge limit holds, or has given way to the budget (limit ${rest.limit})`,
  );
  const fixed = await ev(() => {
    __v().setOptions({ radialMaxNodes: 1500 });
    __v().renderNow();
    return __v().getStats().budget;
  });
  await page.waitForTimeout(1500);
  const fixedLater = await budgetStats();
  ok(
    fixed === 1500 && fixedLater.budget === 1500 && fixedLater.drawn <= 1500,
    'a number stays fixed: radialMaxNodes 1500 gives a budget of 1500 over later frames',
  );
  await ev(() => {
    __v().setOptions({ minCladePx: window.__minCladePx, radialMaxNodes: 'auto' });
    __v().fit(false);
    __v().renderNow();
  });
  await page.locator('button[title=Rectangular]').click();
  await page.waitForTimeout(500);
  // search is not capped (#58): every match is counted and highlighted
  await page.locator('button[aria-label="Search tips"]').click();
  await page.keyboard.type('a');
  await page.waitForTimeout(800);
  const all = await ev(() => __v().getHighlighted().length);
  const count = await page.locator('.ex-search-count').innerText();
  ok(
    all > 5000 && count === `1 / ${all.toLocaleString('en')}`,
    `search highlights and counts every match, past the old 5,000 cap (${count}, ${all} highlighted)`,
  );
}

// ---------------------------------------------------------------- a layout switch keeps the place (#56)
{
  await open('rich-fish-carangaria-135');
  const inView = () =>
    ev(() => {
      const v = __v();
      const t = v.getTree();
      const ranks = [];
      for (let r = 0; r < t.tipCount; r++) if (v.nodePosition(t.tipNode[r])) ranks.push(r);
      return { ranks, view: v.getViewport(), fitted: v.vs.fitted };
    });
  await ev(() => {
    const v = __v();
    const t = v.getTree();
    v.zoomToNode(t.parent[t.parent[t.parent[t.tipNode[70]]]]); // a clade of about 8 tips in the middle of the tree
  });
  await page.waitForTimeout(300);
  const a = await inView();
  for (const [button, layout] of [
    ['Circular', 'radial'],
    ['Rectangular', 'rectangular'],
  ]) {
    await page.locator(`button[title=${button}]`).click();
    await page.waitForTimeout(300);
    const b = await inView();
    const kept = a.ranks.filter((r) => b.ranks.includes(r)).length / a.ranks.length;
    ok(
      (await ev(() => __v().options.layout)) === layout && !b.fitted && kept >= 0.8,
      `${button}: ${Math.round(kept * 100)}% of the ${a.ranks.length} tips in view kept (${b.ranks.length} in view)`,
    );
    if (layout === 'rectangular') ok(JSON.stringify(b.view) === JSON.stringify(a.view), 'and back to the same window, untouched in between');
  }
}

// ---------------------------------------------------------------- the debug panel (?debug=1) and a view copied and restored (?view=)
{
  const debugRoundTrip = async (layout) => {
    await open('rich-fish-carangaria-135', '&debug=1');
    const panel = page.locator('.ex-debug');
    if (layout === 'radial') await page.locator('button[title=Circular]').click();
    const box = await page.locator('.ex-pane canvas').first().boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -200);
    await page.waitForTimeout(700);
    const text = await panel.innerText();
    const pane = await page.locator('.ex-pane').boundingBox();
    const at = await panel.boundingBox();
    ok(
      at && at.y >= pane.y + pane.height - 1 && /minPx\s+[\d.]+ used \/ minCladePx (auto \()?[\d.]+/.test(text) && /viewport\s+x0 -?[\d.]/.test(text),
      `${layout}: the debug panel shows numbers, under the tree pane (${text.split('\n')[text.split('\n').indexOf('frame') + 1] ?? text.slice(0, 80)})`,
    );
    const before = await ev(() => __v().getViewport());
    await panel.locator('button', { hasText: 'Copy view' }).click();
    await panel.locator('textarea').waitFor();
    const json = JSON.parse(await panel.locator('textarea').inputValue());
    const link = await panel.locator('input[aria-label="View URL"]').inputValue();
    ok(
      json.tree.id === 'rich-fish-carangaria-135' &&
        json.layout === layout &&
        typeof json.commit === 'string' &&
        (json.options.minCladePx === 'auto' || json.options.minCladePx > 0) &&
        json.canvas.width > 0 &&
        json.viewport.x0 === before.x0 &&
        json.viewport.y1 === before.y1 &&
        /\?debug=1&view=/.test(link),
      `${layout}: Copy view gives the tree, layout, build, canvas, options and viewport (${JSON.stringify(json.viewport)})`,
    );
    await page.goto(link);
    await page.waitForSelector('.ex-outer canvas', { timeout: 60000 });
    await page.waitForFunction(() => typeof window.__explorer === 'function' && window.__explorer() !== null);
    await page.evaluate(HELPERS);
    await page.waitForTimeout(800);
    const after = await ev(() => __v().getViewport());
    const span = Math.max(before.x1 - before.x0, before.y1 - before.y0);
    const off = Math.max(...['x0', 'x1', 'y0', 'y1'].map((k) => Math.abs(after[k] - before[k])));
    ok(
      off <= span * 1e-6 && (await ev(() => __v().options.layout)) === layout,
      `${layout}: ?view= restores the layout and the viewport (off by ${off.toExponential(2)})`,
    );
  };
  await debugRoundTrip('rectangular');
  await debugRoundTrip('radial');
}

console.log('\nloading in the parse worker (#4): the page keeps drawing frames, Cancel goes back to the tree shown');
{
  // the full Open Tree (2.39M tips) parses for a second or more in the worker; meanwhile the page keeps its frames and the tree shown
  const before = await page.evaluate(() => {
    window.__before = window.__explorer();
    return { id: document.querySelector('.page-head select').value, tips: window.__before.getTree().tipCount };
  });
  const workers = [];
  const onWorker = (w) => {
    const e = { url: w.url(), closed: false };
    w.once('close', () => (e.closed = true));
    workers.push(e);
  };
  page.on('worker', onWorker);
  await page.selectOption('.page-head select', 'otl-2m-full');
  await page.waitForFunction(() => /parsing/.test(document.querySelector('.page-loading')?.textContent ?? ''), null, { timeout: 90000 });
  // frames and the longest gap between them over 400 ms of the parse (the parse alone took about 1.1 s on the main thread before)
  const frames = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const t0 = performance.now();
        let n = 0;
        let last = t0;
        let gap = 0;
        const tick = (t) => {
          n++;
          gap = Math.max(gap, t - last);
          last = t;
          if (t - t0 < 400) requestAnimationFrame(tick);
          else resolve({ n, gap: Math.round(gap), parsing: /parsing/.test(document.querySelector('.page-loading')?.textContent ?? '') });
        };
        requestAnimationFrame(tick);
      }),
  );
  ok(
    workers.some((w) => /parse-worker/.test(w.url)),
    `the tree is parsed in a worker (${workers.map((w) => w.url.split('/').pop()).join(', ')})`,
  );
  ok(
    frames.parsing && frames.n >= 10 && frames.gap < 200,
    `while it parses the page draws frames: ${frames.n} in 400 ms, longest gap ${frames.gap} ms (still parsing: ${frames.parsing})`,
  );
  ok((await ev(() => window.__explorer() === window.__before)) === true, 'the tree shown stays while the next one loads');
  await page.click('.page-loading button');
  await page.waitForFunction(() => !document.querySelector('.page-loading'));
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    id: document.querySelector('.page-head select').value,
    same: window.__explorer() === window.__before,
    tips: window.__explorer().getTree().tipCount,
    error: document.querySelector('.page-error')?.textContent ?? null,
  }));
  ok(
    after.same && after.id === before.id && after.tips === before.tips && after.error === null,
    `Cancel: the tree shown stays (${after.tips} tips, the list on ${after.id}), no error`,
  );
  const parsers = workers.filter((w) => /parse-worker/.test(w.url));
  for (let i = 0; i < 50 && !parsers.every((w) => w.closed); i++) await page.waitForTimeout(100);
  ok(parsers.length > 0 && parsers.every((w) => w.closed), 'Cancel terminates the worker');
  page.off('worker', onWorker);
}
{
  // a load that fails with a tree shown: its error, the tree and the list stay on it; the next pick clears the error
  const before = await page.evaluate(() => {
    window.__before = window.__explorer();
    return document.querySelector('.page-head select').value;
  });
  await page.locator('.page-head input[type=file]').setInputFiles({ name: 'broken.nwk', mimeType: 'text/plain', buffer: Buffer.from('((a,b);') });
  await page.waitForFunction(() => document.querySelector('.page-error') && !document.querySelector('.page-loading'), null, { timeout: 30000 });
  const failed = await page.evaluate(() => ({
    id: document.querySelector('.page-head select').value,
    same: window.__explorer() === window.__before,
    error: document.querySelector('.page-error').textContent,
  }));
  ok(
    failed.same && failed.id === before && /character/.test(failed.error),
    `a load that fails: its error ("${failed.error}"), the tree shown stays and the list is back on it (${failed.id})`,
  );
  await loadVia('syn-yule-1000');
  ok((await page.locator('.page-error').count()) === 0 && (await tipCount()) === 1000, 'the next pick clears the error and loads');
}

{
  // #109: once rows are tall enough for tip dots, the level of detail folds nothing, whatever minCladePx says. The explorer's 14 turned the
  // one-tip genera around Pleganophorus bispinosus on the full Open Tree (2.39M tips) into unlabelled triangles at rows of 13 px
  const ms = await loadVia('otl-2m-full');
  const view = await ev(() => {
    const v = __v();
    // a threshold well above the rows checked (the explorer used 14 for big trees before #115; it now has the library's 3)
    v.setOptions({ minCladePx: 14 });
    const t = v.getTree();
    const rank = t.tipLabels.indexOf('Pleganophorus_bispinosus_ott4616304');
    if (rank < 0) return null;
    const out = [];
    for (const rowPx of [13, 8, 6.5]) {
      v.fit(false);
      v.renderNow();
      v.focusTip(t.tipNode[rank], false);
      v.renderNow();
      const q = v.nodePosition(t.tipNode[rank]);
      v.zoomBy(1, rowPx / v.getStats().ky, q.x, q.y);
      v.renderNow();
      const s = v.getStats();
      out.push({ rowPx: s.ky, summaries: s.summaries, tips: s.tips, minPxUsed: s.minPxUsed, minCladePx: v.options.minCladePx });
    }
    return out;
  });
  ok(view !== null, `otl-2m-full loaded (${ms} ms) and has the tip Pleganophorus bispinosus`);
  ok(
    view !== null && view.every((c) => c.minCladePx === 14 && c.summaries === 0 && c.tips > 20 && c.minPxUsed <= c.rowPx),
    `rows of 13, 8 and 6.5 px, minCladePx 14: no summaries, one-tip genera drawn as tips, minPxUsed at most the row height (${JSON.stringify(view)})`,
  );
}

console.log('\na first load that is cancelled or fails: nothing shown, the list on nothing, so any entry (the same too) can be chosen again');
{
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const parsing = () =>
    p2.waitForFunction(() => /parsing/.test(document.querySelector('.page-loading')?.textContent ?? ''), null, { timeout: 90000 });
  const state = () =>
    p2.evaluate(() => ({
      id: document.querySelector('.page-head select').value,
      canvas: document.querySelector('.ex-outer canvas') !== null,
      loading: document.querySelector('.page-loading') !== null,
      error: document.querySelector('.page-error')?.textContent ?? null,
    }));
  const u = new URL(url);
  u.searchParams.set('tree', 'otl-2m-full');
  await p2.goto(u.href);
  await parsing();
  await p2.click('.page-loading button');
  await p2.waitForFunction(() => !document.querySelector('.page-loading'));
  const s1 = await state();
  ok(s1.id === '' && !s1.canvas && /cancelled/.test(s1.error ?? ''), `Cancel of a first load: no tree, the list on nothing, "${s1.error}"`);
  await p2.selectOption('.page-head select', 'otl-2m-full');
  await parsing();
  const s2 = await state();
  ok(s2.loading && s2.id === 'otl-2m-full' && s2.error === null, 'the same entry can be chosen again: it loads, the error is gone');
  await p2.click('.page-loading button');
  await p2.selectOption('.page-head select', 'syn-yule-1000');
  await p2.waitForFunction(() => window.__explorer?.()?.getTree().tipCount === 1000, null, { timeout: 30000 });
  ok((await state()).error === null, 'then another tree loads');
  u.searchParams.set('tree', 'no-such-tree');
  await p2.goto(u.href);
  await p2.waitForFunction(() => document.querySelector('.page-error'));
  const s3 = await state();
  ok(
    s3.id === '' && !s3.canvas && /unknown tree/.test(s3.error ?? ''),
    `a first load that fails: no tree, the list on nothing ("${(s3.error ?? '').slice(0, 40)}…")`,
  );
  await p2.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks pass');
process.exit(failures ? 1 : 0);
