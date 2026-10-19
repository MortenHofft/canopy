import fs from 'fs';
import { open, sleep } from './lib.mjs';
const S = process.env.S;
const which = process.argv[2];
const files = {
  'yule-1000': ['syn-yule-1000', null], 'yule-5000': ['syn-yule-5000', S + '/gen/newick/yule_5000.nwk'], 'yule-10000': ['syn-yule-10000', null],
  'cat-1000': ['syn-caterpillar-1000', null], 'cat-2000': ['syn-caterpillar-1000', S + '/gen/newick/cat2000.nwk'], 'cat-3500': ['syn-caterpillar-1000', S + '/gen/newick/cat3500.nwk'], 'cat-4000': ['syn-caterpillar-1000', S + '/gen/newick/cat4000.nwk'], 'cat-2700': ['syn-caterpillar-1000', S + '/gen/newick/cat2700.nwk'], 'cat-5000': ['syn-caterpillar-1000', S + '/gen/newick/cat5000.nwk'], 'cat-10000': ['syn-caterpillar-10000', null],
};
const [id, file] = files[which];
const { browser, page, errs } = await open();
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const cpu = async () => { const m = (await cdp.send('Performance.getMetrics')).metrics; return Object.fromEntries(m.map((x) => [x.name, x.value])); };
const out = { which, id };
try {
  const nw = file ? fs.readFileSync(file, 'utf8') : null;
  const t0 = Date.now();
  const r = await Promise.race([page.evaluate(async ({ id, nw }) => {
    const el = document.querySelector('.main'); const size = { width: el.clientWidth, height: el.clientHeight };
    const t = nw ? { newick: nw } : await window.__spikeData.loadTree(id);
    const t1 = performance.now();
    const r = await window.__spike.mount({ treeId: id, newick: t.newick, layout: 'rectangular', branchLengths: true, size });
    return { ...r, wall: performance.now() - t1 };
  }, { id, nw }), sleep(170000).then(() => 'TIMEOUT')]);
  out.mount = r === 'TIMEOUT' ? 'TIMEOUT' : { firstRenderMs: Math.round(r.firstRenderMs), tips: r.tips, note: r.notes?.match(/last rebuild finished (\d+) ms/)?.[1] };
  console.log(JSON.stringify(out));
  if (r !== 'TIMEOUT') {
    await sleep(500);
    out.stats = await page.evaluate(async () => { const s = await window.__spike.getStats(); gc(); const h = performance.memory.usedJSHeapSize / 1048576; return { dom: s.domNodes, svg: s.svgElements, heapMB: Math.round(h) }; });
    // wheel/drag cpu per step
    const box = await page.evaluate(() => { const r = document.querySelector('.Reactree_container').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(box.x, box.y);
    const c0 = await cpu();
    const t1 = Date.now();
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -120); await sleep(30); }
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 120); await sleep(30); }
    await page.mouse.down();
    for (let i = 0; i < 20; i++) { await page.mouse.move(box.x + i * 5, box.y + i * 3); await sleep(16); }
    await page.mouse.up();
    await sleep(300);
    const c1 = await cpu();
    const steps = 24 + 20;
    out.interact = { cpuMsPerStep: Math.round(((c1.TaskDuration - c0.TaskDuration) * 1000) / steps * 10) / 10, scriptMsPerStep: Math.round(((c1.ScriptDuration - c0.ScriptDuration) * 1000) / steps * 10) / 10, layoutMsPerStep: Math.round(((c1.LayoutDuration - c0.LayoutDuration) * 1000) / steps * 10) / 10, recalcStyleMs: Math.round(((c1.RecalcStyleDuration - c0.RecalcStyleDuration) * 1000)), wallMs: Date.now() - t1 };
    console.log(JSON.stringify(out));
    // state changes: time until 2 rAF after the API call resolves (shell does flushSync + 2 rAF)
    const timeIt = (expr) => page.evaluate(async (expr) => { const t = performance.now(); await eval(expr); return Math.round(performance.now() - t); }, expr);
    out.ops = {};
    out.ops.colourOneClade = await timeIt("window.__spike.setColouredClades([{nodeId:'n2',colour:'#e00000'}])");
    out.ops.colourTwoClades = await timeIt("window.__spike.setColouredClades([{nodeId:'n2',colour:'#e00000'},{nodeId:'n3',colour:'#0000e0'}])");
    out.ops.clearColours = await timeIt("window.__spike.setColouredClades([])");
    out.ops.highlight5 = await timeIt("window.__spike.highlightTips(Array.from(document.querySelectorAll('text.leaf-label')).slice(10,15).map(t=>t.__data__.data.name))");
    out.ops.cladogram = await timeIt("window.__spike.setBranchLengths(false)");
    out.ops.radial = await timeIt("window.__spike.setLayout('radial')");
    out.ops.rect = await timeIt("window.__spike.setLayout('rectangular')");
    out.ops.darkOn = await timeIt("window.__spike.setTheme({dark:true})");
    out.ops.tipLinks = await timeIt("window.__spike.setTipLinks((t)=>'https://example.org/'+t)");
    console.log(JSON.stringify(out));
  }
  out.errors = errs.slice(0, 3);
} catch (e) { out.error = String(e).slice(0, 300); }
console.log('FINAL ' + JSON.stringify(out));
await browser.close();
