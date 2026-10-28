// The control layer of a viewer: the element over the canvas that holds the controls (`data-phylo-ui`: the input controller ignores events
// from inside it), its four corner boxes (made when a control first asks for one, kept in reading order), and the list of controls added.
// `TreeViewer.addControl` / `removeControl` / `getControls` are this class; a control has one viewer at a time, so adding it to another
// viewer first removes it from the one that holds it.

import type { Control, ControlPosition } from './control.ts';
import { mk } from './dom.ts';
import type { TreeViewer } from './viewer.ts';

const CORNERS: Exclude<ControlPosition, 'custom'>[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** The layer a control is on (a control has one at a time). */
const OWNER = new WeakMap<Control, ControlLayer>();

export class ControlLayer {
  /** The control layer over the canvas (data-phylo-ui) and its corner boxes. */
  readonly el: HTMLDivElement;
  private corners = new Map<ControlPosition, HTMLDivElement>();
  private controls: Control[] = [];

  constructor() {
    this.el = mk('div', 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none');
    this.el.className = 'phylo-ui';
    this.el.dataset.phyloUi = '';
  }

  /** Add a control: its element goes to its corner of the control layer (or to its `target`), then `setViewer(viewer)` is called.
   *  Adding a control twice does nothing; a control that another viewer holds is first removed from it. */
  add(viewer: TreeViewer, control: Control): void {
    if (this.controls.includes(control)) return;
    const owner = OWNER.get(control);
    if (owner && owner !== this) owner.remove(control);
    OWNER.set(control, this);
    const box = control.target ?? this.cornerBox(control.position ?? 'top-left');
    if (control.target) control.element.dataset.phyloUi = '';
    // the layer itself lets events through to the tree, so a control catches its own unless it set pointer-events itself (a layer
    // over the whole tree sets 'none' to let clicks through)
    else if (!control.element.style.pointerEvents) control.element.style.pointerEvents = 'auto';
    box.appendChild(control.element);
    this.controls.push(control);
    control.setViewer(viewer);
  }

  /** Remove a control: `setViewer(null)`, then its element is taken out of the page. */
  remove(control: Control): void {
    const k = this.controls.indexOf(control);
    if (k < 0) return;
    this.controls.splice(k, 1);
    if (OWNER.get(control) !== this) return; // moved to another viewer meanwhile: leave it there
    OWNER.delete(control);
    control.setViewer(null);
    control.element.remove();
  }

  list(): readonly Control[] {
    return this.controls.slice();
  }

  private cornerBox(pos: ControlPosition): HTMLElement {
    if (pos === 'custom') return this.el;
    let box = this.corners.get(pos);
    if (!box) {
      const [v, h] = pos.split('-');
      // flex column, pointer events only on the controls themselves; the stylesheet adds the gaps
      // the right corners keep clear of a strip along the right edge (the overview sets --phylo-inset-right while it shows one)
      const side = h === 'right' ? 'right:var(--phylo-inset-right,0px)' : 'left:0';
      box = mk('div', `position:absolute;${v}:0;${side};display:flex;flex-direction:column;align-items:${h === 'left' ? 'flex-start' : 'flex-end'}`);
      box.className = `phylo-controls phylo-controls--${pos}`;
      // keep the boxes in a fixed DOM order (reading order: top left, top right, bottom left, bottom right)
      const after = CORNERS.slice(CORNERS.indexOf(pos as (typeof CORNERS)[number]) + 1)
        .map((c) => this.corners.get(c))
        .find((b) => b);
      this.el.insertBefore(box, after ?? null);
      this.corners.set(pos, box);
    }
    return box;
  }
}
