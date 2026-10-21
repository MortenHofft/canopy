// Browser check of the node menu and the tree operations on the dev page (demo.html is dev-only, so it needs the dev server:
// npm run dev, which serves on port 5306).
//   node spikes/custom/scripts/check-node-menu.mjs [--port 5306]
// On the 6-tip edge-case tree: the menu opens on a tip and on a clade with the expected actions and takes focus; arrows move,
// Escape closes it and returns focus to the canvas; Tab out, an outside click and zooming close it; reroot, rotate, remove
// and ladderise change the tip order as expected and focus is on the new canvas afterwards; a clade colour that is no longer
// a clade after a reroot is removed and reported; reset restores the tree as published.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(path.join(root, 'spikes/runner/package.json'));
const { chromium } = require('playwright-core');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const port = Number(args.port || 5306);
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
page.setDefaultTimeout(8000);
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  failures++;
});
await page.goto(`http://127.0.0.1:${port}/demo.html?tree=edge-internal-support&cpu=1`);
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
ok(/Reroot here/.test(await page.evaluate(() => document.activeElement?.textContent ?? '')), 'focus moves to the first item');
await act('reroot');
ok((await order()) === 'CDABEF' && /reroot/.test(await status()), `reroot on C: ${await order()}`);
ok(await canvasFocused(), 'focus is on the new canvas after the action');

// clade menu, keyboard
const ef = await cladeOf('E', 'F');
await openOn(ef);
ok(
  (await items()).join('|') === 'Rotate|Reroot here|Show only this clade|Remove this clade|Colour this clade',
  `clade menu: ${(await items()).join(' | ')}`,
);
await page.keyboard.press('ArrowDown');
ok(/^Reroot here/.test(await page.evaluate(() => document.activeElement?.textContent ?? '')), 'ArrowDown moves to the next item');
await page.keyboard.press('Escape');
ok(!(await menuOpen()) && (await canvasFocused()), 'Escape closes and returns focus to the canvas');
await openOn(ef);
await page.keyboard.press('Shift+Tab');
await page.keyboard.press('Shift+Tab');
ok(!(await menuOpen()), 'Tab out of the menu closes it');
await openOn(ef);
await page.mouse.click(5, 5);
ok(!(await menuOpen()), 'outside click closes it');
await openOn(ef);
await page.mouse.move(ef.x - 20, ef.y - 80); // wheel zoom: a viewport change without a pointer press
await page.mouse.wheel(0, -200);
await page.waitForTimeout(300);
ok(!(await menuOpen()), 'zooming (a viewport change) closes it');
const pb = await pane.boundingBox();
await page.mouse.dblclick(pb.x + 300, pb.y + 12); // double click on empty space fits the tree again
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

// colours follow tips: colour (A,B), reroot on A, the colour is dropped (A alone is now the other side of the root)
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
ok(/0 coloured clades/.test(await status()) && /colour removed: no longer a clade/.test(await status()), `reroot on A drops it: ${await status()}`);

await page.getByRole('button', { name: 'Reset' }).click();
await page.waitForTimeout(400);
ok((await order()) === 'ABCDEF' && /tree as published/.test(await status()), `reset: ${await order()}`);

await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nOK');
process.exit(failures ? 1 : 0);
