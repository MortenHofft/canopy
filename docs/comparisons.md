# How Canopy compares to other tree parsers

A short summary of how we tested `@canopy/io` against the main Newick / NEXUS parsers in the
wild (JS, Python, Java). The full design brief and the per-fixture tables live in
[docs/design/parser-comparison.md](design/parser-comparison.md); the executable suites live under
[tests/bench/parsers/](../tests/bench/parsers/).

## TL;DR

- **Correctness**: 82/89 on the edge-case suite (default mode); 88/89 if you count strict-mode
  rejections, where `{ strict: true }` catches 25/25 malformed inputs. Next best — Forester (70),
  DendroPy (67), patristic (67), newick-js (61), phylio (61).
- **Deep trees**: the only parser we tested, in any language, that completes the 10 000-tip
  caterpillar in the browser without stack-overflowing. phylio, newick-js, patristic *and*
  DendroPy all crash on it; Forester (JVM default stack) is the only other one that survives.
- **Speed**: geomean 4.6× faster than newick-js, 281× faster than phylio in the small window where
  phylio runs, matched or slightly behind patristic on small trees. On a real 19 k-tip OpenTree
  file we parse in 13 ms where newick-js times out at >15 s.
- **Our strict mode** (`parseNewick(text, { strict: true })`) matches phylio's and DendroPy's
  default on the lenient-vs-strict boundary; our default stays lenient and surfaces warnings so
  publishers see what's wrong without the viewer refusing to render.

## How the tests were put together

**89 edge-case fixtures**, assembled from four sources (each with a `source` field):

1. **Hand-crafted** (`fixtures/edge/{well-formed,malformed}.json`). 63 well-formed + 25 malformed
   cases I wrote from the Newick / NEXUS specs: quoted labels with spaces, commas, parens,
   escapes, apostrophes; comments nested, multi-line, inside branch lengths; BEAST `[&...]` and
   NHX `[&&NHX:...]` annotations; whitespace; empty labels; Unicode; deep caterpillar; NEXUS
   TRANSLATE and multi-tree; 25 malformed inputs.
2. **Lifted verbatim from the other libs' own test suites** (`fixtures/edge/borrowed.json`): phylio's
   `test/Bio/Phylogeny/Newick.purs` and `test/data/*.newick`, patristic's `test/newick.test.js`
   and `test/deep.test.js`, newick-js's `src/index.spec.ts`.
3. **Ideas lifted from GPL libs** (`fixtures/edge/borrowed-wider.json`): ape's "extra-paren root
   edge" `((A,B):10);`, ete's `2/3` multisupport and quoted-tree-as-name, plus phylotree.js
   HyPhy `{tag}` and BEAST `{dict}` annotations, biojs-io-newick, lwphylo one-shots.
4. **A 118-file real/synthetic corpus** (`data/`): OpenTree, GBIF-style, synthetic shapes
   200 — 20 000 tips. Every tree file in `data/` parses cleanly with `{ strict: true }`.

Not a union — a curated set with provenance. Running borrowed fixtures through our parser caught
two bugs in our own expectations (off-by-one tip counts) before they could mislead the matrix.

**21 generalized invariants** (`packages/io/test/warnings.test.mjs`): per-warning negative-space
cases, position-within-bounds assertions, cross-mode consistency (default-warns iff strict-throws),
determinism, per-stray-comma firing. These exist to catch the *class* of bug an adversarial
reviewer surfaced after the first pass of the warnings system.

**16-fixture timing bench** (`src/bench.mjs`): each parser × fixture pair in a child Node process
so a slow or stuck parser can be killed on wall-clock timeout. 1 warmup + 5 timed iterations.

## Correctness: how everyone fared

Across 89 edge-case fixtures (63 well-formed, 26 malformed):

| Lib | well-formed | malformed rejected (default) | overall (default) |
|---|---:|---:|---:|
| **canopy/io** | **63/64  (98%)** | **19/25  (76%)** | **82/89  (92%)** |
| patristic | 58/64  (91%) | 10/25  (40%) | 68/89  (76%) |
| newick-js | 49/64  (77%) | 13/25  (52%) | 62/89  (70%) |
| phylio | 40/64  (63%) | 22/25  (88%) | 62/89  (70%) |
| DendroPy (Python ref) | — | — | 67/89  (75%) |
| Forester (Java, GBIF backend) | — | — | 70/89  (79%) |

With `{ strict: true }` we additionally reject every would-be warning: 25/25 malformed caught,
pushing combined coverage to **88/89**. The one remaining miss is `("say ""hi""":2);`, a
patristic-specific doubled-double-quote escape nobody else implements.

Our one well-formed miss is `("say ""hi""":2);`, a patristic-specific doubled-double-quote
escape. Every other well-formed fixture — including real BEAST, NHX, nested comments, Unicode,
NEXUS TRANSLATE and the 10 k-tip caterpillar — parses correctly.

The 6 malformed inputs we accept in default mode are lenient-by-design: non-numeric branch
lengths, dangling colons, double colons, missing `#NEXUS` header, missing TRANSLATE entries,
and invalid NHX syntax. Each produces a `ParserWarning` the viewer can surface so the publisher
sees what's wrong; passing `{ strict: true }` turns every one into a `NewickError`. Real-world
GBIF files sometimes carry one of these — rendering them with a warning is more useful than
refusing the file.

## DendroPy as reference, and where we diverge

DendroPy is the most-used Python phylogenetics library and the natural tie-breaker when the JS
libs disagree. It is **not** an oracle: it fails 22 of our 89 fixtures itself. We walked through
every one of the 24 cases where DendroPy and we disagree:

- **6 cases — different design, both defensible.** DendroPy converts `_` → space on Newick input
  (NEXUS convention leaking in), drops unlabeled tips rather than keeping them with `""` labels,
  and rejects missing `;` or `#NEXUS` headers. We preserve verbatim and warn, because losing
  nodes silently is worse for a viewer and `_` is legitimate in GTDB / OpenTree ids.
- **4 cases — DendroPy strict, our strict mode matches.** `non-numeric-length`, `dangling-colon`,
  `missing-nexus-header`, `missing-trailing-semicolon`: DendroPy throws, we throw in
  `{ strict: true }` and warn in default. Our strict mode and DendroPy's default agree here.
- **3 cases — different error style on empty inputs** (`;`, `[comment];`): DendroPy returns an
  empty TreeList, we throw a clean `NewickError`. Both reject.
- **1 case — DendroPy's own architectural limit.** The 10 000-tip caterpillar crashes DendroPy
  with `RecursionError: maximum recursion depth exceeded`. We're objectively better here.
- **7 cases — we lenient where DendroPy strict**: HyPhy `{tag}` syntax, unquoted spaces in labels,
  invalid NHX, missing TRANSLATE entries. Judgment calls where other JS libs also accept.

Forester (Java, the parser GBIF backend will use) agrees with us on **84/89 fixtures (94%)**.
The 5 disagreements split neatly: 1 case Forester stricter (double-colon, which our strict mode
also catches), 4 cases we stricter (`("A","B");`, `(A'q',B);`, missing-comma — Forester silently
builds a nonsense tree, we hard-error).

## Performance

Node 22, cloud-sandbox container. 1 warmup + 5 timed iterations per pair; each pair runs in its
own child process with a 15 s wall-clock timeout. Relative ordering holds across machines; the
absolute numbers will shift.

| Fixture | Size | Tips | **canopy/io** | phylio | newick-js | patristic |
|---|---:|---:|---:|---:|---:|---:|
| synth-balanced-1000 | 42 KB | 1 000 | **5.0 ms** | SLOW >15 s | 10.0 ms | 3.2 ms |
| real-mammals-4071 | 135 KB | 4 071 | **7.0 ms** | SLOW >15 s | 165 ms | 7.5 ms |
| synth-balanced-10000 | 408 KB | 10 000 | **10.4 ms** | SLOW >15 s | 782 ms | 26.7 ms |
| **synth-caterpillar-10000** | 411 KB | 10 000 | **7.6 ms** | **STACK OVERFLOW** | **STACK OVERFLOW** | **STACK OVERFLOW** |
| real-otol-mammalia (OTL) | 356 KB | 9 328 | **6.2 ms** | ERR | 924 ms | 12.8 ms |
| real-otol-aves (OTL) | 732 KB | 18 988 | **12.9 ms** | ERR | SLOW >15 s | 38.2 ms |

Geometric mean over fixtures where both finished:

- **phylio**: 281× slower than us (n = 3; everything bigger times out or errors)
- **newick-js**: 4.6× slower (n = 11; up to 149× on real OpenTree data)
- **patristic**: 1.23× slower (n = 12; crashes on the deep caterpillar)

## Please report error

If you find a mistake in how we ran or read any of this, please open an issue.

## Reproducing the numbers

```bash
cd tests/bench/parsers
npm install --ignore-scripts

# Correctness matrix (fast)
node --conditions=@canopy/source --experimental-transform-types --no-warnings src/correctness.mjs

# DendroPy oracle (needs pip install dendropy)
node --conditions=@canopy/source --experimental-transform-types --no-warnings src/oracle.mjs

# Forester oracle (needs forester.jar on the classpath; see tests/bench/parsers/README.md)
node --conditions=@canopy/source --experimental-transform-types --no-warnings src/forester-oracle.mjs

# Timing bench (~10 min)
TIMEOUT_MS=15000 ITER=5 OUT=results/latest.json \
  node --conditions=@canopy/source --experimental-transform-types --no-warnings src/bench.mjs
```
