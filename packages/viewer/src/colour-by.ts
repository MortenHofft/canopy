// colourBy: colour a tree by one attribute of its tips (a sidecar column from @gbif-phylo/io, a BEAST annotation, anything with
// `annotations.get(node, key)`). Pure data in, data out: it returns the `setClades` list that colours the tip branches, dots and labels, the
// legend items, and a swatch column, so an app wires the three it wants. The viewer is not touched.
//
// Categories are the distinct values as strings (a number column is categories too). The most frequent get the palette's colours in turn;
// the rest share one 'Other' colour (the theme's `muted`), so a column with hundreds of values stays readable and never needs more than
// `palette.length + 1` classes. Tips without a value are not coloured and have no swatch.

import type { CladeColour, CustomColumn, ColumnRenderer, TreeTheme } from './types.ts';
import type { LegendItem } from './controls/legend.ts';

/** What colourBy reads of a tree: a `TreeModel` of @gbif-phylo/io fits as it is. */
export interface ColourByTree {
  tipCount: number;
  tipNode: ArrayLike<number>;
  annotations: { get(node: number, key: string): unknown } | null;
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

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = Array.isArray(v) ? v.join(', ') : String(v);
  return s === '' ? null : s;
}

export function colourBy(tree: ColourByTree, key: string, theme: Pick<TreeTheme, 'categorical' | 'muted'>, o: ColourByOptions = {}): ColourBy {
  const palette = o.palette ?? theme.categorical;
  const other = o.other ?? theme.muted;
  const ann = tree.annotations;
  const byTip: (string | null)[] = new Array(tree.tipCount);
  const count = new Map<string, number>();
  let coloured = 0;
  for (let r = 0; r < tree.tipCount; r++) {
    const v = ann ? text(ann.get(tree.tipNode[r], key)) : null;
    byTip[r] = v;
    if (v === null) continue;
    coloured++;
    count.set(v, (count.get(v) ?? 0) + 1);
  }
  // most frequent first; ties keep first-seen order (Map order, stable sort)
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  const classOf = new Map<string, number>(); // value -> index into palette, palette.length for 'Other'
  const items: LegendItem[] = [];
  let otherTips = 0;
  ranked.forEach(([value, n], i) => {
    if (i < palette.length) {
      classOf.set(value, i);
      items.push({ colour: palette[i], label: value, detail: `${n} tips` });
    } else {
      classOf.set(value, palette.length);
      otherTips += n;
    }
  });
  if (otherTips) items.push({ colour: other, label: 'Other', detail: `${otherTips} tips, ${ranked.length - palette.length} values` });

  const clades: CladeColour[] = [];
  const palettePlus = [...palette, other];
  const swatch = new Map<number, number>(); // node -> index into palettePlus
  for (let r = 0; r < tree.tipCount; r++) {
    const v = byTip[r];
    if (v === null) continue;
    const k = classOf.get(v)!;
    clades.push({ node: tree.tipNode[r], colour: palettePlus[k], label: v });
    swatch.set(tree.tipNode[r], k);
  }

  const renderer: ColumnRenderer<number, Int32Array> = {
    prepare({ nodeValues, tipNodes, tipCount }) {
      const d = new Int32Array(tipCount).fill(-1);
      for (let r = 0; r < tipCount; r++) d[r] = nodeValues?.get(tipNodes[r]) ?? -1;
      return d;
    },
    draw(ctx, f, d) {
      const pad = 2;
      const step = f.rowHeight >= 1 ? 1 : Math.ceil(1 / f.rowHeight);
      const h = Math.max(1, f.rowHeight);
      for (let r = f.r0; r <= f.r1; r += step) {
        const c = d[r];
        if (c < 0) continue;
        ctx.fillStyle = palettePlus[c];
        ctx.fillRect(f.x + pad, f.oy + r * f.rowHeight, f.width - 2 * pad, h);
      }
    },
    hasCell: (d, r) => d[r] >= 0,
  };
  return {
    clades,
    items,
    column: { id: `colour-by:${key}`, kind: 'custom', header: o.header ?? key, width: o.width ?? 14, values: {}, nodeValues: swatch, renderer },
    coloured,
  };
}
