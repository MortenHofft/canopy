// StrictMode-like launch, destroy, launch on a 5,000-tip tree. Needs the DEV server on 127.0.0.1:5305.
// Paths assume the repository at /home/user/gbif-phylo.
import fs from 'node:fs';
import { open } from './lib.mjs';
const newick = fs.readFileSync('gen/newick/yule_5000.nwk', 'utf8');
const { browser, page } = await open('http://127.0.0.1:5305/?tree=edge-quoted-labels');
await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 60000 });
const r = await page.evaluate(async (newick) => {
  const m = await import('/src/aptx.ts');
  const out = {};
  const div = document.createElement('div'); div.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:400px;z-index:9999;background:#fff'; document.body.appendChild(div);
  const errs = []; window.addEventListener('error', (e) => errs.push(e.message));
  // StrictMode sequence: mount, cleanup, mount again, all in the same task
  const t1 = m.archaeopteryx.parseTree('t.nwk', newick);
  const v1 = m.archaeopteryx.launch(div, t1, { collapseControlPanel: true });
  v1.destroy();
  const t2 = m.archaeopteryx.parseTree('t.nwk', newick);
  const v2 = m.archaeopteryx.launch(div, t2, { collapseControlPanel: true });
  await v2.ready.catch((e) => errs.push('ready2: ' + e));
  await v1.ready.then(() => out.v1ready = 'resolved', (e) => out.v1ready = 'rejected ' + String(e).slice(0, 80));
  await new Promise(r => setTimeout(r, 1500));
  out.svgs = div.querySelectorAll('rect.basebackground').length; out.panels = div.querySelectorAll('.aptx-panel').length; out.labels = div.querySelectorAll('g.node').length;
  out.errs = errs;
  v2.destroy();
  out.afterDestroy = div.children.length;
  div.remove();
  return out;
}, newick);
console.log(JSON.stringify(r));
await browser.close();
