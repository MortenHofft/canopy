// NodeMenu: a menu of actions for the clicked tip or clade, opened at the click (or at the keyboard cursor on Enter). The actions are the
// app's: `items(event, viewer)` returns them (or null / [] for no menu), and each item's onSelect does whatever it does (rotate, reroot,
// open a page). It is a DEFAULT action of the click event: a click listener that calls `preventDefault()` keeps it closed.
//
// Keyboard: opened from the keyboard, focus goes to the first enabled item; arrows move, Escape closes and gives focus back to the tree,
// Tab out closes. Pointer: a press outside, a pan or zoom, or a choice closes it. Opened by a tap, focus stays put: the compatibility
// mousedown that follows a tap would otherwise blur the menu and close it at once. While it is open, hover listeners that run as
// default actions (the tooltip) are suppressed.

import { BaseControl, type ControlOptions } from '../control.ts';
import { cladeName } from '../clade-name.ts';
import type { TreeEvent } from '../events.ts';
import type { TreeViewer } from '../viewer.ts';

export interface NodeMenuItem {
  id: string;
  label: string;
  /** Shown under the label (and as its title). */
  hint?: string;
  disabled?: boolean;
  onSelect(e: TreeEvent): void;
}

export interface NodeMenuOptions extends Omit<ControlOptions, 'position' | 'target'> {
  items(e: TreeEvent, viewer: TreeViewer): NodeMenuItem[] | null | undefined;
  /** The heading; default: the tip label, or the clade's name (without support, through formatLabel), or 'Clade, N tips'. */
  title?(e: TreeEvent, viewer: TreeViewer): string;
}

export class NodeMenu extends BaseControl {
  private opts: NodeMenuOptions;
  private open: { e: TreeEvent; items: NodeMenuItem[] } | null = null;
  private winCleanup: (() => void) | null = null;
  /** An action just ran: if it made the app replace the viewer (a new tree), focus the new one when this menu is added to it. */
  private refocus = false;

  constructor(opts: NodeMenuOptions) {
    super('node-menu', { ...opts, position: 'custom' });
    this.opts = opts;
    const s = this.element.style;
    s.position = 'absolute';
    s.left = '0';
    s.top = '0';
    this.element.hidden = true;
  }

  /** Change where the items come from (the next opening uses them). */
  setItems(items: NodeMenuOptions['items']): void {
    this.opts = { ...this.opts, items };
  }

  isOpen(): boolean {
    return this.open !== null;
  }

  protected attach(v: TreeViewer): void {
    if (this.refocus) {
      this.refocus = false;
      v.focus();
    }
    this.listen(v.on('click', (e) => this.openAt(v, e), { asDefault: true }));
    this.listen(v.on('hover', (e) => this.open && e?.preventDefault()));
    this.listen(v.on('viewchange', () => this.close(false)));
    this.domListen(this.element, 'keydown', (e) => this.onKey(e));
    this.domListen(this.element, 'focusout', (e) => {
      if (this.open && !this.element.contains(e.relatedTarget as Node | null)) this.close(false);
    });
    this.domListen(this.element, 'click', (e) => {
      const b = (e.target as Element).closest('button');
      const it = b && this.open?.items.find((x) => x.id === b.dataset.action);
      if (it && !it.disabled) this.choose(it);
    });
  }

  protected detach(): void {
    this.close(false);
  }

  /** Open the menu for `e` (what a click does); closes it when there are no items. */
  openAt(v: TreeViewer, e: TreeEvent): void {
    const items = this.opts.items(e, v);
    if (!items?.length) return this.close(false);
    this.open = { e, items };
    const el = this.element;
    const head = document.createElement('div');
    head.className = 'phylo-node-menu__title';
    head.setAttribute('aria-hidden', 'true');
    if (e.isTip) head.classList.add('phylo-node-menu__title--tip');
    head.textContent = this.opts.title ? this.opts.title(e, v) : defaultTitle(e, v);
    // role and label only while open, so a closed menu is not a menu to assistive technology (or to a query for one)
    el.setAttribute('role', 'menu');
    el.dataset.treeviewMenu = '';
    el.setAttribute('aria-label', e.isTip ? `Actions for tip ${e.tipId ?? ''}` : `Actions for clade of ${e.tipCount} tips`);
    el.replaceChildren(
      head,
      ...items.map((it) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'phylo-node-menu__item';
        b.setAttribute('role', 'menuitem');
        b.dataset.action = it.id;
        b.disabled = it.disabled === true;
        if (it.hint) b.title = it.hint;
        b.textContent = it.label;
        if (it.hint) {
          const h = document.createElement('span');
          h.className = 'phylo-node-menu__hint';
          h.textContent = it.hint;
          b.append(h);
        }
        return b;
      }),
    );
    el.hidden = false;
    // at the click, kept inside the viewer once its size is known
    const r = v.element.getBoundingClientRect();
    const x = Math.max(4, Math.min(e.clientX - r.left + 6, r.width - el.offsetWidth - 4));
    const y = Math.max(4, Math.min(e.clientY - r.top + 6, r.height - el.offsetHeight - 4));
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (e.via === 'keyboard') el.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    this.bindWindow(v);
  }

  /** Close the menu; `refocusTree` gives focus back to the tree (after Escape or a choice). */
  close(refocusTree: boolean): void {
    this.winCleanup?.();
    this.winCleanup = null;
    if (!this.open) return;
    this.open = null;
    this.element.hidden = true;
    this.element.replaceChildren();
    this.element.removeAttribute('role');
    this.element.removeAttribute('aria-label');
    delete this.element.dataset.treeviewMenu;
    if (refocusTree) this.viewer?.focus();
  }

  private choose(it: NodeMenuItem): void {
    const e = this.open!.e;
    this.refocus = true;
    this.close(true);
    it.onSelect(e);
    requestAnimationFrame(() => {
      this.refocus = false; // a re-creation of the viewer, if any, happened in this task
    });
  }

  private bindWindow(v: TreeViewer): void {
    this.winCleanup?.();
    // a press outside closes it; Escape closes it also while focus is on the tree (a pointer-opened menu)
    const down = (e: PointerEvent) => {
      if (!this.element.contains(e.target as Node)) this.close(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close(v.element.contains(document.activeElement));
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    this.winCleanup = () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return this.close(true);
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = Array.from(this.element.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    const k = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(k + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length]?.focus();
  }
}

function defaultTitle(e: TreeEvent, v: TreeViewer): string {
  if (e.isTip) return v.options.formatLabel(e.tipId ?? '');
  const t = v.getTree();
  const row = t.globalId === null ? e.node : t.toLocal(e.node);
  return cladeName(t, row, v.options.formatLabel) ?? `Clade, ${e.tipCount.toLocaleString('en')} tips`;
}
