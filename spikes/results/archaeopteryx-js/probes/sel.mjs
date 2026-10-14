// Selection mode: node menu Select -> selected_nodes_changed_event -> adapter-derived event. Needs the demo on 127.0.0.1:5305.
// Paths assume the repository at /home/user/gbif-phylo.
import { open } from './lib.mjs';
const { browser, page } = await open('http://127.0.0.1:5305/?tree=syn-yule-200', { w: 1180, h: 760 });
await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 60000 });
await page.waitForTimeout(800);
await page.locator('.ctl-label', { hasText: 'Selection mode' }).click();
await page.waitForTimeout(1500);
const p = await page.evaluate(() => window.__spike.locate({ kind: 'node', id: 'n20' }));
console.log('node point', JSON.stringify(p));
await page.evaluate(() => window.__spike.clearEvents());
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(400);
const items = await page.evaluate(() => [...document.querySelectorAll('.aptx-node-menu *')].filter(e => e.children.length === 0).map(e => e.textContent.trim()).filter(Boolean).slice(0, 30));
console.log('menu items', JSON.stringify(items));
console.log('events after click (selection mode, no click events expected)', JSON.stringify((await page.evaluate(() => window.__spike.getEvents())).map(e => e.type)));
const sel = page.locator('.aptx-node-menu').getByText('Select/Deselect Node', { exact: true }).first();
console.log('select item count', await sel.count());
if (await sel.count()) { await sel.click(); await page.waitForTimeout(400); }
console.log('events after Select', JSON.stringify((await page.evaluate(() => window.__spike.getEvents())).map(e => [e.type, e.nodeId, e.tipIds.length, e.source, e.libraryPayload && e.libraryPayload.via])));
console.log('last-event', await page.locator('[data-testid=last-event]').innerText());
await browser.close();
