// Browser check of the framework-free example (examples/vanilla), the library used the way a non-React page would use it:
// the built-in controls in their corners and one outside the viewer, a custom control, search, the custom popup (an Overlay) on a tip
// click and following the tip while the view moves, the built-in node menu on a clade, the legend, a custom column painting, removing
// and adding the controls, and a dark theme that is only CSS custom properties. No page errors.
//   node tests/browser/scripts/check-vanilla-example.mjs [--url http://127.0.0.1:5308/]   (dev server: npm run dev in examples/vanilla)
import { createRequire } from 'node:module';
import { chromiumPath } from './chromium.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const url = args.url || 'http://127.0.0.1:5308/';
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
page.setDefaultTimeout(10000);
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  failures++;
});
await page.goto(`${url}${url.includes('?') ? '&' : '?'}cpu=1`);
await page.waitForFunction(() => window.__example?.viewer.getStats().frames > 0, null, { timeout: 60000 });
await sleep(300);

const ev = (fn, arg) => page.evaluate(fn, arg);
const view = () => ev(() => window.__example.viewer.getViewport());

// ---- controls in their corners, and one outside the viewer
const placed = await ev(() => {
  const v = window.__example.viewer;
  const corner = (cls) =>
    document
      .querySelector(`.${cls}`)
      ?.closest('.phylo-controls')
      ?.className.match(/phylo-controls--([a-z-]+)/)?.[1] ?? null;
  return {
    zoom: corner('phylo-zoom'),
    fit: corner('phylo-fit'),
    search: corner('phylo-search'),
    inView: corner('phylo-in-view'),
    layoutOutside:
      !!document.querySelector('#layout-slot .phylo-layout-toggle') && !v.element.contains(document.querySelector('.phylo-layout-toggle')),
    overview: !!v.element.querySelector('.phylo-overview canvas'),
  };
});
ok(placed.zoom === 'top-left' && placed.fit === 'top-left', `zoom and fit top left (${placed.zoom}, ${placed.fit})`);
ok(placed.search === 'top-right' && placed.inView === 'top-right', `search and the custom control top right (${placed.search}, ${placed.inView})`);
ok(placed.layoutOutside, 'the layout toggle sits in the page header, outside the viewer');
ok(placed.overview, 'the overview control drew its canvas');
const inViewText = await page.locator('.phylo-in-view').textContent();
ok(/1,000 of 1,000 tips in view/.test(inViewText), `custom control shows the tips in view: "${inViewText}"`);

// ---- zoom and fit buttons
const v0 = await view();
await page.locator('.phylo-zoom button[aria-label="Zoom in"]').click();
await sleep(250);
const v1 = await view();
ok(v1.y1 - v1.y0 < (v0.y1 - v0.y0) * 0.8 && Math.abs(v1.x1 - v1.x0 - (v0.x1 - v0.x0)) < 1e-9, 'zoom in narrows the rows, not the x range');
ok(!/1,000 of 1,000/.test(await page.locator('.phylo-in-view').textContent()), 'the custom control followed the viewchange event');
await page.locator('.phylo-fit button').click();
await sleep(500);
const v2 = await view();
ok(Math.abs(v2.y1 - v2.y0 - (v0.y1 - v0.y0)) < 1e-6, 'fit returns to the whole tree');

// ---- layout toggle (outside the viewer)
await page.locator('#layout-slot button[aria-label="Radial layout"]').click();
await sleep(200);
ok((await ev(() => window.__example.viewer.options.layout)) === 'radial', 'the external layout toggle switches to radial');
ok((await page.locator('#layout-slot button[aria-label="Radial layout"]').getAttribute('aria-pressed')) === 'true', 'and shows it as pressed');
await page.locator('#layout-slot button[aria-label="Rectangular layout"]').click();
await sleep(300);

// ---- search: type, Enter: the tip is highlighted and in view
const target = await ev(() => window.__example.viewer.getTree().tipLabels[500]);
await page.locator('.phylo-search input').fill(target.replace(/_/g, ' ').slice(0, 12));
await sleep(250);
ok((await page.locator('.phylo-search [role=option]').count()) > 0, 'search lists suggestions');
await page.locator('.phylo-search input').fill(target.replace(/_/g, ' '));
await sleep(250);
await page.locator('.phylo-search input').press('Enter');
await sleep(400);
const found = await ev(() => ({ hl: window.__example.viewer.getHighlighted(), vp: window.__example.viewer.getViewport() }));
ok(found.hl.length === 1 && found.hl[0] === target, `search highlights the chosen tip (${found.hl})`);
ok(found.vp.y0 <= 500 && found.vp.y1 >= 501 && found.vp.y1 - found.vp.y0 < 900, 'and brings it into view, zoomed in');

// ---- a tip click opens the custom card (an Overlay) above the tip, and no menu
const tipAt = await ev((t) => {
  const v = window.__example.viewer;
  const p = v.nodePosition(v.tipNode(t));
  const r = v.element.getBoundingClientRect();
  return p && { x: r.left + p.x, y: r.top + p.y };
}, target);
ok(!!tipAt, 'the found tip has a position');
await page.mouse.click(tipAt.x, tipAt.y);
await sleep(250);
const card = await ev(() => {
  const c = window.__example.card.element;
  const b = c.getBoundingClientRect();
  return {
    visible: getComputedStyle(c).visibility === 'visible',
    tip: c.dataset.tipId,
    cx: b.left + b.width / 2,
    bottom: b.bottom,
    text: c.textContent,
  };
});
ok(card.visible && card.tip === target, `tip click shows the card for ${card.tip}`);
ok(
  Math.abs(card.cx - tipAt.x) < 2 && Math.abs(card.bottom - (tipAt.y - 14)) < 2,
  `the card sits above the tip (centre ${card.cx.toFixed(0)} vs ${tipAt.x.toFixed(0)})`,
);
ok(/Occurrences/.test(card.text), 'the card shows the tip metadata');
ok((await page.locator('[role=menu]').count()) === 0, 'preventDefault kept the node menu closed for the tip');

// ---- the card follows the tip when the view moves
await ev(() => {
  const v = window.__example.viewer;
  const w = v.getViewport();
  const d = (w.y1 - w.y0) * 0.2;
  v.setViewport({ ...w, y0: w.y0 + d, y1: w.y1 + d });
});
await sleep(250);
const moved = await ev((t) => {
  const v = window.__example.viewer;
  const p = v.nodePosition(v.tipNode(t));
  const r = v.element.getBoundingClientRect();
  const b = window.__example.card.element.getBoundingClientRect();
  return { tipY: p ? r.top + p.y : null, bottom: b.bottom, visible: getComputedStyle(window.__example.card.element).visibility === 'visible' };
}, target);
ok(
  moved.tipY !== null && moved.visible && Math.abs(moved.bottom - (moved.tipY - 14)) < 2,
  `after a pan the card is still above the tip (${moved.bottom} vs ${moved.tipY})`,
);
await page.locator('.tip-card button').click();
await sleep(100);
ok((await ev(() => getComputedStyle(window.__example.card.element).visibility)) === 'hidden', 'Close hides the card');

// ---- a clade click opens the node menu; colouring a clade fills the legend
await page.locator('.phylo-fit button').click();
await sleep(500);
const clade = await ev(() => {
  const v = window.__example.viewer;
  const t = v.getTree();
  const r = v.element.getBoundingClientRect();
  for (let i = 1; i < t.nodeCount; i++) {
    const n = t.leafEnd[i] - t.leafStart[i];
    if (n < 60 || n > 200) continue;
    const p = v.locateNode(i);
    if (p && p.x - r.left > 120 && p.x - r.left < 600) return { x: p.x, y: p.y, node: i };
  }
  return null;
});
ok(!!clade, 'found a clade marker to click');
await page.mouse.click(clade.x, clade.y);
await sleep(200);
const items = (await page.locator('[role=menuitem]').allInnerTexts()).map((s) => s.split('\n')[0]);
ok(items.join('|') === 'Zoom to this clade|Colour this clade|Clear colours', `the node menu lists the page's actions (${items.join(', ')})`);
await page.locator('[role=menuitem][data-action=colour]').click();
await sleep(200);
const legend = await ev(() => ({
  hidden: document.querySelector('.phylo-legend').hidden,
  entries: [...document.querySelectorAll('.phylo-legend__label')].map((e) => e.textContent),
  clades: window.__example.viewer.getClades().length,
}));
ok(
  legend.clades === 1 && !legend.hidden && legend.entries.length === 1 && /^Clade n\d+$/.test(legend.entries[0]),
  `the legend shows the coloured clade (${legend.entries})`,
);

// ---- the custom column paints its cells (a pixel of the heat strip is not background)
const probe = await ev(() => {
  const v = window.__example.viewer;
  const t = v.getTree();
  const r = v.element.getBoundingClientRect();
  const ctx = v.ctx;
  const dpr = ctx.canvas.width / r.width;
  for (let k = 0; k < t.tipCount; k++) {
    const c = v.columnCell('trait', k);
    if (!c || c.height < 0.5) continue;
    const x = Math.round((c.x - r.left + c.width / 2) * dpr),
      y = Math.round((c.y - r.top + c.height / 2) * dpr);
    const d = ctx.getImageData(x, y, 1, 1).data;
    return { rgb: [d[0], d[1], d[2]], header: true };
  }
  return null;
});
ok(!!probe && !(probe.rgb[0] > 250 && probe.rgb[1] > 250 && probe.rgb[2] > 250), `the custom column painted its cell (rgb ${probe?.rgb})`);

// ---- remove and add the controls
await page.locator('#show-controls').uncheck();
await sleep(100);
const off = await ev(() => ({
  corner: document.querySelectorAll('.phylo-controls .phylo-control').length,
  overview: document.querySelectorAll('.phylo-overview canvas').length,
  outside: document.querySelectorAll('#layout-slot .phylo-layout-toggle').length,
}));
ok(off.corner === 0 && off.overview === 0 && off.outside === 1, `unchecking removes the corner controls and the overview (${JSON.stringify(off)})`);
await page.locator('#show-controls').check();
await sleep(200);
ok((await ev(() => document.querySelectorAll('.phylo-controls .phylo-control').length)) === 5, 'checking puts them back');

// ---- dark theme from CSS custom properties: the canvas and the controls follow
const bgPixel = () =>
  ev(() => {
    const v = window.__example.viewer;
    const d = v.ctx.getImageData(Math.round(v.ctx.canvas.width * 0.5), 2, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
await page.locator('#dark').check();
await sleep(300);
const dark = await ev(() => ({
  t: window.__example.viewer.getTheme(),
  zoomBg: getComputedStyle(document.querySelector('.phylo-zoom')).backgroundColor,
}));
const px = await bgPixel();
ok(dark.t.dark === true && dark.t.background === '#0f172a', `the dark class switches the canvas theme (${dark.t.background}, dark ${dark.t.dark})`);
ok(px[0] < 40 && px[1] < 40 && px[2] < 60, `the canvas background is dark (${px})`);
ok(dark.zoomBg === 'rgb(30, 41, 59)', `the controls follow (${dark.zoomBg})`);
await page.locator('#dark').uncheck();
await sleep(300);
ok((await ev(() => window.__example.viewer.getTheme().dark)) === false && (await bgPixel())[0] > 240, 'and back to light');

const logged = await page.locator('#log li').allInnerTexts();
ok(
  logged.some((l) => l.startsWith('ready')) && logged.some((l) => l.startsWith('click')) && logged.some((l) => l.startsWith('clades')),
  'the event log saw ready, click and clades events',
);

// ---- accessibility: controls and popups are not inside the role="tree" element (a tree may only own tree items)
await page.mouse.click(clade.x, clade.y); // open the node menu again, so it is part of what is checked
await sleep(200);
const inTree = await ev(() =>
  [...document.querySelectorAll('[role=menu], [role=menuitem], .phylo-search input, .phylo-button, .phylo-legend, [role=tooltip]')]
    .filter((e) => e.closest('[role=tree]'))
    .map((e) => e.className || e.getAttribute('role')),
);
ok(inTree.length === 0, `no control or popup inside role=tree${inTree.length ? ': ' + inTree.join(', ') : ''}`);
await page.keyboard.press('Escape');
await sleep(100);

// ---- the wheel over the overview strip zooms the tree and does not scroll the page; over the legend it is left to the legend
// a spacer after <body> makes the page scroll without resizing the viewer
await ev(() => {
  const spacer = document.createElement('div');
  spacer.id = 'spacer';
  spacer.style.height = '2000px';
  document.documentElement.appendChild(spacer);
  window.scrollTo(0, 0);
});
await page.locator('.phylo-fit button').click();
await sleep(500);
const ovBox = await page.locator('.phylo-overview').boundingBox();
const before = await view();
await page.mouse.move(ovBox.x + ovBox.width / 2, ovBox.y + ovBox.height / 2);
await page.mouse.wheel(0, -200);
await sleep(300);
const afterWheel = { v: await view(), scrollY: await ev(() => window.scrollY) };
ok(afterWheel.scrollY === 0, `the wheel over the overview does not scroll the page (scrollY ${afterWheel.scrollY})`);
ok(afterWheel.v.y1 - afterWheel.v.y0 < before.y1 - before.y0, 'it zooms the tree');
const zoomBox = await page.locator('.phylo-zoom').boundingBox();
await page.mouse.move(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2);
const v3 = await view();
await page.mouse.wheel(0, -200);
await sleep(300);
ok((await ev(() => window.scrollY)) === 0 && (await view()).y1 - (await view()).y0 < v3.y1 - v3.y0, 'the same over the zoom buttons');
await ev(() => document.getElementById('spacer').remove());

// ---- a control has one viewer: added to a second viewer it leaves the first, and destroying the first leaves it working on the second
const owner = await ev(async () => {
  const { viewer, cornerControls } = window.__example;
  const Viewer = viewer.constructor;
  const Zoom = cornerControls[0].constructor;
  const mk = () => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:500px;height:300px;z-index:99999;background:#fff';
    document.body.appendChild(host);
    return { host, v: new Viewer({ target: host, tree: viewer.getTree(), options: { softwareCanvas: true } }) };
  };
  const a = mk();
  const b = mk();
  const zoom = new Zoom();
  a.v.addControl(zoom);
  b.v.addControl(zoom); // the natural order when replacing a viewer: the new one first, then destroy the old one
  const inA = a.v.getControls().includes(zoom);
  a.v.destroy();
  a.host.remove();
  const y0 = b.v.getViewport();
  zoom.zoomIn.click();
  const y1 = b.v.getViewport();
  const out = {
    inA,
    inB: b.v.getControls().includes(zoom),
    elementInB: b.v.element.contains(zoom.element),
    zooms: y1.y1 - y1.y0 < y0.y1 - y0.y0,
  };
  b.v.destroy();
  b.host.remove();
  return out;
});
ok(!owner.inA && owner.inB && owner.elementInB, `adding a control to a second viewer moves it (${JSON.stringify(owner)})`);
ok(owner.zooms, 'destroying the first viewer leaves the control working on the second');

await browser.close();
console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
