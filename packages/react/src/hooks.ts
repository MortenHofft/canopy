// Hooks over the TreeViewer behind a <TreeView>: the instance as React state, the viewport and the theme as values that follow the
// viewer's events, and any event of the viewer as a subscription. They use the viewer's public API only (`on()` returning an
// unsubscribe, `getViewport()`, `getTheme()`), so the core needs nothing React-specific. Strict-mode safe: every subscription is made in
// an effect and undone in its cleanup, and each follows the viewer when <TreeView> re-creates it.

import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { Listener, ListenOptions, TreeTheme, TreeViewer, ViewerEventType, Viewport } from '@gbif-phylo/viewer';
import type { TreeViewHandle } from './TreeView.tsx';

/** The `TreeViewer` behind the `<TreeView>` that `ref` is passed to, as state: `null` until it is mounted, and a new value when the
 *  viewer is re-created (`options.softwareCanvas`, or a switch between `tree` and `source`) or the view unmounts. Call it in the
 *  component that renders the `<TreeView>`: the ref is read after each of its renders. */
export function useTreeViewer(ref: RefObject<TreeViewHandle | null>): TreeViewer | null {
  const [viewer, setViewer] = useState<TreeViewer | null>(null);
  // after every render: the <TreeView>'s own layout effects, which create its viewer, have run by then. Setting the same viewer again
  // commits nothing (React may render the component once more before it bails out), so this does not loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- no list on purpose: ref.current is not state, so it is read after every render
  useLayoutEffect(() => {
    setViewer(ref.current?.renderer() ?? null);
  });
  // a viewer destroyed while this component did not render (re-created by the <TreeView>): drop it; the render that follows reads the new one
  useLayoutEffect(() => viewer?.on('destroy', () => setViewer(null)), [viewer]);
  return viewer;
}

/** The viewport in force (`viewer.getViewport()`), updated on every `viewchange` (pan, zoom, fit, resize, animation step); `null`
 *  without a viewer. The same object until the window changes. */
export function useViewport(viewer: TreeViewer | null): Viewport | null {
  return useViewerValue(viewer, 'viewchange', readViewport, viewportSame);
}

/** The theme in force (`viewer.getTheme()`: the fallback, the CSS custom properties and the overrides), updated on every
 *  `themechange`; `null` without a viewer. For React UI around the tree that should match it. */
export function useTreeTheme(viewer: TreeViewer | null): Readonly<TreeTheme> | null {
  return useViewerValue(viewer, 'themechange', readTheme, Object.is);
}

/** Listen to an event of the viewer (`viewer.on(type, handler, options)`) while the viewer lives; re-attached to a re-created viewer and
 *  removed on unmount. `handler` may be a new function on every render (the newest one is called); a change of `type` or of the options
 *  attaches it again. */
export function useTreeEvent<K extends ViewerEventType>(viewer: TreeViewer | null, type: K, handler: Listener<K>, options?: ListenOptions): void {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler; // declared before the subscribing effect, so an event right after it sees this render's handler
  });
  const asDefault = options?.asDefault === true;
  const once = options?.once === true;
  // a layout effect: attached in the commit that brought the viewer, before its first frame (`ready`)
  useLayoutEffect(() => {
    if (!viewer) return;
    const fn = ((e) => latest.current(e)) as Listener<K>;
    return viewer.on(type, fn, { asDefault, once });
  }, [viewer, type, asDefault, once]);
}

const readViewport = (v: TreeViewer): Viewport => v.getViewport();
const readTheme = (v: TreeViewer): Readonly<TreeTheme> => v.getTheme();
const viewportSame = (a: Viewport, b: Viewport): boolean => a.x0 === b.x0 && a.x1 === b.x1 && a.y0 === b.y0 && a.y1 === b.y1;

/** A value read from the viewer and read again on `type` (useSyncExternalStore). The snapshot is cached and returned as long as `same`
 *  says the value is unchanged, as useSyncExternalStore needs (`getViewport()` returns a new object on every call). */
function useViewerValue<T, K extends ViewerEventType>(
  viewer: TreeViewer | null,
  type: K,
  read: (v: TreeViewer) => T,
  same: (a: T, b: T) => boolean,
): T | null {
  const cache = useRef<{ viewer: TreeViewer | null; value: T | null } | null>(null);
  const subscribe = useCallback((onChange: () => void) => (viewer ? viewer.on(type, onChange) : noop), [viewer, type]);
  const getSnapshot = (): T | null => {
    const value = viewer && !viewer.isDestroyed() ? read(viewer) : null;
    const c = cache.current;
    if (c && c.viewer === viewer && (c.value === null ? value === null : value !== null && same(c.value, value))) return c.value;
    cache.current = { viewer, value };
    return value;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function noop(): void {}
