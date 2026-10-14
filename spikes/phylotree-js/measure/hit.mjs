// After focusTip, prints locate(), elementsFromPoint() and the text boxes of the neighbours (hit-test debugging).
// usage: node measure/hit.mjs [url]
import { Browser } from '../../runner/lib/session.mjs';
import { truthTree, getEntry } from '../../runner/lib/truth.mjs';
const e = getEntry('syn-yule-1000'); const t = truthTree(e);
const b = new Browser(process.argv[2] || 'http://127.0.0.1:5203/', () => {});
await b.launch();
await b.withSession('hit', async (s) => {
  await s.mount(e, {});
  const tip = t.tipLabels[300];
  await s.call('focusTip', tip);
  const p = await s.settleLocate({ kind: 'tip', id: tip });
  console.log('locate', JSON.stringify(p));
  const r = await s.page.evaluate(({ p, tip }) => {
    const els = document.elementsFromPoint(p.x, p.y).slice(0, 4).map((el) => el.tagName + ':' + (el.textContent || '').slice(0, 30) + ':' + el.getAttribute('class'));
    const host = document.querySelector('[data-testid=phylotree-host]');
    const texts = Array.from(host.querySelectorAll('text.phylotree-node-text'));
    const me = texts.find((x) => x.textContent === tip);
    const rr = me.getBoundingClientRect();
    const idx = texts.indexOf(me);
    const nb = [texts[idx - 1], texts[idx + 1]].map((x) => { const q = x.getBoundingClientRect(); return { t: x.textContent, top: q.top, bottom: q.bottom, h: q.height }; });
    return { els, me: { top: rr.top, bottom: rr.bottom, h: rr.height, cy: rr.top + rr.height / 2 }, nb, cls: host.className, fs: getComputedStyle(me).fontSize };
  }, { p, tip });
  console.log(JSON.stringify(r, null, 1));
}, 100000);
await b.close();
