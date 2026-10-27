// colourBy: colour a tree by one categorical attribute of its tips, for example a column of a sidecar table (`SidecarBinding.categories`
// in @gbif-phylo/io). Pure data in, data out: it returns the `setClades` list that colours the tip branches, dots and labels, the legend
// items, and a swatch column, so an app wires the three it wants. The viewer is not touched.
//
// The input is integer codes by node, so nothing per tip is kept besides the entries `setClades` takes (about 55 ms per 100,000 tips, measured). The
// most frequent values get the palette's colours in turn; the rest share one 'Other' colour (the theme's `muted`), so a column with hundreds
// of values stays readable and never needs more than `palette.length + 1` colour classes. Tips without a value are not coloured.
// The codes are by node id: after a tree edit (`setTree`), make the codes again from the new tree and call colourBy again.

import type { CladeColour, CustomColumn, ColumnRenderer, TreeTheme } from './types.ts';
import type { LegendItem } from './controls/legend.ts';

/** The tips of a tree: a `TreeModel` of @gbif-phylo/io fits as it is. */
export interface ColourByTree {
  tipCount: number;
  tipNode: ArrayLike<number>;
}

/** One attribute as codes: what `SidecarBinding.categories` returns. `values` are most frequent first, `codes` are by node. */
export interface ColourByCategories {
  key: string;
  codes: ArrayLike<number>;
  values: readonly string[];
  counts: readonly number[];
}

export interface ColourByOptions {
  /** Colours for the most frequent values, in order. Default: the theme's `categorical`. */
  palette?: readonly string[];
  /** Colour of the values beyond the palette. Default: the theme's `muted`. */
  other?: string;
  /** Header of the swatch column. Default: the key. */
  header?: string;
  /** Width of the swatch column in CSS px. Default 14. */
  width?: number;
}

export interface ColourBy {
  /** Pass to `viewer.setClades`: one entry per coloured tip. */
  clades: CladeColour[];
  /** Pass to `new Legend({ items })`: one per palette value (with the tip count as detail), then 'Other' if used. */
  items: LegendItem[];
  /** A column of swatches, one per tip with a value; add it to `viewer.setColumns`. */
  column: CustomColumn<number, Int32Array>;
  /** Tips with a value. */
  coloured: number;
}

const count = (n: number, noun: string) => `${n.toLocaleString('en')} ${noun}${n === 1 ? '' : 's'}`;
const tips = (n: number) => count(n, 'tip');

export function colourBy(
  tree: ColourByTree,
  by: ColourByCategories,
  theme: Pick<TreeTheme, 'categorical' | 'muted'>,
  o: ColourByOptions = {},
): ColourBy {
  const palette = o.palette ?? theme.categorical;
  const colours = [...palette, o.other ?? theme.muted]; // the last is 'Other'
  const cls = (code: number) => Math.min(code, palette.length);
  const items: LegendItem[] = [];
  let otherTips = 0;
  by.values.forEach((value, i) => {
    if (i < palette.length) items.push({ colour: colours[i], label: value, detail: tips(by.counts[i]) });
    else otherTips += by.counts[i];
  });
  if (otherTips)
    items.push({
      colour: colours[palette.length],
      label: 'Other',
      detail: `${tips(otherTips)}, ${count(by.values.length - palette.length, 'value')}`,
    });

  const clades: CladeColour[] = [];
  for (let r = 0; r < tree.tipCount; r++) {
    const node = tree.tipNode[r];
    const code = by.codes[node];
    if (code >= 0) clades.push({ node, colour: colours[cls(code)], label: by.values[code] });
  }

  const renderer: ColumnRenderer<number, Int32Array> = {
    prepare({ tipNodes, tipCount }) {
      const d = new Int32Array(tipCount);
      for (let r = 0; r < tipCount; r++) {
        const code = by.codes[tipNodes[r]];
        d[r] = code >= 0 ? cls(code) : -1;
      }
      return d;
    },
    draw(ctx, f, d) {
      const pad = 2;
      const step = f.rowHeight >= 1 ? 1 : Math.ceil(1 / f.rowHeight); // rows per pixel row
      const h = Math.max(1, f.rowHeight);
      for (let r = f.r0; r <= f.r1; r += step) {
        if (d[r] < 0) continue;
        ctx.fillStyle = colours[d[r]];
        ctx.fillRect(f.x + pad, f.oy + r * f.rowHeight, f.width - 2 * pad, h);
      }
    },
    hasCell: (d, r) => d[r] >= 0,
  };
  return {
    clades,
    items,
    column: { id: `colour-by:${by.key}`, kind: 'custom', header: o.header ?? by.key, width: o.width ?? 14, values: {}, renderer },
    coloured: clades.length,
  };
}
