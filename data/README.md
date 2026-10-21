# Test trees

Trees for benchmarking and testing tree viewers for gbif.org (the research behind them is on the `research` branch, docs/goal.md). Three collections, each with its own README, manifest and scripts. All scripts are pure Python 3 standard library and iterative (no recursion), so they survive 1M-tip and caterpillar trees.

| Folder | What | Sizes | Branch lengths | Committed |
|--------|------|-------|----------------|-----------|
| [real-ladder/](real-ladder/) | Real published trees in a size ladder: Open Tree of Life (species names, no lengths), GTDB (lengths, genome-accession tips), fish tree of life (dated; fetched by script) | 211, 888, 10k, 91k, 1.49M tips (OTL); 215 to 190k (GTDB); 200 to 11.6k (fish) | OTL: none. GTDB: yes, non-ultrametric. Fish: yes, dated | About 5 MB; the 1.49M OTL tree and the fish trees are fetched with `real-ladder/fetch.sh` |
| [rich/](rich/) | Real trees with more than tip names: aligned sequences, NHX, phyloXML, BEAST annotations, trait and GO tables, dated trees, GBIF-matchable species names, plus hand-made format edge cases | 19 to 19k tips (24 datasets) | Mostly yes (substitution-scale and dated); Open Tree sets have none | About 5.6 MB |
| [synthetic/](synthetic/) | Seeded, reproducible trees in six shapes (Yule, birth-death, balanced, caterpillar, bushy, mixed), with metadata and small alignments | 200, 1k, 10k, 100k, 1M tips | Yes, with and without variants | About 3 MB; 100k and 1M regenerate with `make large` (about 410 MB for the 1M rung) |

## Which collection for which question

- **Does it scale?** Use the synthetic 100k and 1M trees (all shapes, especially the caterpillar and the bushy tree) and the real 91k, 190k and 1.49M trees.
- **Does it handle real data?** Use the real ladder (clade-based subtrees keep realistic shape; the random samples show what random sampling does to shape).
- **Branch lengths:** dated (fish, bird, butterfly, mammal, BEAST sets), non-ultrametric (GTDB, Ensembl gene trees), none (Open Tree), and edge cases (negative, zero, missing). See the branch-length tables in each README.
- **Custom columns and alignments:** `rich/ens-*` (alignment plus members table), `rich/phylogenes-*` (GO evidence columns), `synthetic/` (metadata TSV and FASTA, with deliberately unmatched rows), `rich/mammals-4071` (trait table, only partly matching the tree).
- **Format parsing:** `rich/` has Newick, NHX, phyloXML, NEXUS with TAXA and TRANSLATE, multi-tree NEXUS, BEAST `[&...]` annotations and iTOL colour files; `rich/edge-cases/` covers quoted labels, a trifurcating root, missing, zero and negative lengths and a 20,000-tip caterpillar; the Open Tree files contain quoted labels with commas and parentheses.
- **Linking tips to GBIF:** match rates for a sample of up to 200 tips (agent-measured, 2026-10-08) are in `rich/README.md`: fish 100%, birds 100%, corvoid 100%, butterflies 98%, mammals 94.5%, ncRNA-399 97%, Open Tree Carnivora 75% and Aves 76.5% (the Open Tree figures are lower because of subspecies and OTT-style names). Occurrence counts per sampled tip are in each folder's `gbif_match_sample.tsv`.

## Things to know before using these

- **Licences differ.** Most files are CC0 or CC-BY. The GTDB files are CC BY-SA 4.0 (ShareAlike). The Open Tree CC0 statement is qualified ("where not limited by pre-existing terms of use"), and one Zenodo record lists CC-BY 1.0. The Ensembl terms page could not be read, so its wording is unverified. The fish tree of life licence is unclear, so those files are fetched, not committed. Each folder records licence and citation per file; check before redistributing outside this repo.
- **Not copied because the licence is unclear:** Nextstrain datasets, Gramene gene-tree JSON (the tbrowse format; available at data.gramene.org/v68/genetrees), forester/Archaeopteryx test data (GPL).
- **Gaps:** no real 1M-tip tree with branch lengths (the largest is GTDB, 190k); no real dated tree above about 12k tips; no GBIF dataset that already ships a tree was found; TreeBASE, TreeFam and Pfam seed alignments were not obtained (timeouts or access).
- **Tip counts need a quote-aware parser.** Real Open Tree files contain quoted labels with commas and parentheses; a naive regex count overcounts them (a quick check of mine did, until it handled quotes).
- **Checksums for synthetic files** come from CPython 3.13 on x86-64 Linux; other platforms may differ because the generator uses libm.
- **Branch-length units** for GTDB and the fish trees are assumed (substitutions per site, millions of years), not verified.
- Large downloads and generated files are git-ignored (`.cache/` and the generated synthetic files).

## Reproducing

```
cd data/real-ladder && ./fetch.sh          # fetch and verify the non-committed rungs
cd data/synthetic   && make check          # verify committed files; make small / make large regenerate
python3 data/rich/scripts/treecheck.py <file>   # parse and report tip counts
```
