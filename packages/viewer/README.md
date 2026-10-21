# @gbif-phylo/viewer

A phylogenetic tree viewer for the web with no framework dependency. It renders very large trees, up to a million tips, on Canvas 2D by
drawing a level-of-detail cut of the tree each frame. It has rectangular and radial layouts, aligned per-tip columns, keyboard navigation
and accessible tip links. Use it from plain JavaScript or any framework; [`@gbif-phylo/react`](../react) wraps it for React.

```ts
import '@gbif-phylo/viewer/viewer.css';
import { parseNewick } from '@gbif-phylo/io';
import { TreeViewer, defaultControls, Tooltip } from '@gbif-phylo/viewer';

const viewer = new TreeViewer({
  target: document.getElementById('tree')!,
  tree: parseNewick(newickText),
  controls: [...defaultControls({ search: true }), new Tooltip()],
});
viewer.on('click', (e) => console.log(e.isTip ? e.tipId : `clade of ${e.tipCount} tips`));
```

## What you can change

- **Controls.** Zoom, fit, layout toggle, search, legend and overview are built in. Place them in any corner, or outside the viewer with `target`, or leave them out. Your own controls subclass `BaseControl` and use the public API and events.
- **Events.** `click`, `hover`, `viewchange`, `frame`, `optionschange`, `cladeschange`, `highlightchange`, `resize`, `ready` and more. Built-in popups run as default actions, so `preventDefault()` replaces them.
- **Popups.** An `Overlay` pins your own element to a node and follows it as the view moves. `Tooltip` and `NodeMenu` (actions for a clade or tip) are built in.
- **Columns.** Bar, text and alignment columns are built in, and a `ColumnRenderer` draws your own. It prepares its data once and draws the visible rows once per frame.
- **Style.** One set of `--phylo-*` CSS custom properties themes both the canvas (colours, line widths, marker sizes, opacities, fonts) and the DOM (controls, popups). A dark mode is a few custom properties, and `gbif.css` gives the GBIF look.
- **Tree shaking.** The package is one ES module per source file and has no side effects except its CSS. `TreeViewer` alone bundles no control or popup, about 27 kB gzipped; `scripts/check-packages.mjs` checks this.

## Without a build step

The viewer is plain ES modules with no dependencies, so a page can use it directly. `<package>/browser` is a single-file build of each
package, two requests in all:

```html
<link rel="stylesheet" href="/vendor/gbif-phylo/viewer.css" />
<script type="importmap">
  { "imports": { "@gbif-phylo/viewer": "/vendor/gbif-phylo/viewer.js", "@gbif-phylo/io": "/vendor/gbif-phylo/io.js" } }
</script>
<script type="module">
  import { TreeViewer, defaultControls } from '@gbif-phylo/viewer';
  import { parseNewick } from '@gbif-phylo/io';
  const tree = parseNewick(await (await fetch('/trees/my.nwk')).text());
  new TreeViewer({ target: document.getElementById('tree'), tree, controls: defaultControls() });
</script>
```

Copy `css/viewer.css`, `dist/browser/viewer.js` and `io`'s `dist/browser/io.js` to your server, or point at a CDN once the packages are
published. The single-file build includes every control (33.4 kB gzip); bundler users import the package itself and get only what they
use. See [`examples/no-build`](../../examples/no-build).

Docs:

- [API reference](docs/api.md)
- [Internals](docs/internals.md): how the core works and how to change it safely.
- [`examples/vanilla`](../../examples/vanilla): every part above without a framework.
