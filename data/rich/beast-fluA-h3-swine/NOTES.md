# BEAST MCC tree, swine/human H3N2 influenza A (ggtree example), 76 tips, genotype matrix

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `MCC_FluA_H3.tree` (81834 bytes, sha256 `5bd13498b0c95928...`)
- `Genotype.txt` (5311 bytes, sha256 `03f749e6564eddb9...`)
- `NAG_inHA1.txt` (2293 bytes, sha256 `6889865821612a4e...`)
- `sites.txt` (315 bytes, sha256 `ee384932ca863497...`)

## What extra data it carries

BEAST annotations in [&...] comments: height, height_95%_HPD, height_median, height_range, length*, posterior, rate*. Genotype.txt: per-tip lineage origin for each of 8 gene segments (PB2 PB1 PA HA NP NA M NS; values trig, pdm, HuH3N2...) = presence/category matrix for aligned columns. NAG_inHA1.txt: number of N-glycosylation sites in HA1 for each of the 76 tips AND for 75 internal nodes (rows keyed by integer node numbers 77-151, i.e. ancestral-state values). sites.txt: 82 HA1 site positions

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `MCC_FluA_H3.tree` (nexus; 1 tree(s) in file)
- Tips: 76; internal nodes: 75; labelled internal nodes: 0; polytomies (non-root): 0; root children: 2
- Branch lengths: n=150 min 0.04157 max 3.499 med 0.6166 max/med 5.675; zero 0 neg 0 missing 0; not ultrametric
- Kind: dated (time-scaled, BEAST MCC), heterochronous tips, so NOT ultrametric; units: years
- Where the lengths live: Newick `:length` plus BEAST comments `[&height=..,height_95%_HPD={..},length=..,rate=..,posterior=..]`
- Annotation keys found in comments: `height`, `height_95%_HPD`, `height_median`, `height_range`, `length`, `length_95%_HPD`, `length_median`, `length_range`, `posterior`, `rate`, `rate_95%_HPD`, `rate_median`, `rate_range`

## Linking tips to metadata

Genotype.txt (header row, then one row per tip) and NAG_inHA1.txt (no header) are keyed by the tip label in column 1; all 76 tips of the tree match both files exactly (verified). The Nexus writes tips as TRANSLATE numbers (1..76) that map to strain names; the NAG internal-node keys are the BEAST/ggtree node numbers (77-151, not present in the Newick text; unverified how they map)

## Quirks

Time-scaled in years (heterochronous tips: root-to-tip distances differ). Tip labels contain slashes and underscores. Genotype.txt has a header row with one fewer field than the data rows (row names are in the first column). TRANSLATE entries are separated by newlines only (no commas), which strict parsers may reject.

## GBIF match

Not computed for this dataset (tips are not plain species names or the dataset is a sibling of one that was computed).

## Provenance

- Source: https://zenodo.org/records/4997840 (doi:10.5061/dryad.v15v0)
- Licence: CC0 1.0 (Zenodo record metadata license "cc-zero"; Dryad mirror)
- Citation: Yu G, Smith DK, Zhu H, Guan Y, Lam TT-Y (2017) ggtree: an R package for visualization and annotation of phylogenetic trees with their covariates and other associated data. Methods Ecol Evol 8:28-36 (paper reference UNVERIFIED from memory); data: Dryad doi:10.5061/dryad.v15v0
- How obtained: curl of https://zenodo.org/api/records/4997840/files/MCC_FluA_H3.tree/content and the three text files from the same record.
