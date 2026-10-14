// Main-thread CPU (CDP Performance.ThreadTime) per wheel step and per drag move, and for the mount; less load-sensitive than rAF fps.
// usage (from spikes/phylotree-js, a build served at <url>): node measure/cpu-probe.mjs <url> <newick file> <label> [css to inject]
// main-thread CPU (ThreadTime) per interaction step, less sensitive to machine load than rAF fps
import { Browser } from '../../runner/lib/session.mjs';
import { sleep } from '../../runner/lib/util.mjs';
import fs from 'node:fs';
import os from 'node:os';
const [url, file, label, css] = process.argv.slice(2);
const newick = fs.readFileSync(file, 'utf8');
const b = new Browser(url, () => {});
await b.launch();
const out = { label, load: os.loadavg()[0].toFixed(1) };
try {
await b.withSession('cpu', async (s) => {
  const cdp = await s.ctx.newCDPSession(s.page);
  await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  if (css) await s.page.addStyleTag({ content: css });
  const size = await s.mainSize();
  const m0 = await metrics();
  const r = await s.page.evaluate(async ({ newick, size }) => {
    const res = await window.__spike.mount({ treeId: 'custom', newick, layout: 'rectangular', branchLengths: true, size });
    return res;
  }, { newick, size });
  await s.settle(600);
  const m1 = await metrics();
  out.tips = r.tips;
  out.mountCpuMs = Math.round((m1.ThreadTime - m0.ThreadTime) * 1000);
  out.mountScriptMs = Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000);
  const rect = await s.containerRect();
  const cx = rect.x + rect.width * 0.4, cy = rect.y + rect.height * 0.5;
  await s.page.mouse.move(cx, cy);
  const steps = 24;
  const a0 = await metrics();
  for (let i = 0; i < steps; i++) { await s.page.mouse.wheel(0, i < steps / 2 ? -120 : 120); await sleep(120); }
  await s.settle(300);
  const a1 = await metrics();
  const per = (k) => +(((a1[k] - a0[k]) * 1000) / steps).toFixed(1);
  out.wheelStep = { cpuMs: per('ThreadTime'), scriptMs: per('ScriptDuration'), layoutMs: per('LayoutDuration'), styleMs: per('RecalcStyleDuration'), taskMs: per('TaskDuration') };
  // drag pan
  const d0 = await metrics();
  await s.page.mouse.down(); await s.page.mouse.move(cx - 200, cy + 100, { steps: 20 }); await s.page.mouse.up();
  await s.settle(300);
  const d1 = await metrics();
  out.dragPan20steps = { cpuMs: Math.round((d1.ThreadTime - d0.ThreadTime) * 1000), perMoveMs: +(((d1.ThreadTime - d0.ThreadTime) * 1000) / 20).toFixed(1) };
  out.dom = (await s.call('getStats')).domNodes;
}, 300000);
} catch (e) { out.error = String(e.message).slice(0, 200); }
console.log(JSON.stringify(out));
await b.close();
