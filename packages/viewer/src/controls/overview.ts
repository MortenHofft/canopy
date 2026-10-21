// Overview control: the whole tree in small with the current window as a box; press or drag on it to move the window. Rectangular: a
// strip right of the plot, aligned with the rows (the plot leaves room for it); radial: a disc in the bottom left corner. It draws from
// the viewer's own cut machinery, so it uses the viewer's internals (`viewerInternals`), not only the public API.

import { BaseControl, type ControlOptions } from '../control.ts';
import { OVERVIEW_STRIP_W_PX } from '../constants.ts';
import { Overview } from '../overview.ts';
import { viewerInternals, type TreeViewer } from '../viewer.ts';

export class OverviewControl extends BaseControl {
  private ov: Overview | null = null;
  private version = -1;

  constructor(opts: Omit<ControlOptions, 'position' | 'target'> = {}) {
    super('overview', { ...opts, position: 'custom' });
    this.element.setAttribute('aria-hidden', 'true');
  }

  protected attach(v: TreeViewer): void {
    const i = viewerInternals(v);
    const ov = new Overview(i.overviewHost, v.options.softwareCanvas, this.element as HTMLDivElement);
    this.ov = ov;
    this.version = -1;
    i.reserveOverview(true);
    let inset = '';
    this.listen(
      v.on('frame', () => {
        // the strip of the rectangular layout takes the right edge: move the right-hand controls left of it
        const want = v.options.layout === 'rectangular' ? `${OVERVIEW_STRIP_W_PX + 8}px` : '0px';
        if (want !== inset) v.element.style.setProperty('--phylo-inset-right', (inset = want));
        ov.updateBox();
        const k = i.sceneVersion();
        if (k !== this.version) {
          this.version = k;
          ov.dirty = true;
        }
        if (ov.dirty) ov.draw();
      }),
    );
    v.invalidate();
  }

  protected detach(): void {
    this.viewer?.element.style.removeProperty('--phylo-inset-right');
    this.ov?.release();
    this.ov = null;
  }

  setViewer(viewer: TreeViewer | null): void {
    const prev = this.viewer;
    super.setViewer(viewer);
    if (prev && !prev.isDestroyed()) viewerInternals(prev).reserveOverview(false);
  }
}
