# Example: no build step

[`index.html`](index.html) uses the viewer as a plain ES module: `viewer.css` as a stylesheet, and the single-file builds
(`@canopy/viewer/browser`, `@canopy/io/browser`) through an import map, in a `<script type="module">`. There is no bundler and no
package.json. In the repository, build the packages and serve the repository root with any static server:

```
npm run build
npx serve .            # or python3 -m http.server; then open /examples/no-build/?cpu=1
```

The page fetches its tree and parses it in a worker (`parseInWorker` from `@canopy/io`), so a large file does not block the page. The
worker is `dist/browser/io-parse-worker.js`, which has to be hosted next to `io.js`.

On a website, point the import map and the stylesheet at wherever the files are hosted, such as your own server or a CDN once the packages
are published. The per-file `dist/` works the same way without an import map, by importing `.../dist/index.js` directly. It costs about
40 module requests instead of one.

The browser check is `tests/browser/scripts/check-no-build.mjs`.
