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
      nodeMenu={(e) => (e.isTip ? null : [{ id: 'zoom', label: 'Zoom to clade', onSelect: () => onPick(e.nodeId) }])}
      onTipClick={(e) => onPick(e.tipId)}
    />
  );
}
```

`controls`, `tooltip` and `nodeMenu` use the viewer's own controls and popups. `ref.current.renderer()` returns the underlying `TreeViewer`
for everything else (events, `Overlay`, ...). The props and their identity rules are in [the viewer's API docs](../viewer/docs/api.md#treeview).
[`examples/react`](../../examples/react) puts it together with tree operations from `@gbif-phylo/tree-ops`.
