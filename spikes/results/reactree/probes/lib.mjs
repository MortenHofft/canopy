import { chromium } from 'playwright-core';
export async function open(url = 'http://127.0.0.1:5308/', viewport = { width: 1440, height: 900 }) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox', '--disable-gpu-rasterization', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const ctx = await browser.newContext({ viewport });
  await ctx.route((u) => u.hostname !== '127.0.0.1' && u.hostname !== 'localhost', (r) => r.abort());
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror ' + e.message.slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load/.test(m.text())) errs.push('console ' + m.text().slice(0, 300)); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__spike && !!window.__spikeData);
  await page.evaluate(() => window.__spike.ready);
  return { browser, page, errs };
}
export async function mount(page, id, layout = 'rectangular', bl = true) {
  return page.evaluate(async ({ id, layout, bl }) => {
    const el = document.querySelector('.main'); const size = { width: el.clientWidth, height: el.clientHeight };
    const t = await window.__spikeData.loadTree(id);
    return window.__spike.mount({ treeId: id, newick: t.newick, layout, branchLengths: bl, size });
  }, { id, layout, bl });
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
