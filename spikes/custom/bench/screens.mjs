// Takes the small screenshots in spikes/results/custom/screens/ (embed mode, production build on port 5306).
// Usage: node bench/screens.mjs   (preview must be running on 5306)
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../runner/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const out = new URL('../../results/custom/screens/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox', '--disable-gpu-rasterization'] });
async function shot(name, url, w, h, script) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await p.goto(url);
  await p.waitForFunction(() => window.__spike && document.querySelector('[data-testid=tree-container] canvas'), null, { timeout: 60000 });
  await p.waitForTimeout(1500);
  if (script) { await script(p); await p.waitForTimeout(700); }
  await p.screenshot({ path: out + name + '.png' });
  await p.close();
}
const base = 'http://127.0.0.1:5306/?embed=1';
await shot('custom-1k-columns', base + '&tree=syn-yule-1000&cols=1', 1000, 560);
await shot('custom-radial-1k', base + '&tree=syn-yule-1000&layout=radial', 760, 560);
await shot('custom-100k-whole-summaries', base + '&tree=syn-yule-100000', 1000, 560);
await shot('custom-caterpillar-10k', base + '&tree=syn-caterpillar-10000', 1000, 560);
await shot('custom-clades-coloured', base + '&tree=syn-yule-1000', 1000, 560, (p) => p.evaluate(() => window.__spike.setColouredClades([{ nodeId: 'n3', colour: '#e8845b' }, { nodeId: 'n1100', colour: '#5b7ac8' }, { nodeId: 'n1500', colour: '#c0399c' }])));
await shot('custom-dark-focus-tip', base + '&tree=syn-yule-1000&cols=1&dark=1', 1000, 560, async (p) => {
  await p.evaluate(async () => { await window.__spike.highlightTips(['Domefaodon_paraborealis']); await window.__spike.focusTip('Domefaodon_paraborealis'); });
});
await shot('custom-overview-zoomed', base + '&tree=syn-yule-10000', 1000, 560, async (p) => {
  await p.evaluate(async () => { await window.__spike.focusTip(window.__customTree.handle().renderer().tree.tipLabels[4000]); });
});
await b.close();
