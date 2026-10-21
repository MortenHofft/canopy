# Example: @gbif-phylo/viewer without a framework

One page, [`src/main.ts`](src/main.ts), that shows each part of the library:

- the built-in controls in the corners, and one outside the viewer in the page header
- a control of its own
- a bar column and a custom heat-strip column
- its own popup for tips, using `Overlay`
- the node menu for clades
- the tooltip
- a dark theme made only of CSS custom properties ([`src/style.css`](src/style.css))
- an event log

```
npm run dev -w examples/vanilla     # http://127.0.0.1:5308 (?cpu=1 for a CPU canvas)
```

The tree and its metadata are the synthetic 1,000-tip Yule tree in `data/synthetic` (CC0), served at `/data` by the dev server. The browser
check is `tests/browser/scripts/check-vanilla-example.mjs`.
