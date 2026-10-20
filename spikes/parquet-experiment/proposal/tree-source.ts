// PROPOSAL (type-checked, not wired into spikes/custom): a TreeSource abstraction so that "tree in memory" and "tree in Parquet
// behind HTTP ranges" are two implementations of one interface and the renderer stays one renderer.
import type { TreeData } from '../../custom/src/core/types.ts';

/** What the renderer reads each frame. A superset of today's TreeData (which stays valid: the in-memory source returns a snapshot
 *  with `stub` all zero, `globalId` null). Rows are in PREORDER of the loaded subset, so a loaded clade is still a contiguous index
 *  range and the cut in lod.ts keeps jumping with subtreeEnd. */
export interface TreeSnapshot extends TreeData {
  /** 1 = this row stands for a clade whose rows are not loaded (drawn as a triangle from its rollups, never descended into).
   *  Its subtreeEnd is i + 1, childCount 0 is NOT used for it (so it is not mistaken for a tip): see isTip(). */
  readonly stub: Uint8Array;
  /** local row -> preorder id in the FULL tree (what NodeEvent.node and every public API speaks). null = identity (in memory). */
  readonly globalId: Int32Array | null;
  /** Rollups every row carries (computed in one pass for the in-memory source, stored in the file for Parquet). */
  readonly depth: Int32Array;
  readonly maxDepth: Int32Array; // deepest tip below (cladogram X for stubs: 1 - (maxDepth - depth)/H ...)
  readonly cumLength: Float32Array | Float64Array; // X before normalisation
  readonly maxCum: Float32Array | Float64Array; // XMAX source: largest cumLength in the subtree
  readonly row: Float32Array | Float64Array; // layout row (y) of the node; stubs: stored, loaded clades: recomputed from their children
  /** Column aggregates over the clade, by column id (for example occ_sum for occurrence_count). Same length as rows. */
  readonly aggregates?: Readonly<Record<string, Float64Array>>;
  /** Tip rank range of the clade is always [leafStart[i], leafEnd[i]) in the FULL tree's ranks, stub or not (existing contract). */
  isTip(i: number): boolean; // childCount[i] === 0 && !stub[i]
  /** Local row of a global preorder id, or -1 when that node is not part of the snapshot (binary search on globalId). */
  toLocal(globalId: number): number;
}

export interface EnsureOptions {
  signal?: AbortSignal; // cancel when the viewport moved on
  priority?: number; // higher first; clades in the viewport centre beat clades at the edge
  labels?: boolean; // also load tip labels of the clade
}

export interface TreeSource {
  readonly nodeCount: number;
  readonly tipCount: number;
  readonly hasLengths: boolean;
  /** Increases whenever snapshot() would return different rows. The renderer repaints on notification. */
  readonly version: number;
  /** Subscribe to version changes (rows arrived or were evicted). Returns the unsubscribe function. */
  subscribe(listener: (version: number) => void): () => void;
  /** Always renderable, never async: loaded clades fully, everything else as stubs. In memory: the whole tree, no stubs. */
  snapshot(): TreeSnapshot;

  /** Make the subtree rows [lo, hi) (a clade is [i, subtreeEnd[i])) part of the snapshot. Resolves after the version bump.
   *  In memory: resolved promise, no-op. */
  ensure(lo: number, hi: number, o?: EnsureOptions): Promise<void>;
  /** Convenience used by the renderer for a stub it wants to open: ensure(globalId, end of that clade). */
  ensureClade(globalId: number, o?: EnsureOptions): Promise<void>;
  /** The occurrence-page case: path root -> tip, the smallest ancestor clade with >= minTips tips, and the overview level that
   *  makes every ancestor above it a regular (expanded) row with its child stubs. About 3 to 5 requests. */
  ensureTip(rank: number, minTips?: number, o?: EnsureOptions): Promise<{ node: number }>;

  /** Tip labels (and later other per-tip columns) for a rank range; async because they may live in another file. */
  tipLabels(r0: number, r1: number): Promise<string[]>;
  /** Rank of a tip label, or -1. In memory: Map lookup. Parquet: needs a label index (not built in this experiment; see docs). */
  tipRankOf(label: string): Promise<number>;
  /** Optional per-tip column (occurrence_count, country...) for a rank range; the cheap per-column Parquet read. */
  tipColumn?(id: string, r0: number, r1: number): Promise<Float64Array | Int32Array | string[]>;

  /** Drop rows far from the viewport (keep overview + path + viewport). Optional memory cap for the 1.5M case. */
  trim?(keep: Array<[number, number]>): void;
  destroy(): void;
}

/** In-memory implementation = today's behaviour: wrap a TreeModel-like object. Nothing is async, nothing is a stub. */
export class InMemorySource implements TreeSource {
  readonly version = 0;
  constructor(private readonly snap: TreeSnapshot) {}
  get nodeCount() { return this.snap.nodeCount; }
  get tipCount() { return this.snap.tipCount; }
  get hasLengths() { return this.snap.hasLengths; }
  subscribe(): () => void { return () => undefined; }
  snapshot(): TreeSnapshot { return this.snap; }
  ensure(): Promise<void> { return Promise.resolve(); }
  ensureClade(): Promise<void> { return Promise.resolve(); }
  ensureTip(rank: number): Promise<{ node: number }> { return Promise.resolve({ node: this.snap.tipNode[rank] }); }
  tipLabels(r0: number, r1: number): Promise<string[]> { return Promise.resolve(this.snap.tipLabels.slice(r0, r1)); }
  tipRankOf(label: string): Promise<number> { const n = this.snap.tipIndex(label); return Promise.resolve(n < 0 ? -1 : this.snap.tipRank[n]); }
  destroy(): void { /* nothing to release */ }
}
