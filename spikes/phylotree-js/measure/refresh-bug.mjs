// Shows that display.refresh() calls the edge-styler with d3.select(<TreeRender>) instead of the <path> element.
// usage: node measure/refresh-bug.mjs <newick file>
import { Browser } from '../../runner/lib/session.mjs';
import fs from 'node:fs';
const newick = fs.readFileSync(process.argv[2], 'utf8');
const b = new Browser('http://127.0.0.1:5203/', () => {});
await b.launch();
await b.withSession('api', async (s) => {
  const size = await s.mainSize();
  await s.page.evaluate(async ({ newick, size }) => { await window.__spike.mount({ treeId: 'custom', newick, layout: 'rectangular', branchLengths: true, size }); }, { newick, size });
  const r = await s.page.evaluate(() => {
    const d = document.querySelector('[data-testid=phylotree-host]').__phylotree.display;
    const orig = d.edge_styler;
    const seen = [];
    d.edge_styler = function (sel, edge) { const n = sel.node(); seen.push(n ? (n instanceof Element ? 'Element' : n.constructor.name) : String(n)); };
    d.refresh();
    d.edge_styler = orig;
    return { calls: seen.length, kinds: [...new Set(seen)] };
  });
  console.log(JSON.stringify(r));
}, 100000);
await b.close();
