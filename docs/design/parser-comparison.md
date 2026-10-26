# Parser comparison: `@gbif-phylo/io` vs the JS alternatives

**Status:** results from `tests/bench/parsers/` — correctness is settled; timing numbers below are
from the first run on 2026-10-26 in the cloud-sandbox Node 22 container, no GPU, no browser. Hard
numbers will shift between machines; relative ordering should hold.

## Why this exists

The repo rule is "no runtime dependencies in `io` unless there is a strong reason." That means we
need an answer, with evidence, to a reasonable question: *why not use an existing parser?*

Three candidates on npm were worth measuring:

| Library | Version | Formats | Shape of output | License |
|---|---|---|---|---|
| `@gbif-phylo/io` (ours) | 0.1.0 | Newick, NEXUS | typed-array preorder `TreeModel` | Apache-2.0 |
| `@vibbioinfocore/phylio` | 1.1.2 | Newick + NHX + Extended, NEXUS, PhyloXML | nodes[] + edges[] + metadata[] | MIT |
| `newick-js` | 1.2.4 | Newick | `{ graph: [Set<Vertex>, Set<Edge>], root }` | MIT |
| `patristic` | 0.7.1 | Newick | recursive `Branch` tree with parent refs | MIT |

Everything else in the field either bundles rendering (`phylotree.js`, `phylocanvas.gl`,
`jsPhyloSVG`, `TnT`) or is unmaintained and Newick-only. Nothing on npm handles PhyloXML or NeXML
without also pulling in a renderer.

## Correctness

`tests/bench/parsers/src/correctness.mjs` runs 57 hand-crafted edge cases (38 well-formed, 19
malformed) and records one of four verdicts per lib: `ok`, `wrong` (parsed, but shape disagrees
with expectation), `error` (clean throw), `crash` (threw a non-Error, hung, or returned null).

**Score:**

| Lib | Well-formed (38) | Malformed rejected (19) |
|---|---:|---:|
| **gbif-phylo/io** | **38/38** | 11/19 |
| phylio | 23/38 | 16/19 |
| newick-js | 30/38 | 8/19 |
| patristic | 33/38 | 6/19 |

### Where each lib goes wrong

**phylio** fails on realistic, well-formed inputs that we see in the wild:

- quoted labels with spaces, commas, parens, apostrophe-escapes, semicolons
- trees without a trailing `;`
- leading/trailing whitespace
- `[&...]` BEAST annotations (treats the brackets as a syntax error)
- nested comments
- Unicode labels
- `#NEXUS` with any of the above inside

phylio *does* round-trip the subset of Newick its tests cover, and it is strict about malformed
input — the strict grammar is where its 16/19 malformed-rejection score comes from. But the price
for that strictness is rejecting real BEAST and TreeAnnotator output, which is a non-starter for a
GBIF-facing tool.

**newick-js** silently drops comments (sees `[c]` as part of the label text), so BEAST and NHX
inputs come back with corrupted labels. Multi-line comments break the same way.

**patristic** mis-parses `[just a comment];` (no tree, just a comment) and `""` (empty input) as
valid trees of 1 tip each — bad defaults for a library that reads from user files.

**Our parser** passes every well-formed case we tested. It is also the most *lenient* about
malformed input: it will happily parse `(A:xyz,B:1);` as a tree with `NaN` branch lengths, or
`("A","B");` as a tree with labels `"A"` and `"B"` (double-quotes included). This is a deliberate
choice — real-world Newick is messy, and the viewer displays what it can — but it means we accept
some inputs that no other lib accepts. If we ever want to be strict (fail hard, show a diagnostic),
the places are listed as `WRONG` in the correctness output and are the obvious targets.

## Speed

Methodology: each parser × fixture pair runs in a child Node 22 process so a slow or stuck parser
can be killed on wall-clock timeout (default 15s). 1 untimed warmup + 5 timed iterations; the table
reports **median** ms, tips/sec, and MB/sec of uncompressed input. Fixtures: 200 — 19 000 tips, on
real OpenTree + GBIF-style data and synthetic shapes (balanced, caterpillar, bushy, Yule). NEXUS
single-tree, multi-tree, and real BEAST included. Run on the cloud-sandbox container, Node 22, no
browser, no GPU — the absolute numbers will shift elsewhere; relative ordering should hold.

### Median parse time

| Fixture | Size | Tips | **gbif-phylo/io** | phylio | newick-js | patristic |
|---|---:|---:|---:|---:|---:|---:|
| synth-balanced-200          | 13 KB  |    200 |  **1.0 ms** |   313 ms       |   1.3 ms | 1.3 ms |
| synth-caterpillar-200       | 13 KB  |    200 |  **1.2 ms** |   166 ms       | 944 µs   | 1.3 ms |
| synth-bushy-200             | 10 KB  |    200 | **744 µs**  |   406 ms       |   1.0 ms | 1.0 ms |
| synth-balanced-1000         | 42 KB  |  1 000 |  **5.0 ms** | SLOW >15 s     |  10.0 ms | 3.2 ms (faster) |
| synth-caterpillar-1000      | 41 KB  |  1 000 |  **3.9 ms** | SLOW >15 s     |   6.3 ms | 4.4 ms |
| synth-bushy-1000            | 35 KB  |  1 000 |  **2.8 ms** | SLOW >15 s     |   8.2 ms | 2.2 ms (faster) |
| synth-yule-1000             | 41 KB  |  1 000 |  **4.0 ms** | SLOW >15 s     |  16.7 ms | 3.5 ms |
| real-butterflies-496        | 21 KB  |    496 |  **2.7 ms** | SLOW >15 s     |   3.5 ms | 2.3 ms |
| real-mammals-4071           | 135 KB |  4 071 |  **7.0 ms** | SLOW >15 s     |   165 ms | 7.5 ms |
| synth-balanced-10000        | 408 KB | 10 000 | **10.4 ms** | SLOW >15 s     |   782 ms | 26.7 ms |
| synth-caterpillar-10000     | 411 KB | 10 000 | **7.6 ms**  | **STACK OVERFLOW** | **STACK OVERFLOW** | **STACK OVERFLOW** |
| real-otol-mammalia (OTL)    | 356 KB |  9 328 |  **6.2 ms** | ERR (header)   |   924 ms | 12.8 ms |
| real-otol-aves (OTL)        | 732 KB | 18 988 | **12.9 ms** | ERR (header)   | SLOW >15s | 38.2 ms |
| synth-nexus-yule-200        |  9 KB  |    200 | **793 µs**  | ERR (comment)  | n/a      | n/a    |
| synth-nexus-multi-200x10    | 58 KB  |    200 |  **1.4 ms** | ERR (comment)  | n/a      | n/a    |
| real-nexus-beast-fluA       | 80 KB  |     76 |  **3.6 ms** | ERR            | n/a      | n/a    |

Speed ratio vs ours (`>1.0×` = we are faster), geometric mean over fixtures where both finished:

- **phylio**: **281× slower** (n = 3) — can only be measured on the three smallest fixtures;
  everything else times out, errors, or hits a format-detection bug.
- **newick-js**: **4.6× slower** (n = 11) — scales badly, up to 149× slower on 9k-tip real
  OpenTree data (`924 ms` vs our `6.2 ms`); timed out on the 19k-tip aves tree.
- **patristic**: **1.23× slower** (n = 12) — close on small Newick, 2-3× behind on 10k, stack
  overflow on the 10k-tip caterpillar.

### The deep-tree finding

The one fixture that separates the libraries is `synth-caterpillar-10000` (10 000 tips, every
internal node has one child + one leaf — the pathological tree shape). All three alternatives throw
`Maximum call stack size exceeded`; **our parser is the only one that completes.** This is a direct
consequence of the "no recursion" rule in the core (see CLAUDE.md: *"No recursion and no per-node
allocation in the cut, draw and hit code"*) — but the rule holds in `io` too, which is why we're
the one standing.

A 10 000-tip caterpillar is not a theoretical corner. Taxonomy trees fetched from OpenTree, GBIF,
and GTDB routinely have unary-chain spines of thousands of nodes at the root. If we vendored any
of these libs, we'd ship a product that crashes on real GBIF trees without warning.

### phylio's NEXUS story

phylio advertises NEXUS support, but in practice:

- It errors on a `[comment]` placed on the line after `#NEXUS` — which is standard NEXUS.
- It errors on real BEAST NEXUS output (TreeAnnotator style, with TAXA + TRANSLATE + `[&R]`).
- Its format autodetect requires `#NEXUS` to be present even in pure-Newick input larger than a
  few hundred bytes, so real OpenTree Newick files are refused.

That rules it out as a NEXUS parser for our data. Nothing else on the list even claims NEXUS.

## The argument

Four findings make the case for keeping our parsers:

1. **Deep trees.** Only ours completes `caterpillar-10000`. The other three all stack-overflow on
   a shape that appears routinely in taxonomy data (OpenTree, GBIF, GTDB). This alone is
   disqualifying for a GBIF-facing tool.
2. **Correctness on the inputs we actually need.** 38/38 well-formed vs 23 (phylio) / 30 (newick-js)
   / 33 (patristic). The gap is in the exact places that matter: quoted labels with non-ASCII,
   `[&...]` BEAST annotations, nested comments. The alternatives don't just miss edge cases — they
   *refuse or corrupt production tree files.*
3. **Speed.** Geomean 4.6× faster than newick-js (up to 149× on real OpenTree data), 281× faster
   than phylio in the small window where phylio runs at all, and roughly matched with patristic
   until 10k tips when patristic falls 2-3× behind (and crashes on deep). On big real trees
   (`otol-aves`, 19k tips, 732 KB) we parse in 13 ms; newick-js times out, phylio errors,
   patristic takes 38 ms.
4. **Output shape.** The viewer and `tree-ops` are built on a typed-array preorder `TreeModel`
   (`parent: Int32Array`, `length: Float64Array`, `subtreeEnd`, `cumLength`, ...) that was chosen
   for cache locality in the cut/draw hot loop (see `packages/viewer/src/projection.ts`). Every
   candidate lib returns an object-graph: phylio has `nodes[]` + `edges[]`, patristic has a
   recursive `Branch` tree, newick-js hands back `Set`s. Using any of them means wrapping with a
   full tree-shape rebuild, which negates whatever parse-time win they'd offer and brings their
   per-node allocation into our hot path.

The architectural rule — no runtime deps in `io` — holds up here on its own merits, not just as a
preference. We're not writing in-house because we can; we're writing in-house because the
alternatives would ship a worse viewer.

### What we *should* steal

- **phylio's strict malformed rejection**: 16/19 vs our 11/19. Specifically on `(A:xyz,B);`,
  `(A:,B);`, `(A:1:2,B);`, `("A","B");`, `(A'quoted',B);` — all cases where phylio throws and we
  silently build a nonsense tree. These should become opt-in strict-mode diagnostics (`{ strict:
  true }`) rather than default failures: real files sometimes carry these, and the viewer should
  tolerate them, but a validation tool shouldn't.
- **Their test corpora as fixtures.** phylio's and newick-js's test files cover inputs we don't
  have. Vendor them under `tests/bench/parsers/fixtures/` with their licence files, and run them
  through our parser as part of `npm test` in `packages/io`.

### What we should *not* do

- Port DendroPy or ape to JS/wasm. They're correctness references, not speed references. For
  cross-checks on tricky files, run DendroPy as a Python subprocess in CI (one shot, iterate the
  rich fixtures, diff tree shape with ours) rather than shipping a megabyte of wasm.
- Replace our parsers. The three candidates each fail on either real inputs we must handle or on
  the shape of `TreeModel` we need. The cost of switching exceeds the maintenance cost of ~700
  lines of iterative parser code we already have, and would regress correctness on inputs we
  currently pass.

## How to reproduce

```bash
cd tests/bench/parsers
npm install --ignore-scripts
node --conditions=@gbif-phylo/source --experimental-transform-types --no-warnings src/correctness.mjs
TIMEOUT_MS=15000 ITER=5 OUT=results/latest.json \
  node --conditions=@gbif-phylo/source --experimental-transform-types --no-warnings src/bench.mjs
```

See `tests/bench/parsers/README.md` for the layout and env vars.
