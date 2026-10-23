// Browser check of the unrooted layout spike page (examples/unrooted; start it with `npm run dev` there, which serves on port 5313).
//   node tests/browser/scripts/check-unrooted.mjs [--port 5313] [--url <page URL, default http://127.0.0.1:<port>/>]
// The page draws unrootedLayout() of one tree on a plain canvas (window.__unrooted describes what is drawn): the default tree draws
// (non-blank pixels); the tree picker switches to another tree, which draws too and goes into the URL; the lengths and labels toggles
// redraw and go into the URL; ?tree=&lengths=0&labels=1 opened directly gives that state; a path under data/ works as ?tree=.
import { createRequire } from 'node:module';
import { chromiumPath } from './chromium.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const port = Number(args.port || 5313);
const url = args.url || `http://127.0.0.1:${port}/`;
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
page.setDefaultTimeout(20000);
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  console.log('CONSOLE.ERROR', m.text().slice(0, 300));
  failures++;
});
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  failures++;
});

/** Wait until the page has drawn `tree` (and, when given, with that labels state). */
const drawn = (tree, labels) =>
  page.waitForFunction(
    ([tree, labels]) => window.__unrooted?.tree === tree && (labels === undefined || window.__unrooted.labels === labels),
    [tree, labels],
  );
const state = () => page.evaluate(() => ({ ...window.__unrooted, redraw: undefined }));
/** Pixels of the canvas that differ from its corner (the background), in device pixels. */
const inked = () =>
  page.evaluate(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) n++;
    return n;
  });
const query = () => new URL(page.url()).searchParams;

console.log('default tree');
await page.goto(url);
await drawn('gtdb-1k');
let s = await state();
ok(s.tips === 932 && s.usedLengths && !s.labels, `GTDB 1k drawn with branch lengths, no labels (${s.tips} tips)`);
const ink1 = await inked();
ok(ink1 > 2000, `the canvas is drawn (${ink1} non-background pixels)`);
ok((await page.locator('#tree-select option').count()) >= 4, 'the picker lists the trees');
ok(/932 tips/.test(await page.locator('#info').innerText()), 'the info line names the tree');
ok(
  (await page.locator('a[href="https://github.com/MortenHofft/gbif-phylo/blob/main/docs/design/unrooted.md"]').count()) === 1,
  'the page links the design note',
);

console.log('\nthe picker switches trees');
await page.selectOption('#tree-select', 'hcv-19');
await drawn('hcv-19');
s = await state();
ok(s.tips === 19 && s.usedLengths && s.labels, `HCV 19 drawn with branch lengths and labels (${s.tips} tips)`);
const ink2 = await inked();
ok(ink2 > 500 && ink2 !== ink1, `the canvas is drawn again, differently (${ink2} non-background pixels)`);
ok(query().get('tree') === 'hcv-19', 'the URL has ?tree=hcv-19');

console.log('\nthe toggles');
await page.locator('#labels').uncheck();
await drawn('hcv-19', false);
ok(query().get('labels') === '0', 'labels off: ?labels=0');
const ink3 = await inked();
ok(ink3 > 0 && ink3 < ink2, `without labels fewer pixels are drawn (${ink3} < ${ink2})`);
await page.locator('#lengths').uncheck();
await page.waitForFunction(() => window.__unrooted.usedLengths === false);
ok(query().get('lengths') === '0', 'unit lengths: ?lengths=0');
await page.locator('#lengths').check();
await page.waitForFunction(() => window.__unrooted.usedLengths === true);
ok(!query().has('lengths'), 'branch lengths again: ?lengths= is gone');

console.log('\nthe URL');
await page.goto(url + '?tree=otl-canidae-200&lengths=0&labels=1');
await drawn('otl-canidae-200');
s = await state();
ok(s.tips === 211 && !s.usedLengths && s.labels, 'opened with ?tree=otl-canidae-200&lengths=0&labels=1');
ok(
  (await page.locator('#tree-select').inputValue()) === 'otl-canidae-200' &&
    !(await page.locator('#lengths').isChecked()) &&
    (await page.locator('#labels').isChecked()),
  'the controls show the URL state',
);
ok((await inked()) > 2000, 'drawn');
await page.goto(url + '?tree=otl-testudines-1k');
await drawn('otl-testudines-1k');
s = await state();
ok(s.tips === 888 && !s.usedLengths, 'OTL Testudines 1k (no lengths) draws with unit lengths');
await page.goto(url + '?tree=' + encodeURIComponent('real-ladder/trees/otl-0200-canidae.nwk.gz'));
await drawn('real-ladder/trees/otl-0200-canidae.nwk.gz');
ok((await state()).tips === 211, 'a path under data/ works as ?tree=');

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks pass');
process.exit(failures ? 1 : 0);
