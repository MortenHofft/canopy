# Spike contract

Every candidate is a small React 18 + TypeScript + Vite app in `spikes/<candidate>/` that exposes the same test API on `window.__spike`. One shared runner (Playwright, `spikes/runner/`) drives every candidate the same way, so results are comparable. Background: [../docs/spike-plan.md](../docs/spike-plan.md) (scenarios S1 to S15, measures, thresholds) and [../docs/evaluation-framework.md](../docs/evaluation-framework.md) (evidence levels).

## Layout

```
spikes/
  CONTRACT.md            this file
  shared/                TypeScript, no runtime deps except react types; imported by every candidate by relative path
    types.ts             the interfaces below
    newick.ts            iterative, quote-aware Newick parser (no recursion) -> TreeModel
    tree.ts              TreeModel: typed arrays, preorder ids, subtree ranges, descendant tips, depth, cumulative length
    data.ts              fetch + load trees and metadata from /data/... (served by the Vite plugin in vite.base.mjs)
    trees.json           catalogue of test trees (id, path under data/, expected tips, group, hasLengths)
    metrics.ts           timing marks, rAF frame sampler, heap reading
    app-shell.tsx        the React shell every candidate uses (side panel, event log, controls) and installs window.__spike
    vite.base.mjs        shared Vite config helper: serves ../../data at /data, production build settings
  runner/                Playwright runner and report writer
  stub/                  naive SVG reference candidate; template for adapters and self-test of the runner
  <candidate>/           one folder per candidate; own package.json, lockfile, node_modules (git-ignored)
  results/               JSON from runs and a few small screenshots (committed); raw big output git-ignored
```

## Rules for candidate apps

- React **18** and TypeScript. Pin exact versions of the candidate and its peers in `package.json`; commit the lockfile; install with `npm ci --ignore-scripts` (or `npm install --ignore-scripts` the first time). Record the candidate's exact version in `window.__spike.candidate.version`.
- Scripts: `npm run build` (production build, must succeed) and `npm run preview -- --port <p> --strictPort`. The runner uses the production build for all performance numbers.
- The app must use the candidate **the way a gbif.org developer would**: inside a React component, with the callbacks wired into React state. The shell (`app-shell.tsx`) renders a side panel showing the last event (`data-testid="last-event"`), the current coloured clades (`data-testid="clades"`), the highlighted tips, and a stub "map" panel that prints the tip count of the selection (`data-testid="map-panel"`). Scenario passes require the **React state to change**, not just an internal event.
- Do not patch or fork the candidate in the first pass. If something is impossible without patching, record `unsupported` with the reason. If it is possible only by monkey-patching, wrapping internals or reaching into the DOM, implement it that way, mark the capability `partial` and describe the workaround in the notes (it is a result in itself).
- Never leave work in the candidate's code that gives a false pass (for example faking events). Anything computed by the adapter rather than reported by the library must be flagged as such in the event (`source: 'adapter-derived'`).
- Do not use recursion over trees in your own code; use `shared/tree.ts`.

## Ids

- **Tip id**: the tip label string, exactly as parsed (unique in the test trees).
- **Node id**: `n<preorder index>` from `shared/tree.ts` (root is `n0`). Adapters map between these ids and the library's own ids and must make the mapping robust to the library reordering or renaming (match by descendant tip sets if needed).
- **Descendant tips of a node** are always available from `TreeModel` and are the ground truth the runner checks against.

## API on `window.__spike`

```ts
type Layout = 'rectangular' | 'radial';
type Capability = 'yes' | 'partial' | 'no';

interface MountOptions {
  treeId: string;                 // key in trees.json
  newick: string;                 // already fetched text
  layout: Layout;
  branchLengths: boolean;         // phylogram (true) or cladogram (false)
  size: { width: number; height: number };  // CSS px of the container the tree must fill
}
interface MountResult {
  parseMs: number;                // time to parse/convert input inside the candidate (0 if included in firstRenderMs; say which in notes)
  firstRenderMs: number;          // from mount() call to first painted frame (use two rAFs after the library reports done)
  tips: number;                   // tips the library reports/draws (checked against expected)
  notes?: string;
}
interface Point { x: number; y: number }          // client (viewport) CSS px
interface Rect { x: number; y: number; width: number; height: number }

interface SpikeEvent {
  type: 'tipClick' | 'nodeClick' | 'branchClick' | 'tipHover' | 'nodeHover';
  nodeId: string;                 // shared id (tip: use tip's node id)
  isTip: boolean;
  tipIds: string[];               // descendant tips reported for the target (for a tip: [tipId])
  source: 'library' | 'adapter-derived';   // was tipIds in the library payload, or computed by us from the tree?
  libraryPayload?: unknown;       // raw payload, trimmed (for debugging)
  t: number;                      // performance.now()
}

interface SpikeApi {
  candidate: { name: string; version: string; license: string; notes?: string };
  ready: Promise<void>;

  mount(o: MountOptions): Promise<MountResult>;
  unmount(): Promise<void>;                       // must remove everything and release listeners/workers/GL contexts

  // state driven from React (all must go through React state/props where the candidate allows)
  setColouredClades(c: { nodeId: string; colour: string }[]): Promise<void>;   // [] clears
  highlightTips(tipIds: string[]): Promise<void>;                              // [] clears
  focusTip(tipId: string): Promise<void>;                                      // centre and make visible with some sibling context
  setLayout(l: Layout): Promise<void>;
  setBranchLengths(on: boolean): Promise<void>;
  setColumns(cols: ColumnSpec[]): Promise<void>;                               // [] clears
  setTheme(t: { dark: boolean; tokens?: Record<string, string> }): Promise<void>;
  setTipLinks(href: ((tipId: string) => string) | null): Promise<void>;        // make tip labels links

  // test aids (read-only introspection; must not change state)
  locate(t: { kind: 'tip' | 'node'; id: string }): Promise<Point | null>;     // where a real mouse click would hit it; null if not drawn/visible
  bounds(t: { kind: 'tip' | 'node'; id: string }): Promise<Rect | null>;      // drawn extent (for a node: its clade) in client px
  locateCell(colId: string, tipId: string): Promise<Rect | null>;              // drawn column cell for a tip
  getEvents(): Promise<SpikeEvent[]>;
  clearEvents(): Promise<void>;
  getCapabilities(): Promise<Record<string, { level: Capability; how: string }>>;   // self-report, checked by the runner where possible
  getStats(): Promise<{ domNodes: number; svgElements: number; canvases: number; custom?: Record<string, number> }>;
}

interface ColumnSpec {
  id: string;
  kind: 'bar' | 'text' | 'alignment';
  header: string;
  values: Record<string, number | string>;     // by tip id; alignment: aligned sequence string per tip
  width: number;                                // CSS px
}
```

Capability keys every adapter must report (`getCapabilities`): `tipClick`, `internalNodeClick`, `branchClick`, `hover`, `descendantTipsInPayload`, `cladeColouring`, `highlightTip`, `focusTip`, `tipAsLink`, `customColumns`, `alignmentColumn`, `radialLayout`, `branchLengthToggle`, `scaleBar`, `darkTheme`, `cssTokens`, `multipleInstances`, `cleanUnmount`, `controlledState`, `zoomToFit`, `overviewOrMinimap`. Use `no` with a reason in `how` for anything not possible, never leave one out.

## What the runner does (scenarios S1 to S15)

Defined in [../docs/spike-plan.md](../docs/spike-plan.md). The runner is candidate-agnostic:

- Real input only: clicks, hovers, wheel and drag use Playwright mouse at the coordinates returned by `locate`. Pan and zoom are driven by real wheel and drag on the container.
- Colour checks: screenshot the `bounds` of a clade before and after `setColouredClades` and compare the fraction of pixels close to the requested colour (inside versus outside the clade).
- Alignment checks: `locateCell(col, tip).y` must match `locate(tip).y` within a tolerance, for several tips, before and after zoom/pan.
- Link check: an element `a[href][data-tip-id="<tipId>"]` must exist and be keyboard-focusable (`tabindex` not -1); overlays are acceptable if they satisfy the same check.
- React check: after a click, `[data-testid=last-event]` must show the event, and `[data-testid=map-panel]` must show the tip count of the selected clade.
- Performance: parse and first render from `mount`; frame sampler (`requestAnimationFrame` deltas) during a 10 s scripted pan and zoom; click-to-callback latency; JS heap with `--enable-precise-memory-info`; bundle size from `dist/`.
- Unusable thresholds: load > 10 s, p5 FPS < 20, click latency > 300 ms (timeouts mark the run `timeout`, not `fail`).
- Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` via `playwright-core` `executablePath`. For WebGL use `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. There is no GPU, so absolute canvas and WebGL FPS are pessimistic; record this in every result.

## Results

- `spikes/results/<candidate>/<run-id>.json`: machine-readable (candidate, version, Chromium version, date, per scenario and per tree: status `pass|partial|fail|unsupported|timeout`, measures, notes, evidence level `M`).
- `docs/results/<candidate>.md`: written per the template in the evaluation framework, citing the run ids; unsupported and partial entries must say how the workaround works or why it is impossible.

## Clarifications

Added while building the harness (`shared/`, `runner/`, `stub/`). They fill gaps in the text above; where one changes a number or a name it says so. Everything here is implemented by the harness, so a candidate that follows `stub/README.md` gets it for free.

1. **How an adapter plugs in.** The contract describes `window.__spike` but not who installs it. The shell does (`mountShell(adapter)` in `shared/app-shell.tsx`). A candidate supplies a `CandidateAdapter`: `{ candidate, capabilities, View, ready? }` (types in `shared/types.ts`). `View` is a React component that receives the whole state as props (`layout`, `branchLengths`, `colouredClades`, `highlightedTips`, `focusRequest`, `columns`, `theme`, `tipLinks`, `size`, the shared `tree`) and reports through callbacks (`emit`, `onReady`, `handleRef`). The shell turns every `window.__spike` method into a React state change (`flushSync`, then two animation frames), so "through React state" holds by construction. Library events that reach React state only through the shell are what the runner checks.
2. **`window.__spike2`.** S13 needs two instances but the contract API is singular. `window.__spike` drives instance 0 (main area); `window.__spike2` is the same `SpikeApi` bound to instance 1 (a 340x240 box in the side panel). Its panel test ids carry the suffix `-1`.
3. **Clock for `firstRenderMs`.** It starts when the shell hands the input to the adapter, after the shell has built the shared `TreeModel` (reported separately as the additive field `MountResult.sharedParseMs`), and ends two animation frames after the `View` calls `onReady`. `parseMs` is what the candidate itself spent converting input; adapters that only use the shared `TreeModel` report 0 and say so in `notes`.
4. **Input text.** `mount()` always receives clean Newick text. NEXUS entries are converted by `shared/data.ts` (TRANSLATE applied, BEAST comments dropped). Tip ids keep underscores exactly as in the file.
5. **Theme tokens.** `setTheme({ dark, tokens })`: the runner only passes the keys `background`, `foreground`, `branch`, `highlight` (CSS colours) and `fontFamily`. Adapters map them onto whatever the library exposes. The runner checks that the background token dominates a screenshot of the container and that branch pixels take the branch token colour.
6. **Making a tip clickable.** Rows are sub-pixel when a 1k+ tree is fitted to the screen, so a real user zooms first. For tip clicks (S2, S13, S14) the runner calls `focusTip` and then `locate`, as the occurrence page would; if `focusTip` is `no` it clicks at the fit view. Internal-node clicks are first tried at the fit view and only then after zooming to a tip below the node. `locate` for a tip must return the tip marker, for a node the node marker (the place a click opens a nodeClick); `branchClick` is only probed informally (midpoint of the horizontal branch piece).
7. **Statuses.** `unsupported` only when the adapter reports `no` for the capability the scenario needs (the reason quotes the adapter's `how`). `partial`: works but with a workaround or some checks failing (for S3, tip sets computed by the adapter, `source: 'adapter-derived'`, are `partial`, not `pass`). `timeout`: a threshold was exceeded (load > 10 s, p5 FPS < 20, click latency > 300 ms, or the page hung and was killed) and is recorded with the measures. Missing capability keys count as `no` with a `MISSING` note.
8. **Latency definitions.** Click latency = `SpikeEvent.t` minus the `event.timeStamp` of the pointerdown (browser input time, so a busy main thread counts). The linked-view number (S15) is pointerdown to two animation frames after the React commit that carries the coloured clade and the map-panel count.
9. **Linked view.** The shell has a switch (`window.__spikeShell.setLinkedView(true)`, also a checkbox in the toolbar) that, on a node or branch click, sets the coloured clade to `#e00000` through the same React state and updates the map panel. It is off by default so S4 is not polluted. S15 turns it on.
10. **Fit view.** There is no API to refit. When a scenario needs a fresh fit view (S12 sub-checks) the runner mounts again.
11. **Chromium flags.** Besides the flags in the brief the runner adds `--js-flags=--expose-gc` (the page calls `gc()` before heap readings) and `--disable-gpu-rasterization` (2D and SVG raster on the CPU; with GPU rasterisation through SwiftShader a 1,000-tip SVG tree ran at 2 fps, CPU raster at 60 fps; WebGL still uses SwiftShader). Both are recorded in every result.
12. **Catalogue.** `shared/trees.json` replaces fish "dated" with the committed dated trees in `data/rich/` (Carangaria fish, corvoid birds, first BirdTree sample) because `real-ladder/fetch.sh fish` output is not committed. `syn-yule-100000` is git-ignored: generate it with `python3 -I data/synthetic/generate.py --out <dir> --sizes 100000 --shapes yule` and copy `newick/yule_100000.nwk` to `data/synthetic/newick/` (`node runner/check-catalogue.mjs` reports missing files).
13. **Fixed trees per scenario.** S1 and S10 use `--trees` (default `smoke`); S2, S3, S4, S6, S9, S12, S13, S14: `syn-yule-1000`; S5: `syn-yule-10000` (focus must scroll); S7: `syn-yule-1000` (bar column from the TSV); S8: `rich-ens-protein-197`; S11: `rich-ens-protein-197` (non-ultrametric), `rich-corvoid-680` (dated), `edge-polytomy-missing`; S15: `syn-yule-10000` (about 1,000-tip clade). Override with `--functional-tree <id>` for the `syn-yule-1000` ones.

## Styling: every candidate must look like a GBIF app (added 2026-10-14)

Styling is itself a test (criterion 16, scenario S9). Every candidate app must be styled **as much as the library allows** with the GBIF design tokens, so the result shows how far styling actually goes.

- `shared/gbif-tokens.css` is the single source of truth (verbatim from the `gbif-design-tokens` skill; fonts Rubik, Bitter, IBM Plex Mono from Google Fonts). Import it from the shell. Never hardcode a hex colour, font or spacing that exists as a token.
- `shared/gbif-theme.ts` (`gbifTheme()`) returns resolved token values for libraries that cannot use CSS (canvas, WebGL, config objects). Use it to colour nodes, branches, labels, backgrounds and selections.
- The app shell looks like gbif.org: GBIF logo (`https://www.gbif.org/img/public/logo-web-gbif-nav-white-bg.svg` on light, the white variant on `--bg-dark`), `--bg-surface` page, the tree and panels in `.card`s, controls as `.btn` and `.tabs-pill`/`.btn-group`, Rubik body text, tip labels in `--font-body` (scientific names italic), selected and highlighted states in `--color-primary`, clade colours from the categorical palette (`--purple-100`, `--periwinkle-100`, `--fuchsia-100`, `--peach-100`, `--lightblue-100`), the dark footer band with a standing caveat ("A prototype. Under development. Frame rates here are measured without a GPU.") and the GBIF citation-guidelines link.
- For each candidate, write down in `spike.json` under `styling` which token-driven styles were applied and which **could not** be (for example: font family of labels, node shapes, branch widths, hover colours, selection halo, tooltip chrome, dark mode), and how (CSS, props, callbacks, DOM patching, or impossible). That list is the evidence for the styling dimension.
- Do not fake the look with screenshots, overlays or CSS that hides the library's own UI unless that is an official option of the library; hiding via supported options is fine and should be recorded as "customisation: hide features".

## Deployment metadata (added 2026-10-14)

Each candidate folder must contain `spike.json`, read by `scripts/build-site.mjs` for the hub page and the compare page:

```json
{
  "title": "react-bio-viz",
  "library": "react-bio-viz",
  "version": "0.3.0",
  "license": "MIT",
  "description": "one sentence on what the library is",
  "repo": "https://github.com/holmrenser/react-bio-viz",
  "demo": "https://… (the project's own demo, if any)",
  "docs": "docs/research/react-bio-viz.md",
  "rendering": "SVG | Canvas | WebGL | mixed",
  "styling": { "applied": ["..."], "not_possible": ["..."], "notes": "..." }
}
```

The production build must work when hosted under a sub-path (`/<candidate>/`); `vite.base.mjs` already uses a relative base. Data is fetched from `/data/...`; on Vercel `scripts/build-site.mjs` copies the committed test trees there. Only `npm run build` is needed for deployment (`vercel.json` runs `node scripts/build-site.mjs`).
14. **FPS definitions.** `medianFps` = 1000 / median rAF interval. `p5Fps` is time-weighted (95% of the sampled time was spent in frames at least this fast), because a page that freezes produces few frames and a per-frame percentile would hide the freeze; the per-frame value is kept as `p5FpsByFrame`, and `maxFrameGapMs` is reported too. Embed mode, candidate folder names and `spike.json` are documented in `README.md` and the two sections above.
