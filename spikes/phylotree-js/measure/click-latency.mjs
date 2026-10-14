// Linked-view timing by hand: turns the shell's linked view on, clicks a ~10% clade 3 times and prints pointerdown to event / commit / paint.
// usage: node measure/click-latency.mjs <tree id> (served at http://127.0.0.1:5203/)
import { Browser } from '../../runner/lib/session.mjs';
import { sleep } from '../../runner/lib/util.mjs';
import { truthTree, getEntry } from '../../runner/lib/truth.mjs';
const tree = process.argv[2] || 'syn-yule-10000';
const b = new Browser('http://127.0.0.1:5203/', console.log);
await b.launch();
await b.withSession('probe', async (s) => {
  const entry = getEntry(tree);
  const t = truthTree(entry);
  const r = await s.mount(entry, {});
  console.log('mount', JSON.stringify({ parse: r.parseMs, first: r.firstRenderMs, tips: r.tips }));
  await s.page.evaluate(() => window.__spikeShell.setLinkedView(true));
  // pick a clade ~10% of tips
  let best = -1, bs = 1e9;
  for (let i = 1; i < t.nodeCount; i++) { if (t.childCount[i] === 0) continue; const size = t.leafEnd[i] - t.leafStart[i]; const sc = Math.abs(Math.log(size / (t.tipCount * 0.1))); if (sc < bs) { bs = sc; best = i; } }
  const id = t.nodeId(best);
  for (let k = 0; k < 3; k++) {
    const p = await s.settleLocate({ kind: 'node', id }, 0, 800);
    await s.call('clearEvents');
    await s.page.evaluate(() => { window.__t0 = performance.now(); });
    await s.page.mouse.click(p.x, p.y);
    await sleep(2500);
    const st = await s.call('getStats');
    const im = await s.page.evaluate(() => ({ ...window.__spikeMetrics.input }));
    console.log('click', k, 'commit', (im.lastEventCommit - im.pointerDown).toFixed(0), 'paint', (im.lastEventPaint - im.pointerDown).toFixed(0), 'event', (im.lastEvent - im.pointerDown).toFixed(0), JSON.stringify(st.custom));
    await s.page.evaluate(() => window.__spike.setColouredClades([]));
    await sleep(500);
  }
}, 120000);
await b.close();
