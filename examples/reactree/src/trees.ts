// The trees this example can show (?tree=<id>), from the repository's data/ folder (served at /data/ by the dev server), some with
// the alignment the tree was inferred from. .gz files arrive as raw bytes and are inflated here with DecompressionStream.

import { parseNewick, parseNexus, type TreeModel } from '@gbif-phylo/io';

interface Entry {
  label: string;
  path: string;
  format: 'newick' | 'nexus';
  fasta?: string;
}

export const TREES: Record<string, Entry> = {
  'rich-fish-carangaria-135': { label: 'Carangaria MCC (135 tips, dated)', path: 'rich/fish-carangaria-mcc/Carangaria-MCC.tre', format: 'nexus' },
  'rich-hcv-19': {
    label: 'HCV 2k IQ-TREE (19 tips, nucleotides)',
    path: 'rich/hcv-2k-iqtree-alignment/2k1b_2k_ext_IQTree_midpoint.tre',
    format: 'nexus',
    fasta: 'rich/hcv-2k-iqtree-alignment/2k1b_2k_ext.fasta.gz',
  },
  'rich-ens-protein-197': {
    label: 'Ensembl protein family (197 tips, amino acids)',
    path: 'rich/ens-protein-197/tree.nwk',
    format: 'newick',
    fasta: 'rich/ens-protein-197/alignment.fa.gz',
  },
  'edge-internal-support': { label: 'Support values (6 tips)', path: 'rich/edge-cases/internal-labels-support.nwk', format: 'newick' },
  'rich-corvoid-680': { label: 'Corvoid MCC (680 tips)', path: 'rich/corvoid-mcc-680/CC_MCC.tre.gz', format: 'nexus' },
  'otl-1k': { label: 'Open Tree, Testudines (1k tips)', path: 'real-ladder/trees/otl-1k-testudines.nwk.gz', format: 'newick' },
  'syn-yule-10000': { label: 'Yule (10,000 tips)', path: 'synthetic/newick/yule_10000.nwk.gz', format: 'newick' },
};

async function text(path: string): Promise<string> {
  const r = await fetch(`/data/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return path.endsWith('.gz') ? new Response(r.body!.pipeThrough(new DecompressionStream('gzip'))).text() : r.text();
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
