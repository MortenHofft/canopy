// Main-thread tasks while a page loads a tree (#4): every long task (PerformanceObserver 'longtask', over 50 ms) and the longest gap
// between animation frames, from navigation until the explorer shows the tree and has settled.
//   node bench/load.mjs --url 'http://127.0.0.1:5309/?tree=otl-2m-full' [--tips 2390000] [--runs 3] [--settle 3000]
// Start the explorer first (`npm run dev` in examples/explorer, or a build served with `vite preview`). `--tips` is the tip count to wait
// for (default: any tree). Prints one line per run and the median of the longest task.
import { createRequire } from 'node:module';
import { chromiumPath } from '../scripts/chromium.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const url = args.url || 'http://127.0.0.1:5309/?tree=otl-2m-full';
const runs = Number(args.runs || 3);
const settle = Number(args.settle || 3000);
const tips = args.tips ? Number(args.tips) : 0;

// installed before any page script: long tasks (buffered, so the first ones count too) and the longest rAF gap
const PROBE = () => {
  window.__long = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]);
  }).observe({ type: 'longtask', buffered: true });
  window.__gap = { max: 0, at: 0 };
  let last = 0;
  const tick = (t) => {
    if (last && t - last > window.__gap.max) window.__gap = { max: Math.round(t - last), at: Math.round(last) };
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-sandbox'] });
const longest = [];
try {
  for (let run = 0; run < runs; run++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript(PROBE);
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForFunction((n) => (window.__explorer?.()?.getTree().tipCount ?? 0) > (n ? n - 1 : 0), tips, { timeout: 180000, polling: 200 });
    const shown = await page.evaluate(() => Math.round(performance.now()));
    await page.waitForTimeout(settle);
    const r = await page.evaluate(() => ({
      long: window.__long,
      gap: window.__gap,
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
      tips: window.__explorer().getTree().tipCount,
    }));
    const max = Math.max(0, ...r.long.map((x) => x[1]));
    longest.push(max);
    const top = [...r.long].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(
      `run ${run + 1}: ${r.tips} tips, shown at ${shown} ms; long tasks ${r.long.length}, longest ${max} ms, total ${r.long.reduce((s, x) => s + x[1], 0)} ms; ` +
        `longest rAF gap ${r.gap.max} ms (from ${r.gap.at} ms); heap ${r.heap} MB; top [start, ms]: ${JSON.stringify(top)}`,
    );
    await ctx.close();
  }
} finally {
  await browser.close();
}
longest.sort((a, b) => a - b);
console.log(`median longest task: ${longest[Math.floor(longest.length / 2)]} ms over ${runs} runs`);
