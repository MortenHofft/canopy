# Example: the unrooted layout spike

The page of the equal-angle spike ([#42](https://github.com/MortenHofft/gbif-phylo/issues/42)): `unrootedLayout()` of one tree, drawn on
a plain canvas. Every branch is drawn, with no level of detail, no zoom or pan and no hit testing. It is not a view of the viewer; the
viewer has no `layout: 'unrooted'`. The pictures, the timings and the decision are in
[docs/design/unrooted.md](../../docs/design/unrooted.md).

```
npm run dev -w examples/unrooted    # http://127.0.0.1:5313
```

- **Tree** picks one of [`src/trees.json`](src/trees.json): HCV 2k (19 tips) and two GTDB trees with branch lengths, two Open Tree
  trees without.
- **Branch lengths** off draws every branch at length 1 (the Open Tree trees have no lengths, so they always do).
- **Labels** draws each tip's label along its direction. By default they are on up to 250 tips.

The URL keeps the settings: `?tree=<id from src/trees.json>&lengths=0&labels=1`. `?tree=` also takes a path under `data/`, which the
dev server serves for any tree (`tests/browser/bench/unrooted-shots.mjs` times the 10k and 100k trees that way); on the demo site only
the listed trees are there. `?size=` sets the canvas size in CSS px.

## A spike exception: not the public API

The other examples use the public API of the packages only. This one cannot: `unrootedLayout` is not exported by `@gbif-phylo/viewer`,
and stays unexported until the viewer has a real unrooted layout. [`src/main.ts`](src/main.ts) imports it from the viewer's source by
relative path (`../../../packages/viewer/src/unrooted.ts`), which works inside this repository only. The drawing (fit, branches, labels)
is the page's own code.

The colours are the viewer's `--phylo-*` properties from `@gbif-phylo/viewer/gbif.css`, on the GBIF design tokens.

Checked by `tests/browser/scripts/check-unrooted.mjs` (`npm run test:browser -w tests/browser -- --only unrooted`).
