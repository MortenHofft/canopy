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
   * Carry the annotations over an edit of the tree. `map` is the old-to-new node index of a tree-ops result (-1 for removed
   * nodes), `before` the tree that was edited and `after` the result (`result.tree` or the model built from it); both need
   * `parent`. Records are copied, the source table is not touched.
   *
   * Node annotations follow their node. An edge annotation follows the undirected edge: when the edit reversed the edge
   * (`reroot`: every edge between the new and the old root), it moves to the node that is now below it; when `reroot` split the
   * edge with a new root, both halves get a copy. Any other edge stays on the node below it. Not carried: the edge into a
   * removed node, the edge of a removed node, and the edge that `reroot` merges when it suppresses the old root (the surviving
   * child's own annotation wins). Nodes the edit added have none.
   */
  remap(map: Int32Array, before: { parent: Int32Array }, after: { parent: Int32Array; nodeCount: number }): Annotations {
    const node = new Map<number, AnnotationRecord>();
    for (const [i, r] of this.node) {
      const j = i < map.length ? map[i] : -1;
      if (j >= 0) node.set(j, copyRecord(r));
    }
    const edge = new Map<number, AnnotationRecord>();
    const plain: [number, number][] = []; // [source, target] of edges that stay on their node
    for (const [i, r] of this.edge) {
      const a = i < map.length ? map[i] : -1;
      if (a < 0) continue;
      const p = before.parent[i];
      const b = p >= 0 && p < map.length ? map[p] : -1;
      if (b >= 0 && after.parent[b] === a)
        edge.set(b, copyRecord(r)); // reversed
      else if (b >= 0 && after.parent[a] >= 0 && after.parent[a] === after.parent[b]) {
        edge.set(a, copyRecord(r)); // split by a new root
        edge.set(b, copyRecord(r));
      } else plain.push([i, a]);
    }
    for (const [i, a] of plain) if (!edge.has(a)) edge.set(a, copyRecord(this.edge.get(i) as AnnotationRecord));
    return new Annotations(after.nodeCount, node, edge);
  }
}

function copyRecord(r: AnnotationRecord): AnnotationRecord {
  const out = Object.create(null) as AnnotationRecord;
  for (const k in r) {
    const v = r[k];
    out[k] = Array.isArray(v) ? v.slice() : v;
  }
  return out;
}

// ------------------------------------------------------------------------------------------ reading

// No leading zeros ('007', '0001' are identifiers and stay strings); BEAST also writes NaN and Infinity
const NUMBER = /^(?:[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|NaN|[+-]?Infinity)$/;

function scalar(tok: string): AnnotationScalar {
  tok = tok.trim();
  const q = tok.charCodeAt(0);
  if ((q === 34 || q === 39) && tok.length >= 2 && tok.charCodeAt(tok.length - 1) === q) return tok.slice(1, -1);
  return NUMBER.test(tok) ? Number(tok) : tok;
}

/** A bare cell or value as a number if it reads as one, else the string itself. */
export function numberOrString(s: string): AnnotationScalar {
  return NUMBER.test(s) ? Number(s) : s;
}

/** Split `s` at `sep` outside "quotes", 'quotes' and {braces}. A quote opens only at the start of a value (after '=', ',', '{' or the
 *  start), so an apostrophe inside a bare value (`O'Brien`) is just text. */
function splitTop(s: string, sep: number): string[] {
  const out: string[] = [];
  let from = 0;
  let quote = 0;
  let brace = 0;
  let prev = 44; // last character that is not whitespace
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (quote) {
      if (c === quote) quote = 0;
      prev = c;
      continue;
    }
    if (c === 32 || c === 9 || c === 10 || c === 13) continue;
    if ((c === 34 || c === 39) && (prev === 61 || prev === 44 || prev === 123)) quote = c;
    else if (c === 123) brace++;
    else if (c === 125) brace--;
    else if (c === sep && brace <= 0) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
    prev = c;
  }
  out.push(s.slice(from));
  return out;
}

function value(raw: string, nhx: boolean): AnnotationValue {
  const v = raw.trim();
  if (nhx) return NUMBER.test(v) ? Number(v) : v; // NHX values are never quoted or bracketed
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
  const nhx = body.startsWith('&NHX');
  if (nhx) {
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
    rec[key] = value(part.slice(eq + 1), nhx);
  }
  return rec;
}

// ------------------------------------------------------------------------------------------ writing

const BAD_KEY = /[\s[\]{},="']/;

/** `[&k=v,k=v]` in BEAST syntax ('' for no annotations). Strings are double-quoted (single-quoted if they hold a `"`), ranges and
 *  sets are `{a,b}`. An entry the syntax cannot hold and parseAnnotationComment could not read back (a key with whitespace or
 *  `[ ] { } , = " '`, a string with both kinds of quote) is left out and reported to `skipped`. */
export function writeAnnotations(r: AnnotationRecord | undefined, skipped?: (what: string) => void): string {
  if (!r) return '';
  const one = (v: AnnotationScalar): string => {
    if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (!v.includes('"')) return '"' + v + '"';
    if (!v.includes("'")) return "'" + v + "'";
    throw new Error(`value ${JSON.stringify(v)} holds both quote characters`);
  };
  const parts: string[] = [];
  for (const k in r) {
    const v = r[k];
    try {
      if (k === '' || BAD_KEY.test(k)) throw new Error(`key ${JSON.stringify(k)} has whitespace or one of [ ] { } , = " '`);
      parts.push(`${k}=${Array.isArray(v) ? '{' + v.map(one).join(',') + '}' : one(v)}`);
    } catch (e) {
      skipped?.((e as Error).message); // one bad entry does not cost the others
    }
  }
  return parts.length ? `[&${parts.join(',')}]` : '';
}

// ------------------------------------------------------------------------------------------ support

/**
 * Support values taken from a node annotation, for trees whose support is not an internal label (a BEAST MCC tree has
 * `[&posterior=0.98]`). Returns a new Float64Array by node index in the layout of `tree.support` (NaN for tips and for nodes without
 * a number under `key`). `tree.support` itself is never changed. To use the values where tree-ops reads `tree.support`, copy them in
 * on purpose: `tree.support.set(supportFrom(tree, 'posterior'))`.
 *
 * `pick` turns a value into a number for compound annotations, for example IQ-TREE's `SH-aLRT_UFB="85.5/61"`:
 * `supportFrom(tree, 'SH-aLRT_UFB', (v) => parseFloat(String(v).split('/')[1]))` takes the ultrafast bootstrap. It gets any value
 * (number, string or array) and should return NaN for those it cannot use.
 */
export function supportFrom(
  tree: { annotations: Annotations | null; childCount: Int32Array },
  key: string,
  pick?: (value: AnnotationValue) => number,
): Float64Array {
  const a = tree.annotations;
  if (!a) throw new Error('supportFrom needs a tree parsed with { annotations: true }');
  if (!pick) {
    const col = a.column(key);
    for (let i = 0; i < col.length; i++) if (tree.childCount[i] === 0) col[i] = NaN;
    return col;
  }
  const out = new Float64Array(a.nodeCount).fill(NaN);
  for (const [i, r] of a.node) {
    const v = r[key];
    if (v !== undefined && tree.childCount[i] > 0) out[i] = pick(v);
  }
  return out;
}
