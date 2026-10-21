// Search: a text field that finds tips by label as you type (prefix matches first, then matches anywhere, case-insensitive, on the
// displayed label), with a list of suggestions to pick from with the mouse or the arrow keys and Enter. Picking one focuses that tip
// (animated); `highlight: true` also highlights it, and `onSelect` replaces the action entirely.
//
// The lowercased labels are built once per tree and options (a large tree is scanned per keystroke, debounced, not re-lowercased).

import { BaseControl, type ControlOptions } from '../control.ts';
import type { TreeViewer } from '../viewer.ts';
import { ICONS } from './icons.ts';

export interface SearchOptions extends ControlOptions {
  placeholder?: string;
  /** Most suggestions shown (default 8). */
  maxResults?: number;
  /** Also highlight the chosen tip (replacing the highlighted tips). Default false. */
  highlight?: boolean;
  /** What choosing a tip does instead of focusing it. */
  onSelect?(tipId: string, viewer: TreeViewer): void;
  icon?: string;
}

let uid = 0;

export class Search extends BaseControl {
  readonly input: HTMLInputElement;
  readonly list: HTMLUListElement;
  private opts: SearchOptions;
  private lower: string[] | null = null;
  private results: number[] = []; // tip ranks
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
    this.list.hidden = true;
    this.element.append(icon, this.input, this.list);
  }

  protected attach(v: TreeViewer): void {
    this.lower = null;
    const stale = () => {
      this.lower = null;
    };
    this.listen(v.on('sourcechange', stale));
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
      if (li) this.choose(v, Number(li.dataset.rank));
    });
  }

  protected detach(): void {
    clearTimeout(this.timer);
    this.close();
    this.lower = null;
  }

  /** The tip ranks matching `query` (prefix matches first), at most `maxResults`. */
  find(v: TreeViewer, query: string): number[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const t = v.getTree();
    const fmt = v.options.formatLabel;
    this.lower ??= t.tipLabels.map((l) => (l === undefined ? '' : fmt(l).toLowerCase()));
    const max = this.opts.maxResults ?? 8;
    const pre: number[] = [];
    const any: number[] = [];
    const L = this.lower;
    for (let r = 0; r < L.length && pre.length < max; r++) {
      const k = L[r].indexOf(q);
      if (k === 0) pre.push(r);
      else if (k > 0 && any.length < max) any.push(r);
    }
    return pre.concat(any).slice(0, max);
  }

  private run(v: TreeViewer): void {
    this.results = this.find(v, this.input.value);
    this.active = this.results.length ? 0 : -1;
    this.render(v);
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
        li.textContent = fmt(t.tipLabels[r] ?? '');
        return li;
      }),
    );
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

  private choose(v: TreeViewer, rank: number): void {
    const tipId = v.getTree().tipLabels[rank];
    if (tipId === undefined) return;
    this.close();
    this.input.value = v.options.formatLabel(tipId);
    if (this.opts.onSelect) return this.opts.onSelect(tipId, v);
    if (this.opts.highlight) v.setHighlighted([tipId]);
    v.focusTip(rank, true);
  }

  private close(): void {
    this.results = [];
    this.active = -1;
    this.list.replaceChildren();
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }
}
