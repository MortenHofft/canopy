// Controls: UI that sits on the viewer (zoom buttons, search, legend, overview) or anywhere else on the page, and drives it through the
// public API and events only. The viewer places each control's element in one of four corner containers of its control layer (or, with
// `target`, in an element of the page) and calls `setViewer(viewer)` when the control is added and `setViewer(null)` when it is removed.
// Any object with `element` and `setViewer` is a control; `BaseControl` adds listener bookkeeping so a subclass cannot leak listeners.
//
// Pointer, wheel and key events inside the control layer never reach the tree's own input handling (the layer is marked data-phylo-ui).

import type { TreeViewer } from './viewer.ts';

/** A corner of the viewer, or 'custom': the element is put in the control layer as it is and positions itself (absolutely). */
export type ControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'custom';

export interface Control {
  readonly element: HTMLElement;
  /** Where on the viewer; default 'top-left'. Ignored when `target` is set. */
  readonly position?: ControlPosition;
  /** Put the element here instead of on the viewer (a toolbar of the page, for example). */
  readonly target?: HTMLElement | null;
  /** Called with the viewer after the element was placed, and with null after it was removed. */
  setViewer(viewer: TreeViewer | null): void;
}

export interface ControlOptions {
  position?: ControlPosition;
  target?: HTMLElement | null;
  /** Extra class names for the element, besides `phylo-control` and the control's own. */
  className?: string;
}

export class BaseControl implements Control {
  readonly element: HTMLElement;
  readonly position: ControlPosition;
  readonly target: HTMLElement | null;
  protected viewer: TreeViewer | null = null;
  private cleanups: (() => void)[] = [];

  /** `element`: the control's root element (a div by default); `name`: its class, `phylo-<name>`. */
  constructor(name: string, opts: ControlOptions = {}, element: HTMLElement = document.createElement('div')) {
    this.element = element;
    this.element.classList.add('phylo-control', `phylo-${name}`);
    if (opts.className) this.element.classList.add(...opts.className.split(/\s+/).filter(Boolean));
    this.position = opts.position ?? 'top-left';
    this.target = opts.target ?? null;
  }

  setViewer(viewer: TreeViewer | null): void {
    if (this.viewer) {
      for (const f of this.cleanups.splice(0)) f();
      this.detach();
    }
    this.viewer = viewer;
    if (viewer) this.attach(viewer);
  }

  /** Override: called when the control was added to `viewer`. Register listeners with `this.listen`, they are removed on detach. */
  protected attach(_viewer: TreeViewer): void {}

  /** Override: called when the control is removed, after its listeners were removed. */
  protected detach(): void {}

  /** Keep a cleanup function (what `viewer.on` returns, for example) to run when the control is removed. */
  protected listen(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  /** Add a DOM listener that is removed with the control. */
  protected domListen<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void): void {
    el.addEventListener(type, fn);
    this.cleanups.push(() => el.removeEventListener(type, fn));
  }
}

/** A `<button type="button">` with the `phylo-button` class, an accessible name and an icon (SVG markup) or text. */
export function makeButton(label: string, icon: string | null, title = label): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'phylo-button';
  b.setAttribute('aria-label', label);
  b.title = title;
  if (icon) b.innerHTML = icon;
  else b.textContent = label;
  return b;
}
