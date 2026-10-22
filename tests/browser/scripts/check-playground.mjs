// Browser check of the playground (examples/playground; `npm run dev` there serves on port 5310).
//   node tests/browser/scripts/check-playground.mjs [--port 5310] [--url <page URL, default http://127.0.0.1:<port>/>]
// Each kind of setting reaches the viewer (select, toggle, range, colour, text; options, theme, controls, app settings), the special
// values ('fit' → null, 'Infinity'), presets and the transparent background, the layout toggle feeding back into the panel, the URL
// keeping the settings across a reload and Reset clearing them, the click action, per-tip data columns and the alignment, a tree
// file of one's own, re-creating the viewer for softwareCanvas, and the benchmark.
import { createRequire } from 'node:module';
import { chromiumPath } from './chromium.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const url = args.url || `http://127.0.0.1:${Number(args.port || 5310)}/`;
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(10000);
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  failures++;
});
const ev = (fn, arg) => page.evaluate(fn, arg);
const opt = (k) => ev((k) => window.viewer.options[k], k);
const theme = (k) => ev((k) => window.viewer.getTheme()[k], k);
const settled = () => page.waitForTimeout(150);
const select = async (id, v) => (await page.selectOption(`select[data-setting=${id}]`, v), settled());
const toggle = async (id, on) => (await page.setChecked(`input[data-setting=${id}]`, on), settled());
const setInput = async (id, v) => {
  // range and colour inputs: set the value and fire 'input' as a user's drag or pick does
  await page.locator(`input[data-setting=${id}]`).evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await settled();
};
const open = async (query = '') => {
  await page.goto(url + query);
  await page.waitForFunction(() => window.viewer && document.querySelector('#tree canvas'), null, { timeout: 60000 });
  await page.waitForTimeout(400);
  await ev(() => document.querySelectorAll('details.group').forEach((d) => (d.open = true))); // 'Level of detail' starts closed
};
const query = () => new URL(page.url()).searchParams;

console.log('defaults');
await open();
ok((await page.locator('#tree-info').innerText()).startsWith('135 tips'), 'the default tree is loaded (135 tips)');
ok(query().get('tree') === 'rich-fish-carangaria-135' && [...query().keys()].length === 1, 'the URL holds only the tree while everything is default');
ok((await page.locator('.setting.changed').count()) === 0, 'no setting marked as changed');
ok((await page.locator('.phylo-zoom').count()) === 1 && (await page.locator('.phylo-search').count()) === 1, 'default controls: zoom, fit, search');

console.log('options');
await select('layout', 'radial');
ok((await opt('layout')) === 'radial' && query().get('s.layout') === 'radial', 'layout select → options.layout, and into the URL');
await select('drawBudget', '2000');
ok((await opt('drawBudget')) === 2000, 'numeric select → a number');
await select('radialMaxNodes', 'Infinity');
ok((await opt('radialMaxNodes')) === Infinity, "'Infinity' → Infinity");
await select('layout', 'rectangular');
await select('rowHeight', '12');
ok((await opt('rowHeight')) === 12, 'row height 12');
await select('rowHeight', 'fit');
ok((await opt('rowHeight')) === null && !query().has('s.rowHeight'), "'fit' → null, and out of the URL again");
await toggle('branchLengths', false);
ok((await opt('branchLengths')) === false, 'toggle → options.branchLengths false');
await toggle('underscores', false);
ok((await ev(() => window.viewer.options.formatLabel('a_b'))) === 'a_b', 'underscores kept (formatLabel)');
await toggle('tipLinks', true);
ok(
  typeof (await ev(() => typeof window.viewer.options.tipHref)) === 'string' &&
    (await ev(() => window.viewer.options.tipHref('A_b'))).includes('gbif.org'),
  'tip links → tipHref to GBIF',
);

console.log('theme');
await setInput('labelSize', '18');
ok((await theme('labelSize')) === 18, 'range → theme.labelSize');
await setInput('branch', '#ff0000');
ok((await theme('branch')) === '#ff0000' && query().get('s.branch') === '#ff0000', 'colour → theme.branch, and into the URL');
await select('preset', 'dark');
ok((await theme('background')) === '#0f172a' && (await theme('branch')) === '#cbd5e1', 'Dark preset sets the tokens');
await toggle('transparent', true);
ok(
  (await theme('background')) === 'transparent' && (await page.locator('.tree-card.dotted').count()) === 1,
  'transparent background: the dotted card shows through',
);
ok(await page.locator('input[data-setting=background]').isDisabled(), 'the background colour is disabled meanwhile');
await select('preset', 'default');
ok((await theme('background')) === '#ffffff' && (await theme('labelSize')) === 13, 'Library default preset restores every token');

console.log('controls');
await toggle('zoom', false);
await toggle('overview', true);
ok((await page.locator('.phylo-zoom').count()) === 0 && (await page.locator('.phylo-overview').count()) === 1, 'zoom off, overview on');
await toggle('layoutToggle', true);
await page.locator('.phylo-layout-toggle button').nth(1).click();
await settled();
ok(
  (await opt('layout')) === 'radial' && (await page.locator('select[data-setting=layout]').inputValue()) === 'radial',
  'the layout toggle control changes the layout and the panel follows',
);
await select('layout', 'rectangular');

console.log('the URL keeps the settings');
const before = page.url();
await open(new URL(before).search);
ok(
  (await opt('branchLengths')) === false && (await theme('labelSize')) === 13 && (await page.locator('.phylo-overview').count()) === 1,
  'after a reload: same options, theme and controls',
);
ok(
  (await page.locator('input[data-setting=overview]').isChecked()) && (await page.locator('.setting.changed').count()) > 0,
  'and the panel shows them',
);
await page.locator('#reset').click();
await settled();
ok(
  [...query().keys()].join() === 'tree' && (await opt('branchLengths')) === true && (await page.locator('.phylo-zoom').count()) === 1,
  'Reset all: defaults, URL with only the tree',
);

console.log('clicks and highlighting');
await select('click', 'colour');
const clade = await ev(() => {
  const v = window.viewer;
  const t = v.getTree();
  for (let i = 1; i < t.nodeCount; i++) if (t.firstChild[i] >= 0 && t.leafEnd[i] - t.leafStart[i] >= 5) return { node: i, ...v.locateNode(i) };
});
await page.mouse.click(clade.x, clade.y);
await settled();
ok(
  (await ev(() =>
    window.viewer
      .getClades()
      .map((c) => c.node)
      .join(),
  )) === String(clade.node),
  'click with "Colour the clade" colours it',
);
ok(await page.locator('.phylo-legend').isVisible(), 'and the legend shows it');
await select('click', 'menu');
await page.mouse.click(clade.x, clade.y);
ok((await page.locator('[role=menu]').count()) === 1, '"Node menu" opens the menu');
await page.keyboard.press('Escape');
await page.locator('input[data-setting=find]').fill('Bothus');
await settled();
ok((await ev(() => window.viewer.getHighlighted().length)) === 2, 'highlight text → 2 tips');

console.log('tree operations');
await page.locator('input[data-setting=find]').fill('');
const tips = () => ev(() => window.viewer.getTree().tipCount);
// a visible clade of the shown tree with lo..hi tips (skip: the how-manyth), and where to click it
const cladeOf = (lo, hi, skip = 0) =>
  ev(
    ([lo, hi, skip]) => {
      const v = window.viewer;
      const t = v.getTree();
      for (let i = 1; i < t.nodeCount; i++) {
        const c = t.leafEnd[i] - t.leafStart[i];
        if (t.firstChild[i] >= 0 && c >= lo && c <= hi && skip-- <= 0) {
          const q = v.locateNode(i);
          if (q) return { node: i, tips: c, x: q.x, y: q.y };
        }
      }
      return null;
    },
    [lo, hi, skip],
  );
const menu = async (p, item) => {
  await page.mouse.click(p.x, p.y);
  await page.locator('[role=menuitem]', { hasText: item }).first().click();
  await page.waitForTimeout(300);
};
const status = () => page.locator('#ops-status').innerText();
const whole = await tips();
const big = await cladeOf(30, 80);
await menu(big, 'Show only this clade');
ok((await tips()) === big.tips && (await status()).includes(`a clade of ${big.tips} of ${whole} tips`), `Show only this clade: ${big.tips} tips`);
ok(
  query().has('focus') && !(await page.locator('#ops-back').isDisabled()) && !(await page.locator('#ops-up').isDisabled()),
  'focus in the URL; Back and Up enabled',
);
const small = await cladeOf(4, 12);
await menu(small, 'Collapse');
const afterCollapse = await tips();
ok(afterCollapse === big.tips - small.tips + 1, `Collapse: ${big.tips} → ${afterCollapse} tips`);
const tri = await ev(() => {
  const t = window.viewer.getTree();
  for (let r = 0; r < t.tipCount; r++) if (/ and \d+ more$| \(\d+ tips\)$/.test(t.tipLabels[r])) return window.viewer.locateNode(t.tipNode[r]);
  return null;
});
ok(
  tri !== null && query().has('collapsed') && (await page.locator('#ops-expand').innerText()) === 'Expand all (1)',
  'a triangle tip, collapsed in the URL, Expand all (1)',
);
await open(new URL(page.url()).search);
ok((await tips()) === afterCollapse && (await status()).includes('1 collapsed'), 'the focus and the collapsed clade survive a reload');
await menu(
  await ev(() => {
    const t = window.viewer.getTree();
    for (let r = 0; r < t.tipCount; r++) if (/ and \d+ more$| \(\d+ tips\)$/.test(t.tipLabels[r])) return window.viewer.locateNode(t.tipNode[r]);
  }),
  'Expand',
);
ok((await tips()) === big.tips && !query().has('collapsed'), 'Expand from the triangle’s menu');
// a colour set inside the clade stays on it when going back out
const inner = await cladeOf(3, 10);
await menu(inner, 'Colour this clade');
await page.locator('#ops-up').click();
await page.waitForTimeout(300);
const up1 = await tips();
ok(up1 > big.tips, `Up one level: the clade that contains it (${up1} tips)`);
ok((await ev(() => window.viewer.getClades().length)) === 1, 'the colour moves with the clade');
await page.locator('#ops-back').click();
await page.waitForTimeout(300);
ok((await tips()) === big.tips, 'Back: the clade again');
// up from the shown root's menu, level by level, until the whole tree
for (let i = 0; i < 50 && (await tips()) < whole; i++) {
  const r = await ev(() => window.viewer.locateNode(0));
  await menu(r, 'Up one level');
}
ok((await tips()) === whole && (await page.locator('#ops-up').isDisabled()), 'Up one level from the shown root’s menu reaches the whole tree');
// click actions
await select('click', 'collapse');
const c2 = await cladeOf(4, 12, 2);
await page.mouse.click(c2.x, c2.y);
await page.waitForTimeout(300);
ok((await tips()) === whole - c2.tips + 1, 'click action "Collapse or expand"');
await page.locator('#ops-expand').click();
await page.waitForTimeout(300);
ok((await tips()) === whole && (await page.locator('#ops-expand').isDisabled()), 'Expand all');
await select('click', 'focus');
const c3 = await cladeOf(10, 40);
await page.mouse.click(c3.x, c3.y);
await page.waitForTimeout(300);
ok((await tips()) === c3.tips, 'click action "Show only the clade"');
await page.locator('#reset').click();
await page.waitForTimeout(300);
ok(
  (await tips()) === whole && !query().has('focus') && (await ev(() => window.viewer.getClades().length)) === 0,
  'Reset all: the whole tree, no colours',
);
// collapse by support: 0.95 and 100 on one tree (two scales in one file), so the threshold is in % of the scale 0..100
await page.selectOption('#tree-select', 'edge-internal-support');
await page.waitForFunction(() => document.querySelector('#tree-info').textContent.startsWith('6 tips'), null, { timeout: 30000 });
await page.waitForTimeout(300);
ok((await page.locator('#support-note').innerText()).includes('0.95 to 100'), 'the support range of the tree is shown');
const nodes = () => ev(() => window.viewer.getTree().nodeCount);
const n0 = await nodes();
await toggle('supportCollapse', true);
await setInput('minSupport', '99');
await page.waitForTimeout(300);
ok(
  (await nodes()) === n0 - 1 && (await status()).includes('1 branches with low support collapsed'),
  'collapse by support < 99: the 0.95 branch goes',
);
await toggle('supportCollapse', false);
await page.waitForTimeout(300);
ok((await nodes()) === n0, 'unticked: back');
await page.selectOption('#tree-select', 'rich-fish-carangaria-135');
await page.waitForFunction(() => document.querySelector('#tree-info').textContent.startsWith('135 tips'), null, { timeout: 30000 });
ok(await page.locator('input[data-setting=supportCollapse]').isDisabled(), 'no support values: the switch is off');

console.log('data columns');
await page.selectOption('#tree-select', 'syn-yule-1000');
await page.waitForFunction(() => document.querySelector('#tree-info').textContent.startsWith('1,000 tips'), null, { timeout: 30000 });
await page.waitForTimeout(400);
const cell = (id) => ev((id) => window.viewer.columnCell(id, 0), id);
ok((await cell('m:occurrence_count')) !== null && (await cell('alignment')) !== null, 'occurrence bars and the alignment shown by default');
ok((await page.locator('#data-columns .muted').innerText()).includes('of 1,000 tips have data'), 'says how many tips have data');
await page.locator('[data-column=alignment]').setChecked(false);
await page.locator('[data-column=country_code]').setChecked(true);
await settled();
ok((await cell('alignment')) === null && (await cell('m:country_code')) !== null, 'columns switch on and off');
await toggle('columns', false);
ok((await cell('m:occurrence_count')) === null, 'all columns off with the group switch');
ok(query().get('tree') === 'syn-yule-1000', 'the tree is in the URL');

console.log('own file, re-creation, benchmark');
await page
  .locator('#tree-file')
  .setInputFiles({ name: 'mine.nwk', mimeType: 'text/plain', buffer: Buffer.from('((a:1,b:2):1,(c:1,(d:1,e:1):2):1);') });
await page.waitForFunction(() => document.querySelector('#tree-info').textContent.startsWith('5 tips'), null, { timeout: 30000 });
ok((await ev(() => window.viewer.getTree().tipCount)) === 5 && !query().has('tree'), 'a file of one’s own: 5 tips, no tree in the URL');
await ev(() => (window.__old = window.viewer));
await toggle('softwareCanvas', true);
ok(
  (await ev(() => window.viewer !== window.__old && window.__old.isDestroyed())) && (await opt('softwareCanvas')) === true,
  'softwareCanvas re-creates the viewer',
);
await page.locator('#bench').click();
ok((await page.locator('#log').textContent()).includes('30 frames: mean'), 'Benchmark reports in the event log'); // textContent: the log is in a closed <details>

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks pass');
process.exit(failures ? 1 : 0);
