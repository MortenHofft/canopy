// The trees this example can show (?tree=<id>), from the repository's data/ folder (served at /data/ by the dev server), some with
// the alignment the tree was inferred from (list in trees.json). Gzipped files are inflated here with DecompressionStream.

import { parseNewick, parseNexus, type TreeModel } from '@gbif-phylo/io';
import trees from './trees.json';

interface Entry {
  label: string;
  path: string; // under data/
  format: 'newick' | 'nexus';
  fasta?: string;
}

/** In a JSON file so the site build (scripts/build-site.mjs) can copy exactly these files from data/. */
export const TREES = trees as Record<string, Entry>;

async function text(path: string): Promise<string> {
  const r = await fetch(`/data/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  // inflate by content, not by name: a host that sends .gz with Content-Encoding: gzip has the browser inflate it already
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/** FASTA records by id (the header up to the first space). */
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

export async function loadTree(id: string): Promise<{ tree: TreeModel; fasta: Record<string, string> | null }> {
  const t = TREES[id];
  if (!t) throw new Error(`unknown tree ${JSON.stringify(id)}; known: ${Object.keys(TREES).join(', ')}`);
  const [src, fa] = await Promise.all([text(t.path), t.fasta ? text(t.fasta) : Promise.resolve(null)]);
  const tree = t.format === 'nexus' ? parseNexus(src).tree : parseNewick(src);
  return { tree, fasta: fa === null ? null : parseFasta(fa) };
}
