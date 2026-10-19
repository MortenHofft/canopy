import fs from 'fs';
import { open, sleep } from './lib.mjs';
const S = process.env.S;
const { browser, page, errs } = await open('http://127.0.0.1:5308/?tree=rich-ens-protein-197');
const log = (k, v) => console.log(k.padEnd(28), typeof v === 'string' ? v : JSON.stringify(v));
try {
  await sleep(3500);
  // --- Ctrl+F hijack
  log('ctrlF defaultPrevented', await page.evaluate(() => { const e = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }); return !document.body.dispatchEvent(e); }));
  await sleep(300);
  log('search panel opened by ctrl+f', await page.evaluate(() => !!document.querySelector('.Reactree_searchPanel')));
  // --- search driven from outside through the DOM
  const t0 = Date.now();
  await page.evaluate(() => { const i = document.querySelector('.Reactree_searchInput'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'ENSMUSP0018'); i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(500);
  log('search via DOM', await page.evaluate(() => ({ count: document.querySelector('.Reactree_searchCount')?.textContent, glows: document.querySelectorAll('.search-glow').length, dimmedLabels: [...document.querySelectorAll('text.leaf-label')].filter((t) => t.style.opacity === '0.1').length })));
  await page.screenshot({ path: S + '/s_search.png', clip: { x: 0, y: 130, width: 990, height: 650 } });
  await page.keyboard.press('Escape');
  await sleep(300);
  log('search closed', await page.evaluate(() => !document.querySelector('.Reactree_searchPanel')));
  // --- node click default: our event, no library collapse
  const nodeId = await page.evaluate(async () => { for (let i = 1; i < 80; i++) { const p = await window.__spike.locate({ kind: 'node', id: 'n' + i }); const b = await window.__spike.bounds({ kind: 'node', id: 'n' + i }); if (p && b && b.height > 40) return 'n' + i; } });
  const p = await page.evaluate((id) => window.__spike.locate({ kind: 'node', id }), nodeId);
  await page.mouse.click(p.x, p.y); await sleep(300);
  log('node click default', await page.evaluate(() => ({ ev: document.querySelector('[data-testid=last-event]')?.textContent, tri: document.querySelectorAll('.collapse-tri').length, editor: !!document.querySelector('.Reactree_cladeEditor') })));
  await page.screenshot({ path: S + '/s_click.png' });
  // --- libraryCollapse on
  await page.getByText('Library collapse on internal-node click').click(); await sleep(200);
  const p2 = await page.evaluate((id) => window.__spike.locate({ kind: 'node', id }), nodeId);
  await page.mouse.click(p2.x, p2.y); await sleep(600);
  log('node click with collapse', await page.evaluate(() => ({ ev: document.querySelector('[data-testid=last-event]')?.textContent, tri: document.querySelectorAll('.collapse-tri').length, editor: !!document.querySelector('.Reactree_cladeEditor'), leafs: document.querySelectorAll('text.leaf-label').length })));
  await page.screenshot({ path: S + '/s_collapse.png' });
  await page.keyboard.press('Escape');
  // can we still map a click on the collapsed triangle node
  // --- tip click
  const tp = await page.evaluate(async () => { const id = document.querySelectorAll('text.leaf-label')[20].__data__.data.name; await window.__spike.focusTip(id); return { id, p: await window.__spike.locate({ kind: 'tip', id }) }; });
  await sleep(300);
  const tp2 = await page.evaluate((id) => window.__spike.locate({ kind: 'tip', id }), tp.id);
  await page.mouse.click(tp2.x, tp2.y); await sleep(300);
  log('tip click', await page.evaluate(() => ({ ev: document.querySelector('[data-testid=last-event]')?.textContent, info: document.querySelector('.Reactree_nodeInfoPanel')?.textContent?.slice(0, 80) })));
  // --- midpoint reroot then click internal node
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Midpoint/.test(b.textContent)).click()); await sleep(800);
  const nodeId2 = await page.evaluate(async () => { for (let i = 1; i < 190; i++) { const p = await window.__spike.locate({ kind: 'node', id: 'n' + i }); const b = await window.__spike.bounds({ kind: 'node', id: 'n' + i }); if (p && b && b.height > 30) return 'n' + i; } });
  log('after reroot: node located', nodeId2 ?? 'none');
  const stats = await page.evaluate(async () => (await window.__spike.getStats()).custom);
  log('stats', stats);
  // --- export svg
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Export/.test(b.textContent)).click()); await sleep(300);
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.evaluate(() => [...document.querySelectorAll('.Reactree_downloadMenuItem')].find((b) => /SVG/.test(b.textContent)).click());
  const d = await dl;
  if (d) { const path = S + '/export.svg'; await d.saveAs(path); log('export svg', { name: d.suggestedFilename(), bytes: fs.statSync(path).size, hasBranches: fs.readFileSync(path, 'utf8').includes('<path') }); } else log('export svg', 'no download');
  log('errors', errs);
} catch (e) { console.log('ERR', e); }
await browser.close();
