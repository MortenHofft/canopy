// Labels on internal nodes and their branches (the `nodeLabels` option): the types, the number formatting and the reading of a support
// value out of an internal node label. The drawing is `drawNodeLabels` in draw.ts.

import type { TreeSnapshot } from './types.ts';

/** What `nodeLabels` can be: 'none', 'support' (the number at the start of the node's label: `95`, `0.98` or the `98` of `98:Name`),
 *  'length' (the length of the node's branch), or a function. */
export type NodeLabelFn = (node: number, tree: TreeSnapshot) => string | number | null | undefined;
export type NodeLabelsOption = 'none' | 'support' | 'length' | NodeLabelFn;

/** What a number on a node is: a support value or a branch length (`formatNodeLabel` formats both). */
export type NodeLabelKind = 'support' | 'length';

/** The default `formatNodeLabel`: support to 2 decimals at most (`0.95`, `100`), lengths to 3 significant digits (`0.0123`, `1.5e-7`). */
export function defaultFormatNodeLabel(value: number, kind: NodeLabelKind): string {
  return kind === 'support' ? String(Math.round(value * 100) / 100) : String(Number(value.toPrecision(3)));
}

const SUPPORT_PREFIX = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(?::.*)?$/s;

/** The support value of an internal node label: its numeric prefix (`'0.95'`, `'100'`, `'98.0:c__Nitrososphaeria'`), NaN when the label
 *  is empty or a name. The same rule as `splitInternalLabel` in @canopy/io, which the viewer does not depend on. */
export function internalSupport(label: string): number {
  if (label === '') return NaN;
  const c = label.charCodeAt(0);
  if (c > 57 && c < 128) return NaN; // an ASCII letter: a name (the common case), no regex. Digits, '.', '+', '-' and ASCII white space are below 58; Unicode white space (io accepts it) goes to the regex
  const m = SUPPORT_PREFIX.exec(label);
  return m ? Number(m[1]) : NaN;
}
