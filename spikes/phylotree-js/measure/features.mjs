// Drives the demo's Library options (ladderize, layout variants, internal labels, align tips, scale bar, tip dots, collapse on click,
// context menu + reroot) and prints checks; writes f-*.png into the directory given as argv[2] (default .).
// usage: node measure/features.mjs [outDir]   (served at http://127.0.0.1:5203/?tree=syn-yule-200)
import { Browser } from '../../runner/lib/session.mjs';
import { sleep } from '../../runner/lib/util.mjs';
import { truthTree, getEntry } from '../../runner/lib/truth.mjs';
import fs from 'node:fs';
const outDir = process.argv[2] || '.';
const b = new Browser((process.env.BASE || 'http://127.0.0.1:5203/') + '?tree=syn-yule-200', console.log);
await b.launch();
await b.withSession('features', async (s) => {
  const t = truthTree(getEntry('syn-yule-200'));
  await s.page.waitForSelector('[data-state=mounted]', { timeout: 60000 });
  await s.settle(400);
  const toggle = async (label) => { await s.page.locator(`[data-testid=library-options] label:has-text("${label}") input`).click({ force: true }); await s.settle(500); };
  const choose = async (label, value) => { await s.page.locator(`[data-testid=library-options] label:has-text("${label}") select`).selectOption(value); await s.settle(600); };
  const stats = () => s.call('getStats');
  const shot = async (name) => fs.writeFileSync(`${outDir}/f-${name}.png`, (await s.shot(await s.containerRect())).buf);
  const log = (...a) => console.log(...a);
  const tipX = async (id) => (await s.call('locate', { kind: 'tip', id }));
  const ids = [t.tipLabels[3], t.tipLabels[100], t.tipLabels[190]];
  const pos = async () => Promise.all(ids.map((i) => s.call('locate', { kind: 'tip', id: i })));
  const clickNodeCheck = async (label) => {
    // click a mid-size clade's node and compare tip sets with ground truth
    let best = -1, bs = 1e9;
    for (let i = 1; i < t.nodeCount; i++) { if (t.childCount[i] === 0) continue; const size = t.leafEnd[i] - t.leafStart[i]; const sc = Math.abs(Math.log(size / 20)); if (sc < bs) { bs = sc; best = i; } }
    const id = t.nodeId(best);
    const truth = t.descendantTips(best);
    let p = await s.settleLocate({ kind: 'node', id }, 0, 800);
    if (!p) { await s.call('focusTip', truth[0]); p = await s.settleLocate({ kind: 'node', id }, 0, 800); }
    if (!p) { log(label, 'node not locatable'); return; }
    const ev = await s.clickAndWait(p);
    const e = ev.find((x) => x.type === 'nodeClick');
    const ok = e && e.nodeId === id && e.tipIds.length === truth.length && truth.every((x) => e.tipIds.includes(x));
    log(label, 'node click', ok ? 'OK' : 'MISMATCH ' + JSON.stringify(e && { n: e.nodeId, c: e.tipIds.length }), 'want', id, truth.length);
    await s.page.evaluate(() => window.__spike.setColouredClades([]));
    return ok;
  };
  log('default', JSON.stringify(await pos()));
  await shot('0-default');
  // ladderize
  await choose('Ladderize', 'asc'); log('ladderize asc', JSON.stringify((await pos()).map((p) => p && Math.round(p.y)))); await shot('1-ladder-asc'); await clickNodeCheck('ladder asc');
  await choose('Ladderize', 'desc'); log('ladderize desc', JSON.stringify((await pos()).map((p) => p && Math.round(p.y)))); await clickNodeCheck('ladder desc');
  await choose('Ladderize', 'none'); log('ladderize none', JSON.stringify((await pos()).map((p) => p && Math.round(p.y))));
  // variants
  await choose('Layout variant', 'mirror'); log('mirror', JSON.stringify(await pos())); await shot('2-mirror'); await clickNodeCheck('mirror');
  await choose('Layout variant', 'unrooted'); log('unrooted', JSON.stringify(await pos())); await shot('3-unrooted'); await clickNodeCheck('unrooted');
  await choose('Layout variant', 'standard');
  // internal labels, align tips, scale bar, tip dots
  await toggle('Internal node labels'); log('internal labels', JSON.stringify(await stats().then((x) => x.custom))); await shot('4-internal-labels'); await toggle('Internal node labels');
  await toggle('Align tip labels'); log('align tips', JSON.stringify(await pos())); await shot('5-align'); await toggle('Align tip labels');
  await toggle('Scale bar'); log('no scale bar', await s.page.evaluate(() => document.querySelectorAll('.tree-scale-bar').length)); await toggle('Scale bar');
  await toggle('Tip dots'); log('no tip dots', await s.page.evaluate(() => document.querySelectorAll('circle.pt-tip').length)); await toggle('Tip dots');
  // collapse
  await toggle('Collapse clade on internal-node click');
  const n0 = (await stats()).domNodes;
  let best = -1, bs = 1e9; for (let i = 1; i < t.nodeCount; i++) { if (t.childCount[i] === 0) continue; const size = t.leafEnd[i] - t.leafStart[i]; const sc = Math.abs(Math.log(size / 30)); if (sc < bs) { bs = sc; best = i; } }
  const cid = t.nodeId(best);
  let p = await s.settleLocate({ kind: 'node', id: cid }, 0, 800);
  await s.page.mouse.click(p.x, p.y); await s.settle(600);
  const n1 = (await stats()).domNodes;
  log('collapse: dom nodes', n0, '->', n1, 'tips under collapsed locatable?', JSON.stringify(await s.call('locate', { kind: 'tip', id: t.descendantTips(best)[0] })));
  await shot('6-collapsed');
  p = await s.settleLocate({ kind: 'node', id: cid }, 0, 800);
  if (p) { await s.page.mouse.click(p.x, p.y); await s.settle(600); log('expand: dom nodes', (await stats()).domNodes); } else log('collapsed node not locatable for expand');
  await toggle('Collapse clade on internal-node click');
  // context menu + reroot
  await toggle('Library context menu');
  p = await s.settleLocate({ kind: 'node', id: cid }, 0, 800);
  await s.page.mouse.click(p.x, p.y); await s.settle(500);
  const menu = await s.page.evaluate(() => { const m = document.querySelector('.phylotree-context-menu'); return m ? { display: getComputedStyle(m).display, items: Array.from(m.querySelectorAll('a')).map((a) => a.textContent) } : null; });
  log('menu', JSON.stringify(menu));
  await shot('7-menu');
  const before = (await stats()).custom;
  await s.page.locator('.phylotree-menu-item:has-text("Reroot on this node")').click();
  await s.settle(800);
  const after = (await stats()).custom;
  log('reroot: custom before', JSON.stringify({ r: before.rerooted, d: before.drawnNodes }), 'after', JSON.stringify({ r: after.rerooted, d: after.drawnNodes, unmapped: after.unmappedLibraryNodes }));
  await shot('8-rerooted');
  // events after reroot: click a tip and a node
  const tipP = await s.call('locate', { kind: 'tip', id: ids[1] });
  if (tipP) { await s.call('clearEvents'); await s.page.mouse.click(tipP.x, tipP.y); await s.settle(300); log('after reroot tip click events', JSON.stringify((await s.events()).map((e) => e.type + ':' + e.nodeId))); } else { await s.call('focusTip', ids[1]); const q = await s.settleLocate({ kind: 'tip', id: ids[1] }); await s.call('clearEvents'); await s.page.mouse.click(q.x, q.y); await s.settle(300); log('after reroot tip click (focus) events', JSON.stringify((await s.events()).map((e) => e.type + ':' + e.nodeId))); }
  // zoom works after reroot?
  const c = await s.containerRect(); await s.page.mouse.move(c.x + 300, c.y + 300); await s.page.mouse.wheel(0, -240); await s.settle(300);
  log('zoomK after reroot wheel', (await stats()).custom.zoomK);
  // colour a clade after reroot (ids that still match)
  await s.call('setColouredClades', [{ nodeId: 'n2', colour: '#ff0000' }]); await s.settle(300);
  log('red paths after reroot colouring n2', await s.page.evaluate(() => Array.from(document.querySelectorAll('path.branch')).filter((p) => p.style.stroke === 'rgb(255, 0, 0)' || p.style.stroke === '#ff0000').length));
  log('page errors', JSON.stringify(await s.pageErrors()));
}, 300000);
await b.close();
