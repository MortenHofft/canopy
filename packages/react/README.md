# @gbif-phylo/react

`<TreeView>`, a React component over [`@gbif-phylo/viewer`](../viewer). Props hold the state, callbacks report interaction, and a `ref`
gives the imperative handle. React 18 or later is a peer dependency.

```tsx
import '@gbif-phylo/viewer/viewer.css';
import { useMemo } from 'react';
import { TreeView } from '@gbif-phylo/react';
import { defaultControls } from '@gbif-phylo/viewer';

function Tree({ tree, onPick }) {
  const controls = useMemo(() => defaultControls({ search: true, legend: true }), []); // create controls once
  return (
    <TreeView
      tree={tree}
      controls={controls}
      highlighted={['Canis_lupus']}
      nodeMenu={(e) => (e.isTip ? null : [{ id: 'zoom', label: 'Zoom to clade', onSelect: () => onPick(e.node) }])}
      onTipClick={(e) => onPick(e.tipId)}
    />
  );
}
```

`controls`, `tooltip` and `nodeMenu` use the viewer's own controls and popups. The props and their identity rules are in
[the viewer's API docs](../viewer/docs/api.md#treeview).

## Hooks

Four hooks give React the `TreeViewer` behind a `<TreeView>` and what changes on it, built on the viewer's own events:

```tsx
import { useRef } from 'react';
import { TreeView, useTreeViewer, useViewport, useTreeEvent, useTreeTheme, type TreeViewHandle } from '@gbif-phylo/react';

function Tree({ tree }) {
  const ref = useRef<TreeViewHandle>(null);
  const viewer = useTreeViewer(ref); // the TreeViewer, as state: null until mounted, a new one when <TreeView> re-creates it
  const vp = useViewport(viewer); // the window in force, after every pan, zoom, fit or resize
  const theme = useTreeTheme(viewer); // the theme in force, after every theme change
  useTreeEvent(viewer, 'click', (e) => console.log(e.node)); // any viewer event; the handler may change between renders
  return (
    <div style={{ background: theme?.background }}>
      <TreeView ref={ref} tree={tree} />
      {vp && <p>{(vp.y1 - vp.y0).toFixed(0)} rows in view</p>}
    </div>
  );
}
```

| Hook                                          | Returns                                                                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useTreeViewer(ref)`                          | the `TreeViewer` of the `<TreeView>` the ref is on, or `null`. It is state, so an effect can depend on it. The ref is read after each render of the calling component, so call it in the component that renders the `<TreeView>` |
| `useViewport(viewer)`                         | the `Viewport` in force (`getViewport()`), updated on `viewchange`; the same object until the window changes; `null` without a viewer                                                                                                          |
| `useTreeTheme(viewer)`                        | the `TreeTheme` in force (`getTheme()`: fallback, CSS custom properties, overrides), updated on `themechange`; `null` without a viewer                                                                                                          |
| `useTreeEvent(viewer, type, handler, opts?)` | nothing: `viewer.on(type, handler, opts)` while the viewer lives, attached again to a re-created viewer and removed on unmount. The newest `handler` is called; `opts` is `{ asDefault?, once? }` as for `on()`                                  |

They take `null` (before the viewer exists) and are strict-mode safe: every subscription is made in an effect and undone in its
cleanup. `ref.current.renderer()` still returns the viewer for one-off calls from event handlers (`toBlob`, `zoomToNode`, ...).
[`examples/react`](../../examples/react) puts it together with tree operations from `@gbif-phylo/tree-ops`.
