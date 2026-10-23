// Loading for the playground: the catalogue of trees and a tree file of the user's own (both read by examples/shared/data.ts), and the
// per-tip extras some trees have (a TSV keyed by tip label, a FASTA alignment).

import type { TreeModel } from '@gbif-phylo/io';
import { ENTRIES, GROUPS, type Entry, fetchText, loadTreeFile, parseFasta, parseTree } from '../../shared/data.ts';

export { ENTRIES, GROUPS, type Entry };

export interface Loaded {
  tree: TreeModel;
  parseMs: number;
  bytes: number;
  /** Per-tip values by column name (first TSV column = tip label); numeric columns hold numbers. */
  meta: { columns: { name: string; numeric: boolean; values: Record<string, number | string> }[]; rows: number } | null;
  fasta: Record<string, string> | null;
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

/** A tree file the user picked (Newick or NEXUS, optionally gzipped; read by the examples' shared loadTreeFile). */
export async function loadFile(file: File): Promise<Loaded> {
  return { ...(await loadTreeFile(file)), meta: null, fasta: null };
}
