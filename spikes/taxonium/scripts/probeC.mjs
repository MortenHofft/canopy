// leak probe: main-thread heap and worker heap (CDP) across mount / unmount / remount of a small tree
import { launch } from './lib.mjs';
import fs from 'node:fs';
const OUT = new URL('../../results/taxonium/probes/', import.meta.url).pathname;
const { browser, ctx, page, logs } = await launch();
const cdp = await ctx.newCDPSession(page);
const sessions = new Map(); let msgId = 1; const waiters = new Map();
cdp.on('Target.attachedToTarget', (e) => { sessions.set(e.sessionId, e.targetInfo); });
cdp.on('Target.receivedMessageFromTarget', (e) => { const m = JSON.parse(e.message); const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w(m); } });
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
await page.goto('http://127.0.0.1:5207/');
await page.waitForFunction(() => window.__spike);
const toTarget = (sessionId, method, params = {}) => new Promise((res) => { const id = msgId++; waiters.set(id, res); cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }); });
const heaps = async (label) => {
  const out = { label };
  out.mainMB = await page.evaluate(() => { gc(); return performance.memory.usedJSHeapSize / 1048576; });
  out.workers = [];
  for (const [sid, info] of sessions) { if (info.type !== 'worker') continue; await toTarget(sid, 'HeapProfiler.collectGarbage'); const r = await Promise.race([toTarget(sid, 'Runtime.getHeapUsage'), new Promise((r) => setTimeout(() => r({ error: 'timeout' }), 4000))]); out.workers.push({ url: info.url.slice(0, 30), usedMB: r.result ? +(r.result.usedSize / 1048576).toFixed(1) : null, err: r.error ?? null }); }
  return out;
};
const rows = [];
rows.push(await heaps('start (no tree)'));
const mount = (p) => page.evaluate(async (p) => { const text = await (await fetch('/data/' + p)).text(); return window.__spike.mount({ treeId: 'syn-yule-1000', newick: text, layout: 'rectangular', branchLengths: true, size: { width: 800, height: 520 } }).then((m) => m.tips); }, p);
await mount('synthetic/newick/yule_100000.nwk'); await page.waitForTimeout(2000);
rows.push(await heaps('100k tips mounted'));
await page.evaluate(() => window.__spike.unmount()); await page.waitForTimeout(2000);
rows.push(await heaps('after unmount of the 100k tree'));
await mount('synthetic/newick/yule_200.nwk'); await page.waitForTimeout(1500);
rows.push(await heaps('200 tips mounted (replaces the tree in the worker)'));
await page.evaluate(() => window.__spike.unmount()); await page.waitForTimeout(1500);
rows.push(await heaps('after unmount of the 200-tip tree'));
for (const r of rows) console.log(JSON.stringify(r));
console.log('targets', [...sessions.values()].map((i) => i.type + ':' + i.url.slice(0, 40)).join(' | '));
fs.writeFileSync(OUT + 'probeC.json', JSON.stringify(rows, null, 1));
await browser.close();
