// Loading for the playground: the catalogue of trees in data/ (served at /data/ by the dev server and copied there by the site build),
// a tree file of the user's own, and the per-tip extras some trees have (a TSV keyed by tip label, a FASTA alignment).

import { parseNewick, parseNexus, type TreeModel } from '@gbif-phylo/io';
import catalogue from './catalogue.json';

export interface Entry {
  label: string;
  path: string; // under data/
  format: 'newick' | 'nexus';
  meta?: string; // TSV: first column the tip label, the others per-tip values
  fasta?: string;
  /** Where the file lives when it is too large for main (the data/otl-large branch): used when /data/<path> is not there. */
  remote?: string;
}

/** Catalogue groups (shown as <optgroup>) of entries by id. In JSON so the site build can copy exactly these files. */
export const GROUPS = catalogue as Record<string, Record<string, Entry>>;
export const ENTRIES: Record<string, Entry> = Object.assign({}, ...Object.values(GROUPS));

export interface Loaded {
  tree: TreeModel;
  parseMs: number;
  bytes: number;
  /** Per-tip values by column name (first TSV column = tip label); numeric columns hold numbers. */
  meta: { columns: { name: string; numeric: boolean; values: Record<string, number | string> }[]; rows: number } | null;
  fasta: Record<string, string> | null;
}

async function fetchText(path: string, remote?: string): Promise<{ text: string; bytes: number }> {
  let r = await fetch(`/data/${path}`);
  if (r.status === 404 && remote) r = await fetch(remote);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return decode(new Uint8Array(await r.arrayBuffer()));
}

/** Text from bytes, inflating gzip by its magic number (a host may already have inflated a .gz sent with Content-Encoding). */
async function decode(bytes: Uint8Array<ArrayBuffer>): Promise<{ text: string; bytes: number }> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return { text: new TextDecoder().decode(bytes), bytes: bytes.length };
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return { text, bytes: bytes.length };
}

/** NEXUS when the text says so, otherwise Newick. */
export function parseTree(text: string, format?: 'newick' | 'nexus'): TreeModel {
  const nexus = format ? format === 'nexus' : /^\s*#NEXUS/i.test(text);
  return nexus ? parseNexus(text).tree : parseNewick(text);
}

function parseTsv(text: string): Loaded['meta'] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;
  const head = lines[0].split('\t');
  const cols = head.slice(1).map((name) => ({ name, numeric: true, values: {} as Record<string, number | string> }));
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    cols.forEach((c, k) => {
      const v = cells[k + 1] ?? '';
      if (v === '') return;
      c.values[cells[0]] = v;
      if (c.numeric && !Number.isFinite(Number(v))) c.numeric = false;
    });
  }
  for (const c of cols) if (c.numeric) for (const k in c.values) c.values[k] = Number(c.values[k]);
  return { columns: cols, rows: lines.length - 1 };
}

export function parseFasta(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  let id = '';
  let seq: string[] = [];
  for (const line of src.split(/\r?\n/)) {
    if (line.startsWith('>')) {
      if (id) out[id] = seq.join('');
      id = line.slice(1).trim().split(/\s+/)[0];
      seq = [];
    } else if (id) seq.push(line.trim());
  }
  if (id) out[id] = seq.join('');
  return out;
}

export async function loadEntry(id: string): Promise<Loaded> {
  const e = ENTRIES[id];
  if (!e) throw new Error(`unknown tree ${JSON.stringify(id)}`);
  const [src, meta, fasta] = await Promise.all([fetchText(e.path, e.remote), e.meta ? fetchText(e.meta) : null, e.fasta ? fetchText(e.fasta) : null]);
  const t0 = performance.now();
  const tree = parseTree(src.text, e.format);
  return {
    tree,
    parseMs: performance.now() - t0,
    bytes: src.bytes,
    meta: meta ? parseTsv(meta.text) : null,
    fasta: fasta ? parseFasta(fasta.text) : null,
  };
}

/** A tree file the user picked (Newick or NEXUS, optionally gzipped). */
export async function loadFile(file: File): Promise<Loaded> {
  const src = await decode(new Uint8Array(await file.arrayBuffer()));
  const t0 = performance.now();
  const tree = parseTree(src.text);
  return { tree, parseMs: performance.now() - t0, bytes: src.bytes, meta: null, fasta: null };
}
