// Search: a text field that finds tips by label as you type (prefix matches first, then matches anywhere, case-insensitive, on the
// displayed label), with a list of suggestions to pick from with the mouse or the arrow keys and Enter. Picking one focuses that tip
// (animated); `highlight: true` also highlights it, and `onSelect` replaces the action entirely. Tip labels need not be unique: each tip
// is a suggestion of its own, a label that several tips carry says which of them it is ('2 of 3'), and the chosen tip alone is focused and
// highlighted (by node id).
//
// When more tips match than the list shows, its last line says so ('8 of 1,234 matches'), and a polite live region announces the same count.
//
// The lowercased labels are built once per tree and options (a large tree is scanned per keystroke, debounced, not re-lowercased); every
// label is scanned, to count the matches.

import { BaseControl, type ControlOptions } from '../control.ts';
import type { TreeViewer } from '../viewer.ts';
import { ICONS } from './icons.ts';
import { SR_ONLY } from '../dom.ts';

export interface SearchOptions extends ControlOptions {
  placeholder?: string;
  /** Most suggestions shown (default 8). */
  maxResults?: number;
  /** Also highlight the chosen tip (replacing the highlighted tips). Default false. */
  highlight?: boolean;
  /** What choosing a tip does instead of focusing it: its label and its node id (which tells tips with the same label apart). */
  onSelect?(tipId: string, viewer: TreeViewer, node: number): void;
  icon?: string;
}

/** What `Search.find` found: the tip ranks to list (prefix matches first, at most `maxResults`) and how many tips match in all. */
export interface SearchResult {
  ranks: number[];
  total: number;
}

let uid = 0;

export class Search extends BaseControl {
  readonly input: HTMLInputElement;
  readonly list: HTMLUListElement;
  /** The polite live region that announces the count ('8 of 1,234 matches', 'No matches'). */
  readonly status: HTMLDivElement;
  private opts: SearchOptions;
  private lower: string[] | null = null;
  private results: number[] = []; // tip ranks
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
    this.lower = null;
    const stale = () => {
      this.lower = null;
    };
    this.listen(v.on('sourcechange', stale));
    this.listen(
      v.on('treechange', () => {
        stale();
        this.results = [];
        this.close();
      }),
    );
    this.listen(v.on('optionschange', (e) => e.changed.includes('formatLabel') && stale()));
    this.domListen(this.input, 'input', () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.run(v), 100);
    });
    this.domListen(this.input, 'keydown', (e) => this.onKey(v, e));
    this.domListen(this.input, 'blur', () => setTimeout(() => this.close(), 150));
    this.domListen(this.list, 'pointerdown', (e) => e.preventDefault()); // keep focus in the field
    this.domListen(this.list, 'click', (e) => {
      const li = (e.target as Element).closest('li');
      if (li?.dataset.rank) this.choose(v, Number(li.dataset.rank));
    });
  }

  protected detach(): void {
    clearTimeout(this.timer);
    this.close();
    this.lower = null;
  }

  /** The tip ranks matching `query` (prefix matches first), at most `maxResults`, and the number of tips matching in all. */
  find(v: TreeViewer, query: string): SearchResult {
    const q = query.trim().toLowerCase();
    if (!q) return { ranks: [], total: 0 };
    const t = v.getTree();
    const fmt = v.options.formatLabel;
    this.lower ??= t.tipLabels.map((l) => (l === undefined ? '' : fmt(l).toLowerCase()));
    const max = this.opts.maxResults ?? 8;
    const pre: number[] = [];
    const any: number[] = [];
    const L = this.lower;
    let total = 0;
    for (let r = 0; r < L.length; r++) {
      const k = L[r].indexOf(q);
      if (k < 0) continue;
      total++;
      if (k === 0) {
        if (pre.length < max) pre.push(r);
      } else if (any.length < max) any.push(r);
    }
    return { ranks: pre.concat(any).slice(0, max), total };
  }

  private run(v: TreeViewer): void {
    const { ranks, total } = this.find(v, this.input.value);
    this.results = ranks;
    this.total = total;
    this.active = ranks.length ? 0 : -1;
    this.render(v);
    this.status.textContent = this.input.value.trim() ? countText(ranks.length, total) : '';
  }

  private render(v: TreeViewer): void {
    const t = v.getTree();
    const fmt = v.options.formatLabel;
    this.list.replaceChildren(
      ...this.results.map((r, k) => {
        const li = document.createElement('li');
        li.id = `${this.list.id}-${k}`;
        li.className = 'phylo-search__option';
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(k === this.active));
        li.dataset.rank = String(r);
        const label = t.tipLabels[r] ?? '';
        li.textContent = fmt(label);
        const same = v.tipNodes(label);
        if (same.length > 1) {
          const dup = document.createElement('span');
          dup.className = 'phylo-search__dup';
          dup.textContent = ` ${same.indexOf(this.nodeOf(v, r)) + 1} of ${same.length}`;
          li.append(dup);
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

  /** Node id of the tip of this rank, -1 when its row is not loaded. */
  private nodeOf(v: TreeViewer, rank: number): number {
    const t = v.getTree();
    const row = t.tipNode[rank];
    return row < 0 ? -1 : t.globalId === null ? row : t.globalId[row];
  }

  private choose(v: TreeViewer, rank: number): void {
    const tipId = v.getTree().tipLabels[rank];
    if (tipId === undefined) return;
    const node = this.nodeOf(v, rank);
    this.close();
    this.input.value = v.options.formatLabel(tipId);
    if (this.opts.onSelect) return this.opts.onSelect(tipId, v, node);
    if (this.opts.highlight) v.setHighlighted([node >= 0 ? node : tipId]); // the node: this tip, not every tip with its label
    v.focusTip(rank, true);
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

/** '8 of 1,234 matches' when the list shows fewer than match, else '3 matches', '1 match' or 'No matches'. */
function countText(shown: number, total: number): string {
  const n = (x: number) => x.toLocaleString('en');
  if (!total) return 'No matches';
  if (shown < total) return `${n(shown)} of ${n(total)} matches`;
  return `${n(total)} match${total === 1 ? '' : 'es'}`;
}
