# Parser bench + correctness suite

A side-by-side comparison of our Newick/NEXUS parsers (`@gbif-phylo/io`) against the main JS
alternatives: **phylio** (`@vibbioinfocore/phylio`), **newick-js**, and **patristic**.

This is a *decision aid*, not a release artifact. The question is: **can we justify writing our own
parsers, or should we vendor one of these?** The suite answers it with two numbers per lib:

- **Correctness**: how many of 38 well-formed and 19 malformed hand-crafted edge cases each lib
  gets right.
- **Speed**: median parse time on a mix of real and synthetic trees from `data/`, as a ratio vs
  ours.

## Not a workspace

This folder is a standalone npm project outside the monorepo workspaces, so pulling in third-party
parsers doesn't infect `npm run check` or `check:packages`. Install deps on demand:

```bash
cd tests/bench/parsers
npm install --ignore-scripts
```

## Running

```bash
# Correctness matrix (fast, ~1s)
node --conditions=@gbif-phylo/source --experimental-transform-types --no-warnings src/correctness.mjs

# Timing bench (minutes; each parser/fixture pair runs in its own child, with a wall-clock timeout)
TIMEOUT_MS=15000 ITER=5 OUT=results/latest.json \
  node --conditions=@gbif-phylo/source --experimental-transform-types --no-warnings src/bench.mjs

# DendroPy oracle (needs pip install dendropy; reports where DendroPy and the JS libs diverge)
node --conditions=@gbif-phylo/source --experimental-transform-types --no-warnings src/oracle.mjs
```

Env vars:

- `ITER` (default 5) - timed iterations per pair, after 1 untimed warmup.
- `TIMEOUT_MS` (default 15000) - subprocess is killed and the pair marked `SLOW` if it exceeds this.
- `OUT` - optional path for raw JSON results.

## Layout

- `src/parsers.mjs` - thin adapters that normalize every lib to `{ tipCount, nodeCount, tipLabels,
  hasLengths }`. `kind` is `'newick'` or `'nexus'`; a lib that doesn't support `kind` throws
  `Error('unsupported')`.
- `src/correctness.mjs` - edge-case runner. Verdicts: `ok`, `wrong`, `error`, `crash`.
- `src/bench.mjs` + `src/bench-worker.mjs` - timing runner. Child-process isolation per pair so a
  slow or stuck parser can't hang the suite.
- `src/edge-fixtures.mjs` + `fixtures/edge/*.json` - edge cases. Three files:
  - `well-formed.json` and `malformed.json` are our own hand-crafted set.
  - `borrowed.json` is lifted from phylio's, patristic's, and newick-js's own test suites, each
    entry carrying a `source` string naming the upstream test file.
- `src/fixtures.mjs` - timing-bench fixture list, resolving to `data/` in the repo root. Gzipped
  files are inflated in memory.
- `src/oracle.mjs` + `src/dendropy-oracle.py` - DendroPy cross-check. Each edge-case fixture is
  fed to a Python subprocess running DendroPy; the matrix shows where the JS libs diverge from
  the Python reference. Needs `pip install dendropy`.

## What correctness means here

- A **well-formed** fixture passes if the parser returns the expected `tipCount` and `tipLabels`
  (as an unordered multiset). `hasLengths` is advisory.
- A **malformed** fixture passes if the parser throws an `Error`. A parser that silently returns a
  tree built from garbage input scores `wrong` on malformed - that's a *leniency* failure, not a
  robustness feature.

A parser that throws a non-Error (bare string, `undefined`, infinite recursion, etc.) counts as
`crash` on either kind and raises the suite's exit code.

See `docs/design/parser-comparison.md` in the repo root for the writeup.
