// Legend: the clade colours in force (`setClades`), one swatch and name per clade, or a fixed list of items. Clicking a clade's entry
// zooms to it. Hidden while there is nothing to show.

import { BaseControl, type ControlOptions } from '../control.ts';
import { cladeName, type CladeLabelFn } from '../clade-name.ts';
import type { TreeViewer } from '../viewer.ts';

export interface LegendItem {
  colour: string;
  label: string;
  /** Secondary text after the label, such as '12 tips'. */
  detail?: string;
  /** Node id to zoom to when the entry is clicked. */
  node?: number;
}

export interface LegendOptions extends ControlOptions {
  title?: string;
  /** A fixed list instead of the viewer's clade colours. */
  items?: LegendItem[];
  /** Overrides the viewer's `cladeLabel` option (what names an internal node) for this legend. */
  cladeLabel?: CladeLabelFn;
}

export class Legend extends BaseControl {
  readonly list: HTMLUListElement;
  private heading: HTMLDivElement;
  private opts: LegendOptions;

  constructor(opts: LegendOptions = {}) {
    super('legend', { position: 'bottom-right', ...opts });
    this.opts = opts;
    this.heading = document.createElement('div');
    this.heading.className = 'phylo-legend__title';
    this.heading.textContent = opts.title ?? 'Clades';
    this.list = document.createElement('ul');
    this.list.className = 'phylo-legend__list';
    this.element.append(this.heading, this.list);
    this.element.dataset.phyloScroll = ''; // scrolls itself (long lists): the wheel over it does not zoom the tree
    this.element.hidden = true;
  }

  protected attach(v: TreeViewer): void {
    this.listen(v.on('cladeschange', () => this.render(v)));
    this.listen(v.on('sourcechange', () => this.render(v)));
    // formatLabel and cladeLabel change the names
    this.listen(v.on('optionschange', (e) => (e.changed.includes('formatLabel') || e.changed.includes('cladeLabel')) && this.render(v)));
    this.domListen(this.list, 'click', (e) => {
      const b = (e.target as Element).closest('button');
      if (b?.dataset.node) v.zoomToNode(Number(b.dataset.node), true);
    });
    this.render(v);
  }

  /** The entries shown: the fixed items, or one per coloured clade (named by its label, else the clade's name with its tip count as detail, else 'Clade of N tips'). */
  items(v: TreeViewer): LegendItem[] {
    if (this.opts.items) return this.opts.items;
    const t = v.getTree();
    return v.getClades().map((c) => {
      const row = t.globalId === null ? c.node : t.toLocal(c.node);
      if (c.label !== undefined) return { colour: c.colour, label: c.label, node: c.node };
      const tips = row >= 0 ? t.leafEnd[row] - t.leafStart[row] : 0;
      const n = `${tips.toLocaleString('en')} tips`;
      const name = cladeName(t, row, { formatLabel: v.options.formatLabel, cladeLabel: this.opts.cladeLabel ?? v.options.cladeLabel });
      const tip = row >= 0 && t.childCount[row] === 0;
      if (name === null) return { colour: c.colour, label: tip ? 'Unnamed tip' : `Clade of ${n}`, node: c.node };
      return tip ? { colour: c.colour, label: name, node: c.node } : { colour: c.colour, label: name, detail: n, node: c.node };
    });
  }

  private render(v: TreeViewer): void {
    const items = this.items(v);
    this.list.replaceChildren(
      ...items.map((it) => {
        const li = document.createElement('li');
        const sw = document.createElement('span');
        sw.className = 'phylo-legend__swatch';
        sw.style.background = it.colour;
        const text = document.createElement(it.node === undefined ? 'span' : 'button');
        text.className = 'phylo-legend__label';
        text.textContent = it.label;
        if (it.detail) {
          const d = document.createElement('span');
          d.className = 'phylo-legend__detail';
          d.textContent = ` (${it.detail})`;
          text.append(d);
        }
        if (it.node !== undefined) {
          (text as HTMLButtonElement).type = 'button';
          text.dataset.node = String(it.node);
          text.title = `Zoom to ${it.label}`;
        }
        li.append(sw, text);
        return li;
      }),
    );
    this.element.hidden = items.length === 0;
  }
}
