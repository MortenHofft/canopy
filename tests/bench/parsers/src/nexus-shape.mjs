// The hash of a tree's shape and edge lengths that dendropy-nexus-summary.py computes on its side (signature()).
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';

/** The same hash as signature() in dendropy-nexus-summary.py: shape plus lengths, label by label. */
export function signature(t) {
  const sum = new Float64Array(t.nodeCount);
  const size = new Int32Array(t.nodeCount);
  const items = [];
  for (let n = t.nodeCount - 1; n >= 0; n--) {
    if (t.isTip(n)) {
      sum[n] = crc32(Buffer.from(t.labels[n], 'utf8'));
      size[n] = 1;
    }
    if (n === 0) break;
    const p = t.parent[n];
    sum[p] = (sum[p] + sum[n]) % 2 ** 32;
    size[p] += size[n];
    items.push(`${sum[n]}:${size[n]}:${Number.isNaN(t.length[n]) ? '-' : Math.round(t.length[n] * 1e9)}`);
  }
  return createHash('sha1').update(items.sort().join('\n')).digest('hex').slice(0, 16);
}
