// Clicks the midpoint of a tip's branch with the real mouse and prints the events (branchClick) after focusTip.
// usage: node measure/branch.mjs
import { Browser } from '../../runner/lib/session.mjs';
import { truthTree, getEntry } from '../../runner/lib/truth.mjs';
const e = getEntry('syn-yule-1000'); const t = truthTree(e);
const b = new Browser('http://127.0.0.1:5203/', () => {});
await b.launch();
await b.withSession('branch', async (s) => {
  await s.mount(e, {});
  const tip = t.tipLabels[400];
  await s.call('focusTip', tip); await s.settle(500);
  const pt = await s.page.evaluate((tip) => {
    const I = document.querySelector('[data-testid=phylotree-host]').__phylotree;
    const node = I.tipNode.get(tip);
    const p = I.display.svg.node().querySelector('.phylotree-container').querySelectorAll('path.branch');
    for (const el of p) if (el.__data__.target === node) {
      const len = el.getTotalLength(); const q = el.getPointAtLength(len * 0.85); const m = el.getScreenCTM();
      return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f, len };
    }
    return null;
  }, tip);
  console.log('branch point', JSON.stringify(pt));
  await s.call('clearEvents');
  await s.page.mouse.move(pt.x, pt.y); await s.page.mouse.click(pt.x, pt.y); await s.settle(300);
  const ev = await s.events();
  console.log('events', JSON.stringify(ev.map((x) => [x.type, x.nodeId, x.isTip, x.tipIds.length, x.source])));
  console.log('expected tip node', t.tipNodeId(tip));
  console.log('selected classes', await s.page.evaluate(() => document.querySelectorAll('.branch-selected').length));
  console.log('errors', JSON.stringify(await s.pageErrors()));
}, 100000);
await b.close();
