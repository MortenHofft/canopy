// Internal node labels in the wild are names ('Canidae_ott770319'), support values ('0.95', '100') or both
// ('98.0:c__Nitrososphaeria', the GTDB style). A support value belongs to the EDGE above the node, a name to the NODE, so
// rerooting has to take them apart. The same rule as the spikes' Newick parser (spikes/shared/tree.ts splitInternalLabel);
// kept here so the package has no imports outside itself.

const NUMERIC_PREFIX = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(?::(.*))?$/s;

/** Support (NaN if none) and name ('' if none) of an internal label. */
export function splitInternalLabel(label: string): { support: number; name: string } {
  if (label === '') return { support: NaN, name: '' };
  const m = NUMERIC_PREFIX.exec(label);
  if (!m) return { support: NaN, name: label };
  return { support: Number(m[1]), name: m[2] ?? '' };
}

/** The support text as written ('98.0', not 98) and the name. Tips have no support. */
export function supportPart(label: string, isTip: boolean): { support: string; name: string } {
  if (isTip) return { support: '', name: label };
  const { support, name } = splitInternalLabel(label);
  if (support !== support) return { support: '', name: label };
  return { support: (name ? label.slice(0, label.lastIndexOf(name) - 1) : label).trim(), name };
}

/** Inverse of supportPart. */
export const compose = (support: string, name: string): string => (support && name ? support + ':' + name : support || name);
