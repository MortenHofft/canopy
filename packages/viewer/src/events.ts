// The viewer's event emitter: `on(type, listener)` returns the function that removes the listener. Listeners run in the order they were
// added. A listener added with `{ asDefault: true }` is a DEFAULT ACTION: it runs after every ordinary listener, and only when none of them
// called `preventDefault()` on the event. Built-in pieces that react to clicks and hovers (the tooltip, the node menu) listen this way, so
// an app can replace what they do for one event, or for all, without removing them.
//
// No per-frame allocation: `frame` hands out the viewer's own stats object, and an event with no listeners costs one map lookup.

import type { CladeColour, FrameStats, NodeEvent, TipRef, TreeTheme, Viewport, ViewerOptions } from './types.ts';

/** A node event as listeners receive it: `NodeEvent` plus ids and helpers of the public API, and the default-action switch. */
export interface TreeEvent extends NodeEvent {
  readonly tipCount: number;
  /** The tip labels below the target (for a tip, its own): a slice of the loaded labels, allocated on each call. */
  tipIds(): string[];
  /** The same through the tree source, so also for a clade of a partial source whose labels are not loaded yet. */
  tipLabels(): Promise<string[]>;
  /** Skip the default actions for this event (the built-in tooltip or node menu, for example). */
  preventDefault(): void;
  readonly defaultPrevented: boolean;
}

export interface ViewerEventMap {
  /** A click (pointer) or Enter (keyboard) on a tip, a node marker, a collapsed clade or a branch. */
  click: TreeEvent;
  /** The pointer moved onto another target; `null` when it left every target. */
  hover: TreeEvent | null;
  /** The visible window changed (pan, zoom, fit, resize, animation step); equality-guarded. */
  viewchange: Viewport;
  /** After every drawn frame; the object is the viewer's own and is reused, so copy what you keep. */
  frame: FrameStats;
  /** After `setOptions` changed something: the full options in force and the keys that changed. */
  optionschange: { options: Readonly<ViewerOptions>; changed: (keyof ViewerOptions)[] };
  /** After the theme in force changed (`setTheme`, `refreshTheme`). */
  themechange: TreeTheme;
  /** The container was resized (CSS px). */
  resize: { width: number; height: number };
  /** After `setClades` changed the clade colours: the list in force. */
  cladeschange: readonly CladeColour[];
  /** After `setHighlighted` changed the highlighted tips: what it was given (labels and node ids). */
  highlightchange: readonly TipRef[];
  /** The selected node changed (`setSelected`, a click, or the viewer moving it: to the collapsed clade that now hides it, through the
   *  map of `setTree`): its node id, null when nothing is selected. */
  selectionchange: { node: number | null };
  /** The rows of a partial tree source changed (a clade was loaded or dropped). */
  sourcechange: { version: number };
  /** After `setTree` replaced the tree: the node map it was given (old node -> new node, -1 removed), null without one. The controls
   *  that hold something of the old tree (search index, legend) rebuild on it; a listener of yours that keeps node ids should too. */
  treechange: { map: Int32Array | null };
  /** The first frame was drawn. */
  ready: { layoutMs: number; tips: number };
  /** `destroy()` ran; the viewer is dead after the listeners return. */
  destroy: void;
}

export type ViewerEventType = keyof ViewerEventMap;
export type Listener<K extends ViewerEventType> = (e: ViewerEventMap[K]) => void;
export interface ListenOptions {
  /** Run as a default action: after the ordinary listeners, and only when none called `preventDefault()`. */
  asDefault?: boolean;
  /** Remove the listener after its first call. */
  once?: boolean;
}

interface Entry {
  fn: (e: never) => void;
  asDefault: boolean;
  once: boolean;
  /** Removed (possibly during an emit that is walking a list holding it): skipped from then on, as DOM dispatch does. */
  removed: boolean;
}

export class Emitter {
  private map = new Map<ViewerEventType, Entry[]>();

  on<K extends ViewerEventType>(type: K, fn: Listener<K>, opts: ListenOptions = {}): () => void {
    const list = this.map.get(type) ?? [];
    const entry: Entry = { fn: fn as Entry['fn'], asDefault: opts.asDefault === true, once: opts.once === true, removed: false };
    // copy on write: a listener added during an emit is not called by it; one removed during it is skipped (the `removed` flag)
    this.map.set(type, [...list, entry]);
    return () => this.remove(type, entry);
  }

  off<K extends ViewerEventType>(type: K, fn: Listener<K>): void {
    const e = this.map.get(type)?.find((x) => x.fn === fn);
    if (e) this.remove(type, e);
  }

  has(type: ViewerEventType): boolean {
    return (this.map.get(type)?.length ?? 0) > 0;
  }

  emit<K extends ViewerEventType>(type: K, e: ViewerEventMap[K]): void {
    const list = this.map.get(type);
    if (!list) return;
    const prevented = () => typeof e === 'object' && e !== null && (e as { defaultPrevented?: boolean }).defaultPrevented === true;
    for (const pass of [false, true]) {
      if (pass && prevented()) return;
      for (const x of list) {
        if (x.asDefault !== pass || x.removed) continue;
        if (x.once) this.remove(type, x);
        try {
          (x.fn as (e: ViewerEventMap[K]) => void)(e);
        } catch (err) {
          // one failing listener must not stop the others or the frame loop
          reportError(err);
        }
      }
    }
  }

  clear(): void {
    for (const list of this.map.values()) for (const x of list) x.removed = true;
    this.map.clear();
  }

  private remove(type: ViewerEventType, entry: Entry): void {
    entry.removed = true;
    const list = this.map.get(type);
    if (!list) return;
    const next = list.filter((x) => x !== entry);
    if (next.length) this.map.set(type, next);
    else this.map.delete(type);
  }
}

function reportError(err: unknown): void {
  if (typeof globalThis.reportError === 'function') globalThis.reportError(err);
  else
    setTimeout(() => {
      throw err;
    });
}
