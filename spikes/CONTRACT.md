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
