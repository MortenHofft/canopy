// Fit button: show the whole tree (and its columns), animated.

import { BaseControl, makeButton, type ControlOptions } from '../control.ts';
import type { TreeViewer } from '../viewer.ts';
import { ICONS } from './icons.ts';

export interface FitOptions extends ControlOptions {
  icon?: string;
  label?: string;
}

export class Fit extends BaseControl {
  readonly button: HTMLButtonElement;

  constructor(opts: FitOptions = {}) {
    super('fit', opts);
    this.element.classList.add('phylo-bar');
    this.button = makeButton(opts.label ?? 'Show the whole tree', opts.icon ?? ICONS.fit);
    this.element.append(this.button);
  }

  protected attach(v: TreeViewer): void {
    this.domListen(this.button, 'click', () => v.fit(true));
  }
}
