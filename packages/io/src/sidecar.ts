// Sidecar table: a TSV or CSV that sits next to a tree file and adds columns to its nodes (country, host, date...). The first column is
// named `ID` and holds a tip label (or an internal node name); every other column becomes an annotation on the matching node, in the
// same side table the BEAST / NHX comments go to (`tree.annotations`). Nothing is dropped silently: `applySidecar` reports the rows that
// matched nothing and the tips that got no row.

import { Annotations, numberOrString } from './annotations.ts';
import type { AnnotationRecord } from './annotations.ts';
import type { TreeModel } from './tree.ts';

export interface SidecarTable {
  /** The columns after `ID`, in file order. */
  columns: string[];
  /** One entry per data row: the `ID` and the cells in `columns` order ('' for an empty cell). */
  rows: { id: string; cells: string[] }[];
  /** 'tab' or 'comma', as detected from the header line. */
  delimiter: 'tab' | 'comma';
}

export interface SidecarReport {
  /** Rows whose ID matched at least one node. */
  matchedRows: number;
  /** IDs of rows that matched no tip and no internal node name, in file order. */
  unmatchedIds: string[];
  /** Tip labels (by tip rank) that no row named. */
  tipsWithoutRow: string[];
  /** IDs that appear in more than one row. The later row's values replace the earlier ones. */
  duplicateIds: string[];
}

export class SidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SidecarError';
  }
}

/** Split `text` into records of fields. RFC 4180 quoting: a field in "double quotes" may hold the delimiter, newlines and `""` for a quote. */
function splitRecords(text: string, sep: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false; // the current record has any content (so a blank line is skipped, not read as one empty field)
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === '') {
      quoted = true;
      started = true;
    } else if (c === sep) {
      row.push(field);
      field = '';
      started = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (started || field !== '') {
        row.push(field);
        records.push(row);
      }
      row = [];
      field = '';
      started = false;
    } else {
      field += c;
      started = true;
    }
  }
  if (quoted) throw new SidecarError('unterminated quote in the sidecar table');
  if (started || field !== '') {
    row.push(field);
    records.push(row);
  }
  return records;
}

/** Read a TSV or CSV whose first column is named `ID` (case-insensitive). The delimiter is a tab if the header line has one, else a comma.
 *  Throws SidecarError for an empty file, a first column that is not `ID`, or an unterminated quote. A row shorter than the header is
 *  padded with empty cells; extra cells are ignored. */
export function parseSidecar(text: string): SidecarTable {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const nl = text.search(/[\r\n]/);
  const header = nl < 0 ? text : text.slice(0, nl);
  if (header.trim() === '') throw new SidecarError('the sidecar table is empty');
  const delimiter = header.includes('\t') ? 'tab' : 'comma';
  const records = splitRecords(text, delimiter === 'tab' ? '\t' : ',');
  const head = records[0].map((h) => h.trim());
  if (head[0].toLowerCase() !== 'id')
    throw new SidecarError(`the first column of the sidecar table must be named ID, not ${JSON.stringify(head[0])}`);
  const columns = head.slice(1);
  const rows: SidecarTable['rows'] = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    const cells: string[] = new Array(columns.length);
    for (let c = 0; c < columns.length; c++) cells[c] = (rec[c + 1] ?? '').trim();
    rows.push({ id: rec[0].trim(), cells });
  }
  return { columns, rows, delimiter };
}

/**
 * Merge a sidecar table into `tree.annotations` (created if the tree has none) and return what matched. A row goes to every tip that
 * carries its ID (`tipIndices`), else to the internal node with that name. Cells that look like numbers become numbers (leading zeros keep
 * a cell a string, as in the BEAST reader), other cells stay strings, empty cells are not set. A sidecar value replaces an annotation of
 * the same key already on the node.
 */
export function applySidecar(tree: TreeModel, table: SidecarTable): SidecarReport {
  const ann = tree.annotations ?? new Annotations(tree.nodeCount);
  tree.annotations = ann;
  let internal: Map<string, number> | null = null; // built on the first ID that is not a tip
  const seen = new Set<string>();
  const dup = new Set<string>();
  const hit = new Uint8Array(tree.tipCount);
  const unmatchedIds: string[] = [];
  let matchedRows = 0;
  for (const { id, cells } of table.rows) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
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
    if (nodes.length === 0) {
      unmatchedIds.push(id);
      continue;
    }
    matchedRows++;
    for (const k of nodes) {
      if (tree.tipRank[k] >= 0) hit[tree.tipRank[k]] = 1;
      let rec = ann.node.get(k);
      for (let c = 0; c < table.columns.length; c++) {
        if (cells[c] === '' || table.columns[c] === '') continue;
        if (!rec) {
          rec = Object.create(null) as AnnotationRecord;
          ann.node.set(k, rec);
        }
        rec[table.columns[c]] = numberOrString(cells[c]);
      }
    }
  }
  const tipsWithoutRow: string[] = [];
  for (let r = 0; r < tree.tipCount; r++) if (!hit[r]) tipsWithoutRow.push(tree.tipLabels[r]);
  return { matchedRows, unmatchedIds, tipsWithoutRow, duplicateIds: [...dup] };
}
