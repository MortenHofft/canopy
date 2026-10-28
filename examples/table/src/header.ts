// The header row of the table: one cell per column (Tree, Labels and its extra fields, then the data columns), each with its title and
// a handle to resize it, laid over the band the viewer leaves above the plot for its column headers (the viewer's own header text is
// left empty). The viewer has no header row of its own yet, so the cells are placed from what the public API tells after each frame:
//  - a data column's left edge from `columnCell` of a row in view (the viewer does not say where a column is otherwise);
//  - where the labels start from `nodePosition` of tips in view (the aligned label column starts LABEL_GAP_PX right of the farthest tip);
//  - the end of the tree area from the first column's left edge less the viewer's gap between columns.
// See the README, "Gaps".

import type { TreeViewer } from '@canopy/viewer';

/** The viewer's gap between the tree area and a column, and between columns (`COL_GAP` in the viewer's columns.ts, not exported). */
export const COL_GAP = 6;
/** The viewer's gap from the farthest tip to the aligned label text (`LABEL_GAP_PX` in labels.ts, not exported). */
const LABEL_GAP_PX = 8;

export interface HeaderCell {
  id: string;
  title: string;
  /** Text after the title, muted (Labels: '2/3 fields'). */
  note?: string;
  /** Sub-headers in equal parts of the cell, under the title (the heatmap's tissues). */
  parts?: string[];
  /** 'tree' and 'labels' are placed from the tree; a 'column' from its cells. A 'field' is a text column of the Labels group. */
  kind: 'tree' | 'labels' | 'field' | 'column';
  /** Whether the bar column kind (its cells are inset by 2 px). */
  bar?: boolean;
  width: number;
  /** Has a resize handle (the tree has none: see the README). */
  resizable: boolean;
}

export interface HeaderOptions {
  /** A handle was dragged (or moved with the arrow keys) to make `id` this wide; `done` at the end of the gesture. For 'labels' the
   *  width is the whole tree area's, labels included (the viewer's `treeWidth`). */
  onResize(id: string, width: number, done: boolean): void;
}

interface Placed {
  cell: HeaderCell;
  el: HTMLElement;
  left: number;
  width: number;
}

export class HeaderRow {
  private cells: Placed[] = [];
  private labelX = NaN; // where the labels start, cached: it changes only with the x window and the size, not with scrolling

  constructor(
    readonly element: HTMLElement,
    private viewer: TreeViewer,
    private opts: HeaderOptions,
  ) {
    element.setAttribute('role', 'row');
  }

  /** The cells, in order. */
  setCells(cells: HeaderCell[]): void {
    this.element.replaceChildren();
    this.cells = cells.map((cell) => {
      const el = document.createElement('div');
      el.className = `table-head__cell table-head__cell--${cell.kind}`;
      el.setAttribute('role', 'columnheader');
      el.dataset.col = cell.id;
      const title = document.createElement('span');
      title.className = 'table-head__title';
      title.textContent = cell.title;
      el.append(title);
      if (cell.note) {
        const note = document.createElement('span');
        note.className = 'table-head__note';
        note.textContent = cell.note;
        el.append(note);
      }
      if (cell.parts) {
        el.classList.add('table-head__cell--parts');
        const row = document.createElement('span');
        row.className = 'table-head__parts';
        for (const p of cell.parts) {
          const s = document.createElement('span');
          s.textContent = p;
          s.title = `${cell.title}: ${p}`;
          row.append(s);
        }
        el.append(row);
      }
      if (cell.resizable) el.append(this.grip(cell));
      this.element.append(el);
      return { cell, el, left: NaN, width: NaN };
    });
    this.labelX = NaN;
    this.update();
  }

  /** A column's new width (while its handle is dragged: the cells are kept, so the handle keeps the pointer). */
  setWidth(id: string, width: number): void {
    const p = this.cells.find((q) => q.cell.id === id);
    if (p) p.cell = { ...p.cell, width };
    this.update();
  }

  /** Forget the cached label position (after a resize, a new tree width or new options). */
  invalidate(): void {
    this.labelX = NaN;
  }

  /** Place the cells from the frame just drawn. */
  update(): void {
    const v = this.viewer;
    if (v.isDestroyed()) return;
    const origin = v.element.getBoundingClientRect();
    const firstCol = this.cells.find((p) => p.cell.kind === 'field' || p.cell.kind === 'column');
    let colsLeft = NaN;
    for (const p of this.cells) {
      if (p.cell.kind !== 'field' && p.cell.kind !== 'column') continue;
      const x = this.columnX(p.cell);
      if (x === null) continue;
      p.left = x - origin.left;
      p.width = p.cell.width;
      if (p === firstCol) colsLeft = p.left;
    }
    const overview = v.element.querySelector('.phylo-overview')?.getBoundingClientRect();
    const right = Number.isFinite(colsLeft) ? colsLeft - COL_GAP : (overview ? overview.left - origin.left : v.size.width) - 8;
    if (!Number.isFinite(this.labelX)) this.labelX = this.labelStart();
    const labelX = Number.isFinite(this.labelX) ? this.labelX : right * 0.7;
    for (const p of this.cells) {
      if (p.cell.kind === 'tree') [p.left, p.width] = [0, labelX];
      if (p.cell.kind === 'labels') [p.left, p.width] = [labelX, Math.max(0, right - labelX)];
    }
    for (const p of this.cells) {
      const ok = Number.isFinite(p.left);
      p.el.hidden = !ok;
      if (!ok) continue;
      const l = `${Math.round(p.left)}px`,
        w = `${Math.round(p.width)}px`;
      if (p.el.style.left !== l) p.el.style.left = l;
      if (p.el.style.width !== w) p.el.style.width = w;
    }
  }

  /** The client x of the left edge of a column: from a cell of a row in view. */
  private columnX(cell: HeaderCell): number | null {
    const v = this.viewer;
    const L = v.layout;
    const t = v.getTree();
    const { y0, y1 } = v.getViewport();
    for (let row = Math.max(0, Math.floor(y0)); row < Math.min(L.rows, Math.ceil(y1)); row++) {
      const rank = L.rankOfRow ? L.rankOfRow[row] : row;
      if (L.collapsed && L.rowNode && L.collapsed[L.rowNode[row]]) continue; // a collapsed clade's row is blank in every column
      const box = v.columnCell(cell.id, t.tipNode[rank]);
      if (box) return box.x - (cell.bar ? 2 : 0);
    }
    return null;
  }

  /** Where the tip labels start, in px from the viewer's left: the screen x of the farthest tip (layout x = 1) plus the label gap, from
   *  two tips in view (a line through their layout x and screen x), or one at x = 1. NaN when no tip is in view. */
  private labelStart(): number {
    const v = this.viewer;
    const L = v.layout;
    const t = v.getTree();
    const { y0, y1 } = v.getViewport();
    let a: { X: number; x: number } | null = null;
    for (let row = Math.max(0, Math.floor(y0)); row < Math.min(L.rows, Math.ceil(y1)); row++) {
      const node = L.rowNode ? L.rowNode[row] : t.tipNode[row];
      if (L.collapsed?.[node]) continue;
      const p = v.nodePosition(node);
      if (!p) continue;
      const X = L.X[node];
      if (X >= 1 - 1e-9) return p.x + LABEL_GAP_PX;
      if (!a) a = { X, x: p.x };
      else if (Math.abs(X - a.X) > 1e-6) return a.x + ((1 - a.X) * (p.x - a.x)) / (X - a.X) + LABEL_GAP_PX;
    }
    return NaN;
  }

  private grip(cell: HeaderCell): HTMLElement {
    const g = document.createElement('span');
    g.className = 'table-head__grip';
    g.setAttribute('role', 'separator');
    g.setAttribute('aria-orientation', 'vertical');
    g.setAttribute('aria-label', `Resize ${cell.title}`);
    g.tabIndex = 0;
    let start: { x: number; w: number } | null = null;
    // the Labels handle sets the width of the whole tree area (the viewer's `treeWidth`), whose right edge it is
    const width = () => {
      const p = this.cells.find((q) => q.cell.id === cell.id);
      if (!p || !Number.isFinite(p.width)) return cell.width;
      return cell.kind === 'labels' ? p.left + p.width : p.width;
    };
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      start = { x: e.clientX, w: width() };
      g.classList.add('is-dragging');
    });
    g.addEventListener('pointermove', (e) => {
      if (start) this.opts.onResize(cell.id, start.w + e.clientX - start.x, false);
    });
    const end = (e: PointerEvent) => {
      if (!start) return;
      this.opts.onResize(cell.id, start.w + e.clientX - start.x, true);
      start = null;
      g.classList.remove('is-dragging');
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowLeft' ? -10 : e.key === 'ArrowRight' ? 10 : 0;
      if (!d) return;
      e.preventDefault();
      this.opts.onResize(cell.id, width() + d, true);
    });
    return g;
  }
}
