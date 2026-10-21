// Keyboard cursor: which node the cursor starts on and where the navigation keys move it. Pure functions over a TreeSnapshot and the
// viewport, so test/keyboard.test.mjs can walk a tiny tree. The cursor itself (the active node, scrolling it into view, announcing it)
// lives in the renderer; key events are read by input.ts.

import type { LayoutKind, TreeSnapshot, Viewport } from './types.ts';

/** Keys that move the cursor (and are handled by navigate()). */
export function isNavigationKey(key: string): boolean {
  switch (key) {
    case 'ArrowDown':
    case 'ArrowUp':
    case 'PageDown':
    case 'PageUp':
    case 'Home':
    case 'End':
    case 'ArrowLeft':
    case 'ArrowRight':
      return true;
    default:
      return false;
  }
}

/** The node the cursor starts on when none is active: the tip row at the centre of the view (rectangular), or the tip at the angle
 *  of the view centre (radial; the first tip while the centre is at the root). -1 for a partial tree whose tip row is not loaded. */
export function defaultActiveNode(tree: TreeSnapshot, layout: LayoutKind, view: Viewport): number {
  const N = tree.tipCount;
  let rank = 0;
  if (layout === 'rectangular') rank = Math.floor((view.y0 + view.y1) / 2);
  else {
    const cx = (view.x0 + view.x1) / 2,
      cy = (view.y0 + view.y1) / 2;
    if (Math.hypot(cx, cy) > 0.02) rank = Math.floor((((Math.atan2(cy, cx) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * N);
  }
  return tree.tipNode[Math.max(0, Math.min(N - 1, rank))];
}

/** How many tips PageUp / PageDown move: the rows in view (rectangular), 10 (radial, where a view has no row count). */
export function pageRows(layout: LayoutKind, view: Viewport): number {
  return layout === 'rectangular' ? Math.max(1, Math.floor(view.y1 - view.y0)) : 10;
}

/** The node a navigation key moves the cursor from `node` to (a row of the snapshot), or -1 for a key that is not one.
 *  Down / Up step over the tips (Down from a clade skips past its tips), Page keys by `rows` tips, Home / End to the first / last tip,
 *  Left to the parent, Right to the first child (a stub has no loaded children: it stays). Tip ranks are clamped to the tree. */
export function navigate(tree: TreeSnapshot, node: number, key: string, rows: number): number {
  const N = tree.tipCount;
  const tipOf = (r: number) => tree.tipNode[Math.max(0, Math.min(N - 1, r))];
  const startRank = tree.leafStart[node];
  switch (key) {
    case 'ArrowDown':
      return tipOf(tree.childCount[node] === 0 ? startRank + 1 : tree.leafEnd[node]);
    case 'ArrowUp':
      return tipOf(startRank - 1);
    case 'PageDown':
      return tipOf(startRank + rows);
    case 'PageUp':
      return tipOf(startRank - rows);
    case 'Home':
      return tipOf(0);
    case 'End':
      return tipOf(N - 1);
    case 'ArrowLeft':
      return node > 0 ? tree.parent[node] : node;
    case 'ArrowRight':
      return tree.firstChild[node] >= 0 ? tree.firstChild[node] : node;
    default:
      return -1;
  }
}
