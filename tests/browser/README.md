# Browser checks and benchmarks

Headless Chromium through `playwright-core`. Chromium comes from `$CHROMIUM_PATH`, or `/opt/pw-browsers/chromium-1194` if present, or the one
`npx playwright-core install chromium` fetches.

- `npm run test:browser` builds and serves each page in turn, runs its check, and stops the server. `-- --only test,vanilla,react,reactree` picks pages.
  - The test page, [`index.html`](index.html) and [`src/main.tsx`](src/main.tsx), runs `scripts/check-radial-ui.mjs`. The page mounts `<TreeView>` in two instances and exposes `window.__spike` / `__spike2` and `window.__customTree`.
  - `examples/vanilla` runs `scripts/check-vanilla-example.mjs`.
  - `examples/react` runs `scripts/check-node-menu.mjs`.
  - `examples/reactree` runs `scripts/check-reactree.mjs`.
  - `examples/no-build` runs `scripts/check-no-build.mjs`. It builds the packages and serves the repository as static files itself.
- Each check also takes `--url` (or `--port`) to run against a dev server.
- `bench/`: before/after benchmarks against the built test page (`npm run build && npx vite preview --port 5306`). Their results are in
  `docs/design/custom.md`.
