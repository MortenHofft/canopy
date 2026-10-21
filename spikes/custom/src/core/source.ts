// TreeSource: where the renderer gets its tree from. The renderer calls snapshot() once per frame and reads typed arrays from it,
// exactly as it read the TreeData before; a source that loads parts of the tree on demand (src/parquet/) changes what the snapshot
// holds (loaded clades as rows, everything else as stub rows) and tells the renderer through subscribe(). The in-memory source
// is the trivial implementation: version 0, no stubs, nothing to load. Design: docs/results/parquet-experiment.md section 8,
// first draft in spikes/parquet-experiment/proposal/tree-source.ts (this file differs from it where docs/results/treesource-slice.md says so).

import type { TreeData, TreeSnapshot } from './types.ts';

export interface EnsureOptions {
  signal?: AbortSignal; // cancel when the viewport moved on
  priority?: number; // higher first
}

export interface TreeSource {
  /** Nodes / tips of the FULL tree (a snapshot's own nodeCount is its row count). */
  readonly nodeCount: number;
  readonly tipCount: number;
  readonly hasLengths: boolean;
  /** Increases whenever snapshot() would return different rows. */
  readonly version: number;
  /** Called after the version changed (rows arrived or were dropped). Returns the unsubscribe function. */
  subscribe(listener: (version: number) => void): () => void;
  /** Always renderable, never async: loaded clades in full, everything else as stubs. In memory: the whole tree. The object is
   *  stable for one version, so the renderer may keep it for a frame. */
  snapshot(): TreeSnapshot;
  /** Make the clade below preorder id `globalId` part of the snapshot. Resolves after the version bump. In memory: no-op. */
  ensureClade(globalId: number, o?: EnsureOptions): Promise<void>;
  /** Rows ensureClade(globalId) would add; the renderer waits for a bigger clade to fill more of the view before it asks. Optional. */
  openCost?(globalId: number): number;
  /** Tip labels of the rank range [r0, r1). */
  tipLabels(r0: number, r1: number): Promise<string[]>;
  destroy(): void;
}

export function isTreeSource(x: TreeData | TreeSource): x is TreeSource {
  return typeof (x as TreeSource).snapshot === 'function';
}

/** TreeData -> TreeSnapshot without copying: the typed arrays are shared, the three extra fields are null. */
function snapshotOf(t: TreeData): TreeSnapshot {
  return {
    nodeCount: t.nodeCount,
    tipCount: t.tipCount,
    parent: t.parent,
    firstChild: t.firstChild,
    nextSibling: t.nextSibling,
    childCount: t.childCount,
    subtreeEnd: t.subtreeEnd,
    length: t.length,
    leafStart: t.leafStart,
    leafEnd: t.leafEnd,
    tipNode: t.tipNode,
    tipRank: t.tipRank,
    tipLabels: t.tipLabels,
    labels: t.labels,
    hasLengths: t.hasLengths,
    heights: () => t.heights(),
    tipIndex: (label) => t.tipIndex(label),
    stub: null,
    globalId: null,
    rollup: null,
    toLocal: (g) => (g >= 0 && g < t.nodeCount ? g : -1),
  };
}

/** The whole tree in memory (today's behaviour). */
export class InMemorySource implements TreeSource {
  readonly version = 0;
  private readonly snap: TreeSnapshot;
  constructor(tree: TreeData) {
    this.snap = snapshotOf(tree);
  }
  get nodeCount(): number {
    return this.snap.nodeCount;
  }
  get tipCount(): number {
    return this.snap.tipCount;
  }
  get hasLengths(): boolean {
    return this.snap.hasLengths;
  }
  subscribe(): () => void {
    return () => undefined;
  }
  snapshot(): TreeSnapshot {
    return this.snap;
  }
  ensureClade(): Promise<void> {
    return Promise.resolve();
  }
  tipLabels(r0: number, r1: number): Promise<string[]> {
    return Promise.resolve(this.snap.tipLabels.slice(r0, r1));
  }
  destroy(): void {
    /* nothing to release */
  }
}
