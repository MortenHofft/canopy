// Annotations: the `[&key=value,...]` comments of BEAST / FigTree / MrBayes trees and the `[&&NHX:key=value:...]` comments of NHX,
// kept in a side table next to the TreeModel instead of being skipped. Parsing them is opt-in (`parseNewick(text, { annotations: true })`)
// so that large trees without them pay nothing.
//
// A value is a number, a string (quoted or not in the file), or an array for `{a,b}` ranges and sets (HPD intervals, `COO.set`).
// Storage is sparse: a Map from node index to a record of key -> value, one map for the annotations of a node and one for the
// annotations of the edge above it. BEAST writes the node's annotations before the ':' and the edge's after it
// (`A[&height=1]:[&rate=0.1]0.5`); NHX comments are always the node's. Keys that matter can be pulled out as a column (`column`).

export type AnnotationScalar = number | string;
/** A number, a string, or the elements of a `{a,b}` range or set. */
export type AnnotationValue = AnnotationScalar | AnnotationScalar[];
export type AnnotationRecord = Record<string, AnnotationValue>;

export class Annotations {
  /** Number of nodes of the tree these belong to. */
  readonly nodeCount: number;
  /** Node index -> annotations of the node. Only nodes that have some are present. */
  readonly node: Map<number, AnnotationRecord>;
  /** Node index -> annotations of the edge above the node. */
  readonly edge: Map<number, AnnotationRecord>;

  constructor(nodeCount: number, node = new Map<number, AnnotationRecord>(), edge = new Map<number, AnnotationRecord>()) {
    this.nodeCount = nodeCount;
    this.node = node;
    this.edge = edge;
  }

  /** True if nothing was annotated. */
  get isEmpty(): boolean {
    return this.node.size === 0 && this.edge.size === 0;
  }
  /** Annotation `key` of a node (or of the edge above it), undefined if absent. */
  get(i: number, key: string, scope: 'node' | 'edge' = 'node'): AnnotationValue | undefined {
    return (scope === 'node' ? this.node : this.edge).get(i)?.[key];
  }
  /** All keys in use, in the order first seen. */
  keys(scope: 'node' | 'edge' | 'both' = 'both'): string[] {
    const seen = new Set<string>();
    if (scope !== 'edge') for (const r of this.node.values()) for (const k in r) seen.add(k);
    if (scope !== 'node') for (const r of this.edge.values()) for (const k in r) seen.add(k);
    return [...seen];
  }
  /** One key as a Float64Array by node index: NaN where the node has no such annotation or it is not a single number. */
  column(key: string, scope: 'node' | 'edge' = 'node'): Float64Array {
    const out = new Float64Array(this.nodeCount).fill(NaN);
    for (const [i, r] of scope === 'node' ? this.node : this.edge) {
      const v = r[key];
      if (typeof v === 'number') out[i] = v;
    }
    return out;
  }
  /**
   * Carry the annotations over an edit of the tree: `map` is the old-to-new node index of a tree-ops result (-1 for removed
   * nodes) and `nodeCount` the size of the new tree. Node annotations follow their node. Edge annotations follow the node
   * below the edge, which is right for every operation except where edges change direction: after `reroot`, the nodes on the
   * path between the new and the old root hang from a different neighbour, so their edge annotations describe the wrong edge
   * (`stripEdges` drops them instead). Nodes the operation added have none.
   */
  remap(map: Int32Array, nodeCount: number, o: { stripEdges?: boolean } = {}): Annotations {
    const move = (from: Map<number, AnnotationRecord>): Map<number, AnnotationRecord> => {
      const to = new Map<number, AnnotationRecord>();
      for (const [i, r] of from) {
        const j = i < map.length ? map[i] : -1;
        if (j >= 0) to.set(j, r);
      }
      return to;
    };
    return new Annotations(nodeCount, move(this.node), o.stripEdges ? new Map() : move(this.edge));
  }
}

// ------------------------------------------------------------------------------------------ reading

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function scalar(tok: string): AnnotationScalar {
  tok = tok.trim();
  const q = tok.charCodeAt(0);
  if ((q === 34 || q === 39) && tok.length >= 2 && tok.charCodeAt(tok.length - 1) === q) return tok.slice(1, -1);
  return NUMBER.test(tok) ? Number(tok) : tok;
}

/** Split `s` at `sep` outside "quotes", 'quotes' and {braces}. */
function splitTop(s: string, sep: number): string[] {
  const out: string[] = [];
  let from = 0;
  let quote = 0;
  let brace = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (quote) {
      if (c === quote) quote = 0;
    } else if (c === 34 || c === 39) quote = c;
    else if (c === 123) brace++;
    else if (c === 125) brace--;
    else if (c === sep && brace <= 0) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

function value(raw: string): AnnotationValue {
  const v = raw.trim();
  if (v.charCodeAt(0) === 123 && v.charCodeAt(v.length - 1) === 125) {
    const inner = v.slice(1, -1);
    return inner.trim() === '' ? [] : splitTop(inner, 44).map(scalar);
  }
  return scalar(v);
}

/**
 * The annotations in the comment `text[start, end)` (including the brackets): `[&k=v,k=v]` (BEAST and relatives) or `[&&NHX:k=v:k=v]`.
 * Null if it is neither or holds no `key=value` (`[&R]`, `[&U]`, plain comments).
 */
export function parseAnnotationComment(text: string, start: number, end: number): AnnotationRecord | null {
  if (text.charCodeAt(start + 1) !== 38) return null; // '&'
  let body = text.slice(start + 2, end - 1);
  let parts: string[];
  if (body.startsWith('&NHX')) {
    body = body.slice(4);
    parts = body.split(':'); // NHX values have no ':' of their own
  } else {
    parts = splitTop(body, 44);
  }
  let rec: AnnotationRecord | null = null;
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === '') continue;
    rec ??= Object.create(null) as AnnotationRecord;
    rec[key] = value(part.slice(eq + 1));
  }
  return rec;
}

// ------------------------------------------------------------------------------------------ writing

/** `[&k=v,k=v]` in BEAST syntax ('' for no annotations). Strings are double-quoted, ranges and sets are `{a,b}`. */
export function writeAnnotations(r: AnnotationRecord | undefined): string {
  if (!r) return '';
  const one = (v: AnnotationScalar): string => (typeof v === 'number' ? String(v) : '"' + v.replace(/"/g, "'") + '"');
  const parts: string[] = [];
  for (const k in r) {
    const v = r[k];
    parts.push(`${k}=${Array.isArray(v) ? '{' + v.map(one).join(',') + '}' : one(v)}`);
  }
  return parts.length ? `[&${parts.join(',')}]` : '';
}

// ------------------------------------------------------------------------------------------ support

/**
 * Support values taken from a node annotation, for trees whose support is not an internal label (a BEAST MCC tree has
 * `[&posterior=0.98]`). Returns a new Float64Array by node index in the layout of `tree.support` (NaN for tips and for nodes without a
 * number under `key`). `tree.support` itself is never changed. To use the values where the viewer and tree-ops read
 * `tree.support`, copy them in on purpose: `tree.support.set(supportFrom(tree, 'posterior'))`.
 */
export function supportFrom(tree: { annotations: Annotations | null; childCount: Int32Array }, key: string): Float64Array {
  if (!tree.annotations) throw new Error('supportFrom needs a tree parsed with { annotations: true }');
  const col = tree.annotations.column(key);
  for (let i = 0; i < col.length; i++) if (tree.childCount[i] === 0) col[i] = NaN;
  return col;
}
