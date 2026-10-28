// tipTarget: where a tip of the tree `setTree` replaces is in the new tree, for `keptViewport` (view-carry.ts): through the tip map when one
// was given, else by label (the k-th tip with a label before is the k-th after). The returned function is called once per tip in view, only
// when the view is kept, so it may build lookups on first use; it is not part of the frame code. No DOM.

import type { TreeSnapshot } from './types.ts';
import type { TipTarget } from './view-carry.ts';

/** `before` and `after` are the snapshots of the old and the new tree (both in memory), `m` the map old node -> new node (-1 = removed), or null.
 *  The function takes a tip rank of the old tree and fills `out` with where it is now; false when it is gone. With `deep` a tip that is
 *  gone counts as the nearest ancestor the map kept. */
export function tipTarget(before: TreeSnapshot, after: TreeSnapshot, m: Int32Array | null): (r: number, deep: boolean, out: TipTarget) => boolean {
  // up[i]: the nearest node at or above i that the map keeps (built once, in one preorder pass, only if the deep pass runs)
  let up: Int32Array | null = null;
  // tipIndices of a label in the old and the new tree, kept so a repeated label is looked up once
  const dupLists = new Map<string, [ArrayLike<number>, ArrayLike<number>]>();
  const target = (r: number, deep: boolean, out: TipTarget): boolean => {
    let node = before.tipNode[r];
    if (node < 0) return false;
    if (m) {
      // the tip, or what it became (a collapsed clade is one tip, an expanded tip is a clade); with `deep`, what it is part of
      if (deep) {
        if (!up) {
          up = new Int32Array(before.nodeCount);
          for (let i = 0; i < up.length; i++) {
            const q = i < m.length ? m[i] : -1;
            up[i] = q >= 0 && q < after.nodeCount ? i : before.parent[i] >= 0 ? up[before.parent[i]] : -1;
          }
        }
        node = up[node];
        if (node < 0) return false;
      }
      const q = node < m.length ? m[node] : -1;
      if (q < 0 || q >= after.nodeCount) return false;
      out.lo = after.leafStart[q];
      out.hi = after.leafEnd[q];
      out.node = q;
      return true;
    }
    // a label several tips carry: the k-th tip with it before is the k-th after
    const label = before.tipLabels[r];
    let q: number;
    if (before.tipIndices && after.tipIndices) {
      let lists = dupLists.get(label);
      if (!lists) {
        lists = [before.tipIndices(label), after.tipIndices(label)];
        dupLists.set(label, lists);
      }
      let k = 0;
      while (k < lists[0].length && lists[0][k] !== node) k++;
      if (k >= lists[1].length) return false;
      q = lists[1][k];
    } else {
      q = after.tipIndex(label);
      if (q < 0) return false;
    }
    out.lo = after.tipRank[q];
    out.hi = out.lo + 1;
    out.node = q;
    return true;
  };
  return target;
}
