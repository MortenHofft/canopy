// Overlay: an element of yours pinned to a node, a tip or a point of the viewer, that follows it as the view moves (after every frame)
// and hides while its anchor is out of view. Use it for a popup on a clicked node, a badge on a clade, a note on a tip. It is a control
// (position 'custom'): add it with `viewer.addControl(overlay)`, then `setPosition(...)`.

import { BaseControl, type ControlOptions } from '../control.ts';
import type { TreeViewer } from '../viewer.ts';

/** What the overlay is pinned to: a node id, a tip label, or a point in px relative to the viewer element. null hides it. */
export type OverlayAnchor = { node: number } | { tipId: string } | { x: number; y: number } | null;

/** Which point of the element sits on the anchor: vertical then horizontal, as in 'bottom-center' (the element above the anchor). */
export type OverlayPositioning = `${'top' | 'center' | 'bottom'}-${'left' | 'center' | 'right'}`;

export interface OverlayOptions extends Omit<ControlOptions, 'position' | 'target'> {
  /** The content; a div of your own is used as it is. Default: an empty div. */
  element?: HTMLElement;
  /** Default 'top-left': the element's top left corner on the anchor. */
  positioning?: OverlayPositioning;
  /** Shift in px, [x, y], applied after the positioning. Default [0, 0]. */
  offset?: [number, number];
  /** Keep the element inside the viewer (shifted in from the edges). Default true. */
  keepInside?: boolean;
  anchor?: OverlayAnchor;
}

export class Overlay extends BaseControl {
  private anchor: OverlayAnchor;
  private positioning: OverlayPositioning;
  private offset: [number, number];
  private keepInside: boolean;

  constructor(opts: OverlayOptions = {}) {
    super('overlay', { ...opts, position: 'custom' }, opts.element ?? document.createElement('div'));
    this.anchor = opts.anchor ?? null;
    this.positioning = opts.positioning ?? 'top-left';
    this.offset = opts.offset ?? [0, 0];
    this.keepInside = opts.keepInside !== false;
    const s = this.element.style;
    s.position = 'absolute';
    s.left = '0';
    s.top = '0';
    s.visibility = 'hidden';
  }

  setPosition(anchor: OverlayAnchor): void {
    this.anchor = anchor;
    this.update();
  }

  getPosition(): OverlayAnchor {
    return this.anchor;
  }

  setPositioning(p: OverlayPositioning, offset?: [number, number]): void {
    this.positioning = p;
    if (offset) this.offset = offset;
    this.update();
  }

  protected attach(v: TreeViewer): void {
    this.listen(v.on('frame', () => this.update()));
    this.listen(v.on('resize', () => this.update()));
    this.update();
  }

  /** Where the anchor is now, px relative to the viewer element; null when hidden or out of view. */
  anchorPoint(): { x: number; y: number } | null {
    const v = this.viewer;
    const a = this.anchor;
    if (!v || !a) return null;
    if ('x' in a) return { x: a.x, y: a.y };
    const node = 'node' in a ? a.node : v.tipNode(a.tipId);
    return node < 0 ? null : v.nodePosition(node);
  }

  /** Place the element (called after every frame; call it yourself after changing the element's content size). */
  update(): void {
    const s = this.element.style;
    const p = this.anchorPoint();
    if (!p || !this.viewer) {
      s.visibility = 'hidden';
      return;
    }
    const [vert, horiz] = this.positioning.split('-');
    const w = this.element.offsetWidth,
      h = this.element.offsetHeight;
    let x = p.x + this.offset[0] - (horiz === 'center' ? w / 2 : horiz === 'right' ? w : 0);
    let y = p.y + this.offset[1] - (vert === 'center' ? h / 2 : vert === 'bottom' ? h : 0);
    if (this.keepInside) {
      const { width, height } = this.viewer.size;
      x = Math.max(4, Math.min(x, width - w - 4));
      y = Math.max(4, Math.min(y, height - h - 4));
    }
    s.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    s.visibility = 'visible';
  }
}
