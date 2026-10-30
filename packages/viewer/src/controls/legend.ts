// Legend: the clade colours in force (`setClades`), one swatch and name per clade, or a fixed list of items. Clicking a clade's entry
// zooms to it. Hidden while there is nothing to show.

import { BaseControl, type ControlOptions } from '../control.ts';
import type { CladeLabelFn } from '../clade-name.ts';
import { legendItems } from '../legend-items.ts';
import type { TreeViewer } from '../viewer.ts';

export interface LegendItem {
  colour: string;
  label: string;
  /** Secondary text after the label, such as '12 tips'. */
  detail?: string;
  /** Node id to zoom to when the entry is clicked. */
  node?: number;
}

/** A row under the entries, set apart from them: a button that calls `onSelect`. */
export interface LegendAction {
  label: string;
  onSelect: () => void;
}

export interface LegendOptions extends ControlOptions {
  title?: string;
  /** A fixed list instead of the viewer's clade colours. */
  items?: LegendItem[];
  /** Overrides the viewer's `cladeLabel` option (what names an internal node) for this legend. */
  cladeLabel?: CladeLabelFn;
  /** Adds a close button to the title; the app decides what closing does (the legend does not hide itself). */
  onClose?: () => void;
  /** Rows under the entries, after a separator, such as 'Clear selection'. Shown with the entries, so hidden while there are none. */
  actions?: LegendAction[];
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
    const title = document.createElement('span');
    title.textContent = opts.title ?? 'Clades';
    this.heading.append(title);
    if (opts.onClose) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'phylo-legend__close';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Close legend');
      this.heading.append(close);
    }
    this.list = document.createElement('ul');
    this.list.className = 'phylo-legend__list';
    this.element.append(this.heading, this.list);
    if (opts.actions?.length) {
      const actions = document.createElement('div');
      actions.className = 'phylo-legend__actions';
      for (const a of opts.actions) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'phylo-legend__action';
        b.textContent = a.label;
        b.dataset.action = String(opts.actions.indexOf(a));
        actions.append(b);
      }
      this.element.append(actions);
    }
    this.element.dataset.phyloScroll = ''; // scrolls itself (long lists): the wheel over it does not zoom the tree
    this.element.hidden = true;
  }

  protected attach(v: TreeViewer): void {
    this.listen(v.on('cladeschange', () => this.render(v)));
    this.listen(v.on('sourcechange', () => this.render(v)));
    this.listen(v.on('treechange', () => this.render(v)));
    // formatLabel and cladeLabel change the names
    this.listen(v.on('optionschange', (e) => (e.changed.includes('formatLabel') || e.changed.includes('cladeLabel')) && this.render(v)));
    // the close button and the actions are listened to here, not in the constructor, so they work again after a detach
    this.domListen(this.element, 'click', (e) => {
      const b = (e.target as Element).closest('button');
      if (!b || b.closest('ul')) return;
      if (b.classList.contains('phylo-legend__close')) this.opts.onClose?.();
      else if (b.dataset.action !== undefined) this.opts.actions?.[Number(b.dataset.action)]?.onSelect();
    });
    this.domListen(this.list, 'click', (e) => {
      const b = (e.target as Element).closest('button');
      if (b?.dataset.node) v.zoomToNode(Number(b.dataset.node), true);
    });
    this.render(v);
  }

  /** The entries shown: the fixed items, or one per coloured clade (named by its label, else the clade's name with its tip count as detail, else 'Clade of N tips'). */
  items(v: TreeViewer): LegendItem[] {
    if (this.opts.items) return this.opts.items;
    return legendItems(v, { cladeLabel: this.opts.cladeLabel });
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
