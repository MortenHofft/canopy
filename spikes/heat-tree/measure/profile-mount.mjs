import { chromium } from '/home/user/gbif-phylo/spikes/node_modules/playwright-core/index.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--no-sandbox', '--disable-gpu-rasterization'] });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
await p.goto('http://127.0.0.1:5309/');
await p.waitForFunction(() => window.__spike);
const c = await p.context().newCDPSession(p);
await c.send('Profiler.enable'); await c.send('Profiler.start');
await p.evaluate(async () => {
  function mk(n, seed) { let s = seed; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    let items = []; for (let i = 0; i < n; i++) items.push(`Tip_${i}:${(1 + rnd()).toFixed(3)}`);
    while (items.length > 1) { const a = items.splice(Math.floor(rnd() * items.length), 1)[0]; const b = items.splice(Math.floor(rnd() * items.length), 1)[0]; items.push(`(${a},${b}):${(0.5 + rnd()).toFixed(3)}`); }
    return items[0] + ';'; }
  await window.__spike.mount({ treeId: 'x', newick: mk(2000, 7), layout: 'rectangular', branchLengths: true, size: { width: 1000, height: 600 } });
});
const { profile } = await c.send('Profiler.stop');
const dt = profile.timeDeltas; const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n]));
profile.samples.forEach((id, i) => { const n = byId.get(id); const k = n.callFrame.functionName + ' ' + n.callFrame.url.split('/').pop().split('?')[0] + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k) || 0) + dt[i]); });
const tot = [...self.values()].reduce((a, b) => a + b, 0);
console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${(v / 1000).toFixed(0)} ms ${(100 * v / tot).toFixed(0)}% ${k}`).join('\n'));
await b.close();
