// tree-ops: operations a user applies to a phylogenetic tree (reroot, midpoint root, ladderise, rotate, collapse, prune,
// subtree), and a clade focus with back / up one level (focus.ts). Pure functions: input untouched, a new tree out. No rendering, React or DOM; see ../README.md.
export type { OpResult, TreeArrays, TreeInput } from './types.ts';
export { reroot, midpointRoot, type RerootOptions, type MidpointInfo } from './rooting.ts';
export { ladderise, rotate, type LadderiseOptions } from './order.ts';
export { collapseBySupport, collapseShortBranches } from './collapse.ts';
export { collapseClades, prune, subtree } from './subset.ts';
export { splitInternalLabel } from './labels.ts';
export {
  NO_FOCUS,
  canGoBack,
  canGoUp,
  focusBack,
  focusOn,
  focusUp,
  focusedNode,
  remapFocus,
  showFocus,
  type Focus,
  type FocusOperation,
} from './focus.ts';
export { followClade, followClades, invertMap, composeMaps, type FollowOptions, type Followed, type FollowedClade } from './follow.ts';
