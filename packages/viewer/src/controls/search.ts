// Search: a text field that finds nodes by name as you type, tips by label and internal nodes (clades) by name (prefix matches first, then
// matches anywhere, case-insensitive, on the displayed name, a run of spaces and underscores counting as one space; the matching is
// `createSearchIndex`), with a list of suggestions to pick from with the mouse or the arrow keys and Enter. Picking a tip focuses it
// (animated), picking a clade zooms to it; either way the node gets a ring of its own (`setMarked`, until the field is emptied; `mark: false`
// leaves that out), `highlight: true` also highlights a tip, and `onSelect` replaces the action entirely. Tip labels need not be unique: each
// tip is a suggestion of its own, a label that several tips carry says which of them it is ('2 of 3'), and the chosen tip alone is focused and
// ringed (by node id).
//
// When more nodes match than the list shows, its last line says so ('8 of 1,234 matches'), and a polite live region announces the same count.
//
// The index (the lowercased names) is built once per tree and options (a large tree is scanned per keystroke, debounced, not re-lowercased);
// every name is scanned, to count the matches.

import { BaseControl, type ControlOptions } from '../control.ts';
import type { TreeViewer } from '../viewer.ts';
import type { TreeSnapshot } from '../types.ts';
import { ICONS } from './icons.ts';
import { SR_ONLY } from '../dom.ts';
import { cladeName } from '../clade-name.ts';
import { createSearchIndex, type SearchHit, type SearchIndex, type SearchResult } from '../search-index.ts';

export interface SearchOptions extends ControlOptions {
  placeholder?: string;
  /** Most suggestions shown (default 8). */
  maxResults?: number;
  /** Also highlight the chosen tip (replacing the highlighted tips; a chosen clade clears them). Default false. */
  highlight?: boolean;
  /** Ring the chosen node with `setMarked` until the field is emptied or the tree changes. Default true. */
  mark?: boolean;
  /** What choosing a node does instead of focusing it: its label (a clade: its name) and its node id (which tells tips with the same label
   *  apart, and tips from clades: an internal node's id is not a tip's). */
  onSelect?(tipId: string, viewer: TreeViewer, node: number): void;
  icon?: string;
}

let uid = 0;

export class Search extends BaseControl {
  readonly input: HTMLInputElement;
  readonly list: HTMLUListElement;
  /** The polite live region that announces the count ('8 of 1,234 matches', 'No matches'). */
  readonly status: HTMLDivElement;
  private opts: SearchOptions;
  private index: SearchIndex | null = null;
  private results: SearchHit[] = [];
  private marked = false; // this control's ring is on
  private total = 0;
  private active = -1;
  private timer = 0;

  constructor(opts: SearchOptions = {}) {
    super('search', { position: 'top-right', ...opts });
    this.opts = opts;
    const id = `phylo-search-${++uid}`;
    const icon = document.createElement('span');
    icon.className = 'phylo-search__icon';
    icon.innerHTML = opts.icon ?? ICONS.search;
    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.className = 'phylo-search__input';
    this.input.placeholder = opts.placeholder ?? 'Find a tip';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('role', 'combobox');
    this.input.setAttribute('aria-label', 'Find a tip');
    this.input.setAttribute('aria-autocomplete', 'list');
    this.input.setAttribute('aria-expanded', 'false');
    this.input.setAttribute('aria-controls', id);
    this.list = document.createElement('ul');
    this.list.id = id;
    this.list.className = 'phylo-search__list';
    this.list.setAttribute('role', 'listbox');
    this.list.dataset.phyloScroll = ''; // scrolls itself: the wheel over it does not zoom the tree
    this.list.hidden = true;
    this.status = document.createElement('div');
    this.status.style.cssText = SR_ONLY;
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.element.append(icon, this.input, this.list, this.status);
  }

  protected attach(v: TreeViewer): void {
    this.index = null;
    const stale = () => {
      this.index = null;
    };
    this.listen(v.on('sourcechange', stale));
    this.listen(
      v.on('treechange', () => {
        stale();
        this.marked = false; // the viewer keeps or drops the ring by its map
        this.results = [];
        this.close();
      }),
    );
    this.listen(v.on('optionschange', (e) => (e.changed.includes('formatLabel') || e.changed.includes('cladeLabel')) && stale()));
    this.domListen(this.input, 'input', () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.run(v), 100);
    });
    this.domListen(this.input, 'keydown', (e) => this.onKey(v, e));
    this.domListen(this.input, 'blur', () => setTimeout(() => this.close(), 150));
    this.domListen(this.list, 'pointerdown', (e) => e.preventDefault()); // keep focus in the field
    this.domListen(this.list, 'click', (e) => {
      const li = (e.target as Element).closest('li');
      const row = li?.dataset.node === undefined ? -1 : rowOf(v.getTree(), Number(li.dataset.node));
      const hit = row < 0 ? undefined : { node: Number(li?.dataset.node), clade: v.getTree().childCount[row] > 0 };
      if (hit) this.choose(v, hit);
    });
  }

  protected detach(): void {
    clearTimeout(this.timer);
    this.close();
    this.index = null;
    this.unmark();
  }

  /** The nodes matching `query` (prefix matches first), at most `maxResults`, and the number of nodes matching in all. */
  find(v: TreeViewer, query: string): SearchResult {
    this.index ??= createSearchIndex(v.getTree(), { formatLabel: v.options.formatLabel, cladeLabel: v.options.cladeLabel });
    return this.index.find(query, this.opts.maxResults ?? 8);
  }

  private run(v: TreeViewer): void {
    const { hits, total } = this.find(v, this.input.value);
    if (!this.input.value.trim()) this.unmark();
    this.results = hits;
    this.total = total;
    this.active = hits.length ? 0 : -1;
    this.render(v);
    this.status.textContent = this.input.value.trim() ? countText(hits.length, total) : '';
  }

  private render(v: TreeViewer): void {
    const t = v.getTree();
    this.list.replaceChildren(
      ...this.results.map((h, k) => {
        const row = rowOf(t, h.node);
        const li = document.createElement('li');
        li.id = `${this.list.id}-${k}`;
        li.className = 'phylo-search__option';
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(k === this.active));
        li.dataset.node = String(h.node);
        li.textContent = this.nameOf(v, row) ?? '';
        if (h.clade) {
          const n = t.leafEnd[row] - t.leafStart[row];
          li.append(this.detail(` ${n.toLocaleString('en')} ${n === 1 ? 'tip' : 'tips'}`));
        } else {
          const same = v.tipNodes(t.labels[row] ?? '');
          if (same.length > 1) li.append(this.detail(` ${same.indexOf(h.node) + 1} of ${same.length}`));
        }
        return li;
      }),
    );
    if (this.total > this.results.length) {
      const more = document.createElement('li');
      more.className = 'phylo-search__more';
      more.setAttribute('role', 'none');
      more.setAttribute('aria-hidden', 'true'); // the live region says it
      more.textContent = countText(this.results.length, this.total);
      this.list.append(more);
    }
    const open = this.results.length > 0;
    this.list.hidden = !open;
    this.input.setAttribute('aria-expanded', String(open));
    if (this.active >= 0) this.input.setAttribute('aria-activedescendant', `${this.list.id}-${this.active}`);
    else this.input.removeAttribute('aria-activedescendant');
  }

  private onKey(v: TreeViewer, e: KeyboardEvent): void {
    const n = this.results.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!n) return;
      e.preventDefault();
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      this.render(v);
    } else if (e.key === 'Enter') {
      clearTimeout(this.timer);
      if (!n) this.run(v);
      if (this.active >= 0) this.choose(v, this.results[this.active]);
    } else if (e.key === 'Escape') {
      if (!this.list.hidden) {
        e.preventDefault();
        this.close();
      }
    }
  }

  private detail(text: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = 'phylo-search__dup';
    span.textContent = text;
    return span;
  }

  /** The name a node is listed by: a tip's label, a clade's name, through `formatLabel` (and `cladeLabel`). */
  private nameOf(v: TreeViewer, row: number): string | null {
    return cladeName(v.getTree(), row, { formatLabel: v.options.formatLabel, cladeLabel: v.options.cladeLabel });
  }

  private choose(v: TreeViewer, hit: SearchHit): void {
    const t = v.getTree();
    const row = rowOf(t, hit.node);
    const name = this.nameOf(v, row);
    if (row < 0 || name === null) return;
    this.close();
    this.input.value = name;
    if (this.opts.onSelect) return this.opts.onSelect(t.labels[row] ?? name, v, hit.node);
    if (this.opts.highlight) v.setHighlighted(hit.clade ? [] : [hit.node]); // the node: this tip, not every tip with its label
    if (this.opts.mark !== false) {
      v.setMarked([hit.node]);
      this.marked = true;
    }
    if (hit.clade) v.zoomToNode(hit.node, true);
    else v.focusTip(hit.node, true);
  }

  /** Take this control's ring off (the field was emptied or the control removed). */
  private unmark(): void {
    if (this.marked) this.viewer?.setMarked([]);
    this.marked = false;
  }

  private close(): void {
    this.results = [];
    this.total = 0;
    this.status.textContent = '';
    this.active = -1;
    this.list.replaceChildren();
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }
}

/** The row of the snapshot of a node id of the public API, -1 when it is not loaded. */
function rowOf(t: TreeSnapshot, node: number): number {
  return t.globalId === null ? node : t.toLocal(node);
}

/** '8 of 1,234 matches' when the list shows fewer than match, else '3 matches', '1 match' or 'No matches'. */
function countText(shown: number, total: number): string {
  const n = (x: number) => x.toLocaleString('en');
  if (!total) return 'No matches';
  if (shown < total) return `${n(shown)} of ${n(total)} matches`;
  return `${n(total)} match${total === 1 ? '' : 'es'}`;
}
