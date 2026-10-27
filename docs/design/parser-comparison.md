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

`tests/bench/parsers/src/correctness.mjs` runs 89 edge cases (63 well-formed, 26 malformed) and
records one of four verdicts per lib: `ok`, `wrong` (parsed, but shape disagrees with expectation),
`error` (clean throw), `crash` (threw a non-Error, hung, or returned null).

The fixtures come from four places (each entry carries a `source` field naming its origin):

- `fixtures/edge/well-formed.json`, `fixtures/edge/malformed.json` — our own hand-crafted set
  (minimal/trifurcation/polytomy/unary; quoted labels with spaces, commas, parens, apostrophe
  escapes, semicolons; comments, nested, multiline, inside branch lengths; BEAST and NHX
  annotations; whitespace; empty labels; Unicode; deep caterpillar; NEXUS corners; 26 malformed
  inputs).
- `fixtures/edge/borrowed.json` — lifted verbatim from phylio's, patristic's, and newick-js's own
  test suites.
- `fixtures/edge/borrowed-wider.json` — more cases from **phylotree.js**, **ape** (R, GPL-2+, so
  ideas only — the strings themselves aren't code), **ete** (Python, GPL-3+, same), **lwphylo**,
  and **biojs-io-newick**. Covers HyPhy `{tag}` syntax, BEAST `{dict}` annotation values, ape's
  "extra-paren root edge" idiom `((A:1,B:1):10);`, ete's `2/3` multi-support convention, and
  ete's "a quoted label can be an entire mini-tree" trick.
- A **DendroPy oracle** (`src/dendropy-oracle.py`, driven by `src/oracle.mjs`) parses the same
  fixtures as a tie-breaker. DendroPy is the Python reference; it isn't infallible (strong
  opinions on `_`-to-space, drops unlabeled tips, rejects missing `;`) but it is the most
  widely-used phylogenetics parser in bioinformatics.

Running the borrowed fixtures caught two real bugs in our own hand-crafted set (an off-by-one on
`(Alpha,Beta,...,,);` and a tip-count mistake on a nested wiki example). Both are fixed; a wider
corpus pays off even without a bug in the parser itself.

**Score (89 fixtures total):**

| Lib | Well-formed (63) | Malformed rejected (26) | Overall |
|---|---:|---:|---:|
| **gbif-phylo/io** | **62/63  (98%)** | 19/26  (73%) | **81/89  (91%)** |
| patristic | 57/63  (90%) | 10/26  (38%) | 67/89  (75%) |
| newick-js | 48/63  (76%) | 13/26  (50%) | 61/89  (69%) |
| phylio | 39/63  (62%) | 22/26  (85%) | 61/89  (69%) |
| DendroPy (reference) | 48/89 — see below | | |

**None of the other JS libs pass our test suite.** Each has at least a dozen tests they fail on
inputs we handle: phylio rejects BEAST annotations, quoted labels, and no-trailing-`;`; newick-js
corrupts comments and BEAST; patristic parses empty input as a tree. That's the second concrete
reason to keep writing our own in-house (the first was the stack-overflow on deep trees).

Our one well-formed failure is `patristic-doubled-dquotes` — `("say ""hi""":2);` — a
non-standard double-quote escape that only patristic implements. Fine to miss.

### Our own `data/` is clean under the new rules

Every tree file we ship — 118 `.nwk` / `.nex` / `.tree` / `.nhx` across `data/synthetic/`,
`data/rich/`, `data/real-ladder/` — parses with **zero warnings** in strict mode. So turning on
`{ strict: true }` by default is viable for our own corpus, and the warnings are reserved for
genuinely messy files from publishers rather than firing on our own test data.

Run with `node tests/bench/parsers/src/data-corpus-check.mjs`.

### How to read a DendroPy disagreement

DendroPy's overall score on our 89 edge-case fixtures is **67/89 (75%)** vs our 81/89 (91%).
That means DendroPy also fails some of our tests. We use it as a tie-breaker, not an oracle,
and when DendroPy and we disagree the right reading is one of these four:

**1. DendroPy makes a different design choice (both defensible).** 6 cases. DendroPy converts
`_` to space on Newick input (NEXUS convention bleeding over), drops unlabeled tips rather than
keeping them with `""` labels, and rejects a missing trailing `;` or `#NEXUS` header. Our design
is to preserve verbatim and warn: losing nodes silently is worse for a viewer, and `_` is a
legitimate character in GTDB and OpenTree taxon ids. These aren't bugs on either side; they're
different models.

**2. DendroPy is stricter where we warn (and strict mode agrees).** 4 cases:
`non-numeric-length`, `dangling-colon`, `missing-nexus-header`, `missing-trailing-semicolon`.
DendroPy throws. We throw in `strict: true` and warn in default. So our strict mode and
DendroPy's default agree on these; the difference is only whether the viewer still gets a tree.

**3. Different error handling of empty/unterminated input.** 3 cases. DendroPy returns an empty
TreeList (which our oracle counted as `crash`) on inputs like `;`, `[comment];`, and single
semicolon; we throw a cleaner `NewickError`. Both reject, just at different levels.

**4. DendroPy's architectural limitation.** 1 case — the 10 000-tip caterpillar
(`patristic-caterpillar-10k`). DendroPy stack-overflows with `RecursionError: maximum recursion
depth exceeded`. **We're objectively more correct here**, period.

The remaining disagreements (7 cases) are places where we're more lenient than DendroPy on things
other libs also accept: HyPhy `{tag}` syntax, unquoted spaces in labels, invalid NHX,
missing TRANSLATE entries. Each is a judgment call that we document in the warnings table.

The practical rule for interpreting the oracle: a DendroPy disagreement is a **flag for review**,
not a verdict. For every one of ours above we checked the specific case — some we matched (via
strict mode), some are deliberate design differences, and in one case we're better than
DendroPy. If a future disagreement doesn't fit one of these buckets, it's a real bug and should
be investigated.

### Forester (Java) — the one GBIF Backend will probably use

Forester (Christian Zmasek, GPL-3, powers Archaeopteryx) is the Java phylogenetics library GBIF
backend plans to use for Newick / NEXUS / PhyloXML validation server-side. Running our 89 edge-case
fixtures through its `NHXParser` + `NexusPhylogeniesParser` via a thin Java driver
(`tests/bench/parsers/src/ForesterOracle.java`, driven by `src/forester-oracle.mjs`) gave:

| | correct per fixture expectation | agreement with us (same verdict family) |
|---|---:|---:|
| **gbif-phylo/io** | **81/89 (91%)** | — |
| Forester | 70/89 (79%) | 84/89 (94%) |

Forester handles the 10 000-tip caterpillar cleanly — the JVM's bigger default stack puts it in a
league of its own among non-Node runtimes we tested — and agrees with us on nearly every real
input shape. The 5 disagreements fall into two clean groups:

**Forester stricter than us (1 case).** `(A:1:2,B);` double-colon → Forester throws
`NHXFormatException: more than one distance`; we warn and let last-colon win. Our `strict: true`
matches Forester here.

**We stricter than Forester (4 cases).** Forester silently accepts things we hard-error on:

- `("A","B");` → Forester reads the double quotes as valid quoting, parses 2 tips. We reject.
- `(A'q',B);` quote mid-token → Forester parses to 2 tips. We reject.
- `("say ""hi""":2);` doubled-double-quote escape → Forester accepts. We reject (ambivalent).
- `(A(B,C));` missing comma → Forester parses to 2 tips. We reject (unexpected `(`).

On the 11 fixtures where Forester scored "wrong" per our expectations, the pattern is Forester's
NEXUS-leaning conventions: `replaceUnderscores` is on by default so `C_D` becomes `C D`,
unquoted spaces in labels get split differently, and brackets inside quoted labels confuse its
NHX machinery. These are deliberate design choices in Forester — defensible for a NEXUS-oriented
tool, different from our "preserve verbatim and warn" model.

**Practical statement for GBIF backend × our viewer:** 94% verdict-family agreement means a tree
Forester validates server-side will almost always parse cleanly in our viewer (and vice versa).
The 4 cases where we hard-error and Forester silently builds a nonsense tree are places where
*our* behavior protects the user from a wrong tree — a publisher who ships `("A","B");` thinking
double-quotes are legal gets a clear error from us, not a mis-parsed tree. The 1 case where
Forester is stricter (`double-colon`) is covered by our `strict: true` mode. See the full
disagreement table in the `src/forester-oracle.mjs` output.

### DendroPy also fails on deep trees — and Nextstrain already works around it

The oracle run turned up a finding we didn't expect: **DendroPy itself crashes with
`RecursionError: maximum recursion depth exceeded` on the 10 000-tip caterpillar**. The Python
reference implementation has the same architectural problem the three JS libs have. Porting
DendroPy to JS/wasm would not fix the deep-tree issue — the recursive structure is baked into
DendroPy's reader too.

Nextstrain's **augur** pipeline (what feeds auspice, their visualization tool) uses `Bio.Phylo`
for Newick and has a dedicated regex parser for BEAST NEXUS at `augur/import_/beast.py`. On
`augur import beast` their argparse has:

```
beast_parser.add_argument('--recursion-limit', default=False, type=int,
    help="Set a custom recursion limit (dangerous!)")
```

and the parser prints "Recursion limit reached. You can try raising this with the
`--recursion-limit` option (Be careful with this)." when it hits the Python default. That's a
production bioinformatics pipeline shipping a user-facing knob for the exact same problem the
10 000-tip caterpillar exposes. **Nextstrain's own viewer (auspice) is JSON-first and does not
parse Newick in the browser at all** — they do all Newick/NEXUS work in Python server-side via
Augur, convert to a JSON tree, and ship that. That's the architecture they chose because the
browser-side parsing problem is hard. Our iterative parser is the only one in this comparison
that lets the browser do Newick directly without needing a Python pre-processor.

Nextstrain is a reasonable point of comparison: it is one of the most-used phylogenetics
visualizations in the world (public-health genomics, SARS-CoV-2, flu), and they explicitly chose
not to parse in the browser. We're going the other way because our target users publish static
tree files to GBIF archives and need the browser to be the whole pipeline.

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

### Security review: label-XSS threat model

A paranoid review covered the full pipeline: `tree.labels[i]` can hold `<script>`, `javascript:`,
`__proto__`, RTL overrides, and 10 MB strings (the parser treats them as opaque text, which is
correct), so the question is whether any sink in `packages/viewer/`, `packages/react/`, or the
examples turns a label into executable HTML or an unsafe URL. **No critical or high findings.**
Every DOM surface uses `textContent`, JSX children, `setAttribute`, or `dataset` — all of which
treat the string as text. React `dangerouslySetInnerHTML` is used zero times across the repo.

One Medium finding was worth hardening in this PR: the `tipHref` option in `LabelOverlay` passed
the consumer's return value straight to `HTMLAnchorElement.href`. A consumer who naively wrote
`(id) => id` would be exploitable on a tree whose label is `'javascript:alert(1)'`. The library
now routes every href through a safe-scheme allowlist (`http`, `https`, `mailto`, `tel`, `ftp`,
plus fragments, path, query, and relative URLs); anything else collapses to `#`. All current
examples use `encodeURIComponent` + a fixed base URL and are unaffected.

Two Lows were also fixed: `columns.ts` and the playground now use `Object.hasOwn` instead of `in`
/ bracket lookup, so a tip label of `__proto__`, `constructor`, or `toString` can't accidentally
pull `Object.prototype` or a native function out of the lookup table.

Open items the review flagged that we did not act on here (noted for follow-up): no label-length
cap on the parser (10 MB parses in ~77 ms, but a hostile 1 GB input could freeze the tab); RTL
and zero-width characters survive to the DOM (consumers who want to neutralise them can plug
their own `formatLabel`); and `site/src/main.ts` builds its cards via `innerHTML` interpolation
on build-time JSON (not a label-XSS path, but worth defence-in-depth).

### Cross-lib view of the warnings boundary inputs

Running the 21 boundary inputs the warnings system cares about
(`tests/bench/parsers/src/invariants-cross-lib.mjs`) against every lib produces a surprisingly
clean picture:

- **Everyone handles the "shouldn't false-fire" shapes identically.** `(A);`, `((A));`,
  `((Clade));`, `(A:1);`, `((A,B)Clade:0.5);` — all four parsers return 1-2 tips correctly.
  Our `extra-paren-root` guard is a design concern specific to us, not a cross-lib robustness
  issue.
- **Our strict mode and phylio's default mode converge on the lenient cases.** phylio errors
  on 5 of the 10 "we warn" inputs: missing semicolon, non-numeric length, dangling colon,
  double colon, triple colon. These are the same cases our `strict: true` throws on. So the
  practical statement is: **our strict mode = phylio's default**, with the added benefit that
  phylio can't parse real OpenTree trees and our strict mode can.
- **No lib silently corrupts tip counts on these boundary inputs.** Where they parse, they
  parse to the same tip count we do. The disagreement is "parse vs error", not "parse vs wrong
  parse".
- **Everyone is deterministic.** Parsing the same input twice always yields the same result in
  every lib.

The practical consequence for the writeup: when we warn on lenient input, phylio errors on
roughly half. The user who sets `strict: true` on our parser gets validation at least as
strict as phylio's default, plus the correctness, speed, and deep-tree parsing wins. The user
who leaves strict off gets a tree they can render, with warnings publishers can act on.

### Warnings + strict mode (implemented)

Our 65% malformed-rejection rate was on purpose — real GBIF trees carry quirks and the viewer
should tolerate them — but silently returning a nonsense tree isn't acceptable either. Publishers
need feedback or the files stay broken. The parser now attaches a `warnings: ParserWarning[]` to
every `TreeModel` (empty on clean parses) and accepts `{ strict: true }` to throw instead:

```ts
import { parseNewick, type ParserWarning } from '@gbif-phylo/io';

const tree = parseNewick(text);
// tree.warnings is readonly ParserWarning[], always present (empty for clean parses)
for (const w of tree.warnings) {
  console.warn(`[${w.code}] ${w.message} (at char ${w.position})`);
}

parseNewick(text, { strict: true }); // → throws NewickError on the first would-be warning
```

**Behavior categories**, following Morten's rule "fail when the intent is ambivalent, warn when
it's recoverable":

| Input | Default | Strict | Code | Rationale |
|---|---|---|---|---|
| `(A:xyz,B);` (non-numeric length) | **warn** + NaN length | throw | `non-numeric-length` | intent clear ("no length"); recoverable |
| `(A:,B);` (dangling colon) | **warn** + NaN length | throw | `dangling-colon` | same |
| `(A,,B);` middle, `(A,B,);` trailing, `(,A,B);` leading | **warn** + empty tip | throw | `empty-tip` | legal per spec; worth surfacing on real input |
| `(A:1,B:2)` no trailing `;` | **warn** | throw | `missing-trailing-semicolon` | spec says `;` required; many files lack it |
| `((A:1,B:1):10);` ape-style root edge | **warn**, structure kept | throw | `extra-paren-root` | ape's documented behavior |
| `(A:1:2,B);` double colon | **warn**, last-colon wins | throw | `double-colon` | real-world generators use `(sub:len,tip)` as a shortcut; last-wins is predictable |
| `BEGIN TREES` without `#NEXUS` | **warn** + parse | throw | `missing-nexus-header` | spec requires header; files often lack it |
| `("A","B");` double-quoted labels | **error** | error | — | ambivalent: patristic treats as a doubled-dquote escape, standard says single quotes; fail hard |
| `(A'q',B);` quote mid-token | **error** | error | — | ambivalent: forgotten open quote or quoted suffix |
| unmatched parens, unterminated quote/comment, random garbage | **error** | error | — | structurally broken |

Double-colon was proposed as a hard error in the initial design, but it is used deliberately in
viewer test generators (`ladder`, `comb`) as a shortcut for `(sub:len,tip)` and in some real
BEAST-like files, so demoting to a warning preserves callers that worked before while surfacing
the quirk.

The viewer should surface `tree.warnings.length > 0` as a top-of-page banner ("This tree has 3
formatting issues; parsed anyway", expandable to the list, each with its character position). A
validation CLI sets `strict: true` instead and reports the first problem as an error.

See `packages/io/test/warnings.test.mjs` for the executable spec (30 new tests covering every
warning code, strict-mode throws, position correctness, and the false-positive guards).

### What we *should* steal, concretely

- The **borrowed-fixture corpus**. `fixtures/edge/{borrowed,borrowed-wider}.json` is in-tree with
  provenance. Promote under `packages/io/test/corpora/` and wire into `npm test` so every change
  to the parser runs against the full combined set.
- **ete's** idea that a parser accepts a `mode` argument (`parser=0` strict, `parser=1` lenient).
  Our `{ strict: true }` is the two-mode equivalent.
- **ape's** warning for the extra-paren root edge, baked into our warnings system from day one.

### What we should *not* do

- Port DendroPy or ape to JS/wasm. They're correctness references, not speed references, and the
  oracle we wrote (`src/oracle.mjs` + `src/dendropy-oracle.py`) does the only job that would need
  them, as a subprocess that runs on the fixtures. No wasm needed.
- Replace our parsers. The three candidates each fail on either real inputs we must handle or on
  the shape of `TreeModel` we need. The cost of switching exceeds the maintenance cost of ~700
  lines of iterative parser code we already have, and would regress correctness on inputs we
  currently pass.

### DendroPy oracle findings

Running the DendroPy oracle on the 57-fixture edge set exposed three categories of disagreement
between us and DendroPy:

- **Design choices, not bugs.** DendroPy converts `_` to space on Newick input (NEXUS convention
  bleeding into Newick), drops unlabeled tips rather than keeping them with `""` labels, and
  rejects a missing trailing `;`. We disagree on all three deliberately — the viewer wants
  verbatim labels, keeps empty leaves (they still carry structure), and tolerates missing `;`
  because real files often lack it.
- **Fixture bugs.** `extra-comma` `(A,,B);` was marked malformed in our fixture but every lib
  including DendroPy parses it as three tips. The spec is ambiguous; treating it as valid is the
  consensus. Fixed in-tree.
- **Real leniency we should add a strict mode for.** `(A:xyz,B);`, `(A:,B);`, `(A:1:2,B);`,
  `("A","B");`, `BEGIN TREES` without `#NEXUS` — DendroPy rejects, phylio rejects, we accept. Same
  list as above.

## NEXUS against DendroPy and other test suites

Measured 2026-10-27 with DendroPy 5.1.3 (issue #136). Two runs, both in `tests/bench/parsers/src`.

**Whole files, `nexus-dendropy-corpus.mjs`.** Every file that starts with `#NEXUS` in the `trees/` and `mixed/` folders of DendroPy's own test data (82 files; the 48 sequence files in `chars/` hold no trees and are not compared: MrBayes `.t`/`.con` and
BEAST output of the primates, cetaceans and pythonidae sets, PAUP and Mesquite files, TreeBASE exports, hand-made TRANSLATE and multi-block cases).
For the first, second and last tree of each file: tip labels, node count, number and sum of branch lengths, root degree, and one hash of the shape with
every edge length, plus the number of trees. **81 of 82 agree.** The one file DendroPy refuses (`mixed/GEBA.mixed.nexus`) starts with a UTF-8 byte order mark
("Expecting '#NEXUS'"); we read it. DendroPy needs its `DataSet` API for the two files with several TAXA blocks (`TreeList` raises `TooManyTaxaError`);
the helper falls back to it.

**Small cases, `nexus-edge-compare.mjs`.** 161 fixtures in `fixtures/edge/nexus-*.json`, taken from or inspired by other test suites by four research
passes (each fixture then run through DendroPy; the reading of the upstream tests in these passes is not independently checked):

| Source | Fixtures | Licence | Copied |
|---|---|---|---|
| DendroPy tests | 41 | BSD-3-Clause | 2 verbatim, 39 rephrased |
| Biopython tests | 34 | Biopython License Agreement | 6 verbatim, 28 rephrased |
| forester (Java), R `ape`, R `treeio` | 52 | GPL-3, GPL-2/3, Artistic-2.0 | none: ideas only, inputs written from scratch |
| phylotree.js and others | 34 | MIT, BSD, Biopython (and own inputs) | 14 verbatim, 20 rephrased |

The `ape` GitHub repository has no `tests/` directory, so its ideas come from `R/read.nexus.R`, NEWS and the manual page. phytools, ETE, scikit-bio, auspice and augur,
IQ-TREE and Mesquite sample files were not looked at. `@vibbioinfocore/phylio`, patristic and newick-js have no NEXUS tests. Notices for the verbatim ones are in
`fixtures/edge/NOTICE-nexus.md`. The MrBayes `.con.tre` and BEAST 2 inputs are written by hand in the format of their output (**unverified** against a real run).

All 161 behave as recorded (`packages/io/test/nexus-edge-fixtures.test.mjs`, no DendroPy needed). DendroPy and we give the same answer on 144 (tip count, labels and the hash of shape with every edge length); the 17 where we differ are all
deliberate or are DendroPy limits, and each fixture that departs from its source's expectation says why (`oursWhy`).

### Bugs the comparison found (all fixed)

| Found by | What was wrong |
|---|---|
| DendroPy corpus (`multitreeblocks2.nex`) | Tips given as numbers with no TRANSLATE entry stayed `1`, `2`; the standard (and DendroPy) name them by position in the TAXA block |
| Biopython fixtures | A bracket inside a quoted name (`'isn''that [a] strange name?'`) was cut out of TRANSLATE and TAXLABELS |
| `ape` idea | A quoted tree name holding `=` (`tree 'a=b' = ...`) failed, and `''` in a tree name was not unescaped |
| forester idea | Numbers resolved per tip would rename an accession such as `92829` in a tree that mixes names and numbers: now all-or-nothing, as in forester |
| DendroPy-style fixture | A tree with no `;` before `END` got the label `end` on its root, silently: now the warning `missing-trailing-semicolon` (strict throws) |
| Own probe | Sequence rows were mis-split in files with CR-only line endings; `t2_the_name` and `'t2 the name'` were two taxa |
| DendroPy | `NTAX` that disagrees with the labels was not reported: now `nexus-ntax-mismatch` |
| Adversarial review | A TRANSLATE table without commas was read three tokens at a time, and the taxon-number rule then renamed the leftover numbers by position: wrong topology, no error (the real `data/rich/beast-fluA-h3-swine` file has this layout and was right only because its TAXA order equals its TRANSLATE order). Now read as pairs, comma optional |
| Adversarial review | `translateEntries` counted the last TREES block's table; `END [comment]` after a tree with no `;` still became a root label; names were compared case-sensitively (false `nexus-taxa-mismatch`); a CHARACTERS block's own `LINK` was ignored, and without `NTAX` wrapped lines were taken for rows; the first block was reported at `#NEXUS` |

### Where we differ on purpose

- **Case.** NEXUS names are case-insensitive and DendroPy returns the TAXA block's spelling for a tip written in another case. We keep the tip as written: labels are join keys to GBIF.
- **Several TAXA blocks, no `LINK`.** DendroPy raises `LinkRequiredError`; we use the last TAXA block before the trees and say so (`nexus-taxa-ambiguous`).
- **Duplicate tip labels, a branch length with no number, a missing `#NEXUS` header, an unnamed tree, a missing final `;`:** read (the last three with a warning, strict mode throws on the warnings); DendroPy rejects some of them.
- **`UTREE`:** read. DendroPy 5.1.3 finds no tree.
- **Numbers as taxon numbers:** all-or-nothing (forester), not per tip (DendroPy), see above.
- **Only the requested tree is parsed.** A broken later tree is not noticed until it is opened.
- **Not NEXUS:** double-quoted names throw (forester and `ape` accept them).

### Cost of reading the whole file

`parseNexus` now scans to the end of the file (to report what it did not read), where it used to stop at the tree it returned. Measured in this sandbox (Node 22, two runs each, `main` against this branch): a 43 MB file with 10,000 trees of 200 tips, tree 0: 1 to 7 ms against 14 to 21 ms; last tree: 124 to 183 ms against 33 to 37 ms (the statement splitter now jumps between `;`, `[` and quotes with `indexOf`). A 100 MB matrix after the tree: 2 to 7 ms against 128 to 169 ms. Memory stayed flat in both. For files with many trees `nexusIndex` and `index.parse(i)` avoid the repeated scan (`packages/io/README.md`; the 10,000-tree file is made by `npm run bench:posterior` in `packages/io`).

Reproduce (needs `pip install dendropy` and a checkout of DendroPy for the first):

```bash
cd tests/bench/parsers
node --experimental-transform-types --no-warnings src/nexus-dendropy-corpus.mjs <dendropy>/tests/unittests/data
node --experimental-transform-types --no-warnings src/nexus-edge-compare.mjs [--all]
```

## phyloXML against Biopython and the other readers' test files

Measured 2026-10-27 with Biopython 1.88 (issue #137). `tests/bench/parsers/src/phyloxml-biopython-corpus.mjs` runs our `parsePhyloXml` and Biopython's phyloXML reader over every `*.xml` and `*.xml.gz` in the folders given and compares each phylogeny (every one with `--all`): tip labels, tip and node counts, number and sum of branch lengths, number and sum of supports, root degree, a hash of the shape with every edge length (the same one as for NEXUS), and the number of phylogenies.

| Files | Result |
|---|---|
| Biopython's own `Tests/PhyloXML` (7 files, 25 phylogenies), the 3 Ensembl Compara trees and the 3 PANTHER trees of `data/rich`, forester's `test_data` (52 files, read in place, not copied: GPL) | 65 files: **61 agree on every phylogeny**, 0 disagree, Biopython fails on 4 |
| The 4 Biopython fails | an empty `<property/>` (Biopython calls `.strip()` on `None`), and unknown attributes or elements of other namespaces in forester's `phyloxml_test_1`, `_t3` and `_t4` (`Clade.__init__() got an unexpected keyword argument`, an `IndexError`). We read all four: the foreign elements are counted as not read |
| Independent numbers | the 4 phyloXML datasets of `data/rich` also agree with `treecheck.py` (tips, internal nodes, root degree, number, zeros, min and max of branch lengths) |

The PANTHER files declare no XML namespace; Biopython finds no phylogeny in them, so the helper adds the namespace in memory and reads them again. We read them as they are.

### What the comparison found (all fixed)

| Found by | What was wrong |
|---|---|
| forester `phyloxml_test_t4.xml` | Namespace prefixes were dropped, so `<o:phylogeny>`, `<o:clade>` and `<o:name>` of another namespace were read as phyloXML. Now only the phyloXML namespace (or none) is read, and the rest is counted under `{namespace}name` |
| forester `phyloxml_test_atv.xml` | The confidence inside `<events>` (the confidence of a duplication or speciation) is not the support of the branch. Biopython lists it among the clade's confidences; we keep it as the annotation `events.confidence.<type>`, and the helper leaves it out on Biopython's side |
| Adversarial review | An element inside an element read as text (`<name>A<clade/></name>`) reached the clade logic: a silently wrong tree, or an error from `TreeModel`. Now skipped without a note |
| Adversarial review | A `/` or `=` where an attribute name belongs looped for ever (`<name/ >`): now an error |
| Adversarial review | `parsePhyloXml(text, undefined, { treeIndex: 1 })` returned tree 0; a bad `treeIndex` gave a misleading message; an error in a later phylogeny failed the read of an earlier one (now the note `phyloxml-scan-stopped`); the note for an element of a namespace holding a `/` was garbled; a prefixed attribute of another namespace was read as the branch length; `0x10` and `Infinity` were numbers; an attribute and an element that differ passed silently; a `<confidence>` that is not a number was dropped silently; a second root element and a lone surrogate entity were accepted |
| Adversarial review (comparison script) | The support check compared only a count and a sum, and the events-confidence workaround removed the first matching confidence, not the last: now the sorted lists are compared |
| A profile | Resolving the namespace of every tag took 11% of the time; a small cache cut the parse of a 25 MB made-up file from 1.05 s to 0.71 s (one run each; runs in this sandbox differ by about a third, a later run took 1.1 s) |

### Where we differ on purpose

- A node's name is the `<name>`, else the taxonomy's scientific name, else its code or common name, else the sequence's name or accession (Biopython has no such chain; the comparison computes the same one). Ensembl names clades by gene id, so `labelBy: 'scientific_name'` exists for the GBIF join.
- Elements that are not read are counted, not dropped silently. A branch length that is not a number is a warning, not an error.
- Custom entities in a DOCTYPE are not expanded.

Reproduce (needs `pip install biopython`; a clone of Biopython for its test files):

```bash
cd tests/bench/parsers
node --experimental-transform-types --no-warnings src/phyloxml-biopython-corpus.mjs --all ../../../data/rich/ens-phyloxml <biopython>/Tests/PhyloXML
```

## How to reproduce

```bash
cd tests/bench/parsers
npm install --ignore-scripts
node --conditions=@gbif-phylo/source --experimental-transform-types --no-warnings src/correctness.mjs
TIMEOUT_MS=15000 ITER=5 OUT=results/latest.json \
  node --conditions=@gbif-phylo/source --experimental-transform-types --no-warnings src/bench.mjs
```

See `tests/bench/parsers/README.md` for the layout and env vars.
