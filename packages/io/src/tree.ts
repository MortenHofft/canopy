// TreeModel: a rooted tree on typed arrays. Nodes are numbered in preorder (children in file order),
// so a node is named by its preorder index k and the root is 0. Every query is iterative.
//
// Invariants (checked by test/parser.test.mjs, 'structural invariants on a real tree'):
//  * parent[i] < i for i > 0; the subtree of i is exactly the index range [i, subtreeEnd[i]).
//  * Tips are ranked in preorder (= file order). The tips below node i are the contiguous rank range
//    [leafStart[i], leafEnd[i]) so descendant tips are an O(size) slice, never a traversal.

import type { Annotations } from './annotations.ts';

export interface RawTree {
  nodeCount: number;
  tipCount: number;
  parent: Int32Array;
  subtreeEnd: Int32Array;
  depth: Int32Array;
  length: Float64Array; // NaN when the edge has no length
  support: Float64Array; // NaN when the internal label is not numeric
  leafStart: Int32Array;
  leafEnd: Int32Array;
  labels: string[]; // tip label for tips, internal node name ('' if none) for internal nodes
  annotations?: Annotations; // from a parse with { annotations: true }
}

const NUMERIC_PREFIX = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(?::(.*))?$/s;

/**
 * Internal node labels in the wild are names ('Canidae_ott770319'), support values ('0.95', '100') or both
 * ('98.0:c__Nitrososphaeria', the GTDB style). Returns the support (NaN if none) and the name part ('' if none).
 */
export function splitInternalLabel(label: string): { support: number; name: string } {
  if (label === '') return { support: NaN, name: '' };
  const m = NUMERIC_PREFIX.exec(label);
  if (!m) return { support: NaN, name: label };
  return { support: Number(m[1]), name: m[2] ?? '' };
}

export class TreeModel {
  readonly nodeCount: number;
  readonly tipCount: number;
  readonly parent: Int32Array;
  readonly firstChild: Int32Array;
  readonly nextSibling: Int32Array;
  readonly childCount: Int32Array;
  readonly subtreeEnd: Int32Array;
  readonly depth: Int32Array;
  readonly length: Float64Array;
  readonly cumLength: Float64Array;
  readonly support: Float64Array;
  readonly leafStart: Int32Array;
  readonly leafEnd: Int32Array;
  readonly tipNode: Int32Array; // tip rank -> node index
  readonly tipRank: Int32Array; // node index -> tip rank, -1 for internal nodes
  readonly labels: string[];
  /** BEAST / NHX `[&...]` annotations, only when parsed with `{ annotations: true }`; null otherwise. */
  readonly annotations: Annotations | null;
  readonly tipLabels: string[]; // by tip rank
  readonly hasLengths: boolean; // at least one edge has a length
  readonly maxDepth: number;
  readonly maxCumLength: number;
  private _tipIndex: Map<string, number> | null = null;
  private _dupTips: Map<string, number[]> | null = null;
  private _heights: Int32Array | null = null;

  constructor(raw: RawTree) {
    const n = raw.nodeCount;
    this.nodeCount = n;
    this.tipCount = raw.tipCount;
    this.parent = raw.parent;
    this.subtreeEnd = raw.subtreeEnd;
    this.depth = raw.depth;
    this.length = raw.length;
    this.support = raw.support;
    this.leafStart = raw.leafStart;
    this.leafEnd = raw.leafEnd;
    this.labels = raw.labels;
    this.annotations = raw.annotations ?? null;
    if (this.annotations && this.annotations.nodeCount !== n)
      throw new Error(`annotations are for a tree of ${this.annotations.nodeCount} nodes, this one has ${n}`);

    const firstChild = new Int32Array(n).fill(-1);
    const nextSibling = new Int32Array(n).fill(-1);
    const childCount = new Int32Array(n);
    const lastChild = new Int32Array(n).fill(-1);
    for (let i = 1; i < n; i++) {
      const p = raw.parent[i];
      childCount[p]++;
      if (lastChild[p] < 0) firstChild[p] = i;
      else nextSibling[lastChild[p]] = i;
      lastChild[p] = i;
    }
    this.firstChild = firstChild;
    this.nextSibling = nextSibling;
    this.childCount = childCount;

    const cum = new Float64Array(n);
    let anyLen = false;
    let maxCum = 0;
    let maxDepth = 0;
    for (let i = 1; i < n; i++) {
      const l = raw.length[i];
      if (!Number.isNaN(l)) anyLen = true;
      cum[i] = cum[raw.parent[i]] + (!Number.isNaN(l) ? l : 0);
      if (cum[i] > maxCum) maxCum = cum[i];
      if (raw.depth[i] > maxDepth) maxDepth = raw.depth[i];
    }
    this.cumLength = cum;
    this.hasLengths = anyLen;
    this.maxCumLength = maxCum;
    this.maxDepth = maxDepth;

    const tipNode = new Int32Array(raw.tipCount);
    const tipRank = new Int32Array(n).fill(-1);
    const tipLabels: string[] = new Array(raw.tipCount);
    let r = 0;
    for (let i = 0; i < n; i++) {
      if (childCount[i] === 0) {
        tipNode[r] = i;
        tipRank[i] = r;
        tipLabels[r] = raw.labels[i];
        r++;
      }
    }
    if (r !== raw.tipCount) throw new Error(`tip count mismatch: counted ${r}, parser said ${raw.tipCount}`);
    this.tipNode = tipNode;
    this.tipRank = tipRank;
    this.tipLabels = tipLabels;
  }

  /** Name of an internal node without a leading support value ('' if none); tips return their label. */
  nodeName(i: number): string {
    return this.childCount[i] === 0 ? this.labels[i] : splitInternalLabel(this.labels[i]).name;
  }
  isTip(i: number): boolean {
    return this.childCount[i] === 0;
  }
  // Tip labels are lookup keys, not the identity of a tip: a tree can carry the same label on several tips (several sequences of one
  // species, labels made for display). The index maps each label to its first tip in preorder; the labels carried by more than one tip
  // also get the list of all their tips, in a second map that stays empty for a tree without duplicates.
  private buildTipIndex(): Map<string, number> {
    if (this._tipIndex) return this._tipIndex;
    const m = new Map<string, number>();
    const dup = new Map<string, number[]>();
    for (let r = 0; r < this.tipCount; r++) {
      const l = this.tipLabels[r];
      const k = this.tipNode[r];
      const first = m.get(l);
      if (first === undefined) m.set(l, k);
      else {
        const all = dup.get(l);
        if (all) all.push(k);
        else dup.set(l, [first, k]);
      }
    }
    this._tipIndex = m;
    this._dupTips = dup;
    return m;
  }
  /** label -> preorder node index of the FIRST tip with this label (-1 if absent). Built lazily. A label that several tips carry
   *  (see `duplicateTipLabels`) names all of them; `tipIndices` returns every one. */
  tipIndex(label: string): number {
    const k = this.buildTipIndex().get(label);
    return k === undefined ? -1 : k;
  }
  /** Preorder node indexes of every tip with this label, in preorder (empty if none). A new array on every call. */
  tipIndices(label: string): number[] {
    const k = this.buildTipIndex().get(label);
    if (k === undefined) return [];
    const all = this._dupTips!.get(label);
    return all ? all.slice() : [k];
  }
  /** The tip labels that more than one tip carries, each with its tips' node indexes in preorder. Empty when the labels are unique, so an
   *  app can warn about duplicates after parsing (`parseNewick(text).duplicateTipLabels().size`). Do not modify it. */
  duplicateTipLabels(): ReadonlyMap<string, readonly number[]> {
    this.buildTipIndex();
    return this._dupTips!;
  }

  // ---- tips below a node
  /** Number of descendant tips (1 for a tip). */
  tipCountOf(i: number): number {
    return this.leafEnd[i] - this.leafStart[i];
  }
  /** Contiguous tip-rank range [start, end) of the descendant tips. */
  tipRange(i: number): [number, number] {
    return [this.leafStart[i], this.leafEnd[i]];
  }
  /** Labels of the descendant tips in leaf order (a tip returns its own label). */
  descendantTips(i: number): string[] {
    return this.tipLabels.slice(this.leafStart[i], this.leafEnd[i]);
  }
  /** De-duplicated union of the descendant tips of several nodes, in leaf order. */
  tipsOf(nodes: number[]): string[] {
    const mark = new Uint8Array(this.tipCount);
    for (const i of nodes) {
      for (let r = this.leafStart[i]; r < this.leafEnd[i]; r++) mark[r] = 1;
    }
    const out: string[] = [];
    for (let r = 0; r < this.tipCount; r++) if (mark[r]) out.push(this.tipLabels[r]);
    return out;
  }
  /** True if node b lies in the subtree of node a (a counts as its own subtree). */
  contains(a: number, b: number): boolean {
    return a <= b && b < this.subtreeEnd[a];
  }
  children(i: number): number[] {
    const out: number[] = [];
    for (let c = this.firstChild[i]; c >= 0; c = this.nextSibling[c]) out.push(c);
    return out;
  }

  // ---- ancestry
  /** Throws a RangeError unless `i` is a node number of this tree (the walks up from a bad one would never end). */
  private checkNode(i: number): void {
    if (!Number.isInteger(i) || i < 0 || i >= this.nodeCount) throw new RangeError(`not a node of this tree: ${String(i)}`);
  }
  /** Most recent common ancestor of two nodes; returns a node index. */
  mrca(a: number, b: number): number {
    this.checkNode(a);
    this.checkNode(b);
    let x = a;
    while (!(x <= b && b < this.subtreeEnd[x])) x = this.parent[x];
    return x;
  }
  /** MRCA of a set of nodes; returns a node index, or -1 for an empty set. A tip label goes through `tipIndex` (or `tipIndices`, for a
   *  label that several tips carry) first. */
  mrcaOf(nodes: number[]): number {
    let cur = -1;
    for (const k of nodes) cur = cur < 0 ? (this.checkNode(k), k) : this.mrca(cur, k);
    return cur;
  }
  /** Node indexes from the node up to the root (inclusive). */
  ancestors(a: number): number[] {
    this.checkNode(a);
    const out: number[] = [];
    for (let i = a; i >= 0; i = this.parent[i]) out.push(i);
    return out;
  }

  // ---- derived per-node quantities
  /** Edges from each node down to its deepest descendant tip (0 for tips). Computed once. */
  heights(): Int32Array {
    if (!this._heights) {
      const h = new Int32Array(this.nodeCount);
      for (let i = this.nodeCount - 1; i > 0; i--) {
        const p = this.parent[i];
        if (h[i] + 1 > h[p]) h[p] = h[i] + 1;
      }
      this._heights = h;
    }
    return this._heights;
  }
  /** Root-to-tip distance spread relative to the maximum; ~0 for an ultrametric tree. */
  tipDistanceSpread(): number {
    let lo = Infinity;
    let hi = 0;
    for (let r = 0; r < this.tipCount; r++) {
      const d = this.cumLength[this.tipNode[r]];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    return hi > 0 ? (hi - lo) / hi : 0;
  }
  isUltrametric(relTol = 1e-3): boolean {
    return this.hasLengths && this.tipDistanceSpread() <= relTol;
  }

  /** Replace tip labels (for example NEXUS TRANSLATE). Call before anybody uses tip ids. */
  relabelTips(map: (label: string) => string | undefined): void {
    for (let r = 0; r < this.tipCount; r++) {
      const nl = map(this.tipLabels[r]);
      if (nl !== undefined) {
        this.tipLabels[r] = nl;
        this.labels[this.tipNode[r]] = nl;
      }
    }
    this._tipIndex = null;
    this._dupTips = null;
  }
}
