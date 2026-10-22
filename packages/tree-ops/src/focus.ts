// Focus: showing one clade of a tree on its own, with "back" and "up one level". A navigation, not an edit: the tree is not
// changed, the focus says which clade of it is shown. A Focus is a stack of the views visited (clade ids of the tree, -1 = the
// whole tree), so `focusBack` returns to the previous view whatever it was (a deeper clade after `focusUp`, the whole tree after
// the first `focusOn`), like a browser's back button. All functions are pure: they return a new Focus.

import { checkNode, identity } from './draft.ts';
import { followClade } from './follow.ts';
import { subtree } from './subset.ts';
import type { OpResult, TreeInput } from './types.ts';

export interface Focus {
  /** Views visited, oldest first; the last one is shown. -1 = the whole tree. Empty = the whole tree, nothing to go back to. */
  readonly stack: readonly number[];
}

export const NO_FOCUS: Focus = { stack: [] };

/** The clade shown (a node id of the tree), or -1 for the whole tree. */
export function focusedNode(f: Focus): number {
  return f.stack.length ? f.stack[f.stack.length - 1] : -1;
}

/** Show only the clade below `node` (the root, or a tip, is not a clade to focus on: the focus is unchanged). */
export function focusOn(t: TreeInput, f: Focus, node: number): Focus {
  checkNode(t, node);
  if (node === 0 || t.childCount[node] === 0 || node === focusedNode(f)) return f;
  return { stack: [...f.stack, node] };
}

/** One level up: the clade that contains the shown one (the whole tree once its parent is the root). No-op for the whole tree. */
export function focusUp(t: TreeInput, f: Focus): Focus {
  const v = focusedNode(f);
  if (v < 0) return f;
  const p = t.parent[v];
  return { stack: [...f.stack, p <= 0 ? -1 : p] };
}

/** Back to the view shown before the last focusOn / focusUp. */
export function focusBack(f: Focus): Focus {
  return f.stack.length ? { stack: f.stack.slice(0, -1) } : f;
}

export function canGoBack(f: Focus): boolean {
  return f.stack.length > 0;
}

export function canGoUp(f: Focus): boolean {
  return focusedNode(f) >= 0;
}

/** The tree to show for a focus: the focused clade as its own tree (`map`: tree node -> shown node, -1 outside it), or the tree. */
export function showFocus(t: TreeInput, f: Focus): OpResult {
  const v = focusedNode(f);
  return v < 0 ? identity(t) : subtree(t, v);
}

/** An operation on a tree, as `ops.reroot` etc. return it: the tree before and after, and the node map. */
export interface FocusOperation {
  before: TreeInput;
  after: TreeInput;
  map: Int32Array;
}

/**
 * Carry a focus over an operation on the tree (reroot, prune, ...). `keep(node)` returns where a focused clade went in the new tree
 * (-1 if it is gone or no longer a clade), or pass the operation itself (`{ before, after, map }`) to follow each clade by its tips
 * (`followClade`); a clade that ends up the root or a tip cannot be focused and counts as gone. Views that are gone are dropped
 * from the stack, so back skips them.
 */
export function remapFocus(f: Focus, keep: ((node: number) => number) | FocusOperation): Focus {
  const fn =
    typeof keep === 'function'
      ? keep
      : (k: number) => {
          const m = followClade(keep.before, keep.after, keep.map, k).node;
          return m > 0 && keep.after.childCount[m] > 0 ? m : -1;
        };
  const stack: number[] = [];
  for (const v of f.stack) {
    const m = v < 0 ? -1 : fn(v);
    if (v >= 0 && m < 0) continue;
    if (stack[stack.length - 1] !== m && !(stack.length === 0 && m === -1)) stack.push(m); // a leading 'whole tree' is the start: no back step
  }
  return { stack };
}
