import { open, sleep } from './lib.mjs';
const { browser, page, errs } = await open('http://127.0.0.1:5308/?tree=syn-yule-1000');
const log = (k, v) => console.log(k.padEnd(26), typeof v === 'string' ? v : JSON.stringify(v));
try {
  await sleep(6000);
  const k = () => page.evaluate(() => window.__spike.getStats().then((s) => s.custom.k));
  log('k at fit', await k());
  const box = await page.evaluate(() => { const r = document.querySelector('.Reactree_container').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel(0, -120); await sleep(200);
  log('k after 1 wheel in', await k());
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 120); await sleep(60); }
  log('k after 12 wheel out', await k());
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -120); await sleep(30); }
  log('k after 40 wheel in', await k());
  // search keystroke cost at 1k
  await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true })); });
  await sleep(300);
  const ms = await page.evaluate(async () => { const i = document.querySelector('.Reactree_searchInput'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; const out = []; let q = ''; for (const ch of 'Dom') { q += ch; const t = performance.now(); set.call(i, q); i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); out.push(Math.round(performance.now() - t)); } return { out, count: document.querySelector('.Reactree_searchCount')?.textContent }; });
  log('search keystrokes ms (1k)', ms);
  await page.keyboard.press('Escape'); await sleep(500);
  await page.getByText('Keep browser find').click(); await sleep(300);
  log('keepBrowserFind ctrl+F', await page.evaluate(() => { const e = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }); const notPrevented = document.body.dispatchEvent(e); return { defaultPrevented: !notPrevented, panel: !!document.querySelector('.Reactree_searchPanel') }; }));
  log('errors', errs);
} catch (e) { console.log('ERR', e); }
await browser.close();
