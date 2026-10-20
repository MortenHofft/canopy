// Baseline: what the viewer does today. Download the whole gzipped Newick, inflate it, parse with spikes/shared/newick.ts
// (iterative parser, builds the TreeModel typed arrays). Imported read-only from the shared spike code.
import { parseNewick } from '../../shared/newick.ts';

export async function baseline(url: string) {
  const t0 = performance.now();
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error('baseline fetch ' + res.status);
  const buf = await res.arrayBuffer();
  const t1 = performance.now();
  const isGz = url.endsWith('.gz');
  let text: string;
  if (isGz) {
    const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
    text = await ds.text();
  } else text = new TextDecoder().decode(buf);
  const t2 = performance.now();
  const tree = parseNewick(text);
  const t3 = performance.now();
  const arrays = [tree.parent, tree.firstChild, tree.nextSibling, tree.childCount, tree.subtreeEnd, tree.depth, tree.length, tree.cumLength, tree.support, tree.leafStart, tree.leafEnd, tree.tipNode, tree.tipRank];
  const typedBytes = arrays.reduce((a, x) => a + x.byteLength, 0);
  return {
    bytes: buf.byteLength, rawChars: text.length, fetchMs: t1 - t0, inflateMs: t2 - t1, parseBuildMs: t3 - t2, totalMs: t3 - t0,
    nodes: tree.nodeCount, tips: tree.tipCount, typedBytes,
  };
}
