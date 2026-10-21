// Where the draw budget kicks in: same tree, LOD off / budgets 500, 2000, 20000, at the fit view (rectangular).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const [, , file, label, layout = 'rectangular'] = process.argv;
const text = fs.readFileSync(file, 'utf8');
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu-rasterization'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
await p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
await p.goto('http://127.0.0.1:5306/');
await p.waitForFunction(() => window.__spike);
await p.evaluate(
  async ({ text, layout }) => {
    await window.__spike.mount({ treeId: 'x', newick: text, layout, branchLengths: true, size: { width: 1100, height: 640 } });
  },
  { text, layout },
);
for (const [name, o] of [
  ['lod off', { lod: false }],
  ['budget 500', { lod: true, drawBudget: 500 }],
  ['budget 2000', { lod: true, drawBudget: 2000 }],
  ['budget 20000', { lod: true, drawBudget: 20000 }],
]) {
  const r = await p.evaluate(
    ({ o }) => {
      const rd = window.__customTree.handle().renderer();
      rd.setOptions(o);
      rd.renderNow();
      const m = rd.benchmark(3);
      const s = rd.getStats();
      return { ms: m.meanMs, drawn: s.drawn, summaries: s.summaries, minPx: s.minPxUsed, retries: s.budgetRetries, truncated: s.truncated };
    },
    { o },
  );
  console.log(label, layout, name, JSON.stringify(r));
}
await b.close();
