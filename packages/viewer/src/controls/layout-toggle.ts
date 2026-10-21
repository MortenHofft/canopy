// Layout toggle: one button per layout (rectangular, radial) in a group; the one in force is pressed. Follows `setOptions` made
// elsewhere through the optionschange event.

import { BaseControl, makeButton, type ControlOptions } from '../control.ts';
import type { LayoutKind } from '../types.ts';
import type { TreeViewer } from '../viewer.ts';
import { ICONS } from './icons.ts';

export interface LayoutToggleOptions extends ControlOptions {
  icons?: Partial<Record<LayoutKind, string>>;
  labels?: Partial<Record<LayoutKind, string>>;
}

const KINDS: LayoutKind[] = ['rectangular', 'radial'];

export class LayoutToggle extends BaseControl {
  readonly buttons: Record<LayoutKind, HTMLButtonElement>;

  constructor(opts: LayoutToggleOptions = {}) {
    super('layout-toggle', opts);
    this.element.classList.add('phylo-bar');
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', 'Layout');
    const label = { rectangular: 'Rectangular layout', radial: 'Radial layout', ...opts.labels };
    const icon = { ...ICONS, ...opts.icons };
    this.buttons = {
      rectangular: makeButton(label.rectangular, icon.rectangular),
      radial: makeButton(label.radial, icon.radial),
    };
    this.element.append(this.buttons.rectangular, this.buttons.radial);
  }

  protected attach(v: TreeViewer): void {
    for (const k of KINDS) this.domListen(this.buttons[k], 'click', () => v.setOptions({ layout: k }));
    this.listen(v.on('optionschange', (e) => e.changed.includes('layout') && this.sync(v)));
    this.sync(v);
  }

  private sync(v: TreeViewer): void {
    for (const k of KINDS) this.buttons[k].setAttribute('aria-pressed', String(v.options.layout === k));
  }
}
