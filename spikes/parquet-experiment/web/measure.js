// Measurement functions executed inside the page (called from run-browser.mjs through page.evaluate).
import { ParquetTreeSource } from './reader.js';

const heap = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
const typedBytes = (o) => Object.values(o).reduce((a, x) => a + (x && x.byteLength ? x.byteLength : 0), 0);
const snap = (s) => ({ requests: s.requests, bytes: s.bytes });
const diff = (a, b) => ({ requests: b.requests - a.requests, bytes: b.bytes - a.bytes });

/** Time to first usable overview: manifest + overview level 0 (+ footer), decode included. Returns the source for further steps. */
export async function overviewFirst(base, opts = {}) {
  const h0 = heap();
  const t0 = performance.now();
  const src = await ParquetTreeSource.open(base, opts);
  const t1 = performance.now();
  const ov = await src.getOverview(0);
  const t2 = performance.now();
  // "usable": the drawing inputs exist - check a triangle can be formed from the rows
  const draw = ov.node.length;
  window.__src = src;
  return { ms: t2 - t0, manifestMs: t1 - t0, overviewMs: t2 - t1, rows: draw, requests: src.stats.requests, bytes: src.stats.bytes, typedBytes: typedBytes(ov), heapDelta: heap() - h0, manifestBytes: JSON.stringify(src.man).length };
}

/** Footers of nodes.parquet and tips.parquet (parallel, one request each). */
export async function warmFooters() {
  const src = window.__src; const a = snap(src.stats); const t0 = performance.now();
  await Promise.all([src._meta('nodes'), src._meta('tips')]);
  return { ms: performance.now() - t0, ...diff(a, snap(src.stats)) };
}

export async function overviewLevel(level) {
  const src = window.__src; const a = snap(src.stats); const t0 = performance.now();
  const ov = await src.getOverview(level);
  return { level, ms: performance.now() - t0, rows: ov.node.length, typedBytes: typedBytes(ov), ...diff(a, snap(src.stats)) };
}

function dropData(src) {
  for (const f of Object.values(src.files)) { f.blocks = []; f.whole = null; }
  src.ovCache.clear(); src._ovPrimed = null; src._spine = null;
}

/** Fetch one clade: node rows [node, subtree_end) for the numeric columns, and optionally its tip labels, from a cold byte cache. */
export async function fetchClade(node, end, leafStart, tips, withLabels, columns) {
  const src = window.__src; dropData(src);
  const a = snap(src.stats); const h0 = heap(); const t0 = performance.now();
  const jobs = [src.getRange(node, end, columns)];
  if (withLabels) jobs.push(src.getTips(leafStart, leafStart + tips, ['tip_label']));
  const [nd, tp] = await Promise.all(jobs);
  const ms = performance.now() - t0;
  return { ms, ...diff(a, snap(src.stats)), nodeRows: end - node, tips, typedBytes: typedBytes(nd) + (tp ? 0 : 0), labels: tp ? tp.tip_label.length : 0, heapDelta: heap() - h0 };
}

/** Pure decode cost: read the same rows twice; the second read is served from the byte cache, so it is decode + assembly only. */
export async function decodeBench(lo, hi, columns, reps = 3) {
  const src = window.__src; dropData(src);
  await src.getRange(lo, hi, columns);
  let best = Infinity;
  for (let i = 0; i < reps; i++) { const t0 = performance.now(); await src.getRange(lo, hi, columns); best = Math.min(best, performance.now() - t0); }
  return { rows: hi - lo, ms: best, msPer100k: (best / (hi - lo)) * 1e5 };
}

export async function decodeBenchTips(lo, hi, columns, reps = 3) {
  const src = window.__src; dropData(src);
  await src.getTips(lo, hi, columns);
  let best = Infinity;
  for (let i = 0; i < reps; i++) { const t0 = performance.now(); await src.getTips(lo, hi, columns); best = Math.min(best, performance.now() - t0); }
  return { rows: hi - lo, ms: best, msPer100k: (best / (hi - lo)) * 1e5 };
}

/** Root-to-tip path of a tip node. */
export async function path(node) {
  const src = window.__src; dropData(src);
  const a = snap(src.stats); const t0 = performance.now();
  const p = await src.getPath(node);
  return { ms: performance.now() - t0, depth: p.node.length, ...diff(a, snap(src.stats)) };
}

/** label -> rank lookup (cold): footer + one row group of labels.parquet. */
export async function tipRank(rank) {
  const src = window.__src;
  const label = (await src.getTips(rank, rank + 1, ['tip_label'])).tip_label[0];
  dropData(src); src.meta.labels = null;
  const a = snap(src.stats); const t0 = performance.now();
  const r = await src.tipRankOf(label);
  return { ms: performance.now() - t0, ok: r === rank, ...diff(a, snap(src.stats)) };
}

/** Occurrence-page case: focus a tip = path + smallest ancestor clade with >= minTips tips + the overview level that covers its ancestors. */
export async function focusTip(node, minTips) {
  const src = window.__src; dropData(src);
  const a = snap(src.stats); const t0 = performance.now();
  const r = await src.focusTip(node, minTips);
  return { ms: performance.now() - t0, depth: r.path.node.length, cladeTips: r.clade.tips, cladeRows: r.cladeRows, level: r.level, overviewRows: r.overviewRows, ...diff(a, snap(src.stats)) };
}

/** Tip metadata: occurrence_count for tip ranks [r0, r1) vs all of the row groups, to show column selection. */
export async function tipColumns(r0, r1, columns) {
  const src = window.__src; dropData(src);
  const a = snap(src.stats); const t0 = performance.now();
  await src.getTips(r0, r1, columns);
  return { ms: performance.now() - t0, columns, rows: r1 - r0, ...diff(a, snap(src.stats)) };
}

/** Whole-tree via Parquet (every row group of nodes + labels) for comparison with the Newick download. */
export async function fullParquet() {
  const src = window.__src; dropData(src);
  const a = snap(src.stats); const t0 = performance.now();
  const n = src.man.nodes, k = src.man.tips;
  await Promise.all([src.getRange(0, n), src.getTips(0, k, ['tip_label'])]);
  return { ms: performance.now() - t0, ...diff(a, snap(src.stats)) };
}

export function heapNow() { return heap(); }

/** JS heap and typed-array bytes held after loading overview level 0 (+ optionally one clade with labels), after a forced GC. */
export async function memoryHeld(cl) {
  const src = window.__src; dropData(src);
  gc(); const h0 = heap();
  const ov = await src.getOverview(0);
  window.__held = { ov };
  if (cl) {
    const [nd, tp] = await Promise.all([src.getRange(cl.node, cl.end), src.getTips(cl.leaf_start, cl.leaf_start + cl.tips, ['tip_label'])]);
    window.__held.nd = nd; window.__held.tp = tp;
  }
  dropData(src);           // transport cache gone; what remains is what a viewer would keep
  gc(); const h1 = heap();
  const typed = typedBytes(ov) + (window.__held.nd ? typedBytes(window.__held.nd) : 0);
  return { heapDelta: h1 - h0, typedBytes: typed, labels: window.__held.tp ? window.__held.tp.tip_label.length : 0 };
}
