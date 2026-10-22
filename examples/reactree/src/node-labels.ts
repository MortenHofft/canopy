// A control of our own: support values or branch lengths written next to the nodes, like Reactree's "Bootstrap" / "Length" label
// cycle. The viewer has no such option, so this places one absolutely positioned span per visible internal node after every frame
// (the 'frame' event and nodePosition, the same route the built-in Overlay takes). Spans are pooled; the walk over the nodes is
// skipped when rows are too close for text to fit.

import { BaseControl, type TreeViewer } from '@gbif-phylo/viewer';
import { splitInternalLabel } from '@gbif-phylo/io';

export type NodeLabelMode = 'none' | 'bootstrap' | 'branchlength';

const MAX_LABELS = 400; // per frame
const MIN_ROW_PX = 11; // rectangular: no labels while tip rows are closer than this

export class NodeLabels extends BaseControl {
  private mode: NodeLabelMode = 'none';
  private pool: HTMLSpanElement[] = [];
  private skipped: ReadonlySet<number> = new Set();

  constructor() {
    super('rt-node-labels', { position: 'custom' });
    // pointer-events none: clicks go through to the tree (addControl keeps a pointer-events set here)
    this.element.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
  }

  setMode(mode: NodeLabelMode): void {
    this.mode = mode;
    this.place();
  }

  /** Tips of the shown tree that stand for collapsed clades: they get no length (it is the clade's edge plus its height, not an original edge). */
  setSkipped(nodes: ReadonlySet<number>): void {
    this.skipped = nodes;
    this.place();
  }

  protected attach(v: TreeViewer): void {
    this.listen(v.on('frame', () => this.place()));
    this.place();
  }

  protected detach(): void {
    for (const s of this.pool) s.style.display = 'none';
  }

  private place(): void {
    const v = this.viewer;
    let used = 0;
    if (v && this.mode !== 'none') {
      const t = v.getTree();
      const vp = v.getViewport();
      const rect = v.options.layout === 'rectangular';
      const rowPx = v.size.height / Math.max(1e-9, vp.y1 - vp.y0);
      if (!rect || rowPx >= MIN_ROW_PX) {
        for (let i = 1; i < t.nodeCount && used < MAX_LABELS; i++) {
          const isTip = t.firstChild[i] < 0;
          let text = '';
          if (this.mode === 'bootstrap') {
            if (isTip) continue;
            const sup = splitInternalLabel(t.labels[i]).support;
            if (Number.isNaN(sup)) continue;
            text = String(Math.round(sup * 100) / 100);
          } else {
            const len = t.length[i];
            if (Number.isNaN(len) || this.skipped.has(i)) continue;
            text = len.toPrecision(3).replace(/\.?0+$/, '');
          }
          const id = t.globalId ? t.globalId[i] : i;
          const p = v.nodePosition(id);
          if (!p) continue;
          let x = p.x;
          // a branch length sits above the middle of its horizontal segment (rectangular), a support value just left of its node
          if (this.mode === 'branchlength' && rect) {
            const q = v.nodePosition(t.globalId ? t.globalId[t.parent[i]] : t.parent[i]);
            if (q) x = (q.x + p.x) / 2;
          }
          const span = this.span(used++);
          span.textContent = text;
          span.className = `rt-node-label rt-node-label--${this.mode}`;
          span.style.transform = `translate(${x}px, ${p.y}px) translate(${this.mode === 'bootstrap' ? '-100%' : '-50%'}, -100%)`;
          span.style.display = '';
        }
      }
    }
    for (let k = used; k < this.pool.length; k++) this.pool[k].style.display = 'none';
  }

  private span(k: number): HTMLSpanElement {
    if (k < this.pool.length) return this.pool[k];
    const s = document.createElement('span');
    s.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap';
    this.element.append(s);
    this.pool.push(s);
    return s;
  }
}
