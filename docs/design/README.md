# Design notes

Measurements and design notes carried over from the research on the `main` branch. They are records of what was measured and decided at
the time. Paths in them (`spikes/custom/...`, `spikes/shared/...`, `docs/results/...`) refer to the layout of `main`. On this branch:

| Path on `main` | Path here |
|---|---|
| `spikes/custom/src/core/` | `packages/viewer/src/` |
| `spikes/custom/src/react/` | `packages/react/src/` |
| `spikes/shared/newick.ts`, `tree.ts` | `packages/io/src/` |
| `spikes/custom/scripts/check-radial-ui.mjs`, `bench/` | `tests/browser/` |
| `docs/results/custom.md`, `tree-ops.md`, `treesource-slice.md` | this folder |

| File | What |
|---|---|
| [library.md](library.md) | Turning the renderer into a library: the design decisions, what it cost, what is not done (written on this branch) |
| [custom.md](custom.md) | The custom renderer's measurements: benchmarks, scenarios, the radial work, polytomies, the hardening pass |
| [custom-renderer.md](custom-renderer.md) | The research that preceded it: why our own renderer, and its architecture |
| [data-layer.md](data-layer.md) | Data layer research: formats, loading, partial trees |
| [treesource-slice.md](treesource-slice.md) | The `TreeSource` slice: partially loaded trees (its `ParquetSource` is on `main`) |
| [tree-ops.md](tree-ops.md), [tree-ops-libraries.md](tree-ops-libraries.md) | Tree operations: results and the libraries looked at |
| [ete-ideas.md](ete-ideas.md) | Ideas from the ETE toolkit worth reimplementing |
