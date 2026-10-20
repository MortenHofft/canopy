## 8. Fit with the renderer: the `TreeSource` proposal

Goal: today's in-memory behaviour is the trivial implementation of one interface, so Parquet is a second `TreeSource`, not a second renderer. The proposal is type-checked (`tsc --strict`) in [spikes/parquet-experiment/proposal/tree-source.ts](../../spikes/parquet-experiment/proposal/tree-source.ts) against the real `TreeData` type of `spikes/custom/src/core/types.ts` (read only; nothing in `spikes/custom` was edited).

```ts
import type { TreeData } from '../../custom/src/core/types.ts';

/** What the renderer reads each frame: today's TreeData plus rollups and stubs. Rows are in PREORDER of the loaded subset, so a loaded
 *  clade is still a contiguous index range and lod.ts keeps jumping with subtreeEnd. */
export interface TreeSnapshot extends TreeData {
  readonly stub: Uint8Array;            // 1 = row stands for a clade whose rows are not loaded: drawn as a triangle, never descended into
  readonly globalId: Int32Array | null; // local row -> preorder id in the FULL tree (public API speaks global ids); null = identity
  readonly depth: Int32Array;
  readonly maxDepth: Int32Array;        // deepest tip below (cladogram X for stubs)
  readonly cumLength: Float32Array | Float64Array;
  readonly maxCum: Float32Array | Float64Array;   // XMAX source
  readonly row: Float32Array | Float64Array;      // layout y; stubs: stored, loaded clades: recomputed from their children
  readonly aggregates?: Readonly<Record<string, Float64Array>>; // per-clade column rollups, e.g. occ_sum
  isTip(i: number): boolean;            // childCount[i] === 0 && !stub[i]
  toLocal(globalId: number): number;    // -1 if not in the snapshot
}

export interface EnsureOptions { signal?: AbortSignal; priority?: number; labels?: boolean }

export interface TreeSource {
  readonly nodeCount: number;
  readonly tipCount: number;
  readonly hasLengths: boolean;
  readonly version: number;                                   // bumps whenever snapshot() would return different rows
  subscribe(listener: (version: number) => void): () => void; // renderer repaints on notification
  snapshot(): TreeSnapshot;                                   // never async; loaded clades in full, everything else as stubs
  ensure(lo: number, hi: number, o?: EnsureOptions): Promise<void>;   // rows [lo, hi) (a clade is [i, subtreeEnd[i])) join the snapshot
  ensureClade(globalId: number, o?: EnsureOptions): Promise<void>;    // open a stub
  ensureTip(rank: number, minTips?: number, o?: EnsureOptions): Promise<{ node: number }>; // occurrence-page case
  tipLabels(r0: number, r1: number): Promise<string[]>;
  tipRankOf(label: string): Promise<number>;
  tipColumn?(id: string, r0: number, r1: number): Promise<Float64Array | Int32Array | string[]>;
  trim?(keep: Array<[number, number]>): void;                 // optional memory cap
  destroy(): void;
}
```

`InMemorySource` (also in the proposal file, 15 lines) wraps today's `TreeModel`: `version` never changes, `ensure*` resolve immediately, `stub` is all zero, `globalId` is `null`, `subscribe` returns a no-op. The renderer therefore needs no `if (partial)` branches: a snapshot without stubs behaves exactly like today.

### What the renderer needs from a partially loaded tree

1. **Stub rows carrying rollups.** A stub is one row with `leafStart`/`leafEnd` (global tip ranks, as today), `tipCount = leafEnd - leafStart`, `depth`, `maxDepth`, `cumLength`, `maxCum`, `row` and optional aggregates. These are exactly the columns the overview pyramid stores, and `test/overview_vs_layout.mjs` shows that for every overview row `X`, `XMAX` and `ROW` equal what `computeLayout()` derives from the full tree (section 4). `computeLayout` therefore takes `X`, `XMAX`, `ROW` of stub rows from the snapshot instead of from its bottom-up passes; for loaded clades it keeps computing them (the node table does not store `row`; `layoutRows()` in the reader recomputes it exactly).
2. **Drawn as triangles until detail arrives.** In `cutRect`/`cutRadial` a stub is always `K_SUMMARY` (never `K_NODE`), whatever its pixel size; `subtreeEnd[i] = i + 1` makes the existing "jump past the subtree" logic work unchanged. The cut additionally records stubs whose on-screen height exceeds a threshold (for example 24 px, or the clade covers more than a third of the viewport) into a small `needDetail` list.
3. **`ensure(lo, hi)` returns a promise.** After each frame the renderer calls `source.ensureClade(globalId, { priority, signal })` for the `needDetail` list (nearest to the viewport centre first, cancelled with the `AbortSignal` when the viewport moves on, at most 4 in flight). Because each clade fetch is one coalesced range request, 4 in flight stay below the browser's 6 connections per host.
4. **Version / notify.** `subscribe(cb)` fires once per batch of arrived rows (not per row group). The renderer rebuilds the compact snapshot-derived arrays (`Layout`, hit index) and calls its existing `invalidate()`. Cost is O(loaded rows); at the measured 10k to 100k loaded rows this is a few milliseconds (it is the same pass `computeLayout` already makes, measured at 0.3 s for 1M nodes in docs/results/custom.md).
5. **Ids.** The public API (`NodeEvent.node`, `setClades`, `focusTip`, `zoomToNode`) keeps speaking global preorder ids; the renderer maps global to local with `toLocal()` (binary search over `globalId`) at the boundary, and `classOf` / highlight arrays are kept per global range (`setClades` already fills `[node, subtreeEnd[node])`, which is a global range, so it is stored as a list of ranges instead of a dense `Uint8Array(nodeCount)` when the source is partial).
6. **Hit testing and the descendant-tip-set contract for stubs.** `hit.ts` builds its grid from the draw list, and a stub is a normal `K_SUMMARY` entry, so hover and click already work. `NodeEvent` carries `tipStart = leafStart[i]`, `tipEnd = leafEnd[i]` which are the global ranks of the clade: **a click on a stub clade still yields the tip range `[leaf_start, leaf_start + tip_count)`** without loading any row. What is *not* available synchronously is the label list: the host calls `await source.tipLabels(tipStart, tipEnd)` (one `tips.parquet` read, for the 10k-tip clade measured in section 6), or, for very large clades, uses the range itself (for example as a server-side filter) rather than 1M labels. This is a contract change for the host: today `descendantTips` is synchronous.
7. **Focus a tip (occurrence page).** `ensureTip(rank, minTips = 1000)`: a tip-label read gives the node id (`node` column of `tips.parquet`; one small read, **not** included in the focus numbers of section 6.4), `getPath(node)` returns the ancestor chain with `tip_count` from one node row group plus `spine.parquet` (measured: section 6), then one range read for the smallest ancestor clade with at least `minTips` tips, and the overview level whose expanded clades are all at least that large (`level_min_tips` in the manifest) so every ancestor above the loaded clade is a regular row with its child stubs. Label to rank: `tipRankOf(label)` reads the footer of `labels.parquet` and one row group of it (measured in section 6).
8. **Keyboard navigation and accessibility.** `ArrowRight` on a stub triggers `ensureClade` and moves to the first child once it arrives; the screen-reader list (`srList`) only lists loaded tips and announces stubs as "clade of N tips, loading".

### What in the current custom renderer assumes everything is in memory

Read from `spikes/custom/src/core/` (line numbers as of the commit this experiment started from):

| Where | Assumption | Change |
|---|---|---|
| `types.ts` `TreeData` | dense typed arrays indexed by preorder id for the whole tree, `tipLabels: string[]` and `labels: string[]` for all nodes, `tipIndex(label)` map over all labels, `heights()` over the whole tree | split into `TreeSnapshot` (rows) and async label/lookup methods on `TreeSource` |
| `layout.ts` `computeLayout` | three whole-tree passes: `X` from `length`, `ROW` bottom-up from `firstChild`/`LAST`, `XMAX` bottom-up; cladogram X needs `heights()` of the whole tree; `Map<boolean, Layout>` cache per `branchLengths` | stub rows take `X/XMAX/ROW` from rollups; recompute per snapshot version (O(loaded)); cache keyed by (version, flag) |
| `lod.ts` `cutRect`/`cutRadial` | `i < n` scan with `childCount[i] === 0` meaning tip; a node is expanded or collapsed by pixel size only | stub always summary; emit `needDetail`; `isTip` via stub flag |
| `hit.ts` `HitIndex` | reads `tree.parent`, `leafStart`, `ROW`, `LAST`, `firstChild` of nodes in the draw list | works on the snapshot unchanged; stubs are summary items |
| `renderer.ts` lines ~217-240 `setClades`, `setHighlighted` | `new Uint8Array(nodeCount)` for clade classes, `hl = new Uint8Array(tipCount)`, `tipIndex(label)` for every highlighted label | ranges over global ids; labels resolved with `tipRankOf` (async) |
| `renderer.ts` ~287-345 `focusTip`, `zoomToNode`, `locateNode` | `tipNode[rank]`, `L.ROW[node]`, `L.X[node]` available for any node | `focusTip` becomes async via `ensureTip`; `zoomToNode` on a stub zooms to the stub's triangle then loads |
| `renderer.ts` ~535, 807, 863, 1156 labels | `tipLabels[rank]` for any visible rank, `labels[node]` for the live-region text | `tipLabels(r0, r1)` fetched for the visible rank window; text falls back to the clade size while loading |
| `renderer.ts` ~1199-1221 keyboard | `parent`, `firstChild`, `leafEnd` of any node | on stubs, load first |
| `columns.ts` `compileColumns` | iterates ALL tips and looks up `spec.values[tipLabels[r]]` once to build bar widths and ranges | per visible-window lazy values; `tipColumn()` for Parquet; stubs draw the clade aggregate (`occ_sum`) |
| `draw.ts` | `K_SUMMARY` fill uses the clade class and the stub triangle geometry from `ROW/XMAX` | stubs use the same code path; optional text "N tips" and aggregate bar for big stubs |
| `columns` / overview strip (`ovList`) | draws the whole tree once into the strip | draws from the snapshot (overview level 0 is enough) |
| React adapter (`adapter.tsx`, `react/`) | prop `tree: TreeModel` | prop `source: TreeSource` (a `tree` prop wraps an `InMemorySource`), loading / error / retry states |

### Refactor size (engineer-days, estimate, **unverified**: no code was written in `spikes/custom`)

| Piece | Days |
|---|---|
| `TreeSnapshot`/`TreeSource` types, `InMemorySource`, adapter so existing props still work | 1.5 |
| `layout.ts` with stub rollups, per-version recompute, tests against the in-memory layout (this experiment's `overview_vs_layout` is the seed) | 2 |
| `lod.ts` stub rule, `needDetail` list, radial variant | 1.5 |
| `renderer.ts`: subscription and repaint, `ensure` scheduling with priority and cancel, id mapping at the API boundary, async `focusTip`, class and highlight ranges, keyboard on stubs, labels for the visible window | 4 |
| `columns.ts` lazy per-window values and clade aggregates on stubs | 2 |
| `hit.ts` and event contract (async tip labels), a11y strings | 1 |
| `ParquetSource` (snapshot builder that merges overview rows and loaded clades into preorder arrays, eviction, abort, errors, retries, request budget) on top of the reader in this folder | 5 |
| Test harness: a latency-injecting mock source, partial-versus-full frame comparison (same viewport must give the same draw list apart from stubs), re-run S1 to S15 | 3 |
| Build pipeline: converter in the site build or the ingestion job, manifest versioning, CDN/CORS checks | 2 to 3 |
| **Total** | **about 22 to 25 days (4.5 to 5 weeks, one engineer)**, range 16 to 32 depending on how much of columns/search/accessibility is in scope |

The renderer-only part (rows 1 to 6) is about 12 to 14 days; the rest is source, tests and pipeline. A cheaper intermediate step (about 5 to 7 days, **unverified**) loads the *whole* tree from Parquet (or chunked flat files) into the existing `TreeModel` in a Worker with a progress bar and no stubs; that gives the byte savings of a binary format but none of the overview-first behaviour.
