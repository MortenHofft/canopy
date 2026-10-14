// Playwright launcher shared by the probes (Chromium /opt/pw-browsers/chromium-1194, headless, no GPU).
// Paths assume the repository at /home/user/gbif-phylo.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/gbif-phylo/spikes/package.json');
export const { chromium } = require('playwright-core');
export async function open(url, { w = 1300, h = 800 } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-rasterization', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));
  await page.goto(url);
  return { browser, page };
}
