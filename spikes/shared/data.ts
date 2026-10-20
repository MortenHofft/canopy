// Loading test trees and metadata. Everything that touches the network is in the "browser" section; the
// parsers (TSV, FASTA, column building) are pure so the Node runner can import this file as well.
//
// Files come from the repo's data/ directory, served at /data/<path> by vite.base.mjs. .gz files are sent as
// raw bytes (no Content-Encoding) and inflated here with DecompressionStream, so the fetch+inflate cost is
// visible and identical for every candidate.

import catalogueJson from './trees.json' with { type: 'json' };
import { parseNewick, parseNexus, toNewick } from './newick.ts';
import type { TreeModel } from './tree.ts';
import type { ColumnSpec, TreeEntry, TreeGroup } from './types.ts';

export const catalogue: TreeEntry[] = (catalogueJson as unknown as { trees: TreeEntry[] }).trees;

export function getEntry(id: string): TreeEntry {
  const e = catalogue.find((t) => t.id === id);
  if (!e) throw new Error(`unknown tree id ${JSON.stringify(id)}; known: ${catalogue.map((t) => t.id).join(', ')}`);
  return e;
}

export function treesInGroup(g: TreeGroup): TreeEntry[] {
  return catalogue.filter((t) => t.groups.includes(g));
}

// ------------------------------------------------------------------------------------------ pure parsers

export interface Tsv {
  header: string[];
  rows: string[][];
}

/** Tab-separated text with a header line. Blank lines are skipped; no quoting rules (the test files have none). */
export function parseTsv(text: string): Tsv {
  const lines = text.split(/\r?\n/);
  let k = 0;
  while (k < lines.length && lines[k] === '') k++;
  const header = (lines[k] ?? '').split('\t');
  const rows: string[][] = [];
  for (let i = k + 1; i < lines.length; i++) if (lines[i] !== '') rows.push(lines[i].split('\t'));
  return { header, rows };
}

/** FASTA to {id: sequence}. The id is the first whitespace-delimited word after '>'. Wrapped lines are joined. */
export function parseFasta(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let id: string | null = null;
  let chunks: string[] = [];
  const flush = () => {
    if (id !== null) out[id] = chunks.join('');
  };
  for (const raw of text.split(/\r?\n/)) {
    if (raw.charCodeAt(0) === 62) {
      flush();
      id = raw.slice(1).trim().split(/\s+/)[0];
      chunks = [];
    } else if (raw !== '' && id !== null) chunks.push(raw.trim());
  }
  flush();
  return out;
}

export interface ColumnStats {
  /** Tips of the tree that have no row (explicitly unmatched, never silently dropped). */
  tipsWithoutRow: string[];
  /** Rows (or FASTA records) whose key is not a tip of the tree. */
  rowsWithoutTip: string[];
}

export interface LoadedColumns {
  columns: ColumnSpec[];
  tsvStats: ColumnStats | null;
  fastaStats: ColumnStats | null;
  /** Full metadata row per tip (all TSV fields) for the shell's tip-meta panel. */
  rowByTip: Record<string, Record<string, string>>;
}

/** Build ColumnSpecs for an entry from already-fetched file texts. Pure. */
export function buildColumns(entry: TreeEntry, tree: TreeModel, tsvText: string | null, fastaText: string | null): LoadedColumns {
  const result: LoadedColumns = { columns: [], tsvStats: null, fastaStats: null, rowByTip: {} };
  if (!entry.columns) return result;
  const tipSet = new Set(tree.tipLabels);
  let tsv: Tsv | null = null;
  let keyIdx = -1;
  if (tsvText !== null && entry.meta) {
    tsv = parseTsv(tsvText);
    keyIdx = tsv.header.indexOf(entry.tsvKey ?? 'tip_label');
    if (keyIdx < 0) throw new Error(`TSV ${entry.meta} has no column ${entry.tsvKey}`);
    const seen = new Set<string>();
    const extra: string[] = [];
    for (const r of tsv.rows) {
      const key = r[keyIdx];
      if (tipSet.has(key)) {
        seen.add(key);
        const row: Record<string, string> = {};
        tsv.header.forEach((h, i) => (row[h] = r[i] ?? ''));
        result.rowByTip[key] = row;
      } else extra.push(key);
    }
    result.tsvStats = { tipsWithoutRow: tree.tipLabels.filter((l) => !seen.has(l)), rowsWithoutTip: extra };
  }
  let fasta: Record<string, string> | null = null;
  if (fastaText !== null && entry.align) {
    fasta = parseFasta(fastaText);
    const ids = Object.keys(fasta);
    result.fastaStats = { tipsWithoutRow: tree.tipLabels.filter((l) => !(l in fasta!)), rowsWithoutTip: ids.filter((i) => !tipSet.has(i)) };
  }
  for (const c of entry.columns) {
    const values: Record<string, number | string> = {};
    if (c.source === 'tsv' && tsv) {
      const fi = tsv.header.indexOf(c.field ?? '');
      if (fi < 0) throw new Error(`TSV ${entry.meta} has no column ${c.field}`);
      for (const r of tsv.rows) {
        const key = r[keyIdx];
        if (!tipSet.has(key)) continue; // rows without a tip are reported in tsvStats, not drawn
        const v = r[fi];
        if (v === undefined || v === '') continue;
        if (c.kind === 'bar') {
          const x = Number(v);
          if (Number.isFinite(x)) values[key] = x;
        } else values[key] = v;
      }
    } else if (c.source === 'fasta' && fasta) {
      for (const l of tree.tipLabels) if (l in fasta) values[l] = fasta[l];
    } else continue;
    result.columns.push({ id: c.id, kind: c.kind, header: c.header, width: c.width, values });
  }
  return result;
}

/** Convert whatever format the entry has into clean Newick text (Nexus: TRANSLATE applied, comments dropped). */
export function toCleanNewick(entry: TreeEntry, text: string): { newick: string; tree: TreeModel } {
  if (entry.format === 'nexus') {
    const { tree } = parseNexus(text, entry.treeIndex ?? 0);
    return { newick: toNewick(tree), tree };
  }
  return { newick: text, tree: parseNewick(text) };
}

// ------------------------------------------------------------------------------------------ browser

export interface LoadedTree {
  entry: TreeEntry;
  newick: string; // clean Newick text, ready for mount()
  bytes: number; // bytes transferred
  fetchMs: number; // network + inflate
  convertMs: number; // Nexus -> Newick (0 for Newick files)
}

export const DATA_BASE = '/data/';

async function fetchBytes(path: string): Promise<Uint8Array> {
  // an absolute URL (a remote copy of a large tree, needs CORS) is fetched as is; anything else is under data/
  const url = /^https?:\/\//.test(path) ? path : DATA_BASE + path.split('/').map(encodeURIComponent).join('/');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> HTTP ${r.status}. Large trees are git-ignored; see data/README.md (yule_100000 is made with generate.py).`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Fetch a file under data/ as text; .gz is inflated in the browser. */
export async function fetchText(path: string): Promise<{ text: string; bytes: number; ms: number }> {
  const t0 = performance.now();
  let bytes = await fetchBytes(path);
  const wire = bytes.length;
  if (path.endsWith('.gz')) {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return { text: new TextDecoder().decode(bytes), bytes: wire, ms: performance.now() - t0 };
}

/** Fetch a catalogue tree and return clean Newick. */
export async function loadTree(id: string): Promise<LoadedTree> {
  const entry = getEntry(id);
  const f = await fetchText(entry.path);
  let newick = f.text;
  let convertMs = 0;
  if (entry.format === 'nexus') {
    const t0 = performance.now();
    newick = toCleanNewick(entry, f.text).newick;
    convertMs = performance.now() - t0;
  }
  return { entry, newick, bytes: f.bytes, fetchMs: f.ms, convertMs };
}

/** Fetch metadata files for an entry and build its columns against `tree`. Returns empty columns if the entry has none. */
export async function loadColumns(id: string, tree: TreeModel): Promise<LoadedColumns> {
  const entry = getEntry(id);
  if (!entry.columns) return { columns: [], tsvStats: null, fastaStats: null, rowByTip: {} };
  const [tsv, fasta] = await Promise.all([
    entry.meta ? fetchText(entry.meta).then((r) => r.text) : Promise.resolve(null),
    entry.align ? fetchText(entry.align).then((r) => r.text) : Promise.resolve(null),
  ]);
  return buildColumns(entry, tree, tsv, fasta);
}
