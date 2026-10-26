// Sidecar table: a TSV or CSV that sits next to a tree file and adds columns to its nodes (country, host, date, a sequence...). The first
// column is named `ID` and holds a tip label (or an internal node name).
//
// It is kept apart from the tree, and it is lazy. `parseSidecar` keeps the text and only records where each row starts and ends, so a
// cell (a 10 kB sequence, say) costs nothing until it is asked for, and then it is a slice of the text. `bind(tree)` matches the rows to
// the nodes of one tree and returns an Int32Array by node (row number or -1) and a report; nothing is written into the tree, so edits of
// the tree (tree-ops) cost the sidecar nothing, and a new tree is a new `bind`. A column that colours the tree is read once into integer
// codes (`categories`); a node that is inspected is read on its own (`get`, `record`).
//
// Nothing is dropped silently: the report lists the rows that matched nothing and the tips that got no row.

import { numberOrString } from './annotations.ts';
import type { AnnotationScalar } from './annotations.ts';
import type { TreeModel } from './tree.ts';

export class SidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SidecarError';
  }
}

export interface SidecarReport {
  /** Rows whose ID matched at least one node. */
  matchedRows: number;
  /** IDs of rows that matched no tip and no internal node name, in file order. */
  unmatchedIds: string[];
  /** Tip labels that no row named, in tip order. */
  tipsWithoutRow: string[];
  /** IDs of rows that matched a node an earlier row had already matched. The later row wins. */
  duplicateIds: string[];
}

/** One column as integer codes by node, for colouring. `values` are the distinct values, the most frequent first, and `counts` the tips
 *  that have each (internal nodes that matched a row get a code but are not counted). */
export interface Categories {
  key: string;
  /** By node: index into `values`, -1 for a node with no row or an empty cell. */
  codes: Int32Array;
  values: string[];
  counts: number[];
}

/** The text between `[s, e)` split at `sep` into fields (slices of the text; no copy unless a field is quoted and holds `""`). RFC 4180 quoting. */
function splitRow(t: string, s: number, e: number, sep: string): string[] {
  const out: string[] = [];
  let i = s;
  for (;;) {
    let d: number;
    if (i < e && t.charCodeAt(i) === 34) {
      let v = '';
      i++;
      for (;;) {
        const q = t.indexOf('"', i);
        if (q < 0 || q >= e) throw new SidecarError('unterminated quote in the sidecar table');
        v += t.slice(i, q);
        if (q + 1 < e && t.charCodeAt(q + 1) === 34) {
          v += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
      d = t.indexOf(sep, i);
      if (d < 0 || d > e) d = e;
      out.push(v + t.slice(i, d));
    } else {
      d = t.indexOf(sep, i);
      if (d < 0 || d > e) d = e;
      out.push(t.slice(i, d));
    }
    if (d >= e) return out;
    i = d + 1;
  }
}

export class Sidecar {
  /** The columns after `ID`, in file order. */
  readonly columns: string[];
  /** Number of data rows. */
  readonly rowCount: number;
  /** 'tab' or 'comma', as detected from the header line. */
  readonly delimiter: 'tab' | 'comma';
  private readonly text: string;
  private readonly sep: string;
  private readonly bounds: Int32Array; // start, end of each line (header first), the line break excluded
  private readonly quoted: boolean; // the text has a '"' somewhere: cells are parsed with quotes in mind

  /** @internal use `parseSidecar`. */
  constructor(text: string) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    this.text = text;
    this.quoted = text.includes('"');
    const b: number[] = [];
    const len = text.length;
    if (!this.quoted) {
      for (let p = 0; p < len;) {
        let e = text.indexOf('\n', p);
        if (e < 0) e = len;
        const q = e > p && text.charCodeAt(e - 1) === 13 ? e - 1 : e;
        if (q > p) b.push(p, q); // blank lines are skipped
        p = e + 1;
      }
    } else {
      let s = 0;
      let inQuote = false;
      for (let i = 0; i <= len; i++) {
        const c = i < len ? text.charCodeAt(i) : 10;
        if (c === 34)
          inQuote = !inQuote; // "" toggles twice
        else if (c === 10 && (!inQuote || i === len)) {
          const q = i > s && text.charCodeAt(i - 1) === 13 ? i - 1 : i;
          if (q > s) b.push(s, q);
          s = i + 1;
        }
      }
    }
    if (b.length === 0) throw new SidecarError('the sidecar table is empty');
    this.bounds = Int32Array.from(b);
    this.delimiter = text.slice(b[0], b[1]).includes('\t') ? 'tab' : 'comma';
    this.sep = this.delimiter === 'tab' ? '\t' : ',';
    const head = splitRow(text, b[0], b[1], this.sep).map((h) => h.trim());
    if (head[0].toLowerCase() !== 'id')
      throw new SidecarError(`the first column of the sidecar table must be named ID, not ${JSON.stringify(head[0])}`);
    this.columns = head.slice(1);
    this.rowCount = b.length / 2 - 1;
  }

  /** The cell of data row `row` in column `col` (0 is the ID, 1 the first of `columns`), trimmed; '' if the row is shorter. A slice of the text. */
  cell(row: number, col: number): string {
    const t = this.text;
    const s = this.bounds[2 * row + 2];
    const e = this.bounds[2 * row + 3];
    if (this.quoted) return (splitRow(t, s, e, this.sep)[col] ?? '').trim();
    let a = s;
    for (let c = 0; c < col; c++) {
      a = t.indexOf(this.sep, a);
      if (a < 0 || a >= e) return '';
      a++;
    }
    let b = t.indexOf(this.sep, a);
    if (b < 0 || b > e) b = e;
    return t.slice(a, b).trim();
  }

  /** All the cells of data row `row`, ID first. */
  row(row: number): string[] {
    return splitRow(this.text, this.bounds[2 * row + 2], this.bounds[2 * row + 3], this.sep).map((c) => c.trim());
  }

  /** Match the rows to the nodes of `tree`: a row goes to every tip that carries its ID (`tipIndices`), else to the internal node with that
   *  name. Costs one pass over the ID column and 4 bytes per node. Bind again after the tree changes (the node numbers do). */
  bind(tree: TreeModel): SidecarBinding {
    return new SidecarBinding(this, tree);
  }
}

export class SidecarBinding {
  readonly sidecar: Sidecar;
  readonly tree: TreeModel;
  /** By node: the data row of the node, -1 for none. */
  readonly rowOf: Int32Array;
  readonly report: SidecarReport;

  constructor(sidecar: Sidecar, tree: TreeModel) {
    this.sidecar = sidecar;
    this.tree = tree;
    const rowOf = new Int32Array(tree.nodeCount).fill(-1);
    let internal: Map<string, number> | null = null; // built on the first ID that is not a tip
    const dup = new Set<string>();
    const unmatchedIds: string[] = [];
    let matchedRows = 0;
    for (let r = 0; r < sidecar.rowCount; r++) {
      const id = sidecar.cell(r, 0);
      let nodes = tree.tipIndices(id);
      if (nodes.length === 0) {
        if (!internal) {
          internal = new Map();
          for (let i = 0; i < tree.nodeCount; i++) {
            if (tree.childCount[i] === 0) continue;
            const name = tree.nodeName(i);
            if (name !== '' && !internal.has(name)) internal.set(name, i);
          }
        }
        const k = internal.get(id);
        nodes = k === undefined ? [] : [k];
      }
      if (nodes.length === 0) unmatchedIds.push(id);
      else {
        matchedRows++;
        for (const k of nodes) {
          if (rowOf[k] >= 0) dup.add(id); // a node a row already claimed: the ID is in two rows
          rowOf[k] = r;
        }
      }
    }
    const tipsWithoutRow: string[] = [];
    for (let r = 0; r < tree.tipCount; r++) if (rowOf[tree.tipNode[r]] < 0) tipsWithoutRow.push(tree.tipLabels[r]);
    this.rowOf = rowOf;
    this.report = { matchedRows, unmatchedIds, tipsWithoutRow, duplicateIds: [...dup] };
  }

  /** One value of a node: a number if the cell reads as one (`007` stays a string), else the text; undefined for no row, no such column or an empty cell. */
  get(node: number, key: string): AnnotationScalar | undefined {
    const r = this.rowOf[node];
    const c = this.sidecar.columns.indexOf(key);
    if (r < 0 || c < 0) return undefined;
    const v = this.sidecar.cell(r, c + 1);
    return v === '' ? undefined : numberOrString(v);
  }

  /** All the non-empty values of a node by column name, for a popup; undefined when the node has no row. Reads only that row. */
  record(node: number): Record<string, AnnotationScalar> | undefined {
    const r = this.rowOf[node];
    if (r < 0) return undefined;
    const cells = this.sidecar.row(r);
    const out: Record<string, AnnotationScalar> = Object.create(null);
    this.sidecar.columns.forEach((k, c) => {
      const v = cells[c + 1] ?? '';
      if (v !== '' && k !== '') out[k] = numberOrString(v);
    });
    return out;
  }

  /** One column as integer codes by node (see Categories), the values compared as text. One pass over that column, 4 bytes per node. */
  categories(key: string): Categories {
    const col = this.sidecar.columns.indexOf(key);
    if (col < 0) throw new SidecarError(`the sidecar table has no column ${JSON.stringify(key)}`);
    const sc = this.sidecar;
    const code = new Map<string, number>();
    const rowCode = new Int32Array(sc.rowCount).fill(-1);
    for (let r = 0; r < sc.rowCount; r++) {
      const v = sc.cell(r, col + 1);
      if (v === '') continue;
      let k = code.get(v);
      if (k === undefined) code.set(v, (k = code.size));
      rowCode[r] = k;
    }
    const counts = new Array<number>(code.size).fill(0);
    const tree = this.tree;
    const codes = new Int32Array(tree.nodeCount).fill(-1);
    for (let i = 0; i < codes.length; i++) {
      const r = this.rowOf[i];
      if (r < 0 || rowCode[r] < 0) continue;
      codes[i] = rowCode[r];
      if (tree.childCount[i] === 0) counts[rowCode[r]]++;
    }
    // most frequent first (ties keep first-seen order): renumber the codes
    const names = [...code.keys()];
    const order = names.map((_, k) => k).sort((a, b) => counts[b] - counts[a] || a - b);
    const renumber = new Int32Array(order.length);
    order.forEach((k, rank) => (renumber[k] = rank));
    for (let i = 0; i < codes.length; i++) if (codes[i] >= 0) codes[i] = renumber[codes[i]];
    return { key, codes, values: order.map((k) => names[k]), counts: order.map((k) => counts[k]) };
  }
}

/** Read a TSV or CSV whose first column is named `ID` (case-insensitive). The delimiter is a tab if the header line has one, else a comma.
 *  Throws SidecarError for an empty file, a first column that is not `ID`, or an unterminated quote. A row shorter than the header reads as
 *  empty cells; extra cells are ignored. Keeps the text: do not pass a string you will change. */
export function parseSidecar(text: string): Sidecar {
  return new Sidecar(text);
}
