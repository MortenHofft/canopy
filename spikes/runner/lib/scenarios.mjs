// Scenarios S1 to S15 (docs/spike-plan.md). Candidate-agnostic: only window.__spike, real mouse/keyboard input,
// screenshots and the React panels of the shell are used. Ground truth comes from shared/newick.ts on the files.
import { sleep, median, pearson, spearman, withTimeout, TimeoutError, fmt } from './util.mjs';
import { countNear, hexToRgb, meanLuminance, dominant, inkFraction, colourBuckets, diffCount, tintCount } from './pixels.mjs';
import { truthTree, truthColumns, getEntry, catalogue } from './truth.mjs';
import { interactionRounds, summariseRounds, cpuProbe, loadavg } from './measure.mjs';

// Thresholds (CONTRACT.md Clarifications 15): unusable = load > 10 s, or dropped-frame ratio > 0.5 (best of 3 rounds),
// or main-thread CPU per interaction step > 100 ms, or click latency > 300 ms. p5 FPS is reported (best of 3) but not judged.
export const THRESHOLDS = { loadMs: 10000, p5Fps: 20, clickMs: 300, linkedMs: 120, droppedRatio: 0.5, cpuStepMs: 100, sluggishDroppedRatio: 0.2, sluggishCpuStepMs: 50 };
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
  na(name, detail = '') {
    this.list.push({ name, ok: true, na: true, detail: String(detail) });
    return true;
  }
  get naList() {
    return this.list.filter((c) => c.na);
  }
  get failed() {
    return this.list.filter((c) => !c.ok);
  }
  get allOk() {
    return this.failed.length === 0;
  }
  reason(prefix = '') {
    const f = this.failed;
    const na = this.naList.length ? ` [n/a: ${this.naList.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ')}]` : '';
    return (f.length ? prefix + f.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`).join('; ') : prefix + 'all checks passed') + na;
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

/** At most n items spread evenly over an array. */
function thin(a, n) {
  if (a.length <= n) return a;
  const out = [];
  for (let k = 0; k < n; k++) out.push(a[Math.floor((k * a.length) / n)]);
  return out;
}

/** n tip labels spread evenly over the tree. */
function spreadTips(t, n) {
  const step = Math.max(1, Math.floor(t.tipCount / n));
  const ids = [];
  for (let r = 0; r < t.tipCount && ids.length < n; r += step) ids.push(t.tipLabels[r]);
  return ids;
}

/** locate() for many tips in one round trip; only the ones that are on screen. */
async function scanVisible(s, ids, i = 0) {
  return s.page.evaluate(
    async ({ ids, inst }) => {
      const api = inst === 0 ? window.__spike : window.__spike2;
      const out = [];
      for (const id of ids) {
        const p = await api.locate({ kind: 'tip', id });
        if (p) out.push({ id, p });
      }
      return out;
    },
    { ids, inst: i },
  );
}

/**
 * Tips that are on screen right now (up to `want`, spread). Scroll-only and uniform-zoom viewers show few tips at the
 * fit view, so when fewer than `min` are visible the view is moved with focusTip to a few spread tips and the
 * visible sets are merged (positions are read in the view in which they were found; callers must not mix views).
 */
async function visibleTips(s, t, caps, { want = 12, min = 5 } = {}) {
  let vis = await scanVisible(s, spreadTips(t, 400));
  if (vis.length >= min || caps.focusTip?.level === 'no') return thin(vis, want);
  await bringTipIntoView(s, t.tipLabels[Math.floor(t.tipCount / 2)], caps);
  await s.settle(150);
  const near = t.tipLabels.slice(Math.max(0, Math.floor(t.tipCount / 2) - 150), Math.floor(t.tipCount / 2) + 150);
  vis = await scanVisible(s, near);
  return thin(vis, want);
}

/** Node locate that moves the view with focusTip (middle, first, last tip of the clade) if the node is off screen. */
async function locateNode(s, t, i, caps, waitMs = 600) {
  const target = { kind: 'node', id: t.nodeId(i) };
  let p = await s.settleLocate(target, 0, waitMs);
  if (p) return p;
  const lo = t.leafStart[i], hi = t.leafEnd[i];
  for (const r of [(lo + hi) >> 1, lo, hi - 1]) {
    await bringTipIntoView(s, t.tipLabels[r], caps);
    p = await s.settleLocate(target, 0, waitMs);
    if (p) return p;
  }
  return null;
}

/** Vertical distance between two neighbouring visible tips (row pitch, px) around a pivot tip; null if not measurable. */
async function rowPitch(s, t, rank) {
  const a = await s.call('locate', { kind: 'tip', id: t.tipLabels[rank] });
  const b = await s.call('locate', { kind: 'tip', id: t.tipLabels[Math.min(t.tipCount - 1, rank + 1)] });
  return a && b ? { pitch: Math.hypot(a.x - b.x, a.y - b.y), at: a } : null;
}

/** Zoom with real wheel input around a visible tip until the row pitch reaches `target` px or stops changing. */
async function zoomToPitch(s, t, rank, target = 14, maxNotches = 40) {
  let last = await rowPitch(s, t, rank);
  const start = last?.pitch ?? null;
  let stuck = 0, notches = 0;
  while (last && last.pitch < target && notches < maxNotches && stuck < 3) {
    await s.page.mouse.move(last.at.x, last.at.y);
    await s.page.mouse.wheel(0, -120);
    notches++;
    await sleep(60);
    const nx = await rowPitch(s, t, rank);
    if (!nx) break;
    stuck = nx.pitch <= last.pitch * 1.02 ? stuck + 1 : 0;
    last = nx;
  }
  await s.settle(200);
  return { startPitch: start, endPitch: last?.pitch ?? null, notches };
}

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

/**
 * Zoom with real wheel input around a clade until its drawn box is at least `minPx` tall. Strokes of uniform-fit SVG and
 * WebGL viewers are sub-pixel at the fit view of a big tree, so pixel checks are made after this zoom. Returns what it did.
 */
async function zoomIntoClade(s, t, i, caps, minPx = 60, maxNotches = 45) {
  const id = t.nodeId(i);
  let b = await s.call('bounds', { kind: 'node', id });
  const h0 = b?.height ?? 0;
  if (b && b.height >= minPx) return { zoomed: false, notches: 0, boxPxBefore: h0, boxPxAfter: h0, factor: 1 };
  await bringTipIntoView(s, t.tipLabels[(t.leafStart[i] + t.leafEnd[i]) >> 1], caps);
  await s.settle(150);
  b = await s.call('bounds', { kind: 'node', id });
  let notches = 0, stuck = 0, last = b?.height ?? 0;
  while (b && b.height < minPx && notches < maxNotches && stuck < 4) {
    const c = centre(b);
    await s.page.mouse.move(c.x, c.y);
    await s.page.mouse.wheel(0, -120);
    notches++;
    await sleep(80);
    b = await s.call('bounds', { kind: 'node', id });
    const h = b?.height ?? 0;
    stuck = h <= last * 1.02 ? stuck + 1 : 0;
    last = h;
  }
  await s.settle(250);
  return { zoomed: true, notches, boxPxBefore: h0, boxPxAfter: last, factor: h0 > 0 ? last / h0 : null, note: 'bounds are clipped to the container, so the factor is approximate' };
}

/** Wait (up to timeoutMs) for the paint mark of the last event to exist; returns the marks (paint 0 = never painted). */
async function waitPaint(s, timeoutMs = 30000) {
  const t0 = Date.now();
  let im = await inputMarks(s);
  while (!(im.lastEventPaint > 0 && im.lastEventCommit > 0 && im.lastEventPaint >= im.lastEventCommit) && Date.now() - t0 < timeoutMs) {
    await sleep(50);
    im = await inputMarks(s);
  }
  return im;
}

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
    const p = await locateNode(s, t, i, caps); // moves the view with focusTip if the node is off screen
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

/** S4: colour clades from React state, check pixels, layout stability, clear. Works with partly visible trees. */
async function checkColourOnce(s, entry, t, caps, screenLabel, saveShot, zoomMode) {
  const ck = new Checks();
  const m = {};
  const [a, b] = pickClades(t, [0.2, 0.15], { minTips: 8 });
  if (a === undefined) return { ck: Object.assign(ck, { list: [{ name: 'found a clade to colour', ok: false, detail: 'tree too small' }] }), measures: m };
  const A = t.nodeId(a);
  const B = b !== undefined ? t.nodeId(b) : null;
  let bA = await s.call('bounds', { kind: 'node', id: A });
  if (!bA) {
    await bringTipIntoView(s, t.tipLabels[(t.leafStart[a] + t.leafEnd[a]) >> 1], caps); // scroll-only viewers: bring the clade into view
    await s.settle(150);
    bA = await s.call('bounds', { kind: 'node', id: A });
  }
  if (!bA) {
    ck.add('bounds(clade A) available', false, 'bounds returned null even after focusTip');
    return { ck, measures: m };
  }
  // Sub-pixel strokes at the fit view (uniform-fit SVG, WebGL): keep the fit-view result as a note, then zoom around the clade
  if (bA.height < 60 || zoomMode === 'pitch') {
    const base0 = await s.shot(bA);
    await s.call('setColouredClades', [{ nodeId: A, colour: RED }]);
    await s.settle(200);
    const after0 = await s.shot(bA);
    const f0 = base0 && after0 ? tintCount(after0.png, base0.png, hexToRgb(RED)) : { frac: NaN, count: 0 };
    await s.call('setColouredClades', []);
    await s.settle(200);
    m.fitViewCheck = { cladeBoxPx: bA.height, redFrac: f0.frac, redPixels: f0.count, note: 'result at the fit view, before zooming' };
    if (zoomMode === 'pitch') {
      // retry mode: readable rows (14 px pitch) around the middle of the clade; marker outlines and minimum sizes can hide fills in big views
      const mid = (t.leafStart[a] + t.leafEnd[a]) >> 1;
      await bringTipIntoView(s, t.tipLabels[mid], caps);
      await s.settle(150);
      m.zoom = { mode: 'row pitch 14 px', ...(await zoomToPitch(s, t, mid, 14)) };
    } else m.zoom = await zoomIntoClade(s, t, a, caps);
    bA = await s.call('bounds', { kind: 'node', id: A });
    m.pixelChecksAfterZoom = true;
    if (!bA) {
      ck.add('bounds(clade A) available after zooming', false, 'null');
      return { ck, measures: m };
    }
  }
  const bB = B ? await s.call('bounds', { kind: 'node', id: B }) : null;
  const useB = !!bB && !rectsIntersect(bA, bB);
  if (B && !useB) m.controlNote = bB ? 'control clade overlaps clade A (no control)' : 'control clade not on screen (no control)';
  m.cladeTips = t.tipCountOf(a);
  // probes: tips that are on screen now; checked only if they are on screen both before and after (null probes are ignored)
  const probes = thin(await scanVisible(s, spreadTips(t, 400)), 6);
  const pos = async () => Promise.all(probes.map((p) => s.call('locate', { kind: 'tip', id: p.id })));
  const L0 = await pos();
  const dom0 = (await s.domStats()).nodes;
  // colour metric: pixels that moved towards the target colour relative to the same pixels before (relative to the drawn branch width)
  const baseA = await s.shot(bA);
  const baseB = useB ? await s.shot(bB) : null;
  const f = async (r, hex) => {
    const sh = await s.shot(r);
    const base = r === bA ? baseA : baseB;
    return sh && base ? tintCount(sh.png, base.png, hexToRgb(hex)) : { frac: NaN, count: 0 };
  };
  const aRed0 = await f(bA, RED);
  const bRed0 = useB ? await f(bB, RED) : { frac: 0 };
  const bBlue0 = useB ? await f(bB, BLUE) : { frac: 0 };
  const aBlue0 = await f(bA, BLUE);

  await s.call('setColouredClades', [{ nodeId: A, colour: RED }]);
  await s.settle(200);
  const aRed1 = await f(bA, RED);
  const bRed1 = useB ? await f(bB, RED) : { frac: 0 };
  const dRed = aRed1.frac - aRed0.frac;
  m.redFrac = { before: aRed0.frac, after: aRed1.frac, pixelsBefore: aRed0.count, pixelsAfter: aRed1.count, controlBefore: bRed0.frac, controlAfter: bRed1.frac };
  // threshold: 0.1% of the clade box and at least 20 pixels that moved towards red
  ck.add('clade A turns red (>= 0.1% of the clade box and >= 20 px move towards red)', dRed >= 0.001 && aRed1.count - aRed0.count >= 20, `fraction ${fmt(aRed0.frac * 100, 2)}% -> ${fmt(aRed1.frac * 100, 2)}%`);
  if (useB) ck.add('other clade unchanged (control)', bRed1.frac - bRed0.frac <= Math.max(0.001, 0.25 * dRed), `${fmt(bRed0.frac * 100, 2)}% -> ${fmt(bRed1.frac * 100, 2)}%`);
  let st = await s.reactState();
  ck.add('React clades panel lists A', st.clades?.length === 1 && st.clades[0].nodeId === A && st.clades[0].colour.toLowerCase() === RED, JSON.stringify(st.clades));
  const compare = (L1, label) => {
    const both = probes.map((p, k) => [L0[k], L1[k]]).filter(([x]) => x);
    if (both.length < 2) return ck.na(label, `only ${both.length} probe tips on screen`);
    const moved = both.some(([x, y]) => !y || Math.hypot(x.x - y.x, x.y - y.y) > 1);
    return ck.add(label, !moved, `${both.length} probe tips compared`);
  };
  compare(await pos(), 'no layout change when colouring');
  m.domNodesDelta = (await s.domStats()).nodes - dom0;

  if (useB) {
    await s.call('setColouredClades', [{ nodeId: A, colour: RED }, { nodeId: B, colour: BLUE }]);
    await s.settle(200);
    const aRed2 = await f(bA, RED);
    const bBlue2 = await f(bB, BLUE);
    ck.add('two clades, two colours (A red kept, B blue appears)', aRed2.frac - aRed0.frac >= 0.5 * dRed && bBlue2.frac - bBlue0.frac >= 0.001, `A red ${fmt(aRed2.frac * 100, 2)}%, B blue ${fmt(bBlue2.frac * 100, 2)}%`);
    if (screenLabel && saveShot) {
      const sh = await s.shot(await s.containerRect());
      if (sh) saveShot(screenLabel, sh.buf);
    }
  } else if (screenLabel && saveShot) {
    const sh = await s.shot(await s.containerRect());
    if (sh) saveShot(screenLabel, sh.buf);
  }
  await s.call('setColouredClades', []);
  await s.settle(200);
  const aRed3 = await f(bA, RED);
  const bBlue3 = useB ? await f(bB, BLUE) : { frac: 0 };
  const aBlue3 = await f(bA, BLUE);
  ck.add('clear restores the original colours', aRed3.frac <= aRed0.frac + 0.0008 && bBlue3.frac <= bBlue0.frac + 0.0008 && aBlue3.frac <= aBlue0.frac + 0.0008, `A red ${fmt(aRed3.frac * 100, 2)}% (was ${fmt(aRed0.frac * 100, 2)}%)`);
  st = await s.reactState();
  ck.add('React clades panel empty after clear', st.clades?.length === 0, JSON.stringify(st.clades));
  compare(await pos(), 'no layout change after clear');
  return { ck, measures: m };
}

/** S4 with one retry: if the checks fail at the first zoom level, zoom to readable rows and check again (both results are kept). */
async function checkColour(s, entry, t, caps, screenLabel, saveShot) {
  const first = await checkColourOnce(s, entry, t, caps, screenLabel, saveShot, 'auto');
  if (first.ck.allOk) return first;
  await s.call('setColouredClades', []).catch(() => {});
  await s.settle(150);
  const second = await checkColourOnce(s, entry, t, caps, screenLabel, saveShot, 'pitch');
  second.measures.firstAttempt = { failed: first.ck.failed.map((c) => `${c.name} (${c.detail})`), measures: first.measures };
  second.measures.retriedAfterZoom = true;
  return second;
}

/** S7/S8: aligned column cells versus tip positions on the tips that are on screen, at the fit view and after a real zoom. */
async function checkColumn(s, t, cols, col, caps, { minCells = 5, tol = 2, targetPitch = 14 } = {}) {
  const ck = new Checks();
  const m = {};
  await s.page.evaluate((c) => window.__spike.setColumns(c), cols);
  await s.settle(300);
  const withValue = new Set(Object.keys(col.values));
  const scan = async () => {
    const ids = [];
    const step = Math.max(1, Math.floor(t.tipCount / 400));
    for (let r = 0; r < t.tipCount && ids.length < 400; r += step) if (withValue.has(t.tipLabels[r])) ids.push(t.tipLabels[r]);
    return s.page.evaluate(
      async ({ ids, colId }) => {
        const out = [];
        for (const id of ids) {
          const p = await window.__spike.locate({ kind: 'tip', id });
          if (!p) continue;
          const c = await window.__spike.locateCell(colId, id);
          out.push({ id, p, c });
        }
        return out;
      },
      { ids, colId: col.id },
    );
  };
  const evalAlign = (rows, label) => {
    const withCell = rows.filter((r) => r.c);
    const dys = withCell.map((r) => Math.abs(r.c.y + r.c.height / 2 - r.p.y));
    const good = dys.filter((d) => d <= tol).length;
    m[label] = { visibleTips: rows.length, cells: withCell.length, aligned: good, maxDy: Math.max(0, ...dys) };
    if (rows.length === 0) return { na: true, withCell };
    ck.add(`${label}: at least ${minCells} tips with a drawn cell`, withCell.length >= minCells, `${withCell.length} of ${rows.length} on-screen tips have a cell`);
    ck.add(`${label}: cell centre within ${tol}px of tip row`, withCell.length > 0 && good / withCell.length >= 0.9, `${good}/${withCell.length} aligned, max dy ${fmt(Math.max(0, ...dys), 1)}px`);
    return { na: false, withCell };
  };
  let rows = await scan();
  if (rows.length < minCells && caps.focusTip?.level !== 'no') {
    // scroll-only viewers show too few tips at the fit view: look at the middle of the tree
    await bringTipIntoView(s, t.tipLabels[Math.floor(t.tipCount / 2)], caps);
    await s.settle(200);
    rows = await scan();
    m.focusedForFitView = true;
  }
  const first = evalAlign(rows, 'fit view');
  if (first.na) ck.add('fit view: some tip on screen', false, 'no tip with a value is on screen even after focusTip');
  // real zoom until rows are readable, then a small pan
  const rect = await s.containerRect();
  const pivot = rows.length ? rows[Math.floor(rows.length / 2)].id : null;
  if (pivot) {
    const rank = t.tipRank[t.tipIndex(pivot)];
    m.zoom = await zoomToPitch(s, t, rank, targetPitch);
    const c = centre(rect);
    await s.page.mouse.move(c.x, c.y);
    await s.page.mouse.down();
    await s.page.mouse.move(c.x - 30, c.y + 50, { steps: 6 });
    await s.page.mouse.up();
    await s.settle(250);
  }
  const rowsAfter = await scan();
  const after = evalAlign(rowsAfter, 'after zoom and pan');
  if (after.na) ck.na('after zoom and pan', 'no tip on screen after zooming and panning (the viewer moved the content away)');
  const sample = (after.na ? first : after).withCell;
  if (col.kind === 'bar') {
    const pts = sample.filter((r) => r.c).map((r) => [Number(col.values[r.id]), r.c.width]);
    if (pts.length >= 5) {
      const rho = spearman(pts.map((p) => p[0]), pts.map((p) => p[1]));
      m.barRankCorrelation = rho;
      ck.add('bar width increases with value (Spearman >= 0.7)', rho >= 0.7, `rho=${fmt(rho, 2)} over ${pts.length} cells`);
    } else ck.na('bar width follows value', `only ${pts.length} cells on screen`);
  }
  // drawn: pixels in the cell differ between columns on and off
  const pick = sample.filter((r) => r.c && r.c.height >= 3 && r.c.width >= 3).sort((p, q) => q.c.width - p.c.width)[0] ?? sample.filter((r) => r.c && r.c.height >= 1)[0];
  if (pick) {
    const r = { x: pick.c.x, y: pick.c.y - 1, width: Math.min(pick.c.width, 320), height: Math.max(pick.c.height, 3) + 2 };
    const on = await s.shot(r);
    await s.page.evaluate(() => window.__spike.setColumns([]));
    await s.settle(250);
    const off = await s.shot(r);
    await s.page.evaluate((c) => window.__spike.setColumns(c), cols);
    await s.settle(300);
    if (on && off) {
      const frac = diffCount(on.png, off.png, 20) / (on.png.width * on.png.height);
      m.cellDrawnFraction = frac;
      ck.add('cell is actually painted (pixels change when the column is removed)', frac >= 0.2, `${fmt(frac * 100, 0)}% of the cell rect changes`);
      if (col.kind === 'alignment') ck.add('alignment cell shows several residue colours', colourBuckets(on.png, 0.02) >= 3, `${colourBuckets(on.png, 0.02)} colour groups`);
    }
  }
  return { ck, measures: m };
}

// ------------------------------------------------------------------------------------------ S1 scale phase

export async function scalePhase(s, entry, partial, shots) {
  const t = truthTree(entry);
  const caps = await s.call('getCapabilities');
  partial.loadAvgAtStart = loadavg();
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
  partial.stats = await s.call('getStats');
  partial.domPierced = await s.domStats();
  if (partial.loadMs > 60000) {
    partial.status = 'timeout';
    partial.reason = `load ${fmt(partial.loadMs / 1000, 1)} s > ${THRESHOLDS.loadMs / 1000} s; interaction measures skipped`;
    partial.unusableFactor = partial.loadMs / THRESHOLDS.loadMs;
    return;
  }

  // click latency at the fit view (internal nodes near the root are large targets even for 100k tips)
  partial.phase = 'click latency';
  const lat = [], paint = [];
  const clades = pickClades(t, [0.3, 0.15, 0.08, 0.04, 0.02], { minTips: 2 });
  let hits = 0, tries = 0;
  for (const i of clades) {
    if (tries >= 5) break;
    const p = await locateNode(s, t, i, caps, 400);
    if (!p) continue;
    tries++;
    await s.metrics(() => Object.assign(window.__spikeMetrics.input, { lastEvent: 0, lastEventCommit: 0, lastEventPaint: 0 }));
    const ev = await s.clickAndWait(p, 0, 4000);
    const c = ev.find((e) => e.type.endsWith('Click'));
    if (!c) continue;
    if (c.nodeId === t.nodeId(i)) hits++;
    const im = await waitPaint(s, 8000);
    if (im.lastEvent >= im.pointerDown - 1 && im.pointerDown > 0) lat.push(Math.max(0, im.lastEvent - im.pointerDown));
    if (im.lastEventPaint > 0 && im.lastEventPaint >= im.lastEventCommit && im.lastEventCommit >= im.pointerDown) paint.push(im.lastEventPaint - im.pointerDown);
  }
  partial.clickLatencyMs = lat.length ? median(lat) : null;
  partial.clickToPaintMs = paint.length ? median(paint) : null;
  partial.clickSamples = { events: lat.length, tries, rightNode: hits };

  // 3 rounds of scripted wheel zoom and drag pan with the frame sampler (best of 3), then CPU per step
  partial.phase = 'pan/zoom';
  await s.page.evaluate(() => window.scrollTo(0, 0));
  const rect2 = await s.containerRect();
  const rounds = await interactionRounds(s, rect2, { rounds: 3, ms: 3500 });
  Object.assign(partial, summariseRounds(rounds));
  partial.fpsP95 = Math.max(...rounds.map((x) => x.p95Fps));
  partial.phase = 'cpu per step';
  Object.assign(partial, await cpuProbe(s, rect2, { capMs: 25000 }));
  partial.loadAvgAtEnd = loadavg();
  partial.heapAfterInteractionMB = await heapMB(s);
  partial.heapMB = partial.heapAfterInteractionMB ?? partial.heapAfterMountMB;
  partial.phase = 'done';

  const bad = [];
  const slow = [];
  if (partial.loadMs > THRESHOLDS.loadMs) bad.push(`load ${fmt(partial.loadMs / 1000, 1)} s > ${THRESHOLDS.loadMs / 1000} s`);
  if (partial.droppedRatio > THRESHOLDS.droppedRatio) bad.push(`${fmt(partial.droppedRatio * 100)}% of the time in frames > 50 ms (best of 3 rounds)`);
  else if (partial.droppedRatio > THRESHOLDS.sluggishDroppedRatio) slow.push(`${fmt(partial.droppedRatio * 100)}% of the time in frames > 50 ms`);
  if (partial.cpuMsPerStep > THRESHOLDS.cpuStepMs) bad.push(`${fmt(partial.cpuMsPerStep)} ms main-thread CPU per interaction step > ${THRESHOLDS.cpuStepMs}`);
  else if (partial.cpuMsPerStep > THRESHOLDS.sluggishCpuStepMs) slow.push(`${fmt(partial.cpuMsPerStep)} ms CPU per step`);
  if (partial.clickLatencyMs !== null && partial.clickLatencyMs > THRESHOLDS.clickMs) bad.push(`click latency ${fmt(partial.clickLatencyMs)} ms > ${THRESHOLDS.clickMs} ms`);
  partial.unusableFactor = Math.max(partial.loadMs / THRESHOLDS.loadMs, partial.cpuMsPerStep / THRESHOLDS.cpuStepMs, (partial.clickLatencyMs ?? 0) / THRESHOLDS.clickMs, partial.droppedRatio / THRESHOLDS.droppedRatio);
  const base = `load ${fmt(partial.loadMs)} ms, median ${fmt(partial.fpsMedian, 1)} fps, best p5 ${fmt(partial.fpsP5, 1)}, dropped ${fmt(partial.droppedRatio * 100)}%, CPU/step ${fmt(partial.cpuMsPerStep)} ms, click ${partial.clickLatencyMs === null ? 'n/a' : fmt(partial.clickLatencyMs) + ' ms'}`;
  if (bad.length) {
    partial.status = 'timeout';
    partial.reason = 'unusable: ' + bad.join('; ');
  } else if (lat.length === 0 && caps.internalNodeClick?.level !== 'no') {
    partial.status = 'partial';
    partial.reason = `${base}; no click event could be triggered on internal nodes at the fit view`;
  } else if (slow.length) {
    partial.status = 'partial';
    partial.reason = `sluggish: ${slow.join('; ')} (${base})`;
  } else {
    partial.status = 'pass';
    partial.reason = base;
  }
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
  /**
   * Tree for S5 and S15: an explicit flag wins; otherwise the default (10k Yule) if S1 mounted it within the load limit,
   * else the largest of 1k and 200 tips that S1 mounted (never above 1k); without S1 results the default.
   */
  const chooseTree = (flag, dflt) => {
    if (flag) return { id: flag, chosenBy: 'flag' };
    const r1 = opts.s1Results;
    if (!r1) return { id: dflt, chosenBy: 'default (no S1 result in this run)' };
    const ok = (id) => {
      const r = r1[id];
      return !!r && r.status !== 'skipped' && r.status !== 'fail' && !!r.loadMs && r.loadMs <= THRESHOLDS.loadMs;
    };
    if (ok(dflt)) return { id: dflt, chosenBy: 'default (S1 mounted it)' };
    for (const id of ['syn-yule-1000', 'syn-yule-200']) if (ok(id)) return { id, chosenBy: `fallback: ${dflt} did not mount within ${THRESHOLDS.loadMs / 1000} s in S1 (${r1[dflt]?.status ?? 'not run'}${r1[dflt]?.loadMs ? ', load ' + fmt(r1[dflt].loadMs / 1000, 1) + ' s' : ''})`, fallbackFrom: dflt };
    return { id: 'syn-yule-200', chosenBy: 'fallback: nothing above 200 tips mounted in S1', fallbackFrom: dflt };
  };

  const S = {};

  // -------------------------------------------------------------------- S1
  S.S1 = async () => {
    const trees = opts.scaleTrees;
    const out = { trees: {} };
    let first = true;
    let bigFactor = 0; // worst unusableFactor among the 5k to 20k-tip trees: decides whether bigger trees are tried at all
    for (const entry of trees) {
      const partial = { treeId: entry.id, tips: entry.tips, status: 'fail', reason: 'not run' };
      const t0 = Date.now();
      if (opts.deadline && Date.now() > opts.deadline) {
        Object.assign(partial, { status: 'skipped', reason: 'skipped: run time cap reached before this tree' });
        out.trees[entry.id] = partial;
        continue;
      }
      if (opts.skipLarge && entry.tips > 20000 && bigFactor > 10) {
        Object.assign(partial, { status: 'skipped', reason: `skipped: unusable at 10k (factor ${fmt(bigFactor)}x the threshold, rule: skip above 20k tips when the 10k rung is more than 10x over)` });
        out.trees[entry.id] = partial;
        log(`  S1 ${entry.id} (${entry.tips}): ${partial.reason}`);
        continue;
      }
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
          entry.tips >= 50000 ? 600000 : 240000,
        );
      } catch (e) {
        if (e instanceof TimeoutError) {
          partial.status = 'timeout';
          partial.reason = `${partial.phase ?? 'start'}: ${e.message}${partial.loadMs ? '' : ' (mount never finished)'}`;
        } else if (partial.loadMs && /Timeout \d+ms exceeded/.test(e.message)) {
          // mounted, but the page produced no frame for a screenshot within 30 s: unusable, not a candidate error
          partial.status = 'timeout';
          partial.reason = `${partial.phase ?? 'start'}: page unresponsive after mount (${e.message.split('\n')[0]})`;
          partial.unusableFactor = 1e3;
        } else {
          partial.status = 'fail';
          partial.reason = `${partial.phase ?? 'start'}: ${e.message.split('\n')[0]}`;
        }
      }
      partial.wallSec = (Date.now() - t0) / 1000;
      if (partial.unusableFactor === undefined && (partial.status === 'timeout' || partial.status === 'fail') && !partial.loadMs) partial.unusableFactor = 1e6; // never finished mounting
      if (entry.tips >= 5000 && entry.tips <= 20000 && partial.unusableFactor !== undefined && !/caterpillar/.test(entry.id)) bigFactor = Math.max(bigFactor, partial.unusableFactor);
      log(`  S1 ${entry.id} (${entry.tips}): ${partial.status}: ${partial.reason}`);
      out.trees[entry.id] = partial;
    }
    const all = Object.values(out.trees);
    const rs = all.filter((r) => r.status !== 'skipped');
    const sk = all.length - rs.length;
    const skNote = sk ? ` (${sk} larger tree(s) skipped: ${all.find((r) => r.status === 'skipped').reason})` : '';
    if (!rs.length) return result('fail', 'no trees run' + skNote);
    if (rs.every((r) => r.status === 'pass')) (out.status = 'pass'), (out.reason = `${rs.length} trees loaded, rendered and interactive${skNote}`);
    else if (rs.some((r) => r.status === 'pass')) {
      out.status = 'partial';
      out.reason = rs.filter((r) => r.status !== 'pass').map((r) => `${r.treeId}: ${r.status} (${r.reason})`).join('; ') + skNote;
    } else {
      out.status = worst(rs);
      out.reason = rs.map((r) => `${r.treeId}: ${r.status} (${r.reason})`).join('; ') + skNote;
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
      const pick = chooseTree(opts.s5Tree, 'syn-yule-10000');
      const entry = getEntry(pick.id);
      const t = truthTree(entry);
      const caps = await capsOf(s);
      const ck = new Checks();
      const m = { tree: entry.id, treeChosenBy: pick.chosenBy, treeFallbackFrom: pick.fallbackFrom ?? null };
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
      // a library that cannot draw a bar column (heat-map only, ...) declares candidate.columnKinds; test with the best kind it supports
      const declared = await s.page.evaluate(() => window.__spike.candidate.columnKinds ?? null);
      const kinds = declared ?? ['bar', 'text', 'alignment'];
      const bar = ['bar', 'text', 'alignment'].filter((k) => kinds.includes(k)).map((k) => lc.columns.find((c) => c.kind === k)).find(Boolean);
      if (!bar) return result('fail', `${entry.id} has no column of a supported kind (${kinds.join(', ')}) in the catalogue`);
      await mountOrThrow(s, entry);
      const { ck, measures } = await checkColumn(s, t, [bar], bar, caps);
      measures.columnKind = bar.kind;
      measures.declaredColumnKinds = declared;
      if (lc.tsvStats) measures.unmatched = { tipsWithoutRow: lc.tsvStats.tipsWithoutRow.length, rowsWithoutTip: lc.tsvStats.rowsWithoutTip.length };
      // an unmatched tip must not get a cell
      // a tip with no value in the column that was tested (FASTA rows for an alignment column, TSV rows for bar and text columns)
      const un = t.tipLabels.find((l) => !(l in bar.values));
      if (un) {
        await bringTipIntoView(s, un, caps);
        const c = await s.call('locateCell', bar.id, un);
        ck.add('tip without a data row gets no cell (explicitly unmatched)', c === null || c.width <= 2, c ? JSON.stringify(c) : 'null');
      }
      const fitOk = ck.list.filter((c) => c.name.startsWith('fit view')).every((c) => c.ok);
      const status = ck.allOk ? (bar.kind === 'bar' ? 'pass' : 'partial') : fitOk ? 'partial' : 'fail';
      return result(status, ck.reason(`${entry.id}, column ${bar.id} (kind ${bar.kind}${bar.kind === 'bar' ? '' : ': the library cannot draw bars, tested with its supported kind'}): `), { checks: ck.list, measures });
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
      const { ck, measures } = await checkColumn(s, t, [aln], aln, caps);
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
      let lightShot = await s.shot(rect);
      // hairline strokes at the fit view (uniform-fit SVG, WebGL): look at a zoomed view for every pixel check of this scenario
      m.inkAtFit = inkFraction(lightShot.png);
      if (m.inkAtFit < 0.003) {
        const t9 = truthTree(entry);
        const mid = Math.floor(t9.tipCount / 2);
        await bringTipIntoView(s, t9.tipLabels[mid], caps);
        await s.settle(150);
        m.zoom = await zoomToPitch(s, t9, mid, 14);
        m.pixelChecksAfterZoom = true;
        lightShot = await s.shot(rect);
      }
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
        let brFrac = countNear(sh.png, hexToRgb(br), 45);
        m.tokenBackgroundFraction = bgFrac;
        m.tokenBranchPixelsAtCurrentView = brFrac.count;
        if (brFrac.count < 30 && !m.pixelChecksAfterZoom) {
          // hairline strokes at the fit view cannot show the token colour: check again at readable rows
          const t9 = truthTree(entry);
          const mid = Math.floor(t9.tipCount / 2);
          await bringTipIntoView(s, t9.tipLabels[mid], caps);
          await s.settle(150);
          m.zoom = await zoomToPitch(s, t9, mid, 14);
          m.pixelChecksAfterZoom = true;
          const sh2 = await s.shot(rect);
          if (sh2) brFrac = countNear(sh2.png, hexToRgb(br), 45);
          m.tokenBranchChecked = 'after zooming to 14 px rows';
        }
        m.tokenBranchPixels = brFrac.count;
        ck.add('background token applied (dominant colour)', bgFrac > 0.4, `${fmt(bgFrac * 100)}% of pixels`);
        ck.add('branch token applied (pixels in branch colour)', brFrac.count >= 30, `${brFrac.count} pixels`);
      }
      const status = ck.allOk ? ((dark && tok) ? 'pass' : 'partial') : ck.list.some((c) => c.ok) ? 'partial' : 'fail';
      return result(status, ck.reason(`${entry.id}: `) + (dark ? '' : '; darkTheme=no') + (tok ? '' : '; cssTokens=no'), { checks: ck.list, measures: m, notes: ['per-node colour from a callback is covered by S4 (setColouredClades); no separate callback API in the contract'] });
    });

  // -------------------------------------------------------------------- S10
  S.S10 = () => {
    // tree: the largest one that mounted (S1 result), preferring the 100k Yule tree; software GL gets 600 s
    const mounted = (e) => {
      const r = opts.s1Results?.[e.id];
      return !r || (r.status !== 'skipped' && r.status !== 'fail' && r.loadMs && r.loadMs < 120000);
    };
    const list = opts.scaleTrees.slice().sort((a, b) => b.tips - a.tips).filter(mounted);
    const entry = list.find((e) => e.id === 'syn-yule-100000') ?? list[0] ?? getEntry('syn-yule-1000');
    const partial = { treeId: entry.id };
    const big = entry.tips >= 50000;
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
        const first = t.tipLabels[0], last = t.tipLabels[t.tipCount - 1];
        const wholeVisible = async () => {
          const [a, b] = await Promise.all([s.call('locate', { kind: 'tip', id: first }), s.call('locate', { kind: 'tip', id: last })]);
          if (a && b) return 'tips';
          // tips hidden inside collapsed clades: use the reported geometry of the root clade (strictly inside the container)
          const bb = await s.call('bounds', { kind: 'node', id: 'n0' });
          if (bb && bb.x >= rect.x - 1 && bb.y >= rect.y - 1 && bb.x + bb.width <= rect.x + rect.width + 1 && bb.y + bb.height <= rect.y + rect.height + 1 && (bb.height < rect.height - 4 || bb.width < rect.width - 4) && bb.height >= 0.3 * rect.height) return 'bounds';
          return null;
        };
        // 1. the view must really change SCALE when zooming in by wheel (a pan is not a zoom; otherwise nothing can be said)
        const mid = Math.floor(t.tipCount / 2);
        const metric = async () => {
          const rp = await rowPitch(s, t, mid);
          if (rp) return { kind: 'pitch', v: rp.pitch };
          const [a, b] = await Promise.all([s.call('locate', { kind: 'tip', id: first }), s.call('locate', { kind: 'tip', id: last })]);
          return a && b ? { kind: 'span', v: Math.hypot(a.x - b.x, a.y - b.y) } : null;
        };
        const before = { m: await metric(), wv: await wholeVisible() };
        await s.page.mouse.move(c.x, c.y);
        for (let k = 0; k < 12; k++) {
          await s.page.mouse.wheel(0, -120);
          await sleep(30);
        }
        await s.settle(250);
        const zoomed = { m: await metric(), wv: await wholeVisible() };
        partial.scaleBefore = before.m;
        partial.scaleAfter = zoomed.m;
        const changed = before.m && zoomed.m && before.m.kind === zoomed.m.kind ? Math.abs(zoomed.m.v / before.m.v - 1) > 0.1 : before.wv !== zoomed.wv;
        partial.zoomInChangedView = changed;
        await s.page.mouse.down();
        await s.page.mouse.move(c.x - 200, c.y - 120, { steps: 8 });
        await s.page.mouse.up();
        await s.settle(250);
        if (!changed) {
          return result('n/a', `${entry.id}: wheel zoom-in did not change the view (whole tree stays at the same size and position, so a zoom-out cannot be tested; the viewer may pan or scroll instead of zooming with a plain wheel)`, { measures: partial, checks: ck.list });
        }
        // 2. zoom out with real wheel input until the whole tree is back in view
        await s.metrics(() => window.__spikeMetrics.startSampler());
        let notches = 0, how = null;
        const t0 = Date.now();
        const limitMs = big ? 300000 : 90000;
        while (notches < 90 && Date.now() - t0 < limitMs) {
          for (let k = 0; k < 3; k++) {
            await s.page.mouse.wheel(0, 120);
            await sleep(16);
            notches++;
          }
          how = await wholeVisible();
          if (how) break;
        }
        const fps = await s.metrics(() => window.__spikeMetrics.stopSampler());
        partial.notches = notches;
        partial.zoomOutSec = (Date.now() - t0) / 1000;
        partial.wholeTreeBy = how;
        Object.assign(partial, { fpsMedian: fps.medianFps, fpsP5: fps.p5Fps, droppedRatio: fps.slowTimeFrac, maxFrameGapMs: fps.maxIntervalMs, droppedFrames: fps.droppedFrames });
        await s.settle(400);
        const sh = await s.shot(rect);
        if (sh) {
          partial.inkAfterZoomOut = inkFraction(sh.png);
          saveShot(`S10-zoomed-out-${entry.id}`, sh.buf);
        }
        partial.stats = await s.call('getStats');
        partial.domPierced = await s.domStats();
        ck.add('whole tree in view after zooming out by wheel (first and last tip locatable, or root bounds inside the container)', !!how, `after ${notches} wheel notches${how ? ' via ' + how : ''}`);
        ck.add('tree still drawn when zoomed out', (partial.inkAfterZoomOut ?? 0) > 0.0005);
        ck.add('no freeze: longest frame gap < 2 s', fps.maxIntervalMs < 2000, `${fmt(fps.maxIntervalMs)} ms`);
        const smooth = fps.slowTimeFrac <= THRESHOLDS.droppedRatio;
        const status = !how || !ck.list[1].ok ? 'fail' : !ck.list[2].ok ? 'timeout' : smooth ? 'pass' : 'partial';
        const reason = ck.reason(`${entry.id}: `) + `; while zooming out median ${fmt(fps.medianFps, 1)} fps, ${fmt(fps.slowTimeFrac * 100)}% of the time in frames > 50 ms, DOM nodes ${partial.domPierced.nodes} (shadow DOM included), canvases ${partial.domPierced.canvases}` + (how && !smooth ? ' (more than half of the time in slow frames)' : '') + `; overviewOrMinimap self-report: ${caps.overviewOrMinimap?.level}`;
        return result(status, reason, { checks: ck.list, measures: partial });
      },
      big ? 900000 : 300000,
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
      /**
       * x positions of tips that are on screen; when fewer than 5 are visible (scroll-only viewers) the view is moved
       * with focusTip to three spread places and the samples are merged (the horizontal position does not change).
       */
      const sampleX = async (t, ids = null) => {
        const want = ids ?? spreadTips(t, 400);
        let vis = await scanVisible(s, want);
        if (vis.length >= 5 || caps.focusTip?.level === 'no') return vis;
        const seen = new Map(vis.map((v) => [v.id, v.p]));
        for (const f of [0.15, 0.5, 0.85]) {
          const mid = Math.floor(t.tipCount * f);
          await bringTipIntoView(s, t.tipLabels[mid], caps);
          await s.settle(120);
          const near = t.tipLabels.slice(Math.max(0, mid - 200), mid + 200);
          for (const v of await scanVisible(s, near)) seen.set(v.id, v.p);
        }
        return [...seen].map(([id, p]) => ({ id, p }));
      };
      // non-ultrametric: x must follow cumulative length
      const e1 = getEntry('rich-ens-protein-197');
      const t1 = truthTree(e1);
      await mountOrThrow(s, e1, { branchLengths: true });
      const v1 = await sampleX(t1);
      m.visibleTips = v1.length;
      const x1 = new Map(v1.map((v) => [v.id, v.p.x]));
      const r1 = pearson(v1.map((v) => v.p.x), v1.map((v) => t1.cumLength[t1.tipIndex(v.id)]));
      m.phylogramPearson = r1;
      if (v1.length < 5) ck.add('phylogram: at least 5 tips measurable', false, `only ${v1.length} tips on screen`);
      else ck.add('phylogram: tip x follows root-to-tip length (Pearson >= 0.97)', r1 >= 0.97, `r=${fmt(r1, 3)} over ${v1.length} visible tips`);
      await s.call('setBranchLengths', false);
      await s.settle(300);
      const v2 = (await sampleX(t1, v1.map((v) => v.id))).filter((v) => x1.has(v.id));
      const r2 = pearson(v2.map((v) => v.p.x), v2.map((v) => t1.cumLength[t1.tipIndex(v.id)]));
      const moved = v2.reduce((a, v) => a + Math.abs(v.p.x - x1.get(v.id)), 0) / Math.max(1, v2.length);
      m.cladogramPearson = r2;
      m.meanTipShiftPx = moved;
      if (v2.length < 5) ck.add('cladogram: at least 5 tips measurable', false, `only ${v2.length}`);
      else {
        ck.add('toggle to cladogram changes the layout (tips move)', moved >= 3, `mean tip shift ${fmt(moved, 1)} px over ${v2.length} tips`);
        ck.add('cladogram no longer proportional to length', Number.isFinite(r2) ? r2 < r1 - 0.05 : true, `r ${fmt(r1, 3)} -> ${fmt(r2, 3)}`);
      }
      await s.call('setBranchLengths', true);
      await s.settle(300);
      const v3 = (await sampleX(t1, v1.map((v) => v.id))).filter((v) => x1.has(v.id));
      const r3 = pearson(v3.map((v) => v.p.x), v3.map((v) => t1.cumLength[t1.tipIndex(v.id)]));
      ck.add('toggling back restores the phylogram', r3 >= 0.97, `r=${fmt(r3, 3)}`);
      // ultrametric dated tree: tips aligned in a phylogram
      const e2 = getEntry('rich-corvoid-680');
      const t2 = truthTree(e2);
      await mountOrThrow(s, e2, { branchLengths: true });
      const rect = await s.containerRect();
      const v4 = await sampleX(t2);
      const xs = v4.map((v) => v.p.x);
      const spread = xs.length ? (Math.max(...xs) - Math.min(...xs)) / rect.width : NaN;
      m.ultrametricTipSpread = spread;
      m.ultrametricTips = xs.length;
      if (xs.length < 5) ck.na('dated phylogram tips aligned', `only ${xs.length} tips on screen`);
      else ck.add('dated (ultrametric) phylogram: tips end at the same x (spread < 2% of width)', spread < 0.02, `spread ${fmt(spread * 100, 2)}% over ${xs.length} tips`);
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
      // the two-instance clash test runs even when the adapter says multipleInstances=no, so the clash is observed, not assumed
      m.adapterReportsMultipleInstances = `${caps.multipleInstances?.level}: ${caps.multipleInstances?.how}`;
      try {
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
        const stats0 = await s.domStats();
        ck.add('unmount leaves nothing in the container', stats0.nodes === 0 && stats0.canvases === 0, `domNodes=${stats0.nodes} (shadow DOM included) canvases=${stats0.canvases}`);
      } catch (e) {
        ck.add('two-instance test ran without exceptions', false, String(e.message).split('\n')[0]);
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
      const crit = ck.list.filter((c) => /second instance|cross|reaches|five mount|two-instance|survives|both instances/.test(c.name) && !c.ok);
      const status = ck.allOk ? 'pass' : crit.length ? 'fail' : 'partial';
      return result(status, ck.reason('') + `; adapter self-report: multipleInstances=${caps.multipleInstances?.level}`, { checks: ck.list, measures: m });
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
      const tipSet = new Set(t.tipLabels);
      // distinct focusable elements inside the tree container, identified by element identity (not by number of Tab presses)
      const describe = () =>
        s.page.evaluate(() => {
          const a = document.activeElement;
          const c = document.querySelector('[data-testid=tree-container]');
          if (!a || !c || !c.contains(a) || a === c) return null;
          if (a.__spikeTab === undefined) a.__spikeTab = (window.__spikeTabSeq = (window.__spikeTabSeq || 0) + 1);
          const name = (a.getAttribute('aria-label') || a.getAttribute('data-tip-id') || a.getAttribute('data-tip-label') || a.textContent || a.getAttribute('title') || '').trim().slice(0, 80);
          return { uid: a.__spikeTab, tag: a.tagName.toLowerCase(), role: a.getAttribute('role'), name, tipAttr: a.getAttribute('data-tip-id') || a.getAttribute('data-tip-label') };
        });
      const tabThrough = async (label) => {
        await s.page.evaluate(() => {
          document.body.focus();
          if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        });
        const distinct = new Map();
        let outside = 0;
        for (let k = 0; k < 220; k++) {
          await s.page.keyboard.press('Tab');
          const d = await describe();
          if (d) {
            distinct.set(d.uid, d);
            outside = 0;
          } else if (distinct.size > 0 && ++outside > 3) break; // left the container
          if (distinct.size >= 8) break;
        }
        m[label] = [...distinct.values()];
        return [...distinct.values()];
      };
      const isTipTarget = (d) => (d.tipAttr && tipSet.has(d.tipAttr)) || tipSet.has(d.name);
      let seen = await tabThrough('tabAtFit');
      let usedFocus = false;
      if (!(seen.length >= 3 && seen.some(isTipTarget)) && caps.focusTip?.level !== 'no') {
        await s.call('focusTip', t.tipLabels[Math.floor(t.tipCount / 2)]);
        await s.settleLocate({ kind: 'tip', id: t.tipLabels[Math.floor(t.tipCount / 2)] });
        await s.settle(250);
        seen = await tabThrough('tabAfterFocusTip');
        usedFocus = true;
        m.neededFocusTip = true;
      }
      const named = seen.filter((d) => d.name);
      const tipTargets = seen.filter(isTipTarget);
      m.distinctFocusable = seen.length;
      m.tipLevelTargets = tipTargets.length;
      ck.add('Tab reaches at least 3 DISTINCT focusable elements inside the tree', seen.length >= 3, `${seen.length} distinct elements (${[...new Set(seen.map((d) => d.tag + (d.role ? '[' + d.role + ']' : '')))].join(', ') || 'none'})`);
      ck.add('at least one tip-level target (named like a tip) is reachable by Tab', tipTargets.length >= 1, tipTargets.length ? tipTargets.slice(0, 2).map((d) => d.name).join(', ') : 'only container-level targets (for example one canvas)');
      ck.add('focusable elements have accessible names', seen.length > 0 && named.length >= Math.min(3, seen.length), `${named.length}/${seen.length} named`);
      const sem = await s.page.evaluate(() => {
        const c = document.querySelector('[data-testid=tree-container]');
        const roles = Array.from(c.querySelectorAll('[role]')).map((e) => e.getAttribute('role'));
        return { roles: [...new Set(roles)], labelled: !!c.querySelector('[aria-label],[aria-labelledby]'), textFallback: c.querySelectorAll('table,ul,ol').length > 0 };
      });
      m.semantics = sem;
      ck.add('tree container exposes a role/label or a text fallback', sem.roles.length > 0 || sem.labelled || sem.textFallback, JSON.stringify(sem));
      const focusedTip = seen.find(isTipTarget) && (await describe());
      if (tipTargets.length) {
        // Enter on the last focused tip-level element should activate it
        await s.page.evaluate((uid) => {
          for (const el of document.querySelectorAll('[data-testid=tree-container] *')) if (el.__spikeTab === uid) el.focus();
        }, tipTargets[0].uid);
        await s.call('clearEvents');
        await s.page.keyboard.press('Enter');
        await sleep(250);
        m.enterActivates = (await s.events()).some((e) => e.type === 'tipClick');
      }
      void focusedTip;
      const status = ck.allOk ? 'pass' : ck.list.some((c) => c.ok) && seen.length > 0 ? 'partial' : 'fail';
      return result(status, ck.reason('') + (usedFocus ? '; tips were not focusable at the fit view, only after focusTip' : '') + (m.enterActivates === false ? '; Enter on a focused tip does not fire a click event' : ''), { checks: ck.list, measures: m });
    });

  // -------------------------------------------------------------------- S15
  S.S15 = () =>
    session('S15', async (s) => {
      const pick = chooseTree(opts.s15Tree, 'syn-yule-10000');
      const entry = getEntry(pick.id);
      const caps = await capsOf(s);
      const u = unsupported(caps, 'internalNodeClick');
      if (u) return u;
      const ck = new Checks();
      const m = { tree: entry.id, treeChosenBy: pick.chosenBy, treeFallbackFrom: pick.fallbackFrom ?? null };
      const target = entry.tips >= 5000 ? 1000 : 300;
      const t = truthTree(entry);
      const [i] = pickClades(t, [target / t.tipCount], { minTips: 20 });
      const nodeId = t.nodeId(i);
      const truthN = t.tipCountOf(i);
      m.cladeTips = truthN;
      await mountOrThrow(s, entry);
      await s.page.evaluate(() => window.__spikeShell.setLinkedView(true));
      const colour = await s.page.evaluate(() => window.__spikeShell.linkedColour);
      const commit = [], paint = [];
      let okCount = 0, unmeasured = 0;
      for (let k = 0; k < 5; k++) {
        const p = await locateNode(s, t, i, caps, 800); // focusTip on tips of the clade first (scroll-only viewers)
        if (!p) {
          ck.add(`click ${k + 1}: node locatable`, false, 'locate null even after focusTip on tips of the clade');
          break;
        }
        await s.call('clearEvents');
        // reset the marks so that nothing stale from a previous click can be read as this click's paint
        await s.metrics(() => Object.assign(window.__spikeMetrics.input, { lastEvent: 0, lastEventCommit: 0, lastEventPaint: 0 }));
        await s.page.mouse.move(p.x, p.y);
        await s.page.mouse.click(p.x, p.y);
        const t0 = Date.now();
        let st;
        while (Date.now() - t0 < 30000) {
          st = await s.reactState();
          if (st.mapCount === truthN && st.clades?.length === 1) break;
          await sleep(10);
        }
        const im = await waitPaint(s, 30000); // the first frame after the commit, same performance.now() clock as the pointerdown timestamp
        st = await s.reactState();
        const good = st.mapCount === truthN && st.mapNode === nodeId && st.clades?.[0]?.nodeId === nodeId;
        if (good) okCount++;
        const valid = im.pointerDown > 0 && im.lastEvent >= im.pointerDown - 1 && im.lastEventCommit >= im.lastEvent && im.lastEventPaint >= im.lastEventCommit;
        commit.push(im.lastEventCommit > 0 && im.lastEventCommit >= im.pointerDown ? im.lastEventCommit - im.pointerDown : NaN);
        if (valid) paint.push(im.lastEventPaint - im.pointerDown);
        else unmeasured++;
        await s.page.evaluate(() => window.__spike.setColouredClades([]));
        await s.settle(150);
        await s.page.mouse.move(p.x - 30, p.y + 30);
      }
      ck.add(`map panel shows ${truthN} tips and the clade is in React state (all 5 clicks)`, okCount === 5, `${okCount}/5 clicks ended correctly`);
      ck.add('click-to-paint measurable for at least 3 of 5 clicks (a frame after the commit, never before the click)', paint.length >= 3, `${paint.length} valid, ${unmeasured} not measurable`);
      m.clickToCommitMs = commit;
      m.clickToPaintMs = paint;
      m.medianCommitMs = median(commit.filter(Number.isFinite));
      m.medianPaintMs = paint.length ? median(paint) : null;
      // pixel check: colour the clade through the same React state the click uses; after zooming in if its strokes are sub-pixel at the fit view
      try {
        let z = await zoomIntoClade(s, t, i, caps);
        let b = await s.call('bounds', { kind: 'node', id: nodeId });
        const tint = async (bb) => {
          const base = await s.shot(bb);
          await s.call('setColouredClades', [{ nodeId, colour }]);
          await s.settle(250);
          const after = await s.shot(bb);
          await s.call('setColouredClades', []);
          await s.settle(150);
          return base && after ? tintCount(after.png, base.png, hexToRgb(colour), 40) : { frac: NaN, count: 0 };
        };
        if (b) {
          let f = await tint(b);
          if (!(f.frac >= 0.001 && f.count >= 20)) {
            // retry at readable rows (marker outlines can hide the fill in big views)
            const mid = (t.leafStart[i] + t.leafEnd[i]) >> 1;
            await bringTipIntoView(s, t.tipLabels[mid], caps);
            await s.settle(150);
            const zz = await zoomToPitch(s, t, mid, 14);
            const b2 = await s.call('bounds', { kind: 'node', id: nodeId });
            if (b2) {
              m.pixelCheckFirstAttempt = { frac: f.frac, pixels: f.count };
              z = { ...z, retriedAtRowPitch14: zz };
              b = b2;
              f = await tint(b2);
              await s.call('setColouredClades', [{ nodeId, colour }]);
              await s.settle(200);
            }
          } else {
            await s.call('setColouredClades', [{ nodeId, colour }]);
            await s.settle(200);
          }
          m.redFractionAfterColour = f.frac;
          m.pixelCheck = { afterZoom: z.zoomed, zoom: z };
          ck.add(`clade is red (>= 0.1% of the clade box and >= 20 px move towards red)${z.zoomed ? ' [checked after zooming in]' : ''}`, f.frac >= 0.001 && f.count >= 20, `${fmt(f.frac * 100, 2)}% of the clade box, box ${fmt(b.height)} px tall`);
          const sh = await s.shot(await s.containerRect());
          if (sh) saveShot('S15-linked-view', sh.buf);
        } else ck.add('clade bounds available for the pixel check', false);
      } catch (e) {
        ck.add('pixel check ran', false, String(e.message).split('\n')[0]);
      }
      const mp = m.medianPaintMs;
      let status = ck.allOk ? 'pass' : 'fail';
      let reason = ck.reason(`${entry.id}, ${truthN}-tip clade${pick.fallbackFrom ? ` (fallback tree: ${pick.chosenBy})` : ''}: `);
      if (!ck.allOk && ck.failed.length === 1 && ck.failed[0].name.startsWith('click-to-paint')) {
        status = 'partial';
        reason += '; the click-to-paint time could not be measured, so the latency verdict is withheld';
      }
      if (ck.allOk) {
        reason += `; click to React commit ${fmt(m.medianCommitMs)} ms, to paint ${fmt(mp)} ms (median of ${paint.length})`;
        if (mp > THRESHOLDS.clickMs) (status = 'timeout'), (reason += ` > ${THRESHOLDS.clickMs} ms (unusable)`);
        else if (mp > THRESHOLDS.linkedMs) (status = 'partial'), (reason += ` > ${THRESHOLDS.linkedMs} ms target (spec: about 100 ms)`);
      }
      return result(status, reason, { checks: ck.list, measures: m });
    });

  return S;
}
