// Takes the small demo screenshots for docs/results/phylocanvas-gl.md from the running demo (npm run dev -- --port 5304).
// Usage: node scripts/screens.mjs http://127.0.0.1:5304/ ../results/phylocanvas-gl/screens
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../../node_modules/playwright-core/index.mjs';

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-gpu-rasterization'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name, query, steps, crop = null, clipSel = '[data-testid=tree-container]', pad = 0) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route((u) => u.hostname !== '127.0.0.1' && u.hostname !== 'localhost', (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(name, 'pageerror', e.message.slice(0, 200)));
  await page.goto(base + query);
  await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 90000 });
  await sleep(1500);
  if (steps) await steps(page);
  await sleep(2500);
  const box = await page.locator(clipSel).first().boundingBox();
  const file = path.join(outDir, name);
  const c = crop ?? { x: 0, y: 0, width: box.width, height: box.height };
  await page.screenshot({ path: file, clip: { x: box.x + c.x - pad, y: box.y + c.y - pad, width: c.width + 2 * pad, height: c.height + 2 * pad } });
  console.log(name, fs.statSync(file).size, 'bytes');
  await ctx.close();
}

// 1. rectangular 1k tips, two clades coloured from React state, labels thinned, scale bar
await shot('demo-1-rect-1k-clades.png', '?tree=syn-yule-1000', async (p) => {
  await p.evaluate(() => window.__spike.setColouredClades([{ nodeId: 'n388', colour: '#684393' }, { nodeId: 'n835', colour: '#20b4e9' }]));
});
// 2. 200 tips, own columns (bar + text + alignment) aligned to the rows, one tip highlighted and focused
await shot('demo-2-columns-focus.png', '?tree=syn-yule-1000&cols=1', async (p) => {
  await p.evaluate(() => window.__spike.focusTip('Chebecous_microaurea'));
  await sleep(800);
  await p.evaluate(() => window.__spike.highlightTips(['Chebecous_microaurea']));
}, { x: 330, y: 0, width: 630, height: 420 });
// 3. circular layout, dark theme, clade coloured
await shot('demo-3-circular-dark.png', '?tree=rich-fish-carangaria-135&layout=radial&dark=1&pc.fontSize=10', async (p) => {
  await p.evaluate(() => window.__spike.setColouredClades([{ nodeId: 'n30', colour: '#ebac7c' }, { nodeId: 'n150', colour: '#20b4e9' }]));
}, { x: 190, y: 20, width: 590, height: 560 });
// 4. library coloured blocks instead of our columns, with clades collapsed to pie charts (Library options via URL)
await shot('demo-4-blocks-collapsed.png', '?tree=syn-yule-1000&cols=1&pc.columnMode=blocks&pc.collapse=20', async (p) => {
  await p.evaluate(() => window.__spike.setColouredClades([{ nodeId: 'n388', colour: '#d0628d' }]));
});
// 5. non-ASCII labels (shipped behaviour vs patched) side by side is covered in the doc text; this one shows the patched result with links on
await shot('demo-5-links-unicode.png', '?tree=syn-yule-200', async (p) => {
  const nw = "((Cyanistes_caeruleus:1,Parus_major:1):1,('Poecile atricapillus (L.)':1.5,Ménétries_ñandú:1):0.5,(日本語_ラベル:1,Ünïcödé_Œuvre:2):1,'a,b(c)':1);";
  await p.evaluate(async (nw) => window.__spike.mount({ treeId: 'x', newick: nw, layout: 'rectangular', branchLengths: true, size: { width: 760, height: 360 } }), nw);
  await p.evaluate(() => window.__spike.setTipLinks((id) => 'https://www.gbif.org/species/search?q=' + encodeURIComponent(id)));
});
await browser.close();
