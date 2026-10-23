# Example: the unrooted layout spike

The page of the equal-angle spike ([#42](https://github.com/MortenHofft/gbif-phylo/issues/42)): `unrootedLayout()` of one tree, drawn on
a plain canvas. Every branch is drawn, with no level of detail, no zoom or pan and no hit testing. It is not a view of the viewer; the
viewer has no `layout: 'unrooted'`. The pictures, the timings and the decision are in
[docs/design/unrooted.md](../../docs/design/unrooted.md).

```
npm run dev -w examples/unrooted    # http://127.0.0.1:5313
```

- **Tree** picks one of [`src/trees.json`](src/trees.json): HCV 2k (19 tips) and two GTDB trees with branch lengths, two Open Tree
  trees without; then every tree of the playground's catalogue ([`../shared/catalogue.json`](../shared/catalogue.json)); or, last,
  *A file from your computer…* (Newick or NEXUS, gzipped or not), as in the playground ([`../shared/picker.ts`](../shared/picker.ts),
  `loadTreeFile` in [`../shared/data.ts`](../shared/data.ts)).
- **The node limit**: the page draws at most 25,000 nodes (`NODE_LIMIT` in [`src/main.ts`](src/main.ts)). It draws every branch with no
  level of detail, and the cost is linear in the nodes: in [docs/design/unrooted.md](../../docs/design/unrooted.md) a redraw takes
  about 5 ms at 14,874 and 20,243 nodes (the two 10k-tip trees) and 52 to 56 ms at 199,999, so 25,000 is about 7 ms and keeps every
  10k-tip tree of the catalogue in. The catalogue's larger trees (the 22,800-tip polytomies, and from 91k tips up) stay in the list,
  disabled, with their node count (the catalogue's `nodes`); a file or a `?tree=` path above the limit gets a message instead of a
  drawing. This is not the 2,000 nodes the design note proposes for the viewer's own layout, which is set by readability.
- **Branch lengths** off draws every branch at length 1 (the Open Tree trees have no lengths, so they always do).
- **Labels** draws each tip's label along its direction. By default they are on up to 250 tips.

The URL keeps the settings: `?tree=<id from src/trees.json>&lengths=0&labels=1`. `?tree=` also takes a path under `data/`, which the
dev server serves for any tree (`tests/browser/bench/unrooted-shots.mjs` times the 10k and 100k trees that way); on the demo site only
the listed trees are there. `?size=` sets the canvas size in CSS px. `?limit=<nodes>` changes the node limit (`0`: none), for the
timings of the bench script. A file is not kept in the URL.

## A spike exception: not the public API

The other examples use the public API of the packages only. This one cannot: `unrootedLayout` is not exported by `@gbif-phylo/viewer`,
and stays unexported until the viewer has a real unrooted layout. [`src/main.ts`](src/main.ts) imports it from the viewer's source by
relative path (`../../../packages/viewer/src/unrooted.ts`), which works inside this repository only. The drawing (fit, branches, labels)
is the page's own code.

The colours are the viewer's `--phylo-*` properties from `@gbif-phylo/viewer/gbif.css`, on the GBIF design tokens.

Checked by `tests/browser/scripts/check-unrooted.mjs` (`npm run test:browser -w tests/browser -- --only unrooted`).
