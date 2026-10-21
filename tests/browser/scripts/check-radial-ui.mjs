// Browser check of the radial cut-off in the real demo (needs the production build served: npm run build && npm run preview -- --port 5306).
//   node packages/viewer/scripts/check-radial-ui.mjs [--port 5306]
// Checks on a 10,000-tip Yule tree, radial: hover and click on a summarised clade (event carries the clade's tip count), clade colouring
// of a summarised clade, highlight and focus of a tip inside a summary, no tree redraw on hover, reduced frames during a wheel gesture
// and one full frame after it, a click right after a wheel hits what a full-quality frame shows, and progressive detail when zooming.
// Then the renderer driven directly (its class is reached through window.__customTree): a double-click on a clade with a source whose node ids are
// not its rows zooms to the same viewport as zoomToNode(id), aligned columns through the renderer, tipHref link mode, a set of setOptions
// combinations, setters that must not redraw on equal input, two simultaneous instances (window.__spike and __spike2), and mount / unmount cycles
// that leave the DOM as they found it, with no page error.
// Timing: the fixed sleeps (100 to 450 ms) wait for the refine frame, animations and the overlay timers; on a heavily loaded CI runner they may
// need raising (the 'frames' and viewport assertions are the ones that fail first).
// `npm run test:browser` (scripts/test-browser.mjs) builds, serves and runs this. Chromium: $CHROMIUM_PATH, else the sandbox copy when it exists,
// else the browser Playwright installed (npx playwright-core install chromium).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath } from './chromium.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const port = Number(args.port || 5306);
const text = zlib.gunzipSync(fs.readFileSync(path.join(root, 'data/synthetic/newick/yule_10000.nwk.gz'))).toString('utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => {
  console.log((c ? '  ok   ' : '  FAIL ') + m);
  if (!c) failures++;
};

const executablePath = chromiumPath(); // undefined: Playwright's own
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu-rasterization'],
});
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
page.on('pageerror', (e) => {
  console.log('PAGEERR', e.message);
  failures++;
});
// console.error is a failure too (the shell and React report their errors there); a failed resource fetch (the optional column files of
// the catalogue trees) is not the renderer's
page.on('console', (m) => {
  if (m.type() !== 'error' || /Failed to load resource/.test(m.text())) return;
  console.log('CONSOLE.ERROR', m.text().slice(0, 300));
  failures++;
});
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => window.__spike);
await page.evaluate(async (t) => {
  await window.__spike.mount({ treeId: 'syn-yule-10000', newick: t, layout: 'radial', branchLengths: true, size: { width: 1100, height: 640 } });
}, text);
const getBox = () =>
  page.evaluate(() => {
    const r = window.__customTree.handle().renderer().root.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
let box = await getBox();
const stats = () => page.evaluate(() => window.__customTree.stats());
const rd = (fn, ...a) => page.evaluate(fn, ...a);

// ---- fit view: the cut-off is active and the notice shows
let s = await stats();
ok(
  s.budget === 2000 && s.drawn <= 2000 && s.forced > 0 && s.summaries > 0,
  `fit: drawn ${s.drawn} <= budget ${s.budget}, ${s.forced} clades summarised`,
);
const noticeText = await page.locator('[data-treeview] [role=status]').first().textContent();
ok(/clades? summarised, raise the limit in Library options/.test(noticeText ?? ''), `notice: "${noticeText}"`);

// ---- find a summary with room to click
const target = await rd(() => {
  const r = window.__customTree.handle().renderer();
  const { list, tree, T, L } = r;
  for (let e = 0; e < list.count; e++) {
    if (list.kind[e] !== 2) continue;
    const i = list.node[e];
    const r1 = L.XMAX[i] * T.k,
      r0 = L.X[i] * T.k,
      arc = (tree.leafEnd[i] - tree.leafStart[i]) * T.da * r1;
    if (arc < 2.5 || r1 - r0 < 10 || tree.leafEnd[i] - tree.leafStart[i] < 3) continue;
    const a = ((tree.leafStart[i] + tree.leafEnd[i]) / 2) * T.da,
      rr = r1 - 3;
    const x = T.cx + rr * Math.cos(a),
      y = T.cy + rr * Math.sin(a);
    if (x > 20 && y > 40 && x < T.W - 20 && y < T.H - 20)
      return { node: i, x, y, tips: tree.leafEnd[i] - tree.leafStart[i], start: tree.leafStart[i] };
  }
  return null;
});
ok(!!target, 'found a summarised clade to interact with');
box = await getBox();
const px = box.x + target.x,
  py = box.y + target.y;

// ---- hover: event with the clade's tip count
await page.evaluate(() => window.__spike.clearEvents());
await page.mouse.move(px - 40, py - 40);
await page.mouse.move(px, py, { steps: 4 });
await sleep(150);
let ev = await page.evaluate(() => window.__spike.getEvents());
const hov = ev.filter((e) => e.type === 'nodeHover').pop();
ok(
  hov && hov.nodeId === 'n' + target.node && hov.tipIds.length === target.tips,
  `hover on a summary: ${hov?.nodeId}, ${hov?.tipIds.length} tips (expected n${target.node}, ${target.tips})`,
);

// ---- hover and selection never redraw the tree layer
// A web font that finishes loading redraws the tree once, by design (renderer: fonts.ready / 'loadingdone'). The fonts come from Google
// Fonts and load lazily, and the hover above can start one, so on a network where they arrive (CI) a load could land inside the window
// below and count as a hover redraw. Wait for pending font loads first.
await page.evaluate(() => document.fonts.ready);
await sleep(100);
const f0 = (await stats()).frames;
for (let k = 0; k < 40; k++) {
  await page.mouse.move(px + (k % 7) * 3, py + (k % 5) * 3);
  await sleep(12);
}
await sleep(100);
const f1 = (await stats()).frames;
ok(f1 === f0, `40 pointer moves over the tree: ${f1 - f0} tree redraws`);

// ---- click: nodeClick with the tip set
await page.evaluate(() => window.__spike.clearEvents());
await page.mouse.click(px, py);
await sleep(150);
ev = await page.evaluate(() => window.__spike.getEvents());
const clk = ev.filter((e) => e.type === 'nodeClick').pop();
ok(clk && clk.nodeId === 'n' + target.node && clk.tipIds.length === target.tips, `click on a summary: ${clk?.nodeId}, ${clk?.tipIds.length} tips`);
const lastEvent = await page.locator('[data-testid=last-event]').textContent();
ok(
  new RegExp('(nodeClick|nodeHover) n' + target.node + ' ').test(lastEvent ?? ''),
  `React state shows the event (a hover can follow the click): ${(lastEvent ?? '').slice(0, 60)}`,
);

// ---- colouring a summarised clade: pixels at its fan turn red
const before = await rd(({ x, y }) => {
  const c = window.__customTree.handle().renderer().ctx;
  const d = c.getImageData(Math.round(x * (devicePixelRatio || 1)), Math.round(y * (devicePixelRatio || 1)), 1, 1).data;
  return [d[0], d[1], d[2]];
}, target);
await page.evaluate((id) => window.__spike.setColouredClades([{ nodeId: id, colour: '#e00000' }]), 'n' + target.node);
await sleep(100);
const after = await rd(({ x, y }) => {
  const c = window.__customTree.handle().renderer().ctx;
  const d = c.getImageData(Math.round(x * (devicePixelRatio || 1)), Math.round(y * (devicePixelRatio || 1)), 1, 1).data;
  return [d[0], d[1], d[2]];
}, target);
ok(after[0] > after[1] + 40 && after[0] > before[0] - 1, `clade colour: pixel ${before} -> ${after}`);
await page.evaluate(() => window.__spike.setColouredClades([]));

// ---- highlight and focus a tip inside a summary
const tipId = await rd((start) => window.__customTree.handle().renderer().tree.tipLabels[start + 1], target.start);
await page.evaluate((t) => window.__spike.highlightTips([t]), tipId);
await page.evaluate((t) => window.__spike.focusTip(t), tipId);
await sleep(200);
const loc = await page.evaluate((t) => window.__spike.locate({ kind: 'tip', id: t }), tipId);
s = await stats();
ok(!!loc && s.drawn <= 2000, `focusTip on a tip that was inside a summary: locate ${loc ? 'found' : 'null'}, drawn ${s.drawn}`);
await page.evaluate(() => window.__spike.highlightTips([]));

// ---- wheel gesture: reduced frames while it lasts, one full frame after, click right after hits the full-quality target
await rd(() => window.__customTree.handle().renderer().fit(false));
await sleep(200);
const cx = box.x + box.width * 0.45,
  cy = box.y + box.height * 0.5;
await page.mouse.move(cx, cy);
let sawReduced = false,
  maxReducedDrawn = 0;
for (let k = 0; k < 8; k++) {
  await page.mouse.wheel(0, -120);
  await sleep(16);
  const q = await stats();
  if (q.reduced) {
    sawReduced = true;
    maxReducedDrawn = Math.max(maxReducedDrawn, q.drawn);
  }
}
ok(sawReduced && maxReducedDrawn <= 500, `during the wheel: reduced frames drawn (max ${maxReducedDrawn} <= 500)`);
await sleep(300);
s = await stats();
ok(!s.reduced && s.drawn <= 2000, `300 ms after the wheel: full frame (reduced=${s.reduced}, drawn ${s.drawn})`);

// ---- progressive detail: zoom in step by step, forced summaries fall to 0, budget respected
const series = [];
for (let k = 0; k < 14; k++) {
  for (let j = 0; j < 4; j++) {
    await page.mouse.wheel(0, -120);
    await sleep(16);
  }
  await sleep(220);
  const q = await stats();
  series.push([q.drawn, q.forced, +q.minPxUsed.toFixed(2), q.reduced]);
}
console.log('  zoom series [drawn, forced, minPx, reduced]:', JSON.stringify(series));
ok(
  series.every((q) => q[0] <= 2000 && !q[3]),
  'drawn <= 2000 at every zoom step, all settled to full frames',
);
ok(series[series.length - 1][1] === 0, 'fully zoomed in: no forced summaries');

// ---- click immediately after a wheel hits what the full-quality frame shows
await rd(() => window.__customTree.handle().renderer().fit(false));
await sleep(200);
await page.evaluate(() => window.__spike.clearEvents());
for (let j = 0; j < 3; j++) {
  await page.mouse.wheel(0, -60);
  await sleep(10);
}
const where = await rd(() => {
  const r = window.__customTree.handle().renderer();
  r.renderNow();
  const { list, T, L } = r;
  for (let e = 0; e < list.count; e++) {
    if (list.kind[e] !== 1) continue;
    const i = list.node[e];
    const x = T.cx + L.X[i] * T.k * L.COS[i],
      y = T.cy + L.X[i] * T.k * L.SIN[i];
    if (x > 100 && y > 100 && x < T.W - 100 && y < T.H - 100) return { node: i, x, y };
  }
  return null;
});
if (where) {
  // after renderNow the frame is full quality; now disturb it with a fresh wheel step and click on the same spot at once
  await page.mouse.wheel(0, 0);
  await page.mouse.click(box.x + where.x, box.y + where.y);
  await sleep(100);
  ev = await page.evaluate(() => window.__spike.getEvents());
  const c2 = ev.filter((e) => e.type === 'tipClick' || e.type === 'nodeClick').pop();
  ok(!!c2, `click right after wheel input produced an event (${c2?.type} ${c2?.nodeId})`);
}

// ================================================================ the renderer driven directly
// A second renderer of the same class on the tree of the mounted one, in fixed-size hosts that sit above the demo page (so real mouse events
// reach them). `mk(opts, source)` is defined once in the page; every section below uses it.
await page.evaluate(() => {
  const r0 = window.__customTree.handle().renderer();
  const R = r0.constructor;
  const base = r0.tree;
  const OFF = 100000;
  const hosts = [];
  window.__t = {
    R,
    base,
    OFF,
    /** A source whose node ids are row + OFF, as a partial source's ids are not its rows. */
    wrapped() {
      const snap = {
        ...base,
        globalId: Int32Array.from({ length: base.nodeCount }, (_, i) => i + OFF),
        toLocal: (g) => (g - OFF >= 0 && g - OFF < base.nodeCount ? g - OFF : -1),
      };
      return {
        nodeCount: base.nodeCount,
        tipCount: base.tipCount,
        hasLengths: base.hasLengths,
        version: 0,
        subscribe: () => () => undefined,
        snapshot: () => snap,
        ensureClade: async () => undefined,
        tipLabels: async (a, b) => base.tipLabels.slice(a, b),
        destroy() {},
      };
    },
    mk(opts = {}, source = base, { left = 10, top = 10, w = 700, h = 420, visible = true } = {}) {
      const host = document.createElement('div');
      host.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${w}px;height:${h}px;z-index:${visible ? 99999 : 1};background:#fff;${visible ? '' : 'visibility:hidden;'}`;
      document.body.appendChild(host);
      const r = new R({ target: host, source, options: { layout: 'rectangular', softwareCanvas: true, ...opts } });
      hosts.push({ host, r });
      return r;
    },
    /** An internal node with minTips..maxTips tips that has an internal child of at least childMin tips: [parent, child]. */
    clade(minTips = 150, maxTips = 400, childMin = 40) {
      for (let i = 1; i < base.nodeCount; i++) {
        const n = base.leafEnd[i] - base.leafStart[i];
        if (n < minTips || n > maxTips) continue;
        let best = -1;
        for (let c = base.firstChild[i]; c >= 0; c = base.nextSibling[c])
          if (base.childCount[c] > 0 && (best < 0 || base.leafEnd[c] - base.leafStart[c] > base.leafEnd[best] - base.leafStart[best])) best = c;
        if (childMin === 0 || (best >= 0 && base.leafEnd[best] - base.leafStart[best] >= childMin)) return [i, best];
      }
      return null;
    },
    cleanup() {
      for (const { host, r } of hosts.splice(0)) {
        r.destroy();
        host.remove();
      }
    },
  };
});
const near = (a, b, eps = 1e-9) => ['x0', 'x1', 'y0', 'y1'].every((k) => Math.abs(a[k] - b[k]) <= eps * Math.max(1, Math.abs(a[k]), Math.abs(b[k])));
const fmtV = (v) => `x ${v.x0.toFixed(4)}..${v.x1.toFixed(4)} y ${v.y0.toFixed(2)}..${v.y1.toFixed(2)}`;

// ---- double-click on a clade with a source whose ids are not its rows (id = row + 100000) zooms like zoomToNode(id), also like the in-memory tree
{
  const prep = await page.evaluate(() => {
    const t = window.__t;
    const cl = t.clade();
    if (!cl) return null;
    const [P, C] = cl;
    const W = t.mk({}, t.wrapped(), { left: 10, top: 10 });
    const Win = t.mk({}, t.wrapped(), { left: 10, top: 10, visible: false });
    const U = t.mk({}, t.base, { left: 10, top: 10, visible: false });
    W.zoomToNode(P + t.OFF, false);
    Win.zoomToNode(P + t.OFF, false);
    U.zoomToNode(P, false);
    W.renderNow();
    const pos = W.locateNode(C + t.OFF);
    Win.zoomToNode(C + t.OFF, false); // what the double-click must end at
    U.zoomToNode(C, false);
    window.__t.W = W;
    return {
      pos,
      start: W.getViewport(),
      expected: Win.getViewport(),
      unwrapped: U.getViewport(),
      fit: (U.fit(false), U.getViewport()),
      tips: t.base.leafEnd[C] - t.base.leafStart[C],
    };
  });
  ok(!!prep && !!prep.pos, `dblclick: found a clade of ${prep?.tips} tips with its marker in view`);
  if (prep && prep.pos) {
    ok(near(prep.expected, prep.unwrapped), `zoomToNode(id) on a source with shifted ids = zoomToNode on the tree (${fmtV(prep.expected)})`);
    ok(!near(prep.start, prep.expected), 'the clade viewport differs from the parent viewport');
    await page.mouse.dblclick(prep.pos.x, prep.pos.y);
    await sleep(450);
    const got = await page.evaluate(() => window.__t.W.getViewport());
    ok(near(got, prep.expected, 1e-6), `dblclick on the clade with shifted ids: viewport ${fmtV(got)}, zoomToNode(id) ${fmtV(prep.expected)}`);
    // empty space: fit. The bottom left corner of the host holds nothing.
    await page.mouse.dblclick(10 + 4, 10 + 420 - 4);
    await sleep(450);
    const fitted = await page.evaluate(() => window.__t.W.getViewport());
    ok(near(fitted, prep.fit, 1e-6), `dblclick on empty space fits: ${fmtV(fitted)} (fit ${fmtV(prep.fit)})`);
  }
  await page.evaluate(() => window.__t.cleanup());
}

// ---- columns through the renderer: bar, text, alignment cells, the pixels of a bar, and no redraw for an unchanged column list
{
  const res = await page.evaluate(async () => {
    const t = window.__t;
    const [P] = t.clade(14, 24, 0); // ~20 rows of ~18 px
    const r = t.mk({});
    const tips = [];
    for (let k = t.base.leafStart[P]; k < t.base.leafEnd[P]; k++) tips.push(t.base.tipLabels[k]);
    const bars = {},
      txt = {},
      aln = {};
    tips.forEach((l, i) => {
      if (i % 5 !== 4) bars[l] = i % 7 === 0 ? 1000 : 5 + i;
      txt[l] = 'name ' + i;
      aln[l] = 'ACDEFGHIKLMNPQRSTVWY'.slice(i % 5) + 'AC--GT';
    });
    const cols = [
      { id: 'bar', kind: 'bar', header: 'Count', width: 90, values: bars },
      { id: 'txt', kind: 'text', header: 'Name', width: 90, values: txt },
      { id: 'aln', kind: 'alignment', header: 'Seq', width: 90, values: aln },
    ];
    const out = {};
    r.zoomToNode(P, false);
    r.setColumns(cols);
    r.renderNow();
    const rank = (i) => t.base.leafStart[P] + i;
    out.cell0 = r.columnCell('bar', rank(0));
    out.cellMissing = r.columnCell('bar', rank(4)); // i = 4: no bar value
    out.cellTxt = r.columnCell('txt', rank(1));
    out.cellAln = r.columnCell('aln', rank(2));
    out.cellNone = r.columnCell('nope', rank(0));
    out.cellOut = r.columnCell('bar', t.base.leafEnd[P] + 50);
    // pixels: the bar of tip 0 (value 1000 = the maximum, full width) against the empty background to its right
    const rect = r.root.getBoundingClientRect();
    const dpr = r.canvas.width / r.size.width;
    const px = (x, y) => [...r.ctx.getImageData(Math.round((x - rect.left) * dpr), Math.round((y - rect.top) * dpr), 1, 1).data.slice(0, 3)];
    out.barPixel = px(out.cell0.x + out.cell0.width / 2, out.cell0.y + out.cell0.height / 2);
    out.bgPixel = px(out.cell0.x + 91, out.cell0.y + out.cell0.height / 2);
    // equal input: no redraw
    r.renderNow();
    await new Promise((res) => setTimeout(res, 150));
    const f0 = r.getStats().frames;
    r.setColumns(cols.slice());
    r.setColumns(cols.map((c) => ({ ...c })));
    await new Promise((res) => setTimeout(res, 150));
    out.framesAfterSame = r.getStats().frames - f0;
    r.setColumns([{ ...cols[0], header: 'Renamed' }, cols[1], cols[2]]);
    await new Promise((res) => setTimeout(res, 150));
    out.framesAfterRename = r.getStats().frames - f0;
    r.setColumns([]);
    r.renderNow();
    out.cellAfterRemoval = r.columnCell('bar', rank(0));
    return out;
  });
  const inBox = (c, w) => c && c.width > 0 && c.height > 0 && c.width <= w + 0.5;
  ok(inBox(res.cell0, 90) && res.cell0.width > 80, `bar cell of the largest value fills the column: ${JSON.stringify(res.cell0)}`);
  ok(res.cellMissing === null, 'a tip without a value has no bar cell');
  ok(inBox(res.cellTxt, 90) && inBox(res.cellAln, 90) && res.cellTxt.x !== res.cell0.x, 'text and alignment cells sit in their own columns');
  ok(res.cellNone === null && res.cellOut === null, 'unknown column id and a tip out of view give no cell');
  ok(res.barPixel.join() !== res.bgPixel.join(), `the bar is painted: pixel ${res.barPixel} inside, ${res.bgPixel} beside it`);
  ok(res.framesAfterSame === 0, `setColumns with an equal list draws no frame (${res.framesAfterSame})`);
  ok(res.framesAfterRename >= 1, `a changed header redraws (${res.framesAfterRename} frames)`);
  ok(res.cellAfterRemoval === null, 'removing the columns removes their cells');
  await page.evaluate(() => window.__t.cleanup());
}

// ---- tipHref: tip labels are real links, switch off and on again
{
  const res = await page.evaluate(async () => {
    const t = window.__t;
    const [P] = t.clade(14, 24, 0);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const r = t.mk({ tipHref: (id) => 'https://example.org/tip/' + encodeURIComponent(id) });
    r.zoomToNode(P, false);
    r.renderNow();
    await sleep(100);
    const q = (sel) => [...r.root.querySelectorAll(sel)];
    const out = { anchors: q('a[data-tip-id]').length };
    const a = q('a[data-tip-id]')[0];
    out.href = a?.getAttribute('href');
    out.id = a?.dataset.tipId;
    out.target = a?.target;
    out.rel = a?.rel;
    r.setOptions({ tipHref: null });
    r.renderNow();
    await sleep(100);
    out.anchorsOff = q('a[data-tip-id]').length;
    out.items = q('[role=treeitem][data-tip-id]').length;
    r.setOptions({ tipHref: (id) => '#' + id });
    r.renderNow();
    await sleep(100);
    out.anchorsOn = q('a[data-tip-id]').length;
    out.itemsOn = q('[role=treeitem][data-tip-id]').length;
    out.hash = q('a[data-tip-id]')[0]?.getAttribute('href') === '#' + q('a[data-tip-id]')[0]?.dataset.tipId;
    return out;
  });
  ok(res.anchors > 5, `tipHref: ${res.anchors} label links in view`);
  ok(
    res.href === 'https://example.org/tip/' + encodeURIComponent(res.id) && res.target === '_blank' && /noopener/.test(res.rel),
    `link of ${res.id}: ${res.href} (${res.target}, ${res.rel})`,
  );
  ok(res.anchorsOff === 0 && res.items > 5, `tipHref off: no links, ${res.items} treeitems`);
  ok(res.anchorsOn > 5 && res.itemsOn === 0 && res.hash, `tipHref on again: ${res.anchorsOn} links, new function used`);
  await page.evaluate(() => window.__t.cleanup());
}

// ---- formatLabel: the accessible label elements follow it, not only the canvas text
{
  const res = await page.evaluate(async () => {
    const t = window.__t;
    const [P] = t.clade(14, 24, 0);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const r = t.mk({});
    r.zoomToNode(P, false);
    r.renderNow();
    await sleep(100);
    const el = () => r.root.querySelector('[data-tip-id]');
    const id = el()?.dataset.tipId;
    const before = el()?.textContent;
    r.setOptions({ formatLabel: (s) => s.toUpperCase() });
    r.renderNow();
    await sleep(100);
    return { id, before, after: el()?.textContent, again: el()?.dataset.tipId };
  });
  ok(res.before === res.id.replace(/_/g, ' '), `label element of ${res.id} reads "${res.before}"`);
  ok(res.after === res.id.toUpperCase() && res.again === res.id, `after formatLabel -> upper case: "${res.after}"`);
  await page.evaluate(() => window.__t.cleanup());
}

// ---- setOptions combinations and setters that must not redraw
{
  const res = await page.evaluate(async () => {
    const t = window.__t;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const r = t.mk({});
    const out = { errors: [], steps: [] };
    const step = (name, patch, check) => {
      try {
        r.setOptions(patch);
        r.renderNow();
        const s = r.getStats();
        const v = r.getViewport();
        const rec = {
          name,
          drawn: s.drawn,
          summaries: s.summaries,
          budget: s.budget,
          finite: [v.x0, v.x1, v.y0, v.y1].every(Number.isFinite) && v.x1 > v.x0 && v.y1 > v.y0,
          layout: r.options.layout,
          rows: v.y1 - v.y0,
          areaH: r.area?.ah,
        };
        rec.extra = check ? check(rec, s, v) : true;
        out.steps.push(rec);
      } catch (e) {
        out.errors.push(name + ': ' + e.message);
      }
    };
    step('radial + cladogram', { layout: 'radial', branchLengths: false });
    step('rectangular + phylogram', { layout: 'rectangular', branchLengths: true });
    step(
      'lod off: every node is drawn, whatever the budget',
      { lod: false, drawBudget: 500 },
      (rec) => rec.drawn === t.base.nodeCount && rec.summaries === 0,
    );
    step('lod on, budget 20000', { lod: true, drawBudget: 20000 });
    step('no summaries', { showSummaries: false }, (rec) => rec.summaries === 0);
    step('summaries back', { showSummaries: true }, (rec) => rec.summaries > 0);
    step('no axis', { axis: false });
    step('row height 20 px', { rowHeight: 20 }, (rec) => Math.abs(rec.rows - r.size.height / 20) < 8);
    step('row height back to fit', { rowHeight: null }, (_rec, _s, v) => Math.abs(v.y1 - v.y0 - t.base.tipCount) < t.base.tipCount * 0.2);
    step('dense labels, minCladePx 6', { labelDensity: 'dense', minCladePx: 6 });
    step('radial, radialMaxNodes 300', { layout: 'radial', radialMaxNodes: 300 }, (rec) => rec.drawn <= 300);
    step('radial, interaction LOD off, dprCap 1', { interactionLOD: false, dprCap: 1 });
    step('alignStyle blocks', { alignStyle: 'blocks', alignRowGap: 2 });
    step('back to rectangular', { layout: 'rectangular' });
    // equal input does not redraw (settle first: a pending refine frame is not what is measured)
    r.renderNow();
    await sleep(200);
    const f0 = r.getStats().frames;
    r.setOptions({ layout: 'rectangular', branchLengths: true });
    r.setOptions({});
    r.setTheme({ ...r.theme, categorical: r.theme.categorical.slice() });
    r.setHighlighted([]);
    r.setHighlighted([t.base.tipLabels[3]]);
    await sleep(200);
    const f1 = r.getStats().frames;
    r.setHighlighted([t.base.tipLabels[3]]);
    r.setClades([]);
    await sleep(200);
    out.framesEqualInput = r.getStats().frames - f1;
    out.framesFirstHighlight = f1 - f0;
    return out;
  });
  ok(res.errors.length === 0, `setOptions combinations: no exception ${res.errors.join('; ')}`);
  for (const st of res.steps)
    ok(
      st.drawn > 0 && st.finite && st.extra,
      `setOptions ${st.name}: ${st.layout}, drawn ${st.drawn}, summaries ${st.summaries}${st.extra ? '' : ' (CHECK FAILED)'}`,
    );
  ok(res.framesEqualInput === 0, `equal highlight / clades after a settled frame: ${res.framesEqualInput} redraws`);
  ok(
    res.framesFirstHighlight === 1,
    `equal options / theme / empty highlight caused exactly the one redraw of the first highlight (${res.framesFirstHighlight})`,
  );
  await page.evaluate(() => window.__t.cleanup());
}

// ================================================================ mount / unmount, two instances
const counts = () =>
  page.evaluate(() => ({
    treeviews: document.querySelectorAll('[data-treeview]').length,
    canvases: document.querySelectorAll('canvas').length,
    nodes: document.getElementsByTagName('*').length,
  }));
const mountOpts = (layout, size) => ({ treeId: 'syn-yule-10000', newick: text, layout, branchLengths: true, size });
{
  const first = await page.evaluate(() => {
    const r = window.__customTree.handle().renderer();
    window.__keep = r;
    return { frames: r.getStats().frames };
  });
  const mounted = await counts();
  await page.evaluate(() => window.__spike.unmount());
  const empty = await counts();
  const gone = await page.evaluate(() => ({
    destroyed: window.__keep.destroyed,
    connected: window.__keep.root.isConnected,
    hook: typeof window.__customTree,
  }));
  ok(
    first.frames > 0 && mounted.treeviews === 1 && empty.treeviews === 0,
    `unmount removes the tree view (${mounted.treeviews} -> ${empty.treeviews})`,
  );
  ok(
    empty.canvases < mounted.canvases && gone.destroyed === true && gone.connected === false && gone.hook === 'undefined',
    `unmount destroys the renderer and its canvases (${mounted.canvases} -> ${empty.canvases} canvases, destroyed ${gone.destroyed}, hook ${gone.hook})`,
  );
  // cycles, back to back (what a strict-mode double mount does to the DOM) and a mount over a mount
  for (let k = 0; k < 4; k++) {
    await page.evaluate(
      async (o) => {
        await window.__spike.mount(o);
        await window.__spike.unmount();
      },
      mountOpts(k % 2 ? 'radial' : 'rectangular', { width: 800, height: 500 }),
    );
  }
  const afterCycles = await counts();
  ok(
    afterCycles.treeviews === 0 && afterCycles.canvases === empty.canvases && Math.abs(afterCycles.nodes - empty.nodes) <= 4,
    `4 mount / unmount cycles leave the DOM as it was: ${JSON.stringify(empty)} -> ${JSON.stringify(afterCycles)}`,
  );
  await page.evaluate(
    async (o) => {
      await window.__spike.mount(o);
      await window.__spike.mount(o);
    },
    mountOpts('rectangular', { width: 800, height: 500 }),
  );
  const twice = await counts();
  ok(
    twice.treeviews === 1 && twice.canvases === mounted.canvases,
    `a mount over a mount keeps one tree view (${twice.treeviews} views, ${twice.canvases} canvases, one instance had ${mounted.canvases})`,
  );

  // two instances at once, independent
  await page.evaluate((o) => window.__spike.mount(o), mountOpts('radial', { width: 640, height: 420 }));
  await page.evaluate((o) => window.__spike2.mount(o), mountOpts('rectangular', { width: 640, height: 420 }));
  const two = await counts();
  ok(two.treeviews === 2, `two instances: ${two.treeviews} tree views`);
  const at = (api) => page.evaluate((a) => window[a].locate({ kind: 'node', id: 'n1' }), api);
  const zoomOf = () => page.evaluate(async () => (await window.__spike2.getStats()).custom);
  const before0 = await at('__spike'),
    before1 = await at('__spike2'),
    z0 = await zoomOf();
  const views = await page.evaluate(() =>
    [...document.querySelectorAll('[data-treeview]')].map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }),
  );
  const f0 = (await stats()).frames;
  const v1 = views[1];
  await page.mouse.move(v1.x + v1.w * 0.4, v1.y + v1.h * 0.5);
  for (let j = 0; j < 6; j++) {
    await page.mouse.wheel(0, -120);
    await sleep(16);
  }
  await sleep(350);
  const after0 = await at('__spike'),
    after1 = await at('__spike2');
  ok(
    JSON.stringify(before0) === JSON.stringify(after0) && before0 !== null,
    `zooming instance 2 leaves instance 1 where it was (${JSON.stringify(before0)})`,
  );
  const z1 = await zoomOf();
  ok(
    z1.ky > z0.ky * 1.5 && z1.frames > z0.frames,
    `instance 2 did zoom: row height ${z0.ky.toFixed(3)} -> ${z1.ky.toFixed(3)} px, frames ${z0.frames} -> ${z1.frames} (node n1 ${JSON.stringify(before1)} -> ${JSON.stringify(after1)})`,
  );
  ok((await stats()).frames === f0, 'no frame was drawn in instance 1 meanwhile');
  const ev0 = await page.evaluate(async () => (await window.__spike.getEvents()).length);
  await page.mouse.click(v1.x + v1.w * 0.4, v1.y + v1.h * 0.5);
  await sleep(150);
  const ev = await page.evaluate(async () => [(await window.__spike.getEvents()).length, (await window.__spike2.getEvents()).length]);
  ok(ev[0] === ev0, `a click in instance 2 emits no event in instance 1 (${ev0} -> ${ev[0]}; instance 2 has ${ev[1]})`);
  await page.evaluate(() => window.__spike2.unmount());
  const one = await counts();
  await page.mouse.move(views[0].x + views[0].w * 0.5, views[0].y + views[0].h * 0.5);
  await page.mouse.wheel(0, -120);
  await sleep(300);
  ok(
    one.treeviews === 1 && (await stats()).frames > f0,
    `unmounting instance 2 leaves instance 1 alive and drawing (${one.treeviews} view, frames ${f0} -> ${(await stats()).frames})`,
  );
  await page.evaluate(() => window.__spike.unmount());
  const end = await counts();
  ok(end.treeviews === 0 && end.canvases === empty.canvases, `both unmounted: ${JSON.stringify(end)}`);
}

await browser.close();
console.log(failures ? `FAILED (${failures})` : 'OK');
process.exit(failures ? 1 : 0);
