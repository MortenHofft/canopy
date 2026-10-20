// ParquetSource: a TreeSource over a Parquet-converted tree (spikes/parquet-experiment: overview.parquet pyramid, nodes.parquet,
// tips.parquet, manifest.json) read with HTTP range requests. The first snapshot is built from the overview alone (level 0: about
// 2,000 rows whatever the tree size); every internal node that is not expanded there is a STUB row that carries its rollups, so the
// renderer draws it as a triangle and a click on it still reports the tip range. ensureClade() turns a stub into rows: a small clade
// is read from nodes.parquet (one coalesced range request per few row groups), a clade too big for that makes the next overview
// level part of the snapshot instead (level l+1 holds the next-largest clades of the WHOLE tree, 6k to 98k rows).
//
// The snapshot is rebuilt from scratch whenever the loaded set changes (O(rows loaded), a few ms for 10^5 rows): rows of the overview
// that lie inside a loaded clade are dropped, loaded rows are spliced in at their preorder position, parent / firstChild /
// subtreeEnd are recomputed over the local rows. Row order is preorder of the full tree, so a loaded clade is still a contiguous
// range and the renderer's cut keeps jumping with subtreeEnd.
//
// Not built (see docs/results/treesource-slice.md): tip labels (tipLabels() is async and reads tips.parquet, the snapshot has none),
// label search, per-tip columns, eviction (trim), retry / error UI, path-to-tip (ensureTip), a worker for decoding.

import { ParquetTreeSource, type Cols } from '../../../parquet-experiment/web/reader.js';
import type { EnsureOptions, TreeSource } from '../core/source.ts';
import type { RollupData, TreeSnapshot } from '../core/types.ts';

const MAX_CLADE_ROWS = 65536; // a clade up to this many rows is read from nodes.parquet (4 row groups of 16,384)

interface Loaded { lo: number; hi: number; cols: Cols }

export interface ParquetStats { requests: number; bytes: number; rows: number; stubs: number; loadedClades: number; overviewLevel: number; snapshotMs: number }

export class ParquetSource implements TreeSource {
  readonly nodeCount: number;
  readonly tipCount: number;
  readonly hasLengths: boolean;
  version = 1;
  private listeners = new Set<(v: number) => void>();
  private snap: TreeSnapshot | null = null;
  private snapMs = 0;
  private level = 0;
  private ov!: { n: number; node: Int32Array; parent: Int32Array; end: Int32Array; leaf: Int32Array; count: Int32Array; len: Float64Array; cum: Float64Array; maxCum: Float64Array; depth: Int32Array; maxDepth: Int32Array; row: Float64Array; stub: Uint8Array };
  private loaded: Loaded[] = []; // disjoint, sorted by lo
  private inflight = new Map<number, Promise<void>>();
  private destroyed = false;
  private readonly noLabels: string[]; // tip labels by rank: empty slots, labels are not part of the snapshot (shared by all snapshots)

  private constructor(private readonly r: ParquetTreeSource) {
    this.nodeCount = r.man.nodes;
    this.tipCount = r.man.tips;
    this.hasLengths = r.man.has_lengths;
    this.noLabels = new Array<string>(this.tipCount);
  }

  /** manifest.json plus the tail of overview.parquet (level 0 and the footer): two requests. */
  static async open(baseUrl: string, o: { level?: number; fetch?: typeof fetch } = {}): Promise<ParquetSource> {
    const r = await ParquetTreeSource.open(baseUrl.replace(/\/+$/, ''), { fetch: o.fetch });
    const s = new ParquetSource(r);
    await s.setLevel(o.level ?? 0);
    return s;
  }

  get stats(): ParquetStats {
    const sn = this.snapshot();
    let stubs = 0;
    const st = sn.stub!;
    for (let i = 0; i < st.length; i++) stubs += st[i];
    return { requests: this.r.stats.requests, bytes: this.r.stats.bytes, rows: sn.nodeCount, stubs, loadedClades: this.loaded.length, overviewLevel: this.level, snapshotMs: this.snapMs };
  }
  get requestLog(): Array<[string, number, number]> { return this.r.stats.log; }

  subscribe(fn: (v: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private bump(): void {
    this.version++;
    this.snap = null;
    for (const f of this.listeners) f(this.version);
  }

  // ------------------------------------------------------------------ overview

  /** Overview rows of levels 0..level as one preorder-sorted row set. A node can appear twice (as a stub row of the level that
   *  expanded its parent and as an expanded row of the level that expanded it): the copy with the smaller sel_level wins. */
  private async setLevel(level: number, notify = false): Promise<void> {
    const a = await this.r.getOverview(level);
    const node = a.node as Int32Array, sel = a.sel_level as Uint8Array | Int32Array, N = node.length;
    const order = new Int32Array(N);
    for (let i = 0; i < N; i++) order[i] = i;
    order.sort((p, q) => node[p] - node[q] || sel[p] - sel[q]);
    const keep: number[] = [];
    for (let k = 0; k < N; k++) if (k === 0 || node[order[k]] !== node[order[k - 1]]) keep.push(order[k]);
    const n = keep.length;
    const f = (name: string): ArrayLike<number> => a[name] as ArrayLike<number>;
    const ov = { n, node: new Int32Array(n), parent: new Int32Array(n), end: new Int32Array(n), leaf: new Int32Array(n), count: new Int32Array(n), len: new Float64Array(n), cum: new Float64Array(n), maxCum: new Float64Array(n), depth: new Int32Array(n), maxDepth: new Int32Array(n), row: new Float64Array(n), stub: new Uint8Array(n) };
    for (let k = 0; k < n; k++) {
      const s = keep[k];
      ov.node[k] = node[s]; ov.parent[k] = f('parent')[s]; ov.end[k] = f('subtree_end')[s]; ov.leaf[k] = f('leaf_start')[s]; ov.count[k] = f('tip_count')[s];
      ov.len[k] = f('len')[s]; ov.cum[k] = f('cum_len')[s]; ov.maxCum[k] = f('max_cum')[s]; ov.depth[k] = f('depth')[s]; ov.maxDepth[k] = f('max_depth')[s]; ov.row[k] = f('row')[s];
      ov.stub[k] = ov.end[k] > ov.node[k] + 1 && sel[s] > level ? 1 : 0; // internal and not expanded at this level
    }
    this.ov = ov;
    this.level = level;
    if (notify) this.bump(); else { this.snap = null; }
  }

  // ------------------------------------------------------------------ snapshot

  snapshot(): TreeSnapshot {
    if (!this.snap) {
      const t0 = performance.now();
      this.snap = this.build();
      this.snapMs = performance.now() - t0;
    }
    return this.snap;
  }

  private build(): TreeSnapshot {
    const { ov, loaded } = this;
    // 1. the row set in preorder: overview rows outside every loaded clade, and the loaded rows
    let total = 0;
    for (const c of loaded) total += c.hi - c.lo;
    let k = 0;
    const keepOv: number[] = [];
    for (let i = 0; i < ov.n; i++) {
      const g = ov.node[i];
      while (k < loaded.length && loaded[k].hi <= g) k++;
      if (k < loaded.length && loaded[k].lo <= g) continue; // inside a loaded clade
      keepOv.push(i);
    }
    const n = keepOv.length + total;
    const gid = new Int32Array(n), parentG = new Int32Array(n), endG = new Int32Array(n), leafStart = new Int32Array(n), leafEnd = new Int32Array(n);
    const len = new Float64Array(n), cum = new Float64Array(n), maxCum = new Float64Array(n), depth = new Int32Array(n), maxDepth = new Int32Array(n);
    const row = new Float64Array(n), stub = new Uint8Array(n);
    let o = 0, li = 0, oi = 0;
    while (o < n) {
      const nextOv = oi < keepOv.length ? ov.node[keepOv[oi]] : Infinity;
      const nextLd = li < loaded.length ? loaded[li].lo : Infinity;
      if (nextOv < nextLd) {
        const i = keepOv[oi++];
        gid[o] = ov.node[i]; parentG[o] = ov.parent[i]; endG[o] = ov.end[i]; leafStart[o] = ov.leaf[i]; leafEnd[o] = ov.leaf[i] + ov.count[i];
        len[o] = ov.len[i]; cum[o] = ov.cum[i]; maxCum[o] = ov.maxCum[i]; depth[o] = ov.depth[i]; maxDepth[o] = ov.maxDepth[i]; row[o] = ov.row[i]; stub[o] = ov.stub[i];
        o++;
      } else {
        const c = loaded[li++], m = c.hi - c.lo, C = c.cols as Record<string, ArrayLike<number>>;
        for (let j = 0; j < m; j++, o++) {
          gid[o] = c.lo + j; parentG[o] = C.parent[j]; endG[o] = C.subtree_end[j]; leafStart[o] = C.leaf_start[j]; leafEnd[o] = C.leaf_start[j] + C.tip_count[j];
          len[o] = C.len[j]; cum[o] = C.cum_len[j]; maxCum[o] = C.max_cum[j]; depth[o] = C.depth[j]; maxDepth[o] = C.max_depth[j];
        }
      }
    }
    // 2. local structure. Ancestors of a row are always present (closure), so a stack of the open expanded rows gives the parent.
    const parent = new Int32Array(n), firstChild = new Int32Array(n).fill(-1), nextSibling = new Int32Array(n).fill(-1), childCount = new Int32Array(n);
    const lastChild = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n + 1);
    let sp = 0;
    for (let i = 0; i < n; i++) {
      while (sp > 0 && endG[stack[sp - 1]] <= gid[i]) sp--;
      if (i > 0) {
        const p = stack[sp - 1];
        parent[i] = p;
        childCount[p]++;
        if (lastChild[p] < 0) firstChild[p] = i; else nextSibling[lastChild[p]] = i;
        lastChild[p] = i;
      }
      if (endG[i] > gid[i] + 1 && stub[i] === 0) stack[sp++] = i; // an expanded internal row has rows below it
    }
    const subtreeEnd = new Int32Array(n);
    for (let i = n - 1; i >= 0; i--) subtreeEnd[i] = lastChild[i] >= 0 ? subtreeEnd[lastChild[i]] : i + 1;
    // 3. tips of the full tree by rank, layout rows
    const tipNode = new Int32Array(this.tipCount).fill(-1), tipRank = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      if (endG[i] === gid[i] + 1) { tipNode[leafStart[i]] = i; tipRank[i] = leafStart[i]; row[i] = leafStart[i] + 0.5; }
    }
    for (let i = n - 1; i >= 0; i--) if (lastChild[i] >= 0) row[i] = (row[firstChild[i]] + row[lastChild[i]]) / 2;
    for (let i = 0; i < n; i++) if (stub[i] === 1) childCount[i] = 1; // internal, so not taken for a tip; its children are not loaded
    const rollup: RollupData = { cumLength: cum, maxCum, depth, maxDepth, row };
    let heights: Int32Array | null = null;
    return {
      nodeCount: n, tipCount: this.tipCount, parent, firstChild, nextSibling, childCount, subtreeEnd, length: len, leafStart, leafEnd, tipNode, tipRank,
      tipLabels: this.noLabels, labels: new Array<string>(n), hasLengths: this.hasLengths,
      heights: () => {
        if (!heights) { heights = new Int32Array(n); for (let i = 0; i < n; i++) heights[i] = maxDepth[i] - depth[i]; }
        return heights;
      },
      tipIndex: () => -1, // labels are not part of the snapshot
      stub, globalId: gid, rollup,
      toLocal: (g) => { let lo = 0, hi = n - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (gid[m] < g) lo = m + 1; else if (gid[m] > g) hi = m - 1; else return m; } return -1; },
    };
  }

  // ------------------------------------------------------------------ loading

  /** Rows the clade below `globalId` would add (what ensureClade would read). The renderer uses it to be more patient with big ones. */
  openCost(globalId: number): number {
    const sn = this.snapshot(), i = sn.toLocal(globalId);
    if (i < 0 || sn.stub![i] === 0) return 0;
    return this.endOf(globalId) - globalId;
  }

  private endOf(g: number): number {
    const ov = this.ov;
    let lo = 0, hi = ov.n - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ov.node[m] < g) lo = m + 1; else if (ov.node[m] > g) hi = m - 1; else return ov.end[m]; }
    return g + 1;
  }

  ensureClade(globalId: number, o: EnsureOptions = {}): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const sn = this.snapshot(), i = sn.toLocal(globalId);
    if (i < 0 || sn.stub![i] === 0) return Promise.resolve(); // not in the snapshot, or already rows
    const hi = this.endOf(globalId), rows = hi - globalId;
    const key = rows <= MAX_CLADE_ROWS ? globalId : -1 - this.level; // a big clade is answered by the next overview level, shared by all of them
    let p = this.inflight.get(key);
    if (!p) {
      p = (rows <= MAX_CLADE_ROWS ? this.loadClade(globalId, hi) : this.nextLevel()).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p.then(() => { if (o.signal?.aborted) throw new DOMException('aborted', 'AbortError'); });
  }

  private async loadClade(lo: number, hi: number): Promise<void> {
    const cols = await this.r.getRange(lo, hi);
    if (this.destroyed || this.loaded.some((c) => c.lo <= lo && hi <= c.hi)) return;
    this.loaded = this.loaded.filter((c) => !(lo <= c.lo && c.hi <= hi)); // a bigger clade replaces the ones inside it
    this.loaded.push({ lo, hi, cols });
    this.loaded.sort((a, b) => a.lo - b.lo);
    this.bump();
  }

  private async nextLevel(): Promise<void> {
    const levels = this.r.man.overview.level_rows.length;
    if (this.level + 1 >= levels) return; // NOT BUILT: a clade of more than MAX_CLADE_ROWS rows below the deepest overview level
    await this.setLevel(this.level + 1, true);
  }

  async tipLabels(r0: number, r1: number): Promise<string[]> {
    const t = await this.r.getTips(r0, r1, ['tip_label']);
    return Array.from(t.tip_label as string[]);
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
  }
}
