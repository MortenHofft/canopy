# gbif-phylo

A phylogenetic tree viewer for the web, built for [gbif.org](https://www.gbif.org) and usable by anyone. It is framework-free at its core
and renders trees from a few tips to a million tips in the browser.

This is the library. The `research` branch holds the research behind it. That research compared existing
viewers, ran a spike with a test harness, and recorded measurements and the recommendation.

## Packages

| Package | What it is |
|---|---|
| [`@gbif-phylo/viewer`](packages/viewer) | The viewer: Canvas 2D, level-of-detail rendering, rectangular and radial layouts, aligned columns, events and an imperative API. No framework. |
| [`@gbif-phylo/react`](packages/react) | `<TreeView>`, a React component over the viewer. |
| [`@gbif-phylo/tree-ops`](packages/tree-ops) | Tree operations a user applies: reroot, midpoint root, ladderise, rotate, swap, reorder, collapse, prune, subtree. No rendering. |
| [`@gbif-phylo/io`](packages/io) | Newick and NEXUS parsers, a Newick writer and the `TreeModel` they produce. |

Examples:

- [`examples/vanilla`](examples/vanilla): no framework, with controls, events, a custom popup and a custom column.
- [`examples/react`](examples/react): `<TreeView>` with tree operations.
- [`examples/playground`](examples/playground): every option, theme token and built-in control in a side panel, on any tree.
- [`examples/explorer`](examples/explorer): the tree explorer, the styled showcase of the library and the counterpart of the playground (its look started from Reactree), with a table of which control uses which API.
- [`examples/no-build`](examples/no-build): plain HTML with an import map; no bundler and no npm on the page's side. Browser checks and benchmarks are in [`tests/browser`](tests/browser). Test trees are in
[`data/`](data); see [data/README.md](data/README.md) for what each tree is for and its licence. Design notes and the measurements behind
the viewer are in [`docs/design`](docs/design).

The packages are not published yet; their names are placeholders.

## Quick start

```ts
import '@gbif-phylo/viewer/viewer.css';
import { parseNewick } from '@gbif-phylo/io';
import { TreeViewer, defaultControls } from '@gbif-phylo/viewer';

const viewer = new TreeViewer({ target: document.getElementById('tree')!, tree: parseNewick(text), controls: defaultControls() });
viewer.on('click', (e) => console.log(e.isTip ? e.tipId : `${e.tipCount} tips`));
```

The [viewer README](packages/viewer/README.md) lists what can be customised: controls, events, popups, columns and styling. The [API
reference](packages/viewer/docs/api.md) covers each part, and [docs/design/library.md](docs/design/library.md) explains how the library is put
together and why.

## Development

Node >= 22.7. From the repository root:

```
npm ci
npm run check          # typecheck, lint, format check, all unit tests
npm run build          # build every package into its dist/
npm run check:packages                 # after build: publint, tarball contents, tree shaking and bundle sizes
npm run test:browser -w tests/browser   # build and serve the test page and the examples, run their browser checks (needs a Chromium)
npm run dev -w examples/vanilla         # the framework-free example on http://127.0.0.1:5308
npm run dev -w examples/react           # the React example on http://127.0.0.1:5307
npm run dev -w examples/explorer        # the tree explorer on http://127.0.0.1:5309
npm run dev -w examples/playground      # the playground on http://127.0.0.1:5310
npm run build:site                      # the demo site (hub, playground, showcases, data) into site-dist/, as Vercel builds it
```

## Licence

[Apache-2.0](LICENSE).
