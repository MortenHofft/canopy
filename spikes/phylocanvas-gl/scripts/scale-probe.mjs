// Scale probe for the Phylocanvas.gl demo: splits what the runner's S1 lumps together.
//   * JS (main-thread) costs, valid on any machine: mount phases, setProps for a view change, style change (clade colour),
//     hover highlight, own CPU hit-test, heap.
//   * GPU frame cost, valid ONLY for software GL (SwiftShader) here: redraw + readPixels with the scene versus with no layers
//     (the empty frame is a fixed floor that depends on canvas pixels, not on the tree).
//   * A Canvas2D reference of the same scene (scripts/canvas2d-ref.html, CPU raster): per-frame JS draw time with and without
//     culling, to put the software-GL numbers in context.
// Usage: node scripts/scale-probe.mjs <baseUrl> <out.json> <treeSpec>...   treeSpec = catalogue id or file:<path-to-nwk>:<id>
// Needs the production build served at baseUrl (npm run preview -- --port 5204) and playwright-core from spikes/node_modules.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../node_modules/playwright-core/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [baseUrl, outFile, ...specs] = process.argv.slice(2);
if (!baseUrl || !outFile || !specs.length) throw new Error('usage: scale-probe.mjs <baseUrl> <out.json> <treeSpec>...');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ARGS = ['--enable-precise-memory-info', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-gpu-rasterization', '--js-flags=--expose-gc'];
const SIZE = { width: 760, height: 560 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

async function loadNewick(page, spec) {
  if (spec.startsWith('file:')) {
    const [, file, id] = spec.split(':');
    return { id, newick: fs.readFileSync(file, 'utf8') };
  }
  const t = await page.evaluate(async (id) => ({ id, newick: (await window.__spikeData.loadTree(id)).newick }), spec);
  return t;
}

async function probeCandidate(browser, spec) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route((u) => u.hostname !== '127.0.0.1' && u.hostname !== 'localhost', (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.goto(baseUrl + '?x=1');
  await page.waitForFunction(() => !!window.__spike && !!window.__spikeData, null, { timeout: 30000 });
  const { id, newick } = await loadNewick(page, spec);
  const t0 = Date.now();
  const mount = await page.evaluate(async ([id, nw, size]) => window.__spike.mount({ treeId: id, newick: nw, layout: 'rectangular', branchLengths: true, size }), [id, newick, SIZE]);
  const out = { tree: id, tips: mount.tips, mount: { parseMs: mount.parseMs, firstRenderMs: mount.firstRenderMs, sharedParseMs: mount.sharedParseMs, wallMs: Date.now() - t0, notes: mount.notes } };
  await sleep(800);
  out.js = await page.evaluate(async () => {
    const lib = window.__phylocanvas[0];
    const hit = window.__phylocanvasHit[0];
    const gl = lib.deck.animationLoop.gl;
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // median of individual timings: one stall from another process on this shared machine must not move the number
    const avg = (n, fn) => { const ts = []; for (let i = 0; i < n; i++) { const t = performance.now(); fn(i); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[Math.floor(ts.length / 2)]; };
    const minOf = (n, fn) => { let m = Infinity; for (let i = 0; i < n; i++) { const t = performance.now(); fn(i); m = Math.min(m, performance.now() - t); } return m; };
    const o = {};
    // view change (pure JS: layout memo, layer objects, deck.setProps; the GPU work is queued, not waited for)
    o.setPropsZoomMs = avg(10, (i) => lib.setProps({ zoom: 0.03 * (i + 1) }));
    lib.setProps({ zoom: 0 });
    o.setStepZoomMs = avg(10, (i) => lib.setProps({ stepZoom: 0.05 * (i + 1) }));
    lib.setProps({ stepZoom: 0 });
    // clade colour: ~10% clade, styles for every tip below it
    const g = lib.getGraphAfterLayout();
    const pre = g.preorderTraversal;
    let best = null;
    for (const n of pre) if (!n.isLeaf && n !== g.root && (!best || Math.abs(n.totalLeaves - g.root.totalLeaves * 0.1) < Math.abs(best.totalLeaves - g.root.totalLeaves * 0.1))) best = n;
    const makeStyles = (c) => { const s = {}; for (let i = best.preIndex; i < best.preIndex + best.totalNodes; i++) if (pre[i].isLeaf) s[pre[i].id] = { fillColour: c, strokeColour: c }; return s; };
    const st1 = makeStyles('#ff0000'), st2 = makeStyles('#0000ff');
    o.cladeTips = best.totalLeaves;
    const sc = (a) => a.slice();
    o.restyleCladeMs = avg(4, (i) => lib.setProps({ styles: i % 2 ? st2 : st1, strokeColour: [65, 62, 62, 255].slice() }));
    lib.setProps({ styles: {}, strokeColour: [65, 62, 62, 255] });
    // hover highlight of the clade (library path: highlightedId recolours every edge of the subtree)
    o.highlightMs = avg(6, (i) => lib.highlightNode(i % 2 ? best : null));
    lib.highlightNode(null);
    // own CPU hit-test: pointer over a branch near the middle of the canvas
    o.hitTestMs = avg(20, (i) => hit(300 + i * 3, 280));
    o.hitTestTipMs = avg(20, (i) => hit(700, 20 + i * 20));
    // GPU frame cost in software GL: with the scene, and with no layers (floor)
    sync();
    lib.setProps({});
    await new Promise((r) => setTimeout(r, 2500)); // let queued GPU work drain before timing frames
    const frame = (n) => minOf(n, () => { lib.deck.redraw(true); sync(); });
    frame(3);
    o.sceneFrameMs = frame(5);
    const layers = lib.deck.props.layers;
    lib.deck.setProps({ layers: [] });
    frame(3);
    o.emptyFrameMs = frame(5);
    lib.deck.setProps({ layers });
    lib.setProps({});
    if (performance.memory) { gc(); o.heapMB = performance.memory.usedJSHeapSize / 1e6; }
    return o;
  });
  await page.close();
  await ctx.close();
  out.errors = errors;
  return out;
}

async function probeCanvas2d(browser, spec, newick) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(baseUrl + 'ref2d.html');
  const load = await page.evaluate((nw) => window.ref.load(nw), newick);
  const out = { tree: spec, load };
  const best = (cull, zoom) => page.evaluate(([cull, zoom]) => { const r = window.ref; r.fit(); if (zoom) r.zoomRows(zoom, 280); r.frame(cull); let m = Infinity; for (let i = 0; i < 7; i++) m = Math.min(m, r.frame(cull)); r.fit(); return m; }, [cull, zoom]);
  out.frameFitNoCullMs = await best(false, 0); // best of 7
  out.frameFitCullMs = await best(true, 0);
  out.frameZoomed20xCullMs = await best(true, 20);
  // scripted wheel + drag for 10 s with the rAF sampler, like the runner's S1 (culling on, redraw once per animation frame)
  await page.evaluate(() => window.ref.fit());
  const cv = await page.evaluate(() => { const r = document.getElementById('c').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.evaluate(() => window.sampler.start());
  const t0 = Date.now();
  let k = 0;
  while (Date.now() - t0 < 10000) {
    const phase = k++ % 4;
    const x = cv.x + cv.w * 0.4 + (k % 3) * 40, y = cv.y + cv.h * 0.5 + (k % 5) * 20;
    await page.mouse.move(x, y);
    if (phase === 0 || phase === 2) for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, phase === 0 ? -120 : 120); await sleep(16); }
    else { const s = phase === 1 ? -1 : 1; await page.mouse.down(); await page.mouse.move(x + s * 160, y + s * 70, { steps: 10 }); await page.mouse.up(); }
  }
  out.scripted10s = await page.evaluate(() => window.sampler.stop());
  await ctx.close();
  return out;
}

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ARGS });
const version = browser.version();
fs.copyFileSync(path.join(here, 'canvas2d-ref.html'), path.join(here, '..', 'dist', 'ref2d.html'));
for (const spec of specs) {
  const row = { spec };
  try {
    row.phylocanvas = await probeCandidate(browser, spec);
  } catch (e) {
    row.phylocanvas = { error: String(e.message).split('\n')[0] };
  }
  try {
    const tmp = await browser.newContext();
    const pg = await tmp.newPage();
    await pg.goto(baseUrl + '?x=1');
    await pg.waitForFunction(() => !!window.__spikeData, null, { timeout: 30000 });
    const { newick } = await loadNewick(pg, spec);
    await tmp.close();
    row.canvas2d = await probeCanvas2d(browser, spec, newick);
  } catch (e) {
    row.canvas2d = { error: String(e.message).split('\n')[0] };
  }
  results.push(row);
  console.log(JSON.stringify(row));
}
await browser.close();
fs.writeFileSync(outFile, JSON.stringify({ date: new Date().toISOString(), chromium: version, args: ARGS, canvas: SIZE, loadAvg: (await import('node:os')).loadavg(), results }, null, 1));
