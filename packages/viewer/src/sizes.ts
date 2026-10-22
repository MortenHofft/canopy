import type { LabelDensity } from './types.ts';

/** A size that follows the label font: px, `'<n>em'` (n times the theme's `labelSize`) or `'auto'` (`AUTO_EM` em). */
export type FontRelative = number | 'auto' | `${number}em`;

/** What `'auto'` means for `maxTipSpacing` and `rowHeight`: room for a label line, an alignment row and padding, in `labelSize`s. */
export const AUTO_EM = 2.2;
/** The label size the px constants below were measured at (the default theme's `labelSize`). */
export const REF_LABEL_SIZE = 13;
/** Rows (rectangular) or arcs (radial) must be at least this many px at `REF_LABEL_SIZE` before tips get labels; scaled with `labelSize`. */
export const LABEL_MIN_PX: Record<LabelDensity, number> = { sparse: 16, normal: 11, dense: 8 };
/** `v` in px for font size `labelSize`. A number is px; `'auto'` is `AUTO_EM` em; `'<n>em'` is n em. Anything else (a bad string) is NaN. */
export function resolveSize(v: FontRelative, labelSize: number): number {
  if (typeof v === 'number') return v;
  if (v === 'auto') return AUTO_EM * labelSize;
  const m = /^\s*(\d*\.?\d+)\s*em\s*$/.exec(v);
  return m ? Number(m[1]) * labelSize : NaN;
}

/** A px constant measured at `REF_LABEL_SIZE`, for font size `labelSize` (exactly the constant at the reference size). */
export function scaledPx(px: number, labelSize: number): number {
  return (px * labelSize) / REF_LABEL_SIZE;
}

/** Least tip pitch (px) at which tips get labels, for the density and font size. */
export function labelMinPx(density: LabelDensity, labelSize: number): number {
  return scaledPx(LABEL_MIN_PX[density], labelSize);
}

/** The `treeWidth` option: `'auto'`, px, or a percentage of the width the plot may use. */
export type TreeWidth = 'auto' | number | `${number}%`;

/** The tree area's width in px for `treeWidth` over `avail` px, or null for 'auto' (also for a value that is not a size). */
export function resolveTreeWidth(tw: TreeWidth, avail: number): number | null {
  if (typeof tw === 'number') return tw > 0 ? tw : null;
  const m = /^\s*(\d*\.?\d+)\s*%\s*$/.exec(tw);
  return m && Number(m[1]) > 0 ? (Number(m[1]) / 100) * avail : null;
}
