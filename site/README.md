# The demo site

The hub page (this folder) and the pages it links to, built into one static site by
[`scripts/build-site.mjs`](../scripts/build-site.mjs) (`npm run build:site`, output `site-dist/`). Vercel builds it on every push (see
[`vercel.json`](../vercel.json)).

- [`src/examples.json`](src/examples.json) lists the pages: `playground` (the plain viewer with every setting) or `showcase` (a specific
  build such as the explorer). Each entry names the example's folder and its data catalogue. To add a page, add an entry.
  Its folder needs an `index.html` and a Vite build, and must load its data from `/data/...`.
- Each page is built with the absolute base `/<id>/`. Vercel's `trailingSlash: false` serves `/<id>/` as `/<id>`, where a relative
  `./assets` would resolve from the site root.
- `public/thumbs/<id>.jpg` are the cards' pictures, made by [`scripts/capture-thumbs.mjs`](scripts/capture-thumbs.mjs) from a built site
  (`npm run build:site && node site/scripts/capture-thumbs.mjs`, then build again).
- `public/favicon.svg` is ours (Apache-2.0, like the rest).

Check it the way Vercel serves it: `node tests/browser/scripts/check-site.mjs` builds the site, serves `site-dist/` with vercel.json's URL
rules (`tests/browser/scripts/static-site.mjs`) and runs the hub, playground and explorer checks. To look at it by hand:
`node tests/browser/scripts/static-site.mjs site-dist`.
