# NEXUS reader: ideas from other implementations

Written 2026-10-27 for issue #136. Three read-only passes (delegated to agents) went through the **implementation** (not the tests) of other NEXUS readers, looking for design ideas for `parseNexus` in `packages/io/src/newick.ts`. This note keeps what is worth deciding on. Where I ran something on our parser myself it says **verified**; everything else is the agents' reading of the code and is **unverified** until someone checks it against the source.

**Licences.** Most of what was read is copyleft. Ideas only: nothing was copied, and nothing from these projects may be pasted into our code.

| Project | What was read | Licence |
|---|---|---|
| DendroPy | `nexusreader.py`, `nexusprocessing.py`, `tokenizer.py`, tree yielders | BSD-3-Clause |
| Biopython 1.88 | `Bio/Nexus/Nexus.py`, `Trees.py`, `Bio/Phylo/NexusIO.py` | Biopython License Agreement |
| python-nexus 2.9.0 | `reader.py`, `handlers/tree.py` | BSD-2 |
| JEBL (jebl2) | `NexusImporter` and tokenizer | LGPL |
| BEAST 1 and BEAST 2 | `NexusImporter`, `TreeImporter`, `NexusParser`, `TreeParser` | LGPL |
| forester | `NexusPhylogeniesParser` | GPL-3 |
| FigTree | NEXUS tree import | GPL-2+ (from a source-file header; no top-level licence file seen) |
| ape, treeio | `read.nexus.R`, `read.nexus.data.R`, `beast.R` | GPL, Artistic-2.0 |
| phylotree.js, @gmod/newick, nexwick (Rust), rapidtrees (Rust) | NEXUS and BEAST parsing | MIT, MIT/Apache |
| IcyTree, gotree | NEXUS tree import | GPL-3, GPL-2 |

Not read: MrBayes and Mesquite sources, phytools, treebender, ete4, scikit-bio, BEAST 2 TreeAnnotator, forester's character-matrix parsers. Nothing was run from these projects.

## Where we are already ahead (agents' reading)

- Every reader found splits the text with a line grep, a regex, or a character-by-character tokenizer, including inside blocks they skip. Our `nexusStatements` jumps between `;`, `[` and `'` with `indexOf` and respects quotes and comments. Several of them break on a `;` inside a quote or comment, strip all whitespace from the tree (which breaks quoted names with spaces), do not nest comments, or recurse (Biopython's tree parse, IcyTree and nexwick overflow on deep trees).
- JEBL, BEAST 1 and BEAST 2 do not honour `LINK` (TITLE is used only to spot duplicates). None of them has a list of what was ignored; they throw, swallow errors or log.
- Our all-or-nothing rule for taxon numbers is forester's (`tipsAreTaxlabelsIndices`); DendroPy, ape and nexwick resolve per tip. We chose the safer one on purpose (see `parser-comparison.md`).

## Verified on our parser (2026-10-27)

| Probe | Result |
|---|---|
| Annotation key with `:` (BEAST 2 `blockcount.t:hi`), `%`, parentheses, `+-` | read correctly |
| Nested braces `{{57,0.08,C,T},{12,0.5,A,G}}` (TreeAnnotator) | read, each inner set kept as one string |
| Quoted value holding an apostrophe, `"Côte d'Ivoire"` | read correctly |
| Adjacent comments `[&a=1][&b=2]` | merged into one record |
| `[&…]` before the length `:` (node), after the `:` (MrBayes) and after the length (BEAST 1) | after `:` or after the length goes to the edge; before it, to the node |
| FigTree colour `!color=#-8381639` | kept as the string `#-8381639`, not decoded |
| Annotation on a TAXLABELS entry, `'A b'[&!color=#ff0000]` | **dropped silently**, no note |
| `parseNexus(text, i)` for many `i` | each call scans from the start: 2,000 tiny trees took 29 ms for 20 picks, so reading all 2,000 one by one would take about 3 s; with 10,000 trees of 200 tips (about 140 ms per call in the earlier measurement) it would be tens of minutes |

## Ideas, ranked

**A. Resumable tree iterator, and an index pass (adopt). Done 2026-10-27 (issue #140): `nexusIndex`, `index.parse(i)`, `nexusTrees`.** Seen in JEBL and BEAST 1 (`hasTree`/`importNextTree` keep the cursor and the translate/taxa state), forester (one tree pre-parsed), DendroPy (`NexusTreeDataYielder` yields each tree as parsed, but has no skip-ahead: `tree_offset` still parses everything), nexwick and rapidtrees (a counting pass, then trees kept as ranges into the buffer). Nobody has random access that survives a `;` in a quote or comment, ours would. The state of `nexusStatements` lives in a closure, so a `function* nexusTrees(text, opts)` and a `nexusIndex(text)` that returns the tree count and each tree's start and end offset (name, `STATE_n`) without parsing are small. This fixes the quadratic case above and gives a progress total and thinning. Later: chunked input (carry the unterminated tail between chunks, `TextDecoder` with `stream: true`), which no library does.

**B. Tree-level facts (adopt). Done in the same change: name, default star, rooted flag, weight and state are on each `NexusTreeInfo`; the state is read from `STATE_n` and `gen.n`, the names the real BEAST and MrBayes files in DendroPy's test data use (the MrBayes `pythonidae.mb.run*.t` files just number their trees).** Expose the raw tree name, the `*` default-tree marker (DendroPy and Biopython skip it; recording it picks the initial tree), the `[&R]`/`[&U]` rooting flag and `[&W n]` weight (we parse past them), and the MCMC state parsed from `STATE_n` names (rapidtrees; BEAST's `TreeAnnotator` takes burn-in in trees or in states). Cheap once the iterator exists.

**C. Burn-in (consider).** By count, fraction or state, plus "skip the first tree" because BEAST writes the start tree. Only after A.

**D. Error context and line numbers (adopt).** Compute line and column lazily from the offset when an error or note is built (BEAST 2 counts lines on every read). IcyTree and nexwick show about 15 characters either side of the error with a marker, which the viewer can show as is. When 10,000 trees each warn, aggregate repeated codes instead of listing them all.

**E. Annotations (adopt the gaps).** Our grammar already covers what forester's value rules and BEAST 2's key rules do (see the probes). Open: decode FigTree's signed-integer colour `#-8381639` (forester does); keep node and raw string side by side (BEAST 2 keeps the raw string next to the parsed map); notes for annotations on TAXLABELS entries instead of dropping them (forester rejoins tokens by bracket balance; FigTree writes them).

**F. Block recovery (consider).** python-nexus ends a block at the next `BEGIN` when `END` is missing; our `swallowedEnd` covers only the tree statement. Also DendroPy's fallback when a `LINK` title is not found and exactly one TAXA block exists (use it, and say so); today we report `nexus-taxa-link-unresolved` and use none.

**G. `begin figtree` block (consider).** It is only `SET key=value;` lines (bool, colour, int, double, string). Parsing it into a record would give a viewer the saved appearance; unknown commands must not throw. Today it is one `nexus-ignored-block` note.

**H. Format sniffing (adopt if the loader lacks it).** `#nexus`, else the first `tree … =`, else Newick; refuse tabular text that is not a tree (treeio's `find_newick` does this for MEGA output). DendroPy has `assume_newick_if_not_nexus`.

**I. Shared tip labels across trees (consider, measure first).** nexwick (`LeafLabelMap`) and ape (`.compressTipLabel`) store the labels once and keep an Int32 index per tip per tree, so a GBIF match runs once per file. Needs a measurement of how much memory the label strings take per tree in our model before it is worth the API change.

**J. Strict cross-checks (consider).** gotree checks every tip against TAXLABELS and the count against NTAX per tree. We report both for the returned tree; strict mode could throw.

**K. Progress and cancel (consider).** Position over length from the iterator and an `AbortSignal` honoured between trees.

**L. Writing (skip unless we write NEXUS).** DendroPy's `escape_nexus_token` quotes labels containing `_`, because `_` reads back as a space. Our `toNexus` quotes by punctuation; worth a check that `t2_the_name` survives a round trip.

## Pitfalls to avoid (seen in the others)

Stripping all whitespace from the tree string; treating one line as one tree or the first `;` as the tree's end; comments that do not nest; recursion on deep ladders; an iterator that swallows an error and stops, silently truncating the run (JEBL); rewriting tree names into identifiers (keep the raw name); one bad tree aborting the whole read (all three Python libraries; none has recovery after a bad tree).

## What is done and what is left

A and B are done (issue #140). Measured on 10,000 trees of 200 tips (43 MB, Node 22, this sandbox): index 53 ms, one tree 3 to 7 ms wherever it stands in the file, all trees through the generator 4.3 s, heap 67 MB; before, `parseNexus(text, i)` rescanned the file for every tree. Left, in the order I would take them: C (burn-in) and K (progress, cancel), which need A; D (line and column, aggregated codes); E and F; then G, H and I as separate decisions.
