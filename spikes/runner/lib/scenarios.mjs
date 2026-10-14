// Scenarios S1 to S15 (docs/spike-plan.md). Candidate-agnostic: only window.__spike, real mouse/keyboard input,
// screenshots and the React panels of the shell are used. Ground truth comes from shared/newick.ts on the files.
import { sleep, median, pearson, spearman, withTimeout, TimeoutError, fmt } from './util.mjs';
import { countNear, hexToRgb, meanLuminance, dominant, inkFraction, colourBuckets, diffCount } from './pixels.mjs';
import { truthTree, truthColumns, getEntry, catalogue } from './truth.mjs';

export const THRESHOLDS = { loadMs: 10000, p5Fps: 20, clickMs: 300, linkedMs: 120 };
const RED = '#ff0000';
const BLUE = '#0000ff';

// ------------------------------------------------------------------------------------------ helpers

class Checks {
  constructor() {
    this.list = [];
  }
  add(name, ok, detail = '') {
    this.list.push({ name, ok: !!ok, detail: String(detail) });
    return !!ok;
  }
  get failed() {
    return this.list.filter((c) => !c.ok);
  }
  get allOk() {
    return this.failed.length === 0;
  }
  reason(prefix = '') {
    const f = this.failed;
    return f.length ? prefix + f.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ') : prefix + 'all checks passed';
  }
}

const result = (status, reason, extra = {}) => ({ status, reason, ...extra });
const unsupported = (caps, key, extra = {}) => (caps[key]?.level === 'no' ? result('unsupported', `adapter reports ${key}=no: ${caps[key].how}`, extra) : null);
const worst = (rs) => {
  const order = ['fail', 'timeout', 'partial', 'pass'];
  for (const s of order) if (rs.some((r) => r.status === s)) return s;
  return 'unsupported';
};
const rectsIntersect = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const centre = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** n deterministic, spread-out tip labels. */
function pickTips(t, n, offset = 0.37) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(t.tipLabels[Math.min(t.tipCount - 1, Math.floor(((k + offset) / n) * t.tipCount))]);
  return [...new Set(out)];
}

/** Internal nodes whose clade size is closest to fraction*tips, pairwise unrelated (no ancestor relation). */
function pickClades(t, fractions, { minTips = 3, exclude = [] } = {}) {
  const n = t.tipCount;
  const chosen = [];
  const related = (a, b) => t.contains(a, b) || t.contains(b, a);
  for (const f of fractions) {
    const target = Math.max(minTips, f * n);
    let best = -1, bestScore = Infinity;
    for (let i = 1; i < t.nodeCount; i++) {
      if (t.childCount[i] === 0) continue;
      const size = t.leafEnd[i] - t.leafStart[i];
      if (size < minTips || size >= n) continue;
      const score = Math.abs(Math.log(size / target)) + t.depth[i] * 1e-4;
      if (score >= bestScore) continue;
      if (chosen.some((c) => related(c, i)) || exclude.some((c) => related(c, i))) continue;
      best = i;
      bestScore = score;
    }
    if (best >= 0) chosen.push(best);
  }
  return chosen;
}

async function colourFrac(s, rect, hex, tol = 100) {
  const sh = await s.shot(rect);
  if (!sh) return { frac: NaN, count: 0, total: 0 };
  return countNear(sh.png, hexToRgb(hex), tol);
}

async function mountOrThrow(s, entry, o = {}) {
  const r = await s.mount(entry, o);
  if (r.tips !== entry.tips) throw new Error(`mount reported ${r.tips} tips, expected ${entry.tips}`);
  await s.settle(150);
  return r;
}

/** Make a tip visible and clickable the way a user (or the occurrence page) would. */
async function bringTipIntoView(s, tipId, caps, i = 0) {
  const f = s.inst(i);
  if (caps.focusTip?.level !== 'no') {
    await f('focusTip', tipId);
    return s.settleLocate({ kind: 'tip', id: tipId }, i);
  }
  return f('locate', { kind: 'tip', id: tipId });
}

async function zoomPan(s, rect, notches = 8) {
  const c = centre(rect);
  await s.page.mouse.move(c.x, c.y);
  for (let k = 0; k < notches; k++) {
    await s.page.mouse.wheel(0, -120);
    await sleep(30);
  }
  await s.page.mouse.move(c.x, c.y);
  await s.page.mouse.down();
  await s.page.mouse.move(c.x - 40, c.y + 90, { steps: 6 });
  await s.page.mouse.up();
  await s.settle(250);
}

const heapMB = (s) => s.metrics(() => window.__spikeMetrics.heap(true)?.usedMB ?? null);
const inputMarks = (s) => s.metrics(() => ({ ...window.__spikeMetrics.input }));

// ------------------------------------------------------------------------------------------ reusable checks

/** S2: click tips, check event, React state and metadata row. */
async function checkTipClick(s, entry, t, caps, { layout = 'rectangular' } = {}) {
  const ck = new Checks();
  const m = {};
  const lc = truthColumns(entry, t);
  const withRow = pickTips(t, 3).filter((x) => x in lc.rowByTip);
  const tips = withRow.length ? withRow : pickTips(t, 3);
  const unmatched = lc.tsvStats?.tipsWithoutRow?.[0];
  if (unmatched) tips.push(unmatched);
  m.focusNeeded = false;
  let hits = 0;
  for (const tip of tips) {
    const nodeId = t.tipNodeId(tip);
    const p = await bringTipIntoView(s, tip, caps);
    if (!p) {
      ck.add(`tip ${tip} locatable`, false, 'locate returned null');
      continue;
    }
    const ev = await s.clickAndWait(p);
    const click = ev.find((e) => e.type === 'tipClick');
    const ok1 = ck.add(`tipClick event for ${tip}`, !!click && click.nodeId === nodeId && click.isTip, click ? `got ${click.type} ${click.nodeId}` : `no tipClick; events: ${ev.map((e) => e.type + ':' + e.nodeId).join(',') || 'none'}`);
    if (!click) continue;
    ck.add(`tipIds=[tip] for ${tip}`, click.tipIds.length === 1 && click.tipIds[0] === tip, JSON.stringify(click.tipIds.slice(0, 3)));
    const st = await s.reactState();
    ck.add(`React last-event shows tip ${tip}`, st.lastEvent?.type === 'tipClick' && st.lastEvent?.nodeId === nodeId, st.lastEvent?.text);
    ck.add(`React map-panel count 1`, st.mapCount === 1, `count=${st.mapCount}`);
    if (lc.columns.length && tip !== unmatched) ck.add(`metadata row shown for ${tip}`, st.tipMeta?.matched === 'true' && st.tipMeta.text.includes(tip), st.tipMeta?.text?.slice(0, 80));
    if (tip === unmatched) ck.add(`unmatched tip ${tip} reported as UNMATCHED`, st.tipMeta?.matched === 'false', st.tipMeta?.text?.slice(0, 80));
    if (ok1) hits++;
  }
  // hover (informational)
  if (caps.hover?.level !== 'no' && tips.length) {
    const p = await s.call('locate', { kind: 'tip', id: tips[0] });
    if (p) {
      await s.call('clearEvents');
      await s.page.mouse.move(p.x + 40, p.y + 40);
      await s.page.mouse.move(p.x, p.y, { steps: 4 });
      await sleep(150);
      const ev = await s.events();
      m.hoverEvent = ev.some((e) => e.type === 'tipHover' || e.type === 'nodeHover');
    }
  }
  m.tipsTried = tips.length;
  m.tipsOk = hits;
  const sources = new Set();
  return { ck, measures: m, sources };
}

/** S3: click internal nodes, compare tip sets with ground truth. */
async function checkNodeClick(s, entry, t, caps) {
  const ck = new Checks();
  const m = { nodes: [] };
  const clades = pickClades(t, [0.5, 0.25, 0.12, 0.06], { minTips: 4 });
  const sources = new Set();
  let ok = 0;
  for (const i of clades) {
    const nodeId = t.nodeId(i);
    const truth = t.descendantTips(i);
    let p = await s.settleLocate({ kind: 'node', id: nodeId }, 0, 600);
    if (!p) {
      // clade centre not in view: zoom to a tip below it, then look again
      await bringTipIntoView(s, truth[0], caps);
      p = await s.settleLocate({ kind: 'node', id: nodeId }, 0, 600);
    }
    if (!p) {
      ck.add(`node ${nodeId} (${truth.length} tips) locatable`, false, 'locate returned null');
      continue;
    }
    const ev = await s.clickAndWait(p);
    const click = ev.find((e) => e.type === 'nodeClick' || e.type === 'branchClick');
    if (!click) {
      ck.add(`node click event for ${nodeId}`, false, `events: ${ev.map((e) => e.type + ':' + e.nodeId).join(',') || 'none'}`);
      continue;
    }
    sources.add(click.source);
    const sameNode = click.nodeId === nodeId;
    const got = new Set(click.tipIds);
    const setOk = got.size === truth.length && truth.every((x) => got.has(x));
    const st = await s.reactState();
    const reactOk = st.lastEvent?.nodeId === click.nodeId && st.mapCount === truth.length;
    const good = ck.add(`node ${nodeId} (${truth.length} tips): event on right node`, sameNode, `got ${click.nodeId}`) & ck.add(`node ${nodeId}: tip set equals ground truth`, setOk, `got ${click.tipIds.length}, want ${truth.length}`) & ck.add(`node ${nodeId}: React map-panel shows ${truth.length}`, reactOk, `last=${st.lastEvent?.text} map=${st.mapCount}`);
    m.nodes.push({ nodeId, tips: truth.length, hit: sameNode, setOk, source: click.source });
    if (good) ok++;
  }
  ck.add('at least 3 nodes tested', m.nodes.length >= 3, `tested ${m.nodes.length}`);
  m.nodesOk = ok;
  m.sources = [...sources];
  // branch click (informational, rectangular only): midpoint of the horizontal piece of a branch
  if (caps.branchClick?.level !== 'no' && clades.length) {
    try {
      const i = clades[0];
      await s.call('focusTip', t.labels[t.tipNode[t.leafStart[i]]]).catch(() => {});
      const pn = await s.settleLocate({ kind: 'node', id: t.nodeId(i) }, 0, 600);
      const pp = await s.call('locate', { kind: 'node', id: t.nodeId(t.parent[i]) });
      if (pn && pp && pn.x - pp.x > 12) {
        const ev = await s.clickAndWait({ x: (pn.x + pp.x) / 2 + 3, y: pn.y });
        const e = ev.find((x) => x.type === 'branchClick' || x.type === 'nodeClick');
        m.branchClick = e ? `${e.type}:${e.nodeId === t.nodeId(i) ? 'right node' : 'other node ' + e.nodeId}` : 'no event';
      }
    } catch (e) {
      m.branchClick = 'error: ' + e.message;
    }
  }
  return { ck, measures: m, sources };
}

/** S4: colour clades from React state, check pixels, layout stability, clear. */
async function checkColour(s, entry, t, caps, screenLabel, saveShot) {
  const ck = new Checks();
  const m = {};
  const [a, b] = pickClades(t, [0.2, 0.15], { minTips: 8 });
  if (a === undefined) return { ck: Object.assign(ck, { list: [{ name: 'found a clade to colour', ok: false, detail: 'tree too small' }] }), measures: m };
  const A = t.nodeId(a);
  const B = b !== undefined ? t.nodeId(b) : null;
  const probe = pickTips(t, 3);
  const pos = async () => Promise.all(probe.map((id) => s.call('locate', { kind: 'tip', id })));
  const bA = await s.call('bounds', { kind: 'node', id: A });
  const bB = B ? await s.call('bounds', { kind: 'node', id: B }) : null;
  if (!bA) {
    ck.add('bounds(clade A) available', false, 'bounds returned null (not visible?)');
    return { ck, measures: m };
  }
  const useB = bB && !rectsIntersect(bA, bB);
  m.cladeTips = t.tipCountOf(a);
  const L0 = await pos();
  const dom0 = (await s.call('getStats')).domNodes;
  const f = async (r, hex) => (await colourFrac(s, r, hex)).frac;
  const aRed0 = await f(bA, RED);
  const bRed0 = useB ? await f(bB, RED) : 0;
  const bBlue0 = useB ? await f(bB, BLUE) : 0;
  const aBlue0 = await f(bA, BLUE);

  await s.call('setColouredClades', [{ nodeId: A, colour: RED }]);
  await s.settle(200);
  const aRed1 = await f(bA, RED);
  const bRed1 = useB ? await f(bB, RED) : 0;
  const dRed = aRed1 - aRed0;
  m.redFrac = { before: aRed0, after: aRed1, controlBefore: bRed0, controlAfter: bRed1 };
  ck.add('clade A turns red (pixel fraction rises)', dRed >= 0.002, `fraction ${fmt(aRed0 * 100, 2)}% -> ${fmt(aRed1 * 100, 2)}%`);
  if (useB) ck.add('other clade unchanged (control)', bRed1 - bRed0 <= Math.max(0.001, 0.25 * dRed), `${fmt(bRed0 * 100, 2)}% -> ${fmt(bRed1 * 100, 2)}%`);
  let st = await s.reactState();
  ck.add('React clades panel lists A', st.clades?.length === 1 && st.clades[0].nodeId === A && st.clades[0].colour.toLowerCase() === RED, JSON.stringify(st.clades));
  const L1 = await pos();
  const moved = L0.some((p, k) => !p || !L1[k] || Math.hypot(p.x - L1[k].x, p.y - L1[k].y) > 1);
  ck.add('no layout change when colouring', !moved);
  m.domNodesDelta = (await s.call('getStats')).domNodes - dom0;

  if (useB) {
    await s.call('setColouredClades', [{ nodeId: A, colour: RED }, { nodeId: B, colour: BLUE }]);
    await s.settle(200);
    const aRed2 = await f(bA, RED);
    const bBlue2 = await f(bB, BLUE);
    ck.add('two clades, two colours (A red kept, B blue appears)', aRed2 - aRed0 >= 0.5 * dRed && bBlue2 - bBlue0 >= 0.002, `A red ${fmt(aRed2 * 100, 2)}%, B blue ${fmt(bBlue2 * 100, 2)}%`);
    if (screenLabel && saveShot) {
      const c = await s.containerRect();
      const sh = await s.shot(c);
      if (sh) saveShot(screenLabel, sh.buf);
    }
  }
  await s.call('setColouredClades', []);
  await s.settle(200);
  const aRed3 = await f(bA, RED);
  const bBlue3 = useB ? await f(bB, BLUE) : 0;
  ck.add('clear restores the original colours', aRed3 <= aRed0 + 0.0008 && bBlue3 <= bBlue0 + 0.0008 && (await f(bA, BLUE)) <= aBlue0 + 0.0008, `A red ${fmt(aRed3 * 100, 2)}% (was ${fmt(aRed0 * 100, 2)}%)`);
  st = await s.reactState();
  ck.add('React clades panel empty after clear', st.clades?.length === 0, JSON.stringify(st.clades));
  const L2 = await pos();
  ck.add('no layout change after clear', !L0.some((p, k) => !p || !L2[k] || Math.hypot(p.x - L2[k].x, p.y - L2[k].y) > 1));
  return { ck, measures: m };
}

/** S7/S8: aligned column cells versus tip positions, before and after real zoom and pan. */
async function checkColumn(s, t, cols, col, caps, { minCells = 8, tol = 2 } = {}) {
  const ck = new Checks();
  const m = {};
  await s.page.evaluate((c) => window.__spike.setColumns(c), cols);
  await s.settle(250);
  const ids = Object.keys(col.values);
  const step = Math.max(1, Math.floor(ids.length / 300));
  const sample = ids.filter((_, k) => k % step === 0).slice(0, 300);
  const scan = () =>
    s.page.evaluate(
      async ({ sample, colId }) => {
        const out = [];
        for (const id of sample) {
          const p = await window.__spike.locate({ kind: 'tip', id });
          if (!p) continue;
          const c = await window.__spike.locateCell(colId, id);
          out.push({ id, p, c });
        }
        return out;
      },
      { sample, colId: col.id },
    );
  const evalAlign = (rows, label) => {
    const withCell = rows.filter((r) => r.c);
    const dys = withCell.map((r) => Math.abs(r.c.y + r.c.height / 2 - r.p.y));
    const good = dys.filter((d) => d <= tol).length;
    ck.add(`${label}: at least ${minCells} tips with a drawn cell`, withCell.length >= minCells, `${withCell.length} of ${rows.length} visible tips have a cell`);
    ck.add(`${label}: cell centre within ${tol}px of tip row`, withCell.length > 0 && good / withCell.length >= 0.9, `${good}/${withCell.length} aligned, max dy ${fmt(Math.max(0, ...dys), 1)}px`);
    m[label] = { visibleTips: rows.length, cells: withCell.length, aligned: good, maxDy: Math.max(0, ...dys) };
    return withCell;
  };
  const before = evalAlign(await scan(), 'fit view');
  const rect = await s.containerRect();
  await zoomPan(s, rect);
  const rowsAfter = await scan();
  const after = evalAlign(rowsAfter, 'after zoom and pan');
  // bar widths follow values
  if (col.kind === 'bar') {
    const pts = after.filter((r) => r.c).map((r) => [Number(col.values[r.id]), r.c.width]);
    if (pts.length >= 8) {
      const rho = spearman(pts.map((p) => p[0]), pts.map((p) => p[1]));
      m.barRankCorrelation = rho;
      ck.add('bar width increases with value (Spearman >= 0.7)', rho >= 0.7, `rho=${fmt(rho, 2)}`);
    }
  }
  // drawn: pixels in the cell differ between columns on and off
  const pick = after.filter((r) => r.c && r.c.height >= 3 && r.c.width >= 3).sort((p, q) => q.c.width - p.c.width)[0] ?? after.filter((r) => r.c && r.c.height >= 1)[0];
  if (pick) {
    const r = { x: pick.c.x, y: pick.c.y - 1, width: Math.min(pick.c.width, 320), height: Math.max(pick.c.height, 3) + 2 };
    const on = await s.shot(r);
    await s.page.evaluate(() => window.__spike.setColumns([]));
    await s.settle(200);
    const off = await s.shot(r);
    await s.page.evaluate((c) => window.__spike.setColumns(c), cols);
    await s.settle(250);
    if (on && off) {
      const frac = diffCount(on.png, off.png, 20) / (on.png.width * on.png.height);
      m.cellDrawnFraction = frac;
      ck.add('cell is actually painted (pixels change when the column is removed)', frac >= 0.2, `${fmt(frac * 100, 0)}% of the cell rect changes`);
      if (col.kind === 'alignment') ck.add('alignment cell shows several residue colours', colourBuckets(on.png, 0.02) >= 3, `${colourBuckets(on.png, 0.02)} colour groups`);
    }
  }
  if (col.kind === 'bar') {
    const missing = Object.keys(col.values).length < t.tipCount;
    if (missing) m.unmatchedNote = 'tips without a value draw no cell (locateCell should return null); checked in unit of S7 notes only';
  }
  return { ck, measures: m };
}

// ------------------------------------------------------------------------------------------ S1 scale phase

export async function scalePhase(s, entry, partial, shots) {
  const t = truthTree(entry);
  const caps = await s.call('getCapabilities');
  partial.phase = 'mount';
  const r = await s.mount(entry, {});
  Object.assign(partial, { fetchMs: r.fetchMs, convertMs: r.convertMs, wireBytes: r.wireBytes, parseMs: r.parseMs, firstRenderMs: r.firstRenderMs, sharedParseMs: r.sharedParseMs, reportedTips: r.tips, notes: r.notes });
  partial.loadMs = r.parseMs + r.firstRenderMs;
  if (r.tips !== entry.tips) {
    partial.status = 'fail';
    partial.reason = `library reports ${r.tips} tips, expected ${entry.tips}`;
    return;
  }
  await s.settle(300);
  const rect = await s.containerRect();
  const sh = await s.shot(rect);
  partial.ink = sh ? inkFraction(sh.png) : null;
  if (shots && sh) shots(`S1-${entry.id}`, sh.buf);
  partial.heapAfterMountMB = await heapMB(s);
  if (!(partial.ink > 0.0005)) {
    partial.status = 'fail';
    partial.reason = `screenshot after mount is blank (ink ${fmt((partial.ink ?? 0) * 100, 3)}%)`;
    return;
  }
  const stats = await s.call('getStats');
  partial.stats = stats;
  if (partial.loadMs > 60000) {
    partial.status = 'timeout';
    partial.reason = `load ${fmt(partial.loadMs / 1000, 1)} s > ${THRESHOLDS.loadMs / 1000} s; interaction measures skipped`;
    return;
  }

  // click latency at the fit view (internal nodes near the root are large targets even for 100k tips)
  partial.phase = 'click latency';
  const lat = [];
  const paint = [];
  const clades = pickClades(t, [0.3, 0.15, 0.08, 0.04, 0.02], { minTips: 2 });
  let hits = 0, tries = 0;
  for (const i of clades) {
    const p = await s.call('locate', { kind: 'node', id: t.nodeId(i) });
    if (!p) continue;
    tries++;
    const ev = await s.clickAndWait(p, 0, 4000);
    const c = ev.find((e) => e.type.endsWith('Click'));
    if (!c) continue;
    if (c.nodeId === t.nodeId(i)) hits++;
    await sleep(150);
    const im = await inputMarks(s);
    lat.push(Math.max(0, im.lastEvent - im.pointerDown));
    paint.push(Math.max(0, im.lastEventPaint - im.pointerDown));
  }
  partial.clickLatencyMs = lat.length ? median(lat) : null;
  partial.clickToPaintMs = paint.length ? median(paint) : null;
  partial.clickSamples = { events: lat.length, tries, rightNode: hits };

  // 10 s of scripted wheel zoom and drag pan with the frame sampler
  partial.phase = 'pan/zoom';
  const fps = await scriptedPanZoom(s, rect, 10000);
  Object.assign(partial, { fpsMedian: fps.medianFps, fpsP5: fps.p5Fps, fpsP95: fps.p95Fps, fpsMean: fps.meanFps, droppedFrames: fps.droppedFrames, maxFrameGapMs: fps.maxIntervalMs, frames: fps.frames });
  partial.heapAfterInteractionMB = await heapMB(s);
  partial.heapMB = partial.heapAfterInteractionMB ?? partial.heapAfterMountMB;
  partial.phase = 'done';

  const bad = [];
  if (partial.loadMs > THRESHOLDS.loadMs) bad.push(`load ${fmt(partial.loadMs / 1000, 1)} s > ${THRESHOLDS.loadMs / 1000} s`);
  if (Math.round(fps.p5Fps) < THRESHOLDS.p5Fps) bad.push(`p5 fps ${fmt(fps.p5Fps, 1)} < ${THRESHOLDS.p5Fps}`);
  if (partial.clickLatencyMs !== null && partial.clickLatencyMs > THRESHOLDS.clickMs) bad.push(`click latency ${fmt(partial.clickLatencyMs)} ms > ${THRESHOLDS.clickMs} ms`);
  if (bad.length) {
    partial.status = 'timeout';
    partial.reason = 'unusable: ' + bad.join('; ');
  } else if (lat.length === 0 && caps.internalNodeClick?.level !== 'no') {
    partial.status = 'partial';
    partial.reason = 'rendered and smooth, but no click event could be triggered on internal nodes at the fit view';
  } else {
    partial.status = 'pass';
    partial.reason = `load ${fmt(partial.loadMs)} ms, p5 ${fmt(fps.p5Fps, 1)} fps, click ${partial.clickLatencyMs === null ? 'n/a' : fmt(partial.clickLatencyMs) + ' ms'}`;
  }
}

/** Real wheel and drag for `ms`, with the page's rAF sampler running. */
async function scriptedPanZoom(s, rect, ms) {
  const cx = rect.x + rect.width * 0.4;
  const cy = rect.y + rect.height * 0.5;
  await s.metrics(() => window.__spikeMetrics.startSampler());
  const t0 = Date.now();
  const hardStop = t0 + ms + 60000;
  let k = 0;
  try {
    while (Date.now() - t0 < ms && Date.now() < hardStop) {
      const phase = k++ % 4;
      const x = cx + (k % 3) * 40, y = cy + (k % 5) * 20;
      await s.page.mouse.move(x, y);
      if (phase === 0 || phase === 2) {
        const dir = phase === 0 ? -120 : 120;
        for (let i = 0; i < 6 && Date.now() - t0 < ms; i++) {
          await s.page.mouse.wheel(0, dir);
          await sleep(16);
        }
      } else {
        const sign = phase === 1 ? -1 : 1;
        await s.page.mouse.down();
        await s.page.mouse.move(x + sign * 160, y + sign * 70, { steps: 10 });
        await s.page.mouse.up();
      }
    }
  } finally {
    // fallthrough: stop even if the page is slow
  }
  return s.metrics(() => window.__spikeMetrics.stopSampler());
}

// ------------------------------------------------------------------------------------------ scenarios

export const SCENARIO_TITLES = {
  S1: 'Load and fit to screen (scale ladder)',
  S2: 'Click a tip',
  S3: 'Click an internal node',
  S4: 'Colour clades from React state',
  S5: 'Highlight and focus a tip',
  S6: 'Tip label as a link',
  S7: 'Custom column (bar) aligned to tips',
  S8: 'Alignment column',
  S9: 'Theming (dark, tokens)',
  S10: 'Zoom out to the whole tree',
  S11: 'Phylogram / cladogram',
  S12: 'Radial layout',
  S13: 'Two instances, mount/unmount x5',
  S14: 'Keyboard and screen reader',
  S15: 'Linked view (click clade, colour, map panel)',
};

const FUNCTIONAL = 'syn-yule-1000';
const timeouts = { default: 150000 };

export function makeScenarios(ctx) {
  const { browser, opts, saveShot, log } = ctx;
  const fid = opts.functionalTree || FUNCTIONAL;
  const session = (name, fn, ms = timeouts.default) => browser.withSession(name, fn, ms);
  const capsOf = (s) => s.call('getCapabilities');

  const S = {};

  // -------------------------------------------------------------------- S1
  S.S1 = async () => {
    const trees = opts.scaleTrees;
    const out = { trees: {} };
    let first = true;
    for (const entry of trees) {
      const partial = { treeId: entry.id, tips: entry.tips, status: 'fail', reason: 'not run' };
      const t0 = Date.now();
      try {
        await session(
          `S1 ${entry.id}`,
          async (s) => {
            try {
              await scalePhase(s, entry, partial, (label, buf) => {
                if (first) {
                  saveShot(label, buf);
                  first = false;
                }
              });
            } finally {
              partial.pageErrors = (await s.pageErrors()).slice(0, 5);
            }
          },
          240000,
        );
      } catch (e) {
        if (e instanceof TimeoutError) {
          partial.status = 'timeout';
          partial.reason = `${partial.phase ?? 'start'}: ${e.message}${partial.loadMs ? '' : ' (mount never finished)'}`;
        } else {
          partial.status = 'fail';
          partial.reason = `${partial.phase ?? 'start'}: ${e.message.split('\n')[0]}`;
        }
      }
      partial.wallSec = (Date.now() - t0) / 1000;
      log(`  S1 ${entry.id} (${entry.tips}): ${partial.status}: ${partial.reason}`);
      out.trees[entry.id] = partial;
    }
    const rs = Object.values(out.trees);
    if (!rs.length) return result('fail', 'no trees selected');
    if (rs.every((r) => r.status === 'pass')) out.status = 'pass', out.reason = `${rs.length} trees loaded, rendered and interactive`;
    else if (rs.some((r) => r.status === 'pass')) {
      out.status = 'partial';
      out.reason = rs.filter((r) => r.status !== 'pass').map((r) => `${r.treeId}: ${r.status} (${r.reason})`).join('; ');
    } else {
      out.status = worst(rs);
      out.reason = rs.map((r) => `${r.treeId}: ${r.status} (${r.reason})`).join('; ');
    }
    return out;
  };

  // -------------------------------------------------------------------- S2
  S.S2 = () =>
    session('S2', async (s) => {
      const entry = getEntry(fid);
      const t = truthTree(entry);
      const caps = await capsOf(s);
      const u = unsupported(caps, 'tipClick');
      if (u) return u;
      await mountOrThrow(s, entry);
      const { ck, measures } = await checkTipClick(s, entry, t, caps);
      const hasRow = ck.list.some((c) => c.name.startsWith('metadata row shown'));
      const status = ck.allOk ? 'pass' : ck.list.some((c) => c.name.startsWith('tipClick event') && c.ok) ? 'partial' : 'fail';
      return result(status, ck.reason(`${entry.id}: `), { checks: ck.list, measures: { ...measures, metadataChecked: hasRow }, notes: ['tips are made visible with focusTip first because rows are sub-pixel at the fit view'] });
    });

  // -------------------------------------------------------------------- S3
  S.S3 = () =>
    session('S3', async (s) => {
      const entry = getEntry(fid);
      const t = truthTree(entry);
      const caps = await capsOf(s);
      const u = unsupported(caps, 'internalNodeClick');
      if (u) return u;
      await mountOrThrow(s, entry);
      const { ck, measures } = await checkNodeClick(s, entry, t, caps);
      const anyEvent = measures.nodes.length > 0;
      let status = 'fail';
      if (ck.allOk) status = measures.sources.includes('adapter-derived') ? 'partial' : 'pass';
      else if (anyEvent && measures.nodes.every((n) => n.hit)) status = 'partial';
      let reason = ck.reason(`${entry.id}: `);
      if (ck.allOk && status === 'partial') reason = `${entry.id}: tip sets correct but computed by the adapter (source=adapter-derived), not delivered by the library`;
      return result(status, reason, { checks: ck.list, measures });
    });

  // -------------------------------------------------------------------- S4
  S.S4 = () =>
    session('S4', async (s) => {
      const entry = getEntry(fid);
      const t = truthTree(entry);
      const caps = await capsOf(s);
      const u = unsupported(caps, 'cladeColouring');
      if (u) return u;
      await mountOrThrow(s, entry);
      const { ck, measures } = await checkColour(s, entry, t, caps, 'S4-two-clades', saveShot);
      const core = ck.list.filter((c) => /turns red|two clades|restores/.test(c.name));
      const status = ck.allOk ? 'pass' : core.every((c) => c.ok) ? 'partial' : 'fail';
      return result(status, ck.reason(`${entry.id}: `), { checks: ck.list, measures });
    });

  // -------------------------------------------------------------------- S5
  S.S5 = () =>
    session('S5', async (s) => {
      const entry = getEntry(opts.s5Tree || 'syn-yule-10000');
      const t = truthTree(entry);
      const caps = await capsOf(s);
      const ck = new Checks();
      const m = {};
      const uh = unsupported(caps, 'highlightTip');
      const uf = unsupported(caps, 'focusTip');
      if (uh && uf) return result('unsupported', `highlightTip=no and focusTip=no`);
      await mountOrThrow(s, entry);
      const tip = t.tipLabels[Math.floor(t.tipCount * 0.71)];
      const parent = t.parent[t.tipIndex(tip)];
      const rect = await s.containerRect();
      const centreP = centre(rect);
      m.initiallyVisible = !!(await s.call('locate', { kind: 'tip', id: tip }));
      if (!uh) {
        await s.call('highlightTips', [tip]);
        await s.settle(150);
        const st = await s.reactState();
        ck.add('React highlighted panel lists the tip', st.highlightedCount === 1 && (st.highlightedText ?? '').includes(tip), st.highlightedText);
      }
      if (!uf) {
        await s.call('focusTip', tip);
        const p = await s.settleLocate({ kind: 'tip', id: tip });
        ck.add('tip is in view after focusTip', !!p, 'locate returned null');
        if (p) {
          const dx = Math.abs(p.x - centreP.x) / rect.width;
          const dy = Math.abs(p.y - centreP.y) / rect.height;
          m.offCentre = { dx, dy };
          ck.add('tip near the centre of the view (within 30% vertically, 40% horizontally)', dy <= 0.3 && dx <= 0.4, `dx ${fmt(dx * 100)}%, dy ${fmt(dy * 100)}%`);
          const sibs = t.descendantTips(parent).filter((x) => x !== tip).slice(0, 4);
          const locs = await Promise.all(sibs.map((x) => s.call('locate', { kind: 'tip', id: x })));
          ck.add('sibling tips (parent clade) are visible', sibs.length === 0 || locs.some(Boolean), `${locs.filter(Boolean).length}/${sibs.length} siblings located`);
          const bp = await s.call('bounds', { kind: 'node', id: t.nodeId(parent) });
          ck.add('parent clade has drawn bounds in view', !!bp);
        }
      }
      if (!uh) {
        const p = await s.call('locate', { kind: 'tip', id: tip });
        if (p) {
          const r = { x: p.x - 50, y: p.y - 40, width: 100, height: 80 };
          const on = await s.shot(r);
          await s.call('highlightTips', []);
          await s.settle(200);
          const off = await s.shot(r);
          const st = await s.reactState();
          ck.add('React highlighted panel empty after clearing', st.highlightedCount === 0);
          if (on && off) {
            const n = diffCount(on.png, off.png, 20);
            m.highlightPixels = n;
            ck.add('highlight is visible (pixels around the tip change)', n >= 40, `${n} pixels differ`);
          }
          await s.call('highlightTips', [tip]);
          await s.settle(200);
          const sh = await s.shot(rect);
          if (sh) saveShot('S5-focus-highlight', sh.buf);
        }
      }
      let status = ck.allOk ? 'pass' : 'fail';
      if (!ck.allOk && (uh || uf)) status = 'partial';
      if (!ck.allOk && ck.list.some((c) => c.ok) && status === 'fail') status = ck.failed.length <= 1 ? 'partial' : 'fail';
      return result(status, ck.reason(`${entry.id}: `) + (uh ? '; highlightTip unsupported' : '') + (uf ? '; focusTip unsupported' : ''), { checks: ck.list, measures: m });
    });

  // -------------------------------------------------------------------- S6
  S.S6 = () =>
    session('S6', async (s) => {
      const entry = getEntry(fid);
      const t = truthTree(entry);
      const caps = await capsOf(s);
      const u = unsupported(caps, 'tipAsLink');
      if (u) return u;
      await mountOrThrow(s, entry);
      const ck = new Checks();
      const m = {};
      const tip = t.tipLabels[Math.floor(t.tipCount * 0.4)];
      await s.page.evaluate(() => window.__spike.setTipLinks((id) => `${location.origin}/__tip__/${encodeURIComponent(id)}`));
      await s.settle(150);
      await bringTipIntoView(s, tip, caps);
      await s.settle(200);
      const find = () =>
        s.page.evaluate((id) => {
          const a = Array.from(document.querySelectorAll('a[href][data-tip-id]')).find((x) => x.getAttribute('data-tip-id') === id);
          if (!a) return null;
          const r = a.getBoundingClientRect();
          return { href: a.getAttribute('href'), tabindex: a.getAttribute('tabindex'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), rect: { x: r.x, y: r.y, width: r.width, height: r.height }, count: document.querySelectorAll('a[href][data-tip-id]').length };
        }, tip);
      const a = await find();
      ck.add('a[href][data-tip-id] exists for a visible tip', !!a, 'no matching anchor in the DOM');
      if (a) {
        m.anchor = a;
        ck.add('href is the requested URL', a.href.endsWith('/__tip__/' + encodeURIComponent(tip)), a.href);
        ck.add('keyboard focusable (tabindex not -1)', a.tabindex === null || Number(a.tabindex) >= 0, `tabindex=${a.tabindex}`);
        const focused = await s.page.evaluate((id) => {
          const el = Array.from(document.querySelectorAll('a[href][data-tip-id]')).find((x) => x.getAttribute('data-tip-id') === id);
          el.focus();
          return document.activeElement === el;
        }, tip);
        ck.add('element.focus() takes focus', focused);
        ck.add('has non-zero size', a.rect.width > 2 && a.rect.height > 2, JSON.stringify(a.rect));
        const opensNew = a.target === '_blank';
        if (a.rect.width > 2) {
          await s.page.mouse.click(a.rect.x + a.rect.width / 2, a.rect.y + a.rect.height / 2);
          await sleep(1200);
          m.popups = s.popups.length;
          ck.add('real click opens a new tab', s.popups.length >= 1, `target=${a.target}; popups=${s.popups.length}`);
        } else ck.add('real click opens a new tab', opensNew, 'not clickable');
      }
      await s.page.evaluate(() => window.__spike.setTipLinks(null));
      await s.settle(200);
      const gone = await s.page.evaluate(() => document.querySelectorAll('a[href][data-tip-id]').length);
      ck.add('setTipLinks(null) removes the anchors', gone === 0, `${gone} remain`);
      const coreOk = a && ck.list.filter((c) => /exists|href|focusable|focus\(\)/.test(c.name)).every((c) => c.ok);
      let status = ck.allOk ? 'pass' : coreOk ? 'partial' : 'fail';
      if (ck.allOk && caps.tipAsLink.level === 'partial') m.note = 'adapter reports partial: ' + caps.tipAsLink.how;
      return result(status, ck.reason(`${entry.id}: `), { checks: ck.list, measures: m });
    });

  // -------------------------------------------------------------------- S7
  S.S7 = () =>
    session('S7', async (s) => {
      const entry = getEntry(opts.s7Tree || 'syn-yule-1000');
      const t = truthTree(entry);
      const caps = await capsOf(s);
      const u = unsupported(caps, 'customColumns');
      if (u) return u;
      const lc = truthColumns(entry, t);
      const bar = lc.columns.find((c) => c.kind === 'bar');
      if (!bar) return result('fail', `${entry.id} has no bar column in the catalogue`);
      await mountOrThrow(s, entry);
      const { ck, measures } = await checkColumn(s, t, [bar], bar, caps);
      if (lc.tsvStats) measures.unmatched = { tipsWithoutRow: lc.tsvStats.tipsWithoutRow.length, rowsWithoutTip: lc.tsvStats.rowsWithoutTip.length };
      // an unmatched tip must not get a cell
      const un = lc.tsvStats?.tipsWithoutRow?.[0];
      if (un) {
        await bringTipIntoView(s, un, caps);
        const c = await s.call('locateCell', bar.id, un);
        ck.add('tip without a data row gets no cell (explicitly unmatched)', c === null || c.width <= 2, c ? JSON.stringify(c) : 'null');
      }
      const fitOk = ck.list.filter((c) => c.name.startsWith('fit view')).every((c) => c.ok);
      const status = ck.allOk ? 'pass' : fitOk ? 'partial' : 'fail';
      return result(status, ck.reason(`${entry.id}, column ${bar.id}: `), { checks: ck.list, measures });
    });

  // -------------------------------------------------------------------- S8
  S.S8 = () =>
    session('S8', async (s) => {
      const entry = getEntry(opts.s8Tree || 'rich-ens-protein-197');
      const t = truthTree(entry);
      const caps = await capsOf(s);
      const u = unsupported(caps, 'alignmentColumn');
      if (u) return u;
      const lc = truthColumns(entry, t);
      const aln = lc.columns.find((c) => c.kind === 'alignment');
      if (!aln) return result('fail', `${entry.id} has no alignment column in the catalogue`);
      await mountOrThrow(s, entry);
      const { ck, measures } = await checkColumn(s, t, [aln], aln, caps, { minCells: 8 });
      measures.alignmentTipsWithSequence = Object.keys(aln.values).length;
      const fitOk = ck.list.filter((c) => c.name.startsWith('fit view')).every((c) => c.ok);
      const status = ck.allOk ? 'pass' : fitOk ? 'partial' : 'fail';
      if (ck.allOk) {
        const rect = await s.containerRect();
        const sh = await s.shot(rect);
        if (sh) saveShot('S8-alignment', sh.buf);
      }
      return result(status, ck.reason(`${entry.id}: `), { checks: ck.list, measures });
    });

  // -------------------------------------------------------------------- S9
  S.S9 = () =>
    session('S9', async (s) => {
      const entry = getEntry(fid);
      const caps = await capsOf(s);
      const dark = caps.darkTheme?.level !== 'no';
      const tok = caps.cssTokens?.level !== 'no';
      if (!dark && !tok) return result('unsupported', `darkTheme=no (${caps.darkTheme?.how}); cssTokens=no (${caps.cssTokens?.how})`);
      await mountOrThrow(s, entry);
      const ck = new Checks();
      const m = {};
      const rect = await s.containerRect();
      const lightShot = await s.shot(rect);
      m.lightLuminance = meanLuminance(lightShot.png);
      if (dark) {
        await s.call('setTheme', { dark: true });
        await s.settle(250);
        const d = await s.shot(rect);
        m.darkLuminance = meanLuminance(d.png);
        ck.add('dark theme darkens the view', m.darkLuminance < m.lightLuminance - 60 && m.darkLuminance < 110, `mean luminance ${fmt(m.lightLuminance)} -> ${fmt(m.darkLuminance)}`);
        ck.add('dark theme still draws the tree', inkFraction(d.png) > 0.0005);
        saveShot('S9-dark', d.buf);
        await s.call('setTheme', { dark: false });
        await s.settle(200);
      }
      if (tok) {
        const bg = '#fdf0d5', br = '#0b6e4f';
        await s.call('setTheme', { dark: false, tokens: { background: bg, foreground: '#241f20', branch: br, highlight: '#684393', fontFamily: 'Georgia, serif' } });
        await s.settle(250);
        const sh = await s.shot(rect);
        const bgFrac = countNear(sh.png, hexToRgb(bg), 8).frac;
        const brFrac = countNear(sh.png, hexToRgb(br), 45);
        m.tokenBackgroundFraction = bgFrac;
        m.tokenBranchPixels = brFrac.count;
        ck.add('background token applied (dominant colour)', bgFrac > 0.4, `${fmt(bgFrac * 100)}% of pixels`);
        ck.add('branch token applied (pixels in branch colour)', brFrac.count >= 30, `${brFrac.count} pixels`);
      }
      const status = ck.allOk ? ((dark && tok) ? 'pass' : 'partial') : ck.list.some((c) => c.ok) ? 'partial' : 'fail';
      return result(status, ck.reason(`${entry.id}: `) + (dark ? '' : '; darkTheme=no') + (tok ? '' : '; cssTokens=no'), { checks: ck.list, measures: m, notes: ['per-node colour from a callback is covered by S4 (setColouredClades); no separate callback API in the contract'] });
    });

  // -------------------------------------------------------------------- S10
  S.S10 = () => {
    const list = opts.scaleTrees.slice().sort((a, b) => b.tips - a.tips);
    const entry = list.find((e) => e.id === 'syn-yule-100000') ?? list[0];
    const partial = { treeId: entry.id };
    return session(
      'S10',
      async (s) => {
        const t = truthTree(entry);
        const ck = new Checks();
        const caps = await capsOf(s);
        const r = await s.mount(entry, {});
        partial.loadMs = r.parseMs + r.firstRenderMs;
        await s.settle(300);
        const rect = await s.containerRect();
        const c = centre(rect);
        // zoom in a lot, then pan, then zoom all the way out with real wheel input
        await s.page.mouse.move(c.x, c.y);
        for (let k = 0; k < 12; k++) {
          await s.page.mouse.wheel(0, -120);
          await sleep(30);
        }
        await s.page.mouse.down();
        await s.page.mouse.move(c.x - 200, c.y - 120, { steps: 8 });
        await s.page.mouse.up();
        await s.settle(200);
        const first = t.tipLabels[0], last = t.tipLabels[t.tipCount - 1];
        const whole = async () => {
          const [a, b] = await Promise.all([s.call('locate', { kind: 'tip', id: first }), s.call('locate', { kind: 'tip', id: last })]);
          return !!a && !!b;
        };
        await s.metrics(() => window.__spikeMetrics.startSampler());
        let notches = 0;
        let ok = false;
        const t0 = Date.now();
        while (notches < 80 && Date.now() - t0 < 90000) {
          for (let k = 0; k < 3; k++) {
            await s.page.mouse.wheel(0, 120);
            await sleep(16);
            notches++;
          }
          if (await whole()) {
            ok = true;
            break;
          }
        }
        const fps = await s.metrics(() => window.__spikeMetrics.stopSampler());
        partial.notches = notches;
        partial.zoomOutSec = (Date.now() - t0) / 1000;
        Object.assign(partial, { fpsMedian: fps.medianFps, fpsP5: fps.p5Fps, maxFrameGapMs: fps.maxIntervalMs, droppedFrames: fps.droppedFrames });
        await s.settle(400);
        const sh = await s.shot(rect);
        if (sh) {
          partial.inkAfterZoomOut = inkFraction(sh.png);
          saveShot(`S10-zoomed-out-${entry.id}`, sh.buf);
        }
        partial.stats = await s.call('getStats');
        ck.add('whole tree in view (first and last tip both locatable) after zoom-out by wheel', ok, `after ${notches} wheel notches`);
        ck.add('tree still drawn when zoomed out', (partial.inkAfterZoomOut ?? 0) > 0.0005);
        ck.add(`no freeze: longest frame gap < 2 s`, fps.maxIntervalMs < 2000, `${fmt(fps.maxIntervalMs)} ms`);
        const smooth = fps.p5Fps >= THRESHOLDS.p5Fps;
        const status = !ok || !ck.list[1].ok ? 'fail' : !ck.list[2].ok ? 'timeout' : smooth ? 'pass' : 'partial';
        const reason = ck.reason(`${entry.id}: `) + `; p5 ${fmt(fps.p5Fps, 1)} fps, median ${fmt(fps.medianFps, 1)} fps, DOM nodes ${partial.stats.domNodes}, canvases ${partial.stats.canvases}` + (ok && !smooth ? ` (p5 < ${THRESHOLDS.p5Fps} fps while zooming out)` : '') + `; overviewOrMinimap self-report: ${caps.overviewOrMinimap?.level}`;
        return result(status, reason, { checks: ck.list, measures: partial });
      },
      300000,
    ).catch((e) => result(e instanceof TimeoutError ? 'timeout' : 'fail', `${entry.id}: ${e.message}`, { measures: partial }));
  };

  // -------------------------------------------------------------------- S11
  S.S11 = () =>
    session('S11', async (s) => {
      const caps = await capsOf(s);
      const u = unsupported(caps, 'branchLengthToggle');
      if (u) return u;
      const ck = new Checks();
      const m = {};
      const tipXs = async (t, ids) => {
        const out = [];
        for (const id of ids) {
          const p = await s.call('locate', { kind: 'tip', id });
          out.push(p ? p.x : null);
        }
        return out;
      };
      const sampleIds = (t, n) => {
        const step = Math.max(1, Math.floor(t.tipCount / n));
        const ids = [];
        for (let r = 0; r < t.tipCount && ids.length < n; r += step) ids.push(t.tipLabels[r]);
        return ids;
      };
      // non-ultrametric: x must follow cumulative length
      const e1 = getEntry('rich-ens-protein-197');
      const t1 = truthTree(e1);
      await mountOrThrow(s, e1, { branchLengths: true });
      const ids = sampleIds(t1, 120);
      const cum = ids.map((id) => t1.cumLength[t1.tipIndex(id)]);
      const x1 = await tipXs(t1, ids);
      const pairs1 = ids.map((_, k) => [x1[k], cum[k], k]).filter((p) => p[0] !== null);
      const r1 = pearson(pairs1.map((p) => p[0]), pairs1.map((p) => p[1]));
      m.phylogramPearson = r1;
      ck.add('phylogram: tip x follows root-to-tip length (Pearson >= 0.97)', pairs1.length >= 20 && r1 >= 0.97, `r=${fmt(r1, 3)} over ${pairs1.length} visible tips`);
      await s.call('setBranchLengths', false);
      await s.settle(250);
      const x2 = await tipXs(t1, ids);
      const pairs2 = ids.map((_, k) => [x2[k], cum[k], x1[k]]).filter((p) => p[0] !== null && p[2] !== null);
      const r2 = pearson(pairs2.map((p) => p[0]), pairs2.map((p) => p[1]));
      const moved = pairs2.reduce((a, p) => a + Math.abs(p[0] - p[2]), 0) / Math.max(1, pairs2.length);
      m.cladogramPearson = r2;
      m.meanTipShiftPx = moved;
      ck.add('toggle to cladogram changes the layout (tips move)', moved >= 3, `mean tip shift ${fmt(moved, 1)} px`);
      ck.add('cladogram no longer proportional to length', Number.isFinite(r2) ? r2 < r1 - 0.05 : true, `r ${fmt(r1, 3)} -> ${fmt(r2, 3)}`);
      await s.call('setBranchLengths', true);
      await s.settle(250);
      const x3 = await tipXs(t1, ids);
      const pairs3 = ids.map((_, k) => [x3[k], cum[k]]).filter((p) => p[0] !== null);
      const r3 = pearson(pairs3.map((p) => p[0]), pairs3.map((p) => p[1]));
      ck.add('toggling back restores the phylogram', r3 >= 0.97, `r=${fmt(r3, 3)}`);
      // ultrametric dated tree: tips aligned in a phylogram
      const e2 = getEntry('rich-corvoid-680');
      const t2 = truthTree(e2);
      await mountOrThrow(s, e2, { branchLengths: true });
      const rect = await s.containerRect();
      const ids2 = sampleIds(t2, 80);
      const xs = (await tipXs(t2, ids2)).filter((x) => x !== null);
      const spread = xs.length ? (Math.max(...xs) - Math.min(...xs)) / rect.width : NaN;
      m.ultrametricTipSpread = spread;
      ck.add('dated (ultrametric) phylogram: tips end at the same x (spread < 2% of width)', xs.length >= 20 && spread < 0.02, `spread ${fmt(spread * 100, 2)}% over ${xs.length} tips`);
      // missing and negative lengths must not break rendering
      const e3 = getEntry('edge-polytomy-missing');
      const t3 = truthTree(e3);
      const r = await s.mount(e3, { branchLengths: true }).catch((e) => ({ error: e.message }));
      ck.add('edge case with missing, zero and negative lengths renders', !r.error && r.tips === t3.tipCount, r.error || `tips ${r.tips}`);
      if (!r.error) {
        await s.settle(200);
        const p = await s.call('locate', { kind: 'tip', id: 'J' });
        ck.add('tip with a negative length is locatable', !!p);
      }
      m.scaleBarSelfReport = `${caps.scaleBar?.level}: ${caps.scaleBar?.how}`;
      const core = ck.list.filter((c) => /phylogram: tip x|toggle to/.test(c.name)).every((c) => c.ok);
      const status = ck.allOk ? 'pass' : core ? 'partial' : 'fail';
      return result(status, ck.reason('') + `; scale bar / time axis is self-reported only (${caps.scaleBar?.level})`, { checks: ck.list, measures: m });
    });

  // -------------------------------------------------------------------- S12
  S.S12 = () =>
    session('S12', async (s) => {
      const entry = getEntry(fid);
      const t = truthTree(entry);
      const caps = await capsOf(s);
      const u = unsupported(caps, 'radialLayout');
      if (u) return u;
      const before = null;
      await mountOrThrow(s, entry, { layout: 'rectangular' });
      const tip = t.tipLabels[Math.floor(t.tipCount / 3)];
      const p0 = await s.call('locate', { kind: 'tip', id: tip });
      await s.call('setLayout', 'radial');
      await s.settle(400);
      const ck = new Checks();
      const p1 = await s.call('locate', { kind: 'tip', id: tip });
      ck.add('setLayout(radial) changes the layout', !!p1 && (!p0 || Math.hypot(p1.x - p0.x, p1.y - p0.y) > 10), `tip moved from ${p0 ? fmt(p0.x) + ',' + fmt(p0.y) : 'null'} to ${p1 ? fmt(p1.x) + ',' + fmt(p1.y) : 'null'}`);
      const sh0 = await s.shot(await s.containerRect());
      if (sh0) saveShot('S12-radial', sh0.buf);
      const parts = {};
      await mountOrThrow(s, entry, { layout: 'radial' }); // fresh fit view for each sub-check
      const a = await checkTipClick(s, entry, t, caps, { layout: 'radial' });
      a.ck.list.forEach((c) => ck.add('radial S2: ' + c.name, c.ok, c.detail));
      if (caps.internalNodeClick?.level !== 'no') {
        await mountOrThrow(s, entry, { layout: 'radial' });
        const b = await checkNodeClick(s, entry, t, caps);
        b.ck.list.forEach((c) => ck.add('radial S3: ' + c.name, c.ok, c.detail));
      }
      if (caps.cladeColouring?.level !== 'no') {
        await mountOrThrow(s, entry, { layout: 'radial' });
        const c = await checkColour(s, entry, t, caps);
        c.ck.list.forEach((x) => ck.add('radial S4: ' + x.name, x.ok, x.detail));
      }
      const status = ck.allOk ? 'pass' : ck.failed.length <= 2 && ck.list[0].ok ? 'partial' : 'fail';
      return result(status, ck.reason(`${entry.id} radial: `), { checks: ck.list, measures: parts });
    });

  // -------------------------------------------------------------------- S13
  S.S13 = () =>
    session('S13', async (s) => {
      const entry = getEntry(fid);
      const small = getEntry('syn-yule-200');
      const t = truthTree(entry);
      const t2 = truthTree(small);
      const caps = await capsOf(s);
      const ck = new Checks();
      const m = {};
      if (caps.multipleInstances?.level === 'no') {
        // still do the mount/unmount loop below
        m.multipleInstancesSkipped = caps.multipleInstances.how;
      } else {
        const r0 = await mountOrThrow(s, entry, { size: { width: 760, height: 560 } });
        const r1 = await s.mount(small, { size: { width: 340, height: 240 }, instance: 1 });
        ck.add('second instance mounts with its own tip count', r1.tips === small.tips && r0.tips === entry.tips, `${r0.tips} and ${r1.tips}`);
        await s.settle(300);
        const c0 = await s.containerRect(0), c1 = await s.containerRect(1);
        const sh = await Promise.all([s.shot(c0), s.shot(c1)]);
        ck.add('both instances draw something', inkFraction(sh[0].png) > 0.0005 && inkFraction(sh[1].png) > 0.0005, `ink ${fmt(inkFraction(sh[0].png) * 100, 2)}% / ${fmt(inkFraction(sh[1].png) * 100, 2)}%`);
        // events must not cross-talk
        const tipA = t.tipLabels[Math.floor(t.tipCount * 0.3)];
        const pA = await bringTipIntoView(s, tipA, caps, 0);
        await s.call('clearEvents');
        await s.call2('clearEvents');
        if (pA) {
          await s.clickAndWait(pA, 0);
          const e0 = await s.events(0), e1 = await s.events(1);
          ck.add('click in instance 0 reaches only instance 0', e0.some((e) => e.type === 'tipClick') && e1.length === 0, `events ${e0.length}/${e1.length}`);
        } else ck.add('instance 0 tip locatable', false);
        const tipB = t2.tipLabels[Math.floor(t2.tipCount * 0.6)];
        const pB = await bringTipIntoView(s, tipB, caps, 1);
        if (pB) {
          await s.clickAndWait(pB, 1);
          const e1 = await s.events(1);
          ck.add('click in instance 1 reaches instance 1', e1.some((e) => e.type === 'tipClick' && e.tipIds[0] === tipB), `events ${e1.length}`);
          const st1 = await s.reactState(1);
          ck.add('React state of instance 1 updated', st1.lastEvent?.type === 'tipClick', st1.lastEvent?.text);
        } else ck.add('instance 1 tip locatable', false);
        await s.call('unmount');
        await s.settle(300);
        const sh1 = await s.shot(await s.containerRect(1));
        ck.add('instance 1 survives unmounting instance 0', !!sh1 && inkFraction(sh1.png) > 0.0005);
        const stats0 = await s.call('getStats');
        ck.add('unmount leaves nothing in the container', stats0.domNodes === 0 && stats0.canvases === 0, `domNodes=${stats0.domNodes} canvases=${stats0.canvases}`);
      }
      // five mount/unmount cycles
      const docNodes = () => s.page.evaluate(() => document.querySelectorAll('*').length);
      const canvases = () => s.page.evaluate(() => document.querySelectorAll('canvas').length);
      await s.call('unmount').catch(() => {});
      await s.call2('unmount').catch(() => {});
      await s.settle(200);
      const base = { dom: await docNodes(), canv: await canvases() };
      const heaps = [];
      let leakErr = null;
      for (let k = 0; k < 5; k++) {
        try {
          await mountOrThrow(s, entry, { size: { width: 700, height: 500 } });
          await s.call('unmount');
        } catch (e) {
          leakErr = `cycle ${k + 1}: ${e.message}`;
          break;
        }
        await s.settle(150);
        heaps.push(await heapMB(s));
      }
      ck.add('five mount/unmount cycles complete', !leakErr, leakErr || '');
      if (!leakErr) {
        const after = { dom: await docNodes(), canv: await canvases() };
        m.baseline = base;
        m.afterCycles = after;
        m.heapMB = heaps;
        ck.add('document DOM node count returns to baseline', Math.abs(after.dom - base.dom) <= 5, `${base.dom} -> ${after.dom}`);
        ck.add('no canvases / GL contexts left behind', after.canv <= base.canv, `${base.canv} -> ${after.canv}`);
        const grow = heaps[4] !== null && heaps[0] !== null ? heaps[4] - heaps[0] : null;
        m.heapGrowthMB = grow;
        if (grow !== null) ck.add('JS heap growth over cycles 2 to 5 below 15 MB (after gc)', grow < 15, `${fmt(grow, 1)} MB`);
      }
      const errs = await s.pageErrors();
      ck.add('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
      m.pageErrors = errs.slice(0, 5);
      const crit = ck.list.filter((c) => /second instance|cross|reaches|five mount/.test(c.name) && !c.ok);
      const status = ck.allOk ? (caps.multipleInstances?.level === 'no' ? 'partial' : 'pass') : crit.length ? 'fail' : 'partial';
      return result(status, ck.reason('') + (m.multipleInstancesSkipped ? `; two-instance part skipped (adapter reports multipleInstances=no: ${m.multipleInstancesSkipped})` : ''), { checks: ck.list, measures: m });
    });

  // -------------------------------------------------------------------- S14
  S.S14 = () =>
    session('S14', async (s) => {
      const entry = getEntry(fid);
      const t = truthTree(entry);
      const caps = await capsOf(s);
      await mountOrThrow(s, entry);
      const ck = new Checks();
      const m = {};
      const describe = () =>
        s.page.evaluate(() => {
          const a = document.activeElement;
          const c = document.querySelector('[data-testid=tree-container]');
          if (!a || !c || !c.contains(a)) return null;
          return { tag: a.tagName.toLowerCase(), role: a.getAttribute('role'), name: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 60), tip: a.getAttribute('data-tip-id') || a.getAttribute('data-tip-label') };
        });
      const tabThrough = async (label) => {
        await s.page.evaluate(() => {
          document.body.focus();
          if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        });
        const seen = [];
        for (let k = 0; k < 140; k++) {
          await s.page.keyboard.press('Tab');
          const d = await describe();
          if (d) seen.push(d);
          else if (seen.length >= 3) break;
          if (seen.length >= 6) break;
        }
        m[label] = seen;
        return seen;
      };
      let seen = await tabThrough('tabAtFit');
      const tip = t.tipLabels[Math.floor(t.tipCount / 2)];
      if (seen.length < 3 && caps.focusTip?.level !== 'no') {
        await s.call('focusTip', tip);
        await s.settleLocate({ kind: 'tip', id: tip });
        await s.settle(200);
        seen = await tabThrough('tabAfterFocusTip');
        m.neededFocusTip = true;
      }
      const named = seen.filter((d) => d.name);
      ck.add('Tab reaches at least 3 focusable elements inside the tree', seen.length >= 3, `${seen.length} found`);
      ck.add('focusable elements have accessible names', named.length >= Math.min(3, seen.length) && seen.length > 0, `${named.length}/${seen.length} named`);
      const sem = await s.page.evaluate(() => {
        const c = document.querySelector('[data-testid=tree-container]');
        const roles = Array.from(c.querySelectorAll('[role]')).map((e) => e.getAttribute('role'));
        const labelled = !!c.querySelector('[aria-label],[aria-labelledby]');
        const text = Array.from(c.querySelectorAll('table,ul,ol')).length > 0;
        return { roles: [...new Set(roles)], labelled, textFallback: text };
      });
      m.semantics = sem;
      ck.add('tree container exposes a role/label or a text fallback', sem.roles.length > 0 || sem.labelled || sem.textFallback, JSON.stringify(sem));
      // Enter on a focused tip should activate it
      const focusedTip = seen.find((d) => d.tip);
      if (focusedTip) {
        await s.call('clearEvents');
        await s.page.keyboard.press('Enter');
        await sleep(200);
        const ev = await s.events();
        m.enterActivates = ev.some((e) => e.type === 'tipClick');
      }
      const status = ck.allOk ? 'pass' : ck.list.some((c) => c.ok) ? 'partial' : 'fail';
      return result(status, ck.reason('') + (m.neededFocusTip ? '; tips were not focusable at the fit view, only after focusTip' : '') + (m.enterActivates === false ? '; Enter on a focused tip does not fire a click event' : ''), { checks: ck.list, measures: m });
    });

  // -------------------------------------------------------------------- S15
  S.S15 = () =>
    session('S15', async (s) => {
      let entry = getEntry(opts.s15Tree || 'syn-yule-10000');
      const caps = await capsOf(s);
      const u = unsupported(caps, 'internalNodeClick');
      if (u) return u;
      const ck = new Checks();
      const m = { tree: entry.id };
      const target = entry.tips >= 5000 ? 1000 : 300;
      let t = truthTree(entry);
      const [i] = pickClades(t, [target / t.tipCount], { minTips: 20 });
      const nodeId = t.nodeId(i);
      const truthN = t.tipCountOf(i);
      m.cladeTips = truthN;
      await mountOrThrow(s, entry);
      await s.page.evaluate(() => window.__spikeShell.setLinkedView(true));
      const colour = await s.page.evaluate(() => window.__spikeShell.linkedColour);
      const lat = [], paint = [];
      let okCount = 0;
      for (let k = 0; k < 5; k++) {
        const p = await s.settleLocate({ kind: 'node', id: nodeId }, 0, 800);
        if (!p) {
          ck.add(`click ${k + 1}: node locatable`, false);
          break;
        }
        await s.call('clearEvents');
        await s.page.mouse.move(p.x, p.y);
        await s.page.mouse.click(p.x, p.y);
        const t0 = Date.now();
        let st;
        while (Date.now() - t0 < 5000) {
          st = await s.reactState();
          if (st.mapCount === truthN && st.clades?.length === 1) break;
          await sleep(10);
        }
        await sleep(250);
        const im = await inputMarks(s);
        st = await s.reactState();
        const good = st.mapCount === truthN && st.mapNode === nodeId && st.clades?.[0]?.nodeId === nodeId;
        if (good) okCount++;
        lat.push(im.lastEventCommit - im.pointerDown);
        paint.push(im.lastEventPaint - im.pointerDown);
        if (k === 0) {
          const b = await s.call('bounds', { kind: 'node', id: nodeId });
          if (b) {
            const f = await colourFrac(s, b, colour, 80);
            m.redFractionAfterClick = f.frac;
            ck.add('clade is red after the click', f.frac >= 0.002, `${fmt(f.frac * 100, 2)}% of the clade box`);
            const sh = await s.shot(await s.containerRect());
            if (sh) saveShot('S15-linked-view', sh.buf);
          } else ck.add('clade bounds available', false);
        }
        await s.page.evaluate(() => window.__spike.setColouredClades([]));
        await s.settle(150);
        await s.page.mouse.move(p.x - 30, p.y + 30);
      }
      ck.add(`map panel shows ${truthN} tips and the clade is in React state (all 5 clicks)`, okCount === 5, `${okCount}/5 clicks ended correctly`);
      m.clickToCommitMs = lat;
      m.clickToPaintMs = paint;
      m.medianCommitMs = median(lat);
      m.medianPaintMs = median(paint);
      const mp = m.medianPaintMs;
      let status = ck.allOk ? 'pass' : 'fail';
      let reason = ck.reason(`${entry.id}, ${truthN}-tip clade: `);
      if (ck.allOk) {
        reason += `; click to React commit ${fmt(m.medianCommitMs)} ms, to paint ${fmt(mp)} ms (median of 5)`;
        if (mp > THRESHOLDS.clickMs) status = 'timeout', reason += ` > ${THRESHOLDS.clickMs} ms (unusable)`;
        else if (mp > THRESHOLDS.linkedMs) status = 'partial', reason += ` > ${THRESHOLDS.linkedMs} ms target (spec: about 100 ms)`;
      }
      return result(status, reason, { checks: ck.list, measures: m });
    });

  return S;
}
