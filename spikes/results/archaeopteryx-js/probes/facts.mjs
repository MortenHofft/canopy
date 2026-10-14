// Library facts: global key/wheel capture, container resize, hidden mount, style: properties. Needs the DEV server on 127.0.0.1:5305 (it imports /src/aptx.ts).
// Paths assume the repository at /home/user/gbif-phylo.
import { open } from './lib.mjs';
const { browser, page } = await open('http://127.0.0.1:5305/?tree=syn-yule-200');
await page.waitForSelector('[data-testid=tree-container][data-state=mounted]', { timeout: 60000 });
await page.waitForTimeout(500);
const out = {};
out.keys = await page.evaluate(() => {
  const res = {};
  const t = (name, init, target = document.body) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); target.dispatchEvent(e); res[name] = e.defaultPrevented; };
  t('Ctrl+F', { key: 'f', ctrlKey: true });
  t('Ctrl+G', { key: 'g', ctrlKey: true });
  t('Ctrl+0', { key: '0', ctrlKey: true });
  t('Ctrl+=', { key: '=', ctrlKey: true });
  t('Ctrl+/', { key: '/', ctrlKey: true });
  t('Ctrl+Shift+L', { key: 'L', ctrlKey: true, shiftKey: true });
  t('Ctrl+A', { key: 'a', ctrlKey: true });
  t('plain f', { key: 'f' });
  const w = (name, init) => { const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, ...init }); document.querySelector('header, .app-header, h1, body').dispatchEvent(e); res[name] = e.defaultPrevented; };
  w('wheel (plain, outside tree)', {});
  w('shift+wheel (outside tree)', { shiftKey: true });
  return res;
});
// resize without window resize
out.resize = await page.evaluate(async () => {
  const c = document.querySelector('[data-testid=tree-container]');
  const svg = () => { const s = document.querySelector('rect.basebackground').parentElement; return [s.getAttribute('width'), s.getAttribute('height')]; };
  const r = { before: svg() };
  c.style.width = '500px'; c.style.height = '300px';
  await new Promise(r => setTimeout(r, 400));
  r.afterContainerResize = svg();
  window.dispatchEvent(new Event('resize'));
  await new Promise(r => setTimeout(r, 400));
  r.afterWindowResizeEvent = svg();
  return r;
});
// hidden mount
out.hidden = await page.evaluate(async () => {
  const m = await import('/src/aptx.ts');
  const div = document.createElement('div'); div.style.cssText = 'width:600px;height:400px;display:none'; document.body.appendChild(div);
  const tree = m.archaeopteryx.parseTree('t.nwk', '((a:1,b:1):1,(c:1,d:1):1);');
  const r = {};
  try { const v = m.archaeopteryx.launch(div, tree, { collapseControlPanel: true }); await v.ready; const s = div.querySelector('rect.basebackground')?.parentElement; r.svgSizeWhenHidden = s && [s.getAttribute('width'), s.getAttribute('height')]; div.style.display = 'block'; window.dispatchEvent(new Event('resize')); await new Promise(r => setTimeout(r, 300)); r.svgSizeAfterShowAndResizeEvent = s && [s.getAttribute('width'), s.getAttribute('height')]; v.destroy(); } catch (e) { r.err = String(e).slice(0, 200); }
  div.remove();
  return r;
});
// style: properties
out.style = await page.evaluate(async () => {
  const m = await import('/src/aptx.ts');
  const div = document.createElement('div'); div.id = 'styletest'; div.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:400px;z-index:9999;background:#fff'; document.body.appendChild(div);
  const tree = m.archaeopteryx.parseTree('t.nwk', '((a:1,b:1):1,(c:1,d:1):1);');
  const find = (n, name) => { const st = [n]; while (st.length) { const x = st.pop(); if (x.name === name) return x; if (x.children) st.push(...x.children); } };
  const P = (ref, value) => ({ ref, value, datatype: 'xsd:string', applies_to: 'node' });
  find(tree, 'a').properties = [P('style:node_color', '#ff0000'), P('style:node_shape', 'diamond'), P('style:font_color', '#00aa00'), P('style:font_size', '20'), P('style:font_style', 'bold_italic')];
  find(tree, 'b').properties = [P('style:node_size', '30'), P('style:font_name', 'Courier New'), P('style:node_transparency', '0.2')];
  const v = m.archaeopteryx.launch(div, tree, { collapseControlPanel: true, enableVisualizations: false });
  await v.ready; await new Promise(r => setTimeout(r, 400));
  const texts = [...div.querySelectorAll('text.extlabel')].map(t => [t.textContent, t.style.fontSize, t.style.fill, t.style.fontStyle, t.style.fontWeight, t.style.fontFamily.slice(0, 20)]);
  const shapes = div.querySelector('g.aptx-node-shapes')?.innerHTML.slice(0, 300);
  const dots = div.querySelector('g.aptx-node-dots')?.innerHTML.slice(0, 300);
  return { texts, shapes, dots };
});
console.log(JSON.stringify(out, null, 1));
await page.screenshot({ path: process.env.SP + '/facts.png' });
await browser.close();
