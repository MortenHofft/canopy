// The trees this example can show (?tree=<id>), all from the repository's data/ folder, served at /data/ by the dev server.
// .gz files arrive as raw bytes and are inflated here with DecompressionStream.

import { parseNewick, parseNexus, type TreeModel } from '@gbif-phylo/io';

const TREES: Record<string, { path: string; format: 'newick' | 'nexus' }> = {
  'rich-corvoid-680': { path: 'rich/corvoid-mcc-680/CC_MCC.tre.gz', format: 'nexus' },
  'rich-fish-carangaria-135': { path: 'rich/fish-carangaria-mcc/Carangaria-MCC.tre', format: 'nexus' },
  'edge-internal-support': { path: 'rich/edge-cases/internal-labels-support.nwk', format: 'newick' },
  'edge-quoted-labels': { path: 'rich/edge-cases/quoted-labels.nwk', format: 'newick' },
  'otl-1k': { path: 'real-ladder/trees/otl-1k-testudines.nwk.gz', format: 'newick' },
  'otl-91k': { path: 'real-ladder/trees/otl-100k-vertebrata.nwk.gz', format: 'newick' },
  'gtdb-10k': { path: 'real-ladder/trees/gtdb-10k-archaea.nwk.gz', format: 'newick' },
  'syn-yule-10000': { path: 'synthetic/newick/yule_10000.nwk.gz', format: 'newick' },
};

export const treeIds = Object.keys(TREES);

export async function loadTree(id: string): Promise<TreeModel> {
  const t = TREES[id];
  if (!t) throw new Error(`unknown tree ${JSON.stringify(id)}; known: ${treeIds.join(', ')}`);
  const r = await fetch(`/data/${t.path}`);
  if (!r.ok) throw new Error(`${t.path}: HTTP ${r.status}`);
  const text = t.path.endsWith('.gz') ? await new Response(r.body!.pipeThrough(new DecompressionStream('gzip'))).text() : await r.text();
  return t.format === 'nexus' ? parseNexus(text).tree : parseNewick(text);
}
