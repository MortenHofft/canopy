// The five demo-*.png screenshots. Needs the demo on 127.0.0.1:5305; picks clades with the shared parser.
// Paths assume the repository at /home/user/gbif-phylo.
import { open } from './lib.mjs';
const OUT = process.env.OUT || process.env.SP + '/shots';
const which = (process.argv[2] || 'all').split(',');
const has = (k) => which.includes('all') || which.includes(k);
async function session(qs, fn, vp = { w: 1180, h: 760 }) {
  const { browser, page } = await open('http://127.0.0.1:5305/?' + qs, vp);
  await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 90000 });
  await page.waitForTimeout(1000);
  const shot = async (name) => { await page.waitForTimeout(700); await page.locator('.main').screenshot({ path: `${OUT}/${name}.png` }); };
  try { await fn(page, shot); } finally { await browser.close(); }
}
// pick clades by size from the shared TreeModel (parsed here in node with the shared parser)
import fs from 'node:fs';
import { parseNewick } from '/home/user/gbif-phylo/spikes/shared/newick.ts';
const NWK = { 'syn-yule-200': '/home/user/gbif-phylo/data/synthetic/newick/yule_200.nwk' };
const pickClades = async (page, treeId, sizes) => {
  const t = parseNewick(fs.readFileSync(NWK[treeId], 'utf8'));
  const out = []; const used = [];
  for (const want of sizes) {
    let best = -1, bd = 1e9;
    for (let i = 1; i < t.nodeCount; i++) { if (t.childCount[i] === 0) continue; const n = t.leafEnd[i] - t.leafStart[i]; const d = Math.abs(n - want); if (d < bd && !used.some(u => t.contains(u, i) || t.contains(i, u))) { bd = d; best = i; } }
    if (best >= 0) { used.push(best); out.push(t.nodeId(best)); }
  }
  return out;
};
const tok = (page, v) => page.evaluate((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), v);
if (has('bare')) await session('tree=syn-yule-200', async (page, shot) => {
  const [a, b] = await pickClades(page, 'syn-yule-200', [14, 22]);
  const c1 = await tok(page, '--purple-100'), c2 = await tok(page, '--peach-100');
  await page.evaluate(async ([a, b, c1, c2]) => { await window.__spike.setColouredClades([{ nodeId: a, colour: c1 }, { nodeId: b, colour: c2 }]); await window.__spike.highlightTips(['Pahohaus_microsylvestris', 'Phesilaella_submontana', 'Zozirella_subcrassa']); }, [a, b, c1, c2]);
  await shot('01-bare-tree-clades-highlight');
});
if (has('panel')) await session('tree=syn-yule-200', async (page, shot) => {
  const [a] = await pickClades(page, 'syn-yule-200', [20]);
  const c1 = await tok(page, '--lightblue-100');
  await page.evaluate(async ([a, c1]) => { await window.__spike.setColouredClades([{ nodeId: a, colour: c1 }]); }, [a, c1]);
  await page.locator('.ctl-label', { hasText: 'Show Archaeopteryx control panel' }).click();
  await page.waitForTimeout(1500);
  await shot('02-full-control-panel');
});
if (has('tracks')) await session('tree=syn-yule-1000&cols=1', async (page, shot) => {
  await page.evaluate(async () => { await window.__spike.focusTip('Zukochoa_paramaritima'); });
  await shot('03-tracks-heatmap-alignment');
});
if (has('dark')) await session('tree=syn-yule-200&dark=1', async (page, shot) => {
  const [a] = await pickClades(page, 'syn-yule-200', [20]);
  const c1 = await tok(page, '--periwinkle-100');
  await page.evaluate(async ([a, c1]) => { await window.__spike.setColouredClades([{ nodeId: a, colour: c1 }]); await window.__spike.highlightTips(['Pahohaus_microsylvestris']); }, [a, c1]);
  await shot('04-dark-theme');
});
if (has('radial')) await session('tree=syn-yule-200&layout=radial', async (page, shot) => {
  const [a, b] = await pickClades(page, 'syn-yule-200', [30, 18]);
  const c1 = await tok(page, '--fuchsia-100'), c2 = await tok(page, '--lightblue-100');
  await page.evaluate(async ([a, b, c1, c2]) => { await window.__spike.setColouredClades([{ nodeId: a, colour: c1 }, { nodeId: b, colour: c2 }]); }, [a, b, c1, c2]);
  await shot('05-radial');
});
