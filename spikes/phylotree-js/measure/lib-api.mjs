// Times library calls on a mounted tree: display.update(), placenodes(), selectNodes(50 names), clearSelection(), refresh().
// usage: node measure/lib-api.mjs <newick file>   (served at http://127.0.0.1:5203/)
import { Browser } from '../../runner/lib/session.mjs';
import fs from 'node:fs';
const file = process.argv[2];
const newick = fs.readFileSync(file, 'utf8');
const b = new Browser('http://127.0.0.1:5203/', () => {});
await b.launch();
await b.withSession('api', async (s) => {
  const size = await s.mainSize();
  await s.page.evaluate(async ({ newick, size }) => { await window.__spike.mount({ treeId: 'custom', newick, layout: 'rectangular', branchLengths: true, size }); }, { newick, size });
  await s.settle(500);
  const r = await s.page.evaluate(() => {
    const host = document.querySelector('[data-testid=phylotree-host]');
    const I = host.__phylotree; const d = I.display;
    const out = {};
    const tips = I.pt.getTips().map((t) => t.data.name);
    const t = (f) => { const a = performance.now(); try { f(); } catch (e) { return 'ERR ' + e.message; } return Math.round(performance.now() - a); };
    out.update_ms = t(() => d.update());
    out.placenodes_ms = t(() => d.placenodes());
    out.selectNodes50_ms = t(() => d.selectNodes(tips.slice(0, 50)));
    out.clearSelection_ms = t(() => d.clearSelection());
    out.refresh = (() => { try { d.refresh(); return 'ok'; } catch (e) { return 'threw: ' + e.message; } })();
    out.refresh_with_stylers_ms = t(() => d.refresh());
    out.getSelection_len = d.getSelection().length;
    out.errorsAfter = window.__spikeMetrics?.errors?.slice(0, 3);
    return out;
  });
  console.log(file.split('/').pop(), JSON.stringify(r));
  console.log('page errors', JSON.stringify(await s.pageErrors()));
}, 200000);
await b.close();
