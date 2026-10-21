# gbif-phylo

A phylogenetic tree viewer for the web, built for [gbif.org](https://www.gbif.org) and usable by anyone. It is framework-free at its core
and renders trees from a few tips to a million tips in the browser.

This is the `lib` branch: the library on its own. The `main` branch holds the research behind it. That research compared existing
viewers, ran a spike with a test harness, and recorded measurements and the recommendation.

## Packages

| Package | What it is |
|---|---|
| [`@gbif-phylo/viewer`](packages/viewer) | The viewer: Canvas 2D, level-of-detail rendering, rectangular and radial layouts, aligned columns, events and an imperative API. No framework. |
| [`@gbif-phylo/react`](packages/react) | `<TreeView>`, a React component over the viewer. |
| [`@gbif-phylo/tree-ops`](packages/tree-ops) | Tree operations a user applies: reroot, midpoint root, ladderise, rotate, collapse, prune, subtree. No rendering. |
| [`@gbif-phylo/io`](packages/io) | Newick and NEXUS parsers, a Newick writer and the `TreeModel` they produce. |

Examples are in [`examples/`](examples). Browser checks and benchmarks are in [`tests/browser`](tests/browser). Test trees are in
[`data/`](data); see [data/README.md](data/README.md) for what each tree is for and its licence. Design notes and the measurements behind
the viewer are in [`docs/design`](docs/design).

The packages are not published yet; their names are placeholders.

## Development

Node >= 22.7. From the repository root:

```
npm ci
npm run check          # typecheck, lint, format check, all unit tests
npm run build          # build every package into its dist/
npm run test:browser -w tests/browser   # build the test page, serve it and run the browser check (needs a Chromium)
npm run dev -w examples/react           # the React example on http://127.0.0.1:5307
```

## Licence

[Apache-2.0](LICENSE).
