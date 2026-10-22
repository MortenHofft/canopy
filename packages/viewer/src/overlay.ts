// LabelOverlay: the accessible face of the canvas. Three DOM pieces, all owned here:
//  - the label layer: one transparent, focusable <a> / <span> per drawn tip label, positioned over the canvas text (a pool keyed by tip
//    rank, so a label keeps its element while it stays in view; real links open the tip's page, the rest are role=treeitem);
//  - the hidden list of the tips in view (first SR_LIST_CAP, in tree order) for screen readers, refreshed 160 ms after the view settles;
//  - the polite live region used to announce the keyboard cursor.
// It reads the LabelList the last full frame produced and does NOT draw, decide when to run (the renderer calls it after full-quality
// frames only) or know about the view. DOM only; no canvas.

import { SR_LIST_CAP } from './constants.ts';
import { mk, SR_ONLY } from './dom.ts';
import type { LabelList } from './draw.ts';
import { K_SUMMARY, K_TIP, type DrawList } from './lod.ts';
import type { LayoutKind, TreeSnapshot, TreeTheme } from './types.ts';

const SR_DELAY_MS = 160; // the list of tips in view follows the view this long after its last change

/** The options the overlay reads. */
export interface OverlayOptions {
  readonly tipHref: ((tipId: string) => string) | null;
  readonly formatLabel: (id: string) => string;
}

/** Size and position an anchor over label `k` of the frame. */
function place(el: HTMLElement, labels: LabelList, k: number, rect: boolean): void {
  const h = labels.h[k];
  const fs = Math.max(8, h - 2);
  el.style.fontSize = fs + 'px';
  el.style.height = h + 'px';
  el.style.lineHeight = h + 'px';
  if (rect) el.style.transform = `translate(${labels.x[k]}px,${labels.y[k] - h / 2}px)`;
  else {
    const deg = (labels.ang[k] * 180) / Math.PI;
    el.style.transform = labels.flip[k]
      ? `translate(${labels.x[k]}px,${labels.y[k] - h / 2}px) rotate(${deg}deg) translateX(-100%) translateX(-${labels.gap[k]}px)`
      : `translate(${labels.x[k]}px,${labels.y[k] - h / 2}px) rotate(${deg}deg) translateX(${labels.gap[k]}px)`;
  }
  el.style.display = '';
}

/** Move an anchor that keeps DOM focus out of the view. */
function park(el: HTMLElement): void {
  el.style.transform = 'translate(-9999px,0)';
}

export class LabelOverlay {
  readonly layer: HTMLDivElement;
  readonly srList: HTMLUListElement;
  readonly live: HTMLDivElement;
  private pool = new Map<number, HTMLElement>();
  private poolMode = '';
  private lastKey = '';
  private srTimer = 0;

  /** `refreshList`: called when the delayed list update is due (scheduleList); it should draw pending changes and call updateList. */
  constructor(private refreshList: () => void) {
    this.layer = mk('div', 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none');
    this.layer.setAttribute('role', 'group');
    this.layer.setAttribute('aria-label', 'Tip labels in view');
    this.srList = mk('ul', SR_ONLY);
    this.srList.setAttribute('aria-label', 'Visible tips');
    this.live = mk('div', SR_ONLY);
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('role', 'status');
  }

  private refocus: string | null = null;

  /** Drop all label elements (the font, the link mode or the theme changed: they are rebuilt on the next update). With `keepFocus`, DOM
   *  focus on a label goes to the anchor of the same tip when it is drawn again (the tree was replaced). */
  clear(keepFocus = false): void {
    const active = document.activeElement as HTMLElement | null;
    for (const el of this.pool.values()) {
      if (keepFocus && el === active) this.refocus = el.dataset.tipId ?? null;
      el.remove();
    }
    this.pool.clear();
  }

  /** Put an anchor over every label of the frame, reuse the ones that stay, remove the ones that left. */
  update(labels: LabelList, tree: TreeSnapshot, opts: OverlayOptions, theme: TreeTheme, kind: LayoutKind): void {
    const mode = opts.tipHref ? 'a' : 'span';
    if (mode !== this.poolMode) {
      this.clear();
      this.poolMode = mode;
    }
    const key = theme.fontFamily + '|' + theme.labelFontStyle;
    if (key !== this.lastKey) {
      this.clear();
      this.lastKey = key;
    }
    const used = new Set<number>();
    const active = document.activeElement;
    const rect = kind === 'rectangular';
    for (let k = 0; k < labels.count; k++) {
      const r = labels.rank[k];
      if (r < 0) continue; // the label of a collapsed clade: canvas text only, the clade is reached by its triangle
      used.add(r);
      let el = this.pool.get(r);
      const id = tree.tipLabels[r] ?? '';
      if (!el) {
        el = document.createElement(mode);
        el.dataset.tipId = id;
        el.textContent = opts.formatLabel(id);
        el.tabIndex = 0;
        el.style.cssText = `position:absolute;left:0;top:0;pointer-events:auto;white-space:nowrap;color:transparent;text-decoration:none;cursor:pointer;outline-offset:1px;font-family:${theme.fontFamily};font-style:${theme.labelFontStyle};transform-origin:0 50%`;
        if (mode === 'a') {
          const a = el as HTMLAnchorElement;
          a.href = opts.tipHref!(id);
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        } else {
          el.setAttribute('role', 'treeitem');
        }
        this.layer.appendChild(el);
        this.pool.set(r, el);
      }
      place(el, labels, k, rect);
      el.style.display = '';
    }
    if (this.refocus !== null) {
      for (const el of this.pool.values())
        if (el.dataset.tipId === this.refocus) {
          el.focus({ preventScroll: true });
          break;
        }
      this.refocus = null;
    }
    for (const [r, el] of this.pool) {
      if (used.has(r)) continue;
      if (el === active) {
        // keep focus alive until it moves; off screen, so the focus outline is not left at the old place
        park(el);
        continue;
      }
      el.remove();
      this.pool.delete(r);
    }
  }

  /** Reduced (interaction) frames skip `update`; this keeps the focused anchor, the only one with a visible outline, over its label. The
   *  label of the frame is found by tip rank; when it is not drawn (left the view, or folded into a summary) the anchor is parked off
   *  screen. The pool is not touched otherwise. */
  follow(labels: LabelList, kind: LayoutKind): void {
    const active = document.activeElement;
    if (!active) return;
    for (const [r, el] of this.pool) {
      if (el !== active) continue;
      let k = 0;
      while (k < labels.count && labels.rank[k] !== r) k++;
      if (k < labels.count) place(el, labels, k, kind === 'rectangular');
      else park(el);
      return;
    }
  }

  /** Move DOM focus to the anchor of tip `rank` when it exists (the keyboard cursor follows focus on a label). */
  focusAnchor(rank: number): void {
    const el = this.pool.get(rank);
    if (el) el.focus({ preventScroll: true });
  }

  /** Ask for the list of tips in view to be refreshed shortly (restarts the delay). */
  scheduleList(): void {
    if (this.srTimer) clearTimeout(this.srTimer);
    this.srTimer = window.setTimeout(() => {
      this.srTimer = 0;
      this.refreshList();
    }, SR_DELAY_MS);
  }

  /** Visually hidden list of the tips in view (first SR_LIST_CAP in tree order) for assistive technology. */
  updateList(
    list: DrawList,
    tree: TreeSnapshot,
    formatLabel: (id: string) => string,
    collapsed: Uint8Array | null = null,
    cladeText?: (row: number) => string,
  ): void {
    const items: HTMLLIElement[] = [];
    let total = 0;
    for (let e = 0; e < list.count; e++) {
      const tip = list.kind[e] === K_TIP;
      // a collapsed clade is listed too, after its name or size, as "collapsed"
      if (!tip && !(collapsed !== null && cladeText && list.kind[e] === K_SUMMARY && list.last[e] < 0 && collapsed[list.node[e]] === 1)) continue;
      total++;
      if (items.length < SR_LIST_CAP) {
        const li = document.createElement('li');
        li.textContent = tip ? formatLabel(tree.tipLabels[tree.tipRank[list.node[e]]] ?? '') : `${cladeText!(list.node[e])}, collapsed`;
        items.push(li);
      }
    }
    const head = document.createElement('li');
    head.textContent = total
      ? `${total} tips drawn in view${total > items.length ? `, first ${items.length} listed` : ''}`
      : 'No individual tips are drawn at this zoom level; zoom in to list them';
    this.srList.replaceChildren(head, ...items);
  }

  announce(text: string): void {
    this.live.textContent = text;
  }

  destroy(): void {
    if (this.srTimer) clearTimeout(this.srTimer);
    this.srTimer = 0;
    this.pool.clear();
  }
}
