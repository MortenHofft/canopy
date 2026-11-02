// Browser check of the GBIF map view example (examples/gbif-map-view): a tree with a CSV of GBIF matches and a map (maplibre) of the
// occurrences of the nodes you click. A click colours a node in the tree and adds a layer to the map and a row to the legend; the legend
// changes the colour, hides a layer, reorders, zooms the tree, links to gbif.org and removes. The network is stubbed (the map's tiles
// answer empty), so the check does not depend on GBIF; the requests it records say what the map asked for. Needs WebGL: the sandbox's
// Chromium gets it from SwiftShader. No page errors.
//   node tests/browser/scripts/check-gbif-map-view.mjs [--url http://127.0.0.1:5312/]   (dev server: npm run dev in examples/gbif-map-view)
import { createRequire } from 'node:module';
import { chromiumPath } from './chromium.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const url = args.url || 'http://127.0.0.1:5312/';
const CHECKLIST = '7ddf754f-d193-4cc9-b351-99906754a03b';
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: chromiumPath(),
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
page.setDefaultTimeout(10000);
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  failures++;
});
// GBIF is not asked: the basemap is a 1x1 PNG, the occurrence tiles are empty. The requests are kept.
const ONE_PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const asked = [];
await page.route(/(api|tile)\.gbif\.org/, (route) => {
  const u = route.request().url();
  if (u.includes('api.gbif.org')) {
    asked.push(u);
    return route.fulfill({ status: 204 });
  }
  return route.fulfill({ status: 200, contentType: 'image/png', body: ONE_PX });
});
await page.goto(`${url}${url.includes('?') ? '&' : '?'}cpu=1`);
await page.waitForFunction(() => window.__example?.map?.loaded() && window.__example.viewer.getStats().frames > 0, null, { timeout: 60000 });
await sleep(300);
const ev = (fn, arg) => page.evaluate(fn, arg);

const layers = () =>
  ev(() =>
    window.__example.map
      .getStyle()
      .layers.filter((l) => l.id.startsWith('occurrences-'))
      .map((l) => ({ id: l.id, layout: l.layout?.visibility ?? 'visible', colour: l.paint['circle-color'] })),
  );
const tileOf = (id) => ev((i) => window.__example.map.getSource(i).tiles[0], id);
const clades = () => ev(() => window.__example.viewer.getClades().map((c) => ({ node: c.node, colour: c.colour })));
const rows = () => page.locator('.legend-item');
const click = async (label) => {
  const at = await ev((t) => {
    const v = window.__example.viewer;
    const p = v.nodePosition(t === 'root' ? 0 : v.tipNode(t));
    const r = v.element.getBoundingClientRect();
    return p && { x: r.left + p.x, y: r.top + p.y };
  }, label);
  await page.mouse.click(at.x, at.y);
  await sleep(300);
};

// ---- the start: a tree, a map, an empty legend, the controls of the tree
ok(await page.locator('.legend-empty').isVisible(), 'the legend starts empty');
ok((await layers()).length === 0, 'the map has no occurrence layer yet');
ok(!!(await ev(() => document.querySelector('.phylo-overview canvas'))), 'the minimap draws its canvas');
ok(
  (await page.locator('.phylo-fit').count()) === 1 && (await page.locator('.phylo-layout-toggle').count()) === 1,
  'the tree has fit and the layout toggle',
);
ok((await page.locator('.phylo-zoom, .phylo-search').count()) === 0, 'and no zoom buttons or search');
ok(
  (await ev(() => document.querySelector('.phylo-fit').closest('.phylo-controls').className)).includes('top-right'),
  'fit and the toggle are at the top right of the tree',
);

// ---- a click colours a tip: tree, map and legend
await click('Australian_Blackwood');
let l = await layers();
ok(l.length === 1 && (await rows().count()) === 1, 'a click on a tip adds a layer and a row');
ok((await clades()).length === 1, 'and colours it in the tree');
const tile = await tileOf(l[0].id);
ok(
  tile.includes(`checklistKey=${CHECKLIST}`) && tile.includes('taxonKey=8PN2') && !tile.includes('taxonKey=LV7'),
  'the layer asks GBIF for its taxon key with the checklist key',
);
ok((await rows().first().locator('.legend-title').innerText()) === 'Acacia melanoxylon R.Br.', 'the legend names it by its GBIF name');
const href = await rows().first().locator('a').getAttribute('href');
ok(
  href === `https://www.gbif.org/occurrence/search?view=MAP&checklistKey=${CHECKLIST}&taxonKey=8PN2`,
  `the link to gbif.org has the same filter (${href})`,
);
await sleep(500);
ok(
  asked.some((u) => u.includes('taxonKey=8PN2') && u.includes(`checklistKey=${CHECKLIST}`)),
  'the map requested tiles of that taxon',
);

// ---- the root: its own key; a second row, on top, in another colour
await click('root');
l = await layers();
ok(l.length === 2 && (await rows().count()) === 2, 'a click on the root adds a second layer');
const root = l.find((x) => x.id !== l[0].id) ?? l[1];
ok((await tileOf(l[1].id)).includes('taxonKey=LV7') && !(await tileOf(l[1].id)).includes('taxonKey=8PN2'), 'the root asks for its own key (LV7)');
ok(l[0].colour !== l[1].colour, 'with another colour');
ok((await rows().first().locator('.legend-title').innerText()) === 'Acacia Mill.', 'the newest row is first (on top)');
ok(
  root !== undefined && l[1].id === (await ev(() => 'occurrences-' + window.__example.selected()[0].node)),
  'and its layer is drawn on top of the other',
);

// ---- the eye hides the layer on the map; the tree keeps the colour
await rows().first().locator('button[aria-label="Hide on the map"]').click();
await sleep(200);
l = await layers();
ok(l[1].layout === 'none' && l[0].layout === 'visible', 'the eye hides that layer only');
ok((await clades()).length === 2, 'the tree keeps the colour');
await rows().first().locator('button[aria-label="Show on the map"]').click();
await sleep(200);
ok((await layers())[1].layout === 'visible', 'and shows it again');

// ---- the colour changes the layer and the tree
await rows().first().locator('input[type=color]').fill('#ff0000');
await sleep(200);
ok((await layers())[1].colour === '#ff0000', 'a new colour reaches the map layer');
ok(
  (await clades()).some((c) => c.colour === '#ff0000'),
  'and the tree',
);

// ---- the order: drag the second row to the top, then ArrowDown on the handle
const first = await rows().first().getAttribute('data-node');
const second = await rows().nth(1).getAttribute('data-node');
await rows().nth(1).locator('.legend-handle').dragTo(rows().first());
await sleep(300);
ok((await rows().first().getAttribute('data-node')) === second, 'dragging the second row to the top reorders the legend');
ok((await layers()).at(-1).id === `occurrences-${second}`, 'and the layers, the first row on top');
await rows().first().locator('.legend-handle').focus();
await page.keyboard.press('ArrowDown');
await sleep(300);
ok(
  (await rows().first().getAttribute('data-node')) === first && (await layers()).at(-1).id === `occurrences-${first}`,
  'ArrowDown on a handle moves the row down',
);

// ---- a link to the tree, and the layout toggle
const v0 = await ev(() => window.__example.viewer.getViewport());
await page.locator('.legend-item:not([data-node="0"]) button[aria-label="Show this clade in the tree"]').click(); // the tip: the root is the whole view already
await sleep(700);
const v1 = await ev(() => window.__example.viewer.getViewport());
ok(JSON.stringify(v1) !== JSON.stringify(v0), 'zoom to the clade changes the tree view');
await page.locator('.phylo-layout-toggle button[aria-label="Radial layout"]').click();
await sleep(400);
ok((await ev(() => window.__example.viewer.options.layout)) === 'radial', 'the toggle switches the tree to circular');
ok(!!(await ev(() => document.querySelector('.phylo-overview canvas'))), 'the minimap is still there');
await page.locator('.phylo-layout-toggle button[aria-label="Rectangular layout"]').click();
await sleep(300);
await page.locator('.phylo-fit button').click();
await sleep(500);

// ---- the basemap: the layers come back
await page.selectOption('#basemap', 'gbif-dark');
await page.waitForFunction(() => window.__example.map.isStyleLoaded());
await sleep(300);
ok((await layers()).length === 2, 'a change of basemap keeps the layers');

// ---- remove one, a node with no taxon key, remove all
await click('Australian_Blackwood');
ok((await layers()).length === 1 && (await rows().count()) === 1 && (await clades()).length === 1, 'a second click on a node removes it');
await click('Wattle_sp_nov');
ok((await rows().count()) === 2 && (await layers()).length === 1, 'a tip with no taxon key gets a row and no layer');
ok(
  (await rows().first().locator('.legend-detail').innerText()) === 'no GBIF match' && (await rows().first().locator('a').count()) === 0,
  'it says no GBIF match and has no link',
);
await rows().nth(1).locator('button[aria-label="Remove"]').click();
await sleep(200);
ok((await rows().count()) === 1 && (await layers()).length === 0, 'the button on a row removes it');
await click('root');
await page.locator('.legend-header button[aria-label="Remove all"]').click();
await sleep(300);
ok(
  (await rows().count()) === 0 && (await layers()).length === 0 && (await clades()).length === 0,
  'remove all empties the legend, the map and the tree colours',
);
ok(await page.locator('.legend-empty').isVisible(), 'and the legend says to click a node');

await browser.close();
console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
