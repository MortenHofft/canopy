// Frame-gap probe with an open node menu versus closed (S1-like wheel and drag script). Needs the demo on 127.0.0.1:5305.
// Paths assume the repository at /home/user/gbif-phylo.
import { open } from './lib.mjs';
const variant = process.argv[2] || 'asis';
const tree = process.argv[3] || 'syn-yule-200';
const secs = Number(process.argv[4] || 6);
const { browser, page } = await open('http://127.0.0.1:5305/?tree=' + tree);
await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 60000 });
await page.waitForTimeout(500);
const css = { noshadow: '*{box-shadow:none!important}', nobackdrop: '*{backdrop-filter:none!important}', nopanel: '.aptx-panel{display:none!important}', nooverview: '.aptx-overview{display:none!important}', noanim: '*{animation:none!important;transition:none!important}', nomenu: '.aptx-node-menu{display:none!important}' }[variant];
if (css) await page.addStyleTag({ content: css });
const rect = await page.locator('[data-testid=tree-container]').boundingBox();
if (variant !== 'noclick') { for (const id of ['n1', 'n2', 'n5']) { const p = await page.evaluate((id) => window.__spike.locate({ kind: 'node', id }), id); console.log('click', id, JSON.stringify(p)); if (p) { await page.mouse.click(p.x, p.y); await page.waitForTimeout(100); } }
if (variant === 'closed') { await page.keyboard.press('Escape'); await page.waitForTimeout(200); } }
await page.evaluate(() => { window.__gaps = []; let last = performance.now(); const f = (t) => { window.__gaps.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
const cx = rect.x + rect.width * 0.4, cy = rect.y + rect.height * 0.5;
const t0 = Date.now(); let k = 0;
while (Date.now() - t0 < secs * 1000) {
  const phase = k++ % 4; const x = cx + (k % 3) * 40, y = cy + (k % 5) * 20;
  await page.mouse.move(x, y);
  if (phase === 0 || phase === 2) { const dir = phase === 0 ? -120 : 120; for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, dir); await page.waitForTimeout(16); } }
  else { const sign = phase === 1 ? -1 : 1; await page.mouse.down(); await page.mouse.move(x + sign * 160, y + sign * 70, { steps: 10 }); await page.mouse.up(); }
}
const r = await page.evaluate(() => { const g = window.__gaps.slice(); const tot = g.reduce((a, b) => a + b, 0); const s = g.slice().sort((a, b) => a - b); const slow = g.filter(x => x > 100); return { frames: g.length, med: s[s.length >> 1], max: s[s.length - 1], slow: slow.length, slowMs: Math.round(slow.reduce((a, b) => a + b, 0)), totalMs: Math.round(tot), menus: document.querySelectorAll('.aptx-node-menu').length }; });
console.log(variant, tree, JSON.stringify(r));
await browser.close();
