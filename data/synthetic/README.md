# Synthetic benchmark trees

Reproducible trees for viewer benchmarks, covering shapes that real data may not (very deep, perfectly balanced, wide fan-out) at 200 to 1,000,000 tips. Real trees are collected elsewhere (see `../real-ladder/`); these complement them. Context: the caterpillar finding in [docs/research/custom-renderer.md](../../docs/research/custom-renderer.md) section 6.3 (clade-pixel-height level of detail fails on ladderised trees).

Everything is pure Python 3 standard library, seeded and iterative (no recursion, so a 1,000,000-deep caterpillar is fine). No Node needed.

## Quick start

```
make check         # verify committed files against manifest.json (sha256 + stats)
make small         # regenerate 200 / 1,000 / 10,000-tip files, all variants
make large         # generate 100,000 and 1,000,000-tip files (~450 MB, ~2 min), verify sha256
python3 generate.py --out /some/dir --sizes 200000 --shapes caterpillar   # ad hoc sizes work too
python3 check.py /some/dir          # independent checker (own parser, shares no code with generate.py)
```

## What is committed, what is generated

| Rung | Committed | Regenerate with |
|------|-----------|-----------------|
| 200, 1,000 tips | every shape and variant, raw `.nwk` | `make small` |
| 10,000 tips | main file of every shape as `.nwk.gz` (`gzip -9 -n`, 0.67 MB total), plus `meta/yule_10000.meta.tsv`. The 30 files of all variants would be 15.6 MB gzipped, over the 10 MB budget, so variants are generated | `make small` |
| 100,000 and 1,000,000 tips | nothing (git-ignored) | `make large` |

`manifest.json` records, for every file including the uncommitted ones: tips, internal nodes, total nodes, max depth, max degree, polytomy count, whether it has branch lengths, whether it is ultrametric, internal label kind, bytes and sha256. `make large` fails if any regenerated file differs.

## Shapes: what each is meant to stress

All trees are rooted. "Ultrametric" trees have root-to-tip height 100.

| File prefix | Shape | Stresses |
|-------------|-------|----------|
| `yule_` | Pure-birth Yule tree, ultrametric (depth about 2 ln n) | The typical random binary tree: baseline for load, layout, LOD cut size and label density. |
| `birthdeath_` | Birth-death (lambda 1, mu 0.5), stopped at n extant lineages, extinct lineages pruned, ultrametric | Realistic uneven branch lengths (long stems, bursts of short internal edges) and node-time distribution. |
| `balanced_` | Perfectly balanced binary (halves differ by at most 1), depth ceil(log2 n) | LOD cut size: a clade-height rule collapses it in bulk or not at all; best case for the cut, worst case for "every node is similar". |
| `caterpillar_` | Fully ladderised binary tree, depth n-1, tip listed first at every node, ultrametric with exponential spine splits | Depth and label overlap: recursion limits, 99,999 or 999,999 nested parentheses, and the failure of clade-pixel-height LOD (every spine clade spans many leaves, most spine edges are sub-pixel). Spine edges average 100/n units, so 44 of 100,000 and 4,994 of 1,000,000 are printed as 0.000000. |
| `bushy_` | Random polytomies, degree 2 to 20 at every internal node, depth 5 to 15 | Wide fan-out: children per node, label stacking in one rectangular slice, and parsers that assume binary trees. Ultrametric by node height (all edges are multiples of one unit). |
| `mixed_` | Yule backbone whose tips are replaced by 3 giant clades (50% of tips: two Yule, one polytomous), 6 caterpillar subtrees (about 20%) and many small Yule clades, ultrametric | Realistic heterogeneity: LOD must cope with a huge clade, deep ladders (max depth 4,975 at 100k, 43,968 at 1M) and tiny clades in one view; collapsed-clade summaries of very unequal size. |

## Variants (file name suffix)

| Suffix | Tip labels | Branch lengths | Internal node labels |
|--------|-----------|----------------|----------------------|
| (none) | `Genus_species` | yes | none |
| `_nobl` | `Genus_species` | no (topology only) | none |
| `_ids` | opaque ids (`t` plus 7 base-36 characters) | yes | none |
| `_support` | `Genus_species` | yes | support value 0 to 1, two decimals, on every internal node including the root, skewed towards 1 |
| `_nodenames` | `Genus_species` | yes | unique names `n<id>` on every internal node |

Species names come from a fixed, deterministic vocabulary (syllable-built genera, 400 epithets), unique, assigned in leaf order so that consecutive tips share a genus (a genus is 1 to 40 tips, mean about 5). A given tip count therefore has the same name list in every shape. Large rungs write only: yule all five variants, caterpillar main and `_nobl`, the other shapes main only.

## Companion files

* `meta/yule_1000.meta.tsv`, `meta/yule_10000.meta.tsv`: `tip_label`, `occurrence_count` (Pareto alpha 0.7, 8% zeros, capped at 10^8), `country_code` (24 ISO codes, Zipf weights, runs along leaf order so clades are partly country-coherent), `trait_value` (Brownian motion along the tree, plus 5). Rows are shuffled. **Deliberately imperfect, to test explicit unmatched handling:** about 2% of tips have no row (18 of 1,000) and there are 3 extra rows (`Extra_unmatched_001..003`) with no tip.
* `align/yule_200.fasta`, `align/yule_1000.fasta`: 200 columns, one line per sequence, evolved along the tree by Jukes-Cantor with four site-rate classes (0.1, 0.5, 1.0, 2.4; 0.01 substitutions per site per unit time), seeded root. About 10% of sequences get one gap run (`-`, 1 to 20 columns). The labels match the Newick tips exactly.
* `nexus/yule_200.nex`, `nexus/mixed_1000.nex` (with support values): `TAXA`, `TRANSLATE` with numeric ids, `TREES`, tree marked `[&R]`, tip labels in the tree are the numeric ids. `nexus/multi_yule_200_x10.nex`: ten different Yule trees on the same 200 taxa (tip-to-taxon assignment is randomised per tree). Unquoted underscores are kept; strict NEXUS parsers that turn `_` into a space will do so.

## Determinism

Seeds derive from a fixed base seed plus the shape and tip count (crc32 of a string), and only `random.Random.random()` is used (never `randrange`, `shuffle` or `sample`, whose output has changed between Python versions). The generator was run twice from scratch for all rungs (119 files) and the sha256 of every file was identical; the checker then verified the second run against the manifest with 0 problems. Caveats: floats go through `math.log`, `exp`, `sqrt`, `cos` of the platform libm and are printed with 6 decimals, so another platform could in principle differ in the last digit of a branch length (unverified; the manifest hashes were produced with CPython 3.13 on x86-64 Linux). Each file's sha256 is of its raw text. The `.gz` files are byte-identical when `gzip -9 -n` is the same implementation; `manifest.json` stores their hash as `gz_sha256_gzip9n` for information only.

## Verification

`check.py` re-parses every file with its own iterative tokenizer and fails on: unbalanced parentheses, duplicate tip labels, missing or partial internal labels, tip count different from the file name, support outside [0, 1], and shape expectations (binary trees have n-1 internal nodes and degree 2; balanced depth equals ceil(log2 n); caterpillar depth equals n-1; bushy has polytomies and degree at most 20; ultrametric where expected). For NEXUS it checks `TAXA`, `TRANSLATE` and every tree's tips against each other; for TSV and FASTA it checks the join against the tree. All 119 files pass.

## Generation time and size

One machine (Linux x86-64, CPython 3.13, single thread, no other heavy load during the timing run). The time is for building the topology plus writing all files of that shape and size (number of Newick files in brackets), so the Yule column includes its five variants. The size is of the main file (`Genus_species`, branch lengths, no internal labels).

| Shape | 200 | 1,000 | 10,000 | 100,000 | 1,000,000 |
|-------|-----|-------|--------|---------|-----------|
| yule | 0.02 s [5], 8 KB (3 KB gz) | 0.06 s [5], 42 KB (16 KB gz) | 0.26 s [5], 0.42 MB (0.15 MB gz) | 3.1 s [5], 4.1 MB (1.5 MB gz) | 48.5 s [5], 41.3 MB (14.5 MB gz) |
| birthdeath | 0.003 s [5], 8 KB (3 KB) | 0.02 s [5], 42 KB (16 KB) | 0.28 s [5], 0.41 MB (0.15 MB) | 1.8 s [1]*, 4.1 MB (1.5 MB) | 28.0 s [1]*, 41.3 MB (14.5 MB) |
| balanced | 0.003 s [5], 9 KB (2 KB) | 0.01 s [5], 43 KB (7 KB) | 0.15 s [5], 0.42 MB (61 KB) | 0.5 s [1], 4.1 MB (0.6 MB) | 6.2 s [1], 41.3 MB (6.0 MB) |
| caterpillar | 0.003 s [5], 8 KB (3 KB) | 0.01 s [5], 42 KB (15 KB) | 0.13 s [5], 0.42 MB (0.12 MB) | 0.6 s [2], 4.2 MB (1.1 MB) | 8.1 s [2], 42.1 MB (9.9 MB) |
| bushy | 0.002 s [5], 7 KB (2 KB) | 0.01 s [5], 36 KB (7 KB) | 0.10 s [5], 0.35 MB (60 KB) | 0.4 s [1], 3.5 MB (0.6 MB) | 4.2 s [1], 35.2 MB (5.9 MB) |
| mixed | 0.003 s [5], 8 KB (3 KB) | 0.02 s [5], 41 KB (14 KB) | 0.16 s [5], 0.41 MB (0.13 MB) | 0.8 s [1], 4.1 MB (1.2 MB) | 9.0 s [1], 40.6 MB (11.9 MB) |

\* Birth-death at 1M spends 19 s in the simulation and pruning (about 1.5 times as many lineages are simulated as survive).

Tree statistics of the main files (tips; total nodes; max depth), also in `manifest.json`:

| Shape | 10,000 | 1,000,000 |
|-------|--------|-----------|
| yule | depth 30 | 1,999,999 nodes, depth 50 |
| birthdeath | depth 35 | 1,999,999 nodes, depth 49 |
| balanced | depth 14 | 1,999,999 nodes, depth 20 |
| caterpillar | depth 9,999 | 1,999,999 nodes, depth 999,999 |
| bushy | depth 11 | 1,403,422 nodes, depth 15 |
| mixed | depth 434 | 1,940,310 nodes, depth 43,968 |

Companion generation (200 and 1,000 tip files) is under 0.1 s each. The whole 1M rung takes about 1 min 45 s and 410 MB of disk; checking it with `check.py` takes about 1 min.

## Limitations

* Synthetic trees do not have real polytomy placement, real taxonomy (the genera are invented and a genus does not correspond to a clade in non-Yule shapes) or real branch-length distributions. Use them for scale and shape stress, not for visual realism.
* The birth-death tree stops at the first moment n lineages are extant and then adds one waiting time, a simple approximation to conditioning on n extant tips.
* Mixed and caterpillar shapes are our construction, not an estimate of how real GBIF trees look. The 200,000-tip caterpillar named in the research notes is not a fixed rung; `--sizes 200000 --shapes caterpillar` makes it (about 1 s) and 100,000 / 1,000,000 bracket it.

## Polytomy demo (hand-made, not part of the generator's grid)

`newick/polytomy_demo_17000.nwk.gz` (49 KB, CC0, deterministic) is written by `make_polytomy.py` (`python3 -I make_polytomy.py`): two balanced 2,000-tip clades plus a star of 10,000 tips with equal child lengths and a star of 3,000 tips with varied child lengths (0.2 to 2.2). It exercises very wide nodes in the level-of-detail cut (issue 13). In the custom demo it is `?tree=syn-polytomy-17000&layout=radial`: zoom in on a star until its tips are a few pixels apart and it turns into one slice. It is not in `manifest.json`.
