# Spikes: shared harness for comparing tree viewers

One test API ([CONTRACT.md](CONTRACT.md)), one React shell, one Playwright runner, so every candidate (tbrowse, react-bio-viz, phylotree.js, Phylocanvas.gl, Archaeopteryx.js, a custom baseline) is measured the same way. Plan and scenarios: [../docs/spike-plan.md](../docs/spike-plan.md); evidence levels: [../docs/evaluation-framework.md](../docs/evaluation-framework.md).

```
shared/    types.ts newick.ts tree.ts data.ts metrics.ts app-shell.tsx vite.base.mjs trees.json   (+ test/)
runner/    run.mjs report.mjs check-catalogue.mjs lib/
stub/      naive SVG reference candidate and template (see stub/README.md)
results/   <candidate>/<run-id>.json, screens/*.png, SUMMARY.md
<name>/    one folder per candidate, own package.json and node_modules
```

## Set up

Needs Node 22.18 or newer (the runner imports the shared `.ts` files with native type stripping) and the Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (override with `CHROMIUM_PATH`). Do not run `playwright install`.

```
cd spikes && npm install --ignore-scripts          # runner deps (playwright-core, pngjs) and TypeScript for shared/
cd stub   && npm install --ignore-scripts          # each candidate installs its own dependencies
```

Data: trees come from `../data/` (served at `/data/` by `shared/vite.base.mjs`, in dev and in `vite preview`). `syn-yule-100000` is git-ignored; see Clarifications 12 in the contract. Check everything is in place:

```
node runner/check-catalogue.mjs      # every tree in shared/trees.json exists, parses, matches tips and lengths
npm run test:parser                  # parser tests incl. 1M-deep caterpillar, NEXUS TRANSLATE, quoted labels
npm run typecheck                    # shared/ only; candidates have their own `npm run typecheck`
```

## Run

```
node spikes/runner/run.mjs --candidate stub                                  # S1-S15 on the smoke trees
node spikes/runner/run.mjs --candidate stub --scenarios S2,S3,S4 --no-build
node spikes/runner/run.mjs --candidate <name> --trees ladder                 # scale ladder (long: 10 trees up to 190k tips)
node spikes/runner/run.mjs --candidate <name> --trees syn-yule-1000,otl-10k --port 4173 --out /tmp/out
node spikes/runner/report.mjs                                                # matrix + scale table -> results/SUMMARY.md
```

Options: `--scenarios S1,S2|all`; `--trees smoke|ladder|worst|real|cols|align|dated|edge|<tree ids, comma separated>` (selects trees for S1, the scale table, and S10; other scenarios use fixed trees, contract Clarifications 13); `--port N` (default: a free port; preview runs with `--strictPort`); `--no-build` (reuse `dist/`); `--out dir` (default `results/<candidate>/`); `--functional-tree <id>`.

What it does: `npm run build` (unless `--no-build`), `npm run preview -- --port N --strictPort`, headless Chromium with `--enable-precise-memory-info --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --no-sandbox` plus `--js-flags=--expose-gc --disable-gpu-rasterization`, one fresh page per scenario (a hung or crashing candidate is killed, recorded as `timeout`/`fail`, and the run continues), real mouse, wheel and keyboard input at coordinates from `locate()`. Results: `results/<candidate>/<run-id>.json` (status `pass|partial|fail|unsupported|timeout`, reason, per-check detail, measures, evidence `M`, bundle sizes, capabilities, Chromium version, machine, no-GPU caveat) and at most 12 PNGs under 150 KB in `results/<candidate>/screens/`. Exit code 1 if any scenario failed.

Thresholds (docs/spike-plan.md): load > 10 s, p5 FPS < 20, click latency > 300 ms mark a tree or scenario `timeout` ("unusable"); S15 wants end-to-end under about 100 ms for a 1,000-tip clade (the runner passes up to 120 ms, `partial` up to 300 ms).

**Limits to remember.** There is no GPU: canvas and WebGL FPS are pessimistic, so use the sandbox for functional checks (S2 to S9, S12 to S15) and relative comparison; take final scale numbers in a real browser (mark them M with the machine). Pan/zoom FPS is measured with Playwright-driven wheel and drag, whose round trips limit how fast input arrives.

## Viewing a candidate manually

```
cd spikes/<name> && npm run dev        # http://127.0.0.1:5173 (vite dev server, /data served too)
```

The page has a toolbar that drives every API method (mount a catalogue tree, layout, lengths, highlight, focus, colour clade, columns, tip links, dark, tokens, linked view, second instance, stats, capabilities) and a side panel with the React state the runner reads (`last-event`, `clades`, `highlighted`, `map-panel`, `tip-meta`, `event-log`). Click a node with "linked view" on to see the linked-view scenario by hand. Everything on the page is also available from the console as `window.__spike`.

## Candidate folder names

Exactly: `stub`, `tbrowse`, `react-bio-viz`, `phylotree-js`, `phylocanvas-gl`, `archaeopteryx-js`, `custom`. `scripts/build-site.mjs` builds every folder under `spikes/` that has a `package.json` with a `build` script, so keep `npm run build` working in each, and do not put other `package.json` files in `spikes/` subfolders that are not candidates (`runner/` has one without a build script, which is fine). Each candidate also needs a `spike.json` (see CONTRACT.md, Deployment metadata).

## Embed mode

`<candidate url>/?embed=1` hides the GBIF header, footer, toolbar and side panel, lets the tree container fill the viewport and shows a small floating chip with the last event; `window.__spike` works as usual (the compare page `spikes/site/compare.html` loads candidates in iframes this way). The page also fetches Google Fonts and the GBIF logo; the runner blocks all non-local requests so timings are not affected by the network.

## Styling

The shell imports `shared/gbif-tokens.css` and uses only `var(--token)` values; the stub takes node, branch and label colours from `gbifTheme()` (`shared/gbif-theme.ts`). Candidates should do the same and record in `spike.json` what could and could not be styled (CONTRACT.md, Styling).

## Adding a candidate

Follow the 10 steps in [stub/README.md](stub/README.md). A candidate is an independent package (not an npm workspace) so dependency trees do not clash; it imports `../shared/*` by relative path and `vite.base.mjs` aliases `react`/`react-dom` to its own `node_modules`. Then: run the runner, commit `results/<name>/*.json` and `screens/`, write `docs/results/<name>.md` citing the run id.

## Rules (from the contract)

React 18, exact versions, `npm ci --ignore-scripts`; no patching or forking the library in the first pass (monkey-patching is `partial` and must be described); never fake an event (`source: 'adapter-derived'` when computed); no recursion over trees (use `shared/tree.ts`); check the licence before adding a dependency.
