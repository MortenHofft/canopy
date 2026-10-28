# Browser checks and benchmarks

Headless Chromium through `playwright-core`. Chromium comes from `$CHROMIUM_PATH`, or the newest `/opt/pw-browsers/chromium-*` if present, or the one
`npx playwright-core install chromium` fetches.

- `npm run test:browser` builds and serves each page in turn, runs its check, and stops the server. `-- --only test,vanilla,react,explorer,playground,table,unrooted,no-build,site` picks pages.
  - The test page, [`index.html`](index.html) and [`src/main.tsx`](src/main.tsx), runs `scripts/check-radial-ui.mjs`. The page mounts `<TreeView>` in two instances and exposes `window.__spike` / `__spike2` and `window.__customTree`.
  - `examples/vanilla` runs `scripts/check-vanilla-example.mjs`.
  - `examples/react` runs `scripts/check-node-menu.mjs`.
  - `examples/explorer` runs `scripts/check-explorer.mjs`.
  - `examples/playground` runs `scripts/check-playground.mjs`.
  - `examples/table` runs `scripts/check-table.mjs`.
  - `examples/unrooted` runs `scripts/check-unrooted.mjs`.
  - `site` runs `scripts/check-site.mjs`: it builds the demo site, serves it with vercel.json's URL rules (`scripts/static-site.mjs`) and runs
    the hub checks, then the playground, explorer, table and unrooted checks against the built pages.
  - `examples/no-build` runs `scripts/check-no-build.mjs`. It builds the packages and serves the repository as static files itself.
- Each check also takes `--url` (or `--port`) to run against a dev server.
- `bench/`: before/after benchmarks against the built test page (`npm run build && npx vite preview --port 5306`). Their results are in
  `docs/design/custom.md`, those of `highlight-bench.mjs` in `docs/design/highlight-cost.md`.
- The page of the unrooted layout spike (#42) is [`examples/unrooted`](../../examples/unrooted). `bench/unrooted-shots.mjs` takes its
  screenshots and draw timings against its dev server, `bench/unrooted-layout.mjs` times the layout pass in Node. Results in
  `docs/design/unrooted.md`.

## Reaching the viewer from a check

A browser check needs the `TreeViewer` of the page under test. The pattern for examples: the page exposes a function that returns the
viewer (or null before it exists) on `window`, named `__<example>` (`__explorer()` in the explorer; the test page has `__spike`; the vanilla example has an object `__example` with its `viewer`), in the
example's own entry code and not in the library. The check waits for it and then reads state and drives the public API:

```js
await page.waitForFunction(() => typeof window.__explorer === 'function' && window.__explorer() !== null);
const branch = await page.evaluate(() => window.__explorer().getTheme().branch);
```

A function rather than the viewer itself, because a component may re-create its viewer (a new `softwareCanvas`, a new tree source).
The library sets no such global and no `data-` attribute linking an element to its viewer. Examples set the global only
for their check, and the library's user documentation never mentions it.
