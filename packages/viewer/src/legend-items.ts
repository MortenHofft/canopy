// legendItems: the entries of the clade legend as plain data, for an app that draws its own legend. The `Legend` control draws the same
// list; read it again on the events that change it (`cladeschange`, `treechange`, `sourcechange`, and `optionschange` when `formatLabel` or
// `cladeLabel` change) and call `viewer.zoomToNode(item.node, true)` when an entry is chosen.

import { cladeName, type CladeLabelFn } from './clade-name.ts';
import type { LegendItem } from './controls/legend.ts';
import type { TreeViewer } from './viewer.ts';

/** One entry per coloured clade (`setClades`): named by its label, else the clade's name with its tip count as detail, else 'Clade of N tips'
 *  ('Unnamed tip' for a tip). `cladeLabel` overrides the viewer's option of that name for this list. */
export function legendItems(v: TreeViewer, opts: { cladeLabel?: CladeLabelFn } = {}): LegendItem[] {
  const t = v.getTree();
  return v.getClades().map((c) => {
    const row = t.globalId === null ? c.node : t.toLocal(c.node);
    if (c.label !== undefined) return { colour: c.colour, label: c.label, node: c.node };
    const tips = row >= 0 ? t.leafEnd[row] - t.leafStart[row] : 0;
    const n = `${tips.toLocaleString('en')} tips`;
    const name = cladeName(t, row, { formatLabel: v.options.formatLabel, cladeLabel: opts.cladeLabel ?? v.options.cladeLabel });
    const tip = row >= 0 && t.childCount[row] === 0;
    if (name === null) return { colour: c.colour, label: tip ? 'Unnamed tip' : `Clade of ${n}`, node: c.node };
    return tip ? { colour: c.colour, label: name, node: c.node } : { colour: c.colour, label: name, detail: n, node: c.node };
  });
}
