import { FALLBACK_THEME, type LabelDensity } from './types.ts';

/** A size that follows the label font: px, `'<n>em'` (n times the theme's `labelSize`) or `'auto'` (`AUTO_EM` em). em values are rounded to a whole CSS px, so rows at the cap sit on the same pixel grid
 *  (24 px at the default label size). */
export type FontRelative = number | 'auto' | `${number}em`;

/** What `'auto'` means for `maxTipSpacing` and `rowHeight`: room for a label line, an alignment row and padding, in `labelSize`s. */
export const AUTO_EM = 1.85;
/** The label size the px constants below were measured at (the default theme's `labelSize`). */
export const REF_LABEL_SIZE = FALLBACK_THEME.labelSize;
/** Labels are never drawn in a smaller font than this (labels.ts), so no density threshold goes below it: a smaller `labelSize` would otherwise
 *  show labels in rows too narrow for them. */
export const LABEL_FONT_FLOOR_PX = 8;
/** Rows (rectangular) or arcs (radial) must be at least this many px at `REF_LABEL_SIZE` before tips get labels; scaled with `labelSize`. */
export const LABEL_MIN_PX: Record<LabelDensity, number> = { sparse: 16, normal: 11, dense: 8 };
/** `v` in px for font size `labelSize`. A number is px; `'auto'` is `AUTO_EM` em; `'<n>em'` is n em. Anything else (a bad string) is NaN. */
export function resolveSize(v: FontRelative, labelSize: number): number {
  if (typeof v === 'number') return v;
  if (v === 'auto') return Math.round(AUTO_EM * labelSize);
  const m = /^\s*(\d*\.?\d+)\s*em\s*$/.exec(v);
  return m ? Math.round(Number(m[1]) * labelSize) : NaN;
}

/** Tip dots are drawn when rows (radial: the arc between tips) are at least this many px. */
export const TIP_DOT_PX = 6;
/** Rectangular: the least row height (px) from which the collapse threshold is capped at the row height. A canvas H px tall holds at most H
 *  rows at 1 px or more, a few thousand entries, far under the budget, and folding gives nothing there: summaries carry no text (#113). */
export const RECT_CAP_MIN_PX = 1;

/** The most the level of detail collapses by (px) while the draw list fits its budget: the tip pitch, less a hair (a one-row clade is the
 *  pitch tall up to rounding, and the cut folds a clade *under* the threshold). Folding a clade next to tips drawn at this pitch saves
 *  nothing, a window holds a few hundred rows at most (#109). From a row height of `RECT_CAP_MIN_PX` in the rectangular layout (#113), from
 *  the dot size `TIP_DOT_PX` in the radial one, where the arcs are denser towards the centre (#110). Infinity before that, and with `lod` off. */
export function collapseCap(tipPitch: number, lod: boolean, rect: boolean): number {
  return lod && tipPitch >= (rect ? RECT_CAP_MIN_PX : TIP_DOT_PX) ? tipPitch * (1 - 1e-4) : Infinity;
}

/** A px constant measured at `REF_LABEL_SIZE`, for font size `labelSize` (exactly the constant at the reference size). */
export function scaledPx(px: number, labelSize: number): number {
  return (px * labelSize) / REF_LABEL_SIZE;
}

/** Least tip pitch (px) at which tips get labels, for the density and font size (at least `LABEL_FONT_FLOOR_PX`). */
export function labelMinPx(density: LabelDensity, labelSize: number): number {
  return Math.max(LABEL_FONT_FLOOR_PX, scaledPx(LABEL_MIN_PX[density], labelSize));
}

/** The `treeWidth` option: `'auto'`, px, or a percentage of the width the plot may use. */
export type TreeWidth = 'auto' | number | `${number}%`;

/** The tree area's width in px for `treeWidth` over `avail` px, or null for 'auto' (also for a value that is not a size). */
export function resolveTreeWidth(tw: TreeWidth, avail: number): number | null {
  if (typeof tw === 'number') return tw > 0 ? tw : null;
  const m = /^\s*(\d*\.?\d+)\s*%\s*$/.exec(tw);
  return m && Number(m[1]) > 0 ? (Number(m[1]) / 100) * avail : null;
}
