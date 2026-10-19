// Probe helper: node probe.mjs <url> <script.js> [w h] evaluates an async script body in the page (dev server: cd spikes/heat-tree && npm run dev -- --port 5309). Requires playwright-core from spikes/node_modules.
import { chromium } from '/home/user/gbif-phylo/spikes/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const [url, file, w = '1280', h = '800'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox', '--disable-gpu-rasterization', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on('pageerror', (e) => console.log('PAGEERROR', e.stack));
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('CONSOLE', m.type(), m.text().slice(0, 300)); });
await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await p.goto(url);
await p.waitForFunction(() => window.__spike);
const code = fs.readFileSync(file, 'utf8');
const out = await p.evaluate(`(async()=>{${code}})()`);
console.log(JSON.stringify(out, null, 1));
if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
await b.close();
