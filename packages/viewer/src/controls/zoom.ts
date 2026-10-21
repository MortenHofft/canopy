// Zoom in / out buttons. They zoom about the centre of the view the way the wheel does: rows only in the rectangular layout (the time or
// length axis keeps its range), both axes in the radial one.

import { BaseControl, makeButton, type ControlOptions } from '../control.ts';
import type { TreeViewer } from '../viewer.ts';
import { ICONS } from './icons.ts';

export interface ZoomOptions extends ControlOptions {
  /** Zoom factor per click (default 1.6). */
  factor?: number;
  zoomInIcon?: string;
  zoomOutIcon?: string;
}

export class Zoom extends BaseControl {
  readonly zoomIn: HTMLButtonElement;
  readonly zoomOut: HTMLButtonElement;
  private factor: number;

  constructor(opts: ZoomOptions = {}) {
    super('zoom', opts);
    this.element.classList.add('phylo-bar');
    this.factor = opts.factor ?? 1.6;
    this.zoomIn = makeButton('Zoom in', opts.zoomInIcon ?? ICONS.zoomIn);
    this.zoomOut = makeButton('Zoom out', opts.zoomOutIcon ?? ICONS.zoomOut);
    this.element.append(this.zoomIn, this.zoomOut);
  }

  protected attach(v: TreeViewer): void {
    this.domListen(this.zoomIn, 'click', () => this.zoom(v, this.factor));
    this.domListen(this.zoomOut, 'click', () => this.zoom(v, 1 / this.factor));
  }

  private zoom(v: TreeViewer, f: number): void {
    const { width, height } = v.size;
    if (v.options.layout === 'rectangular') v.zoomBy(1, f, width / 2, height / 2);
    else v.zoomBy(f, f, width / 2, height / 2);
  }
}
