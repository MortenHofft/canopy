# BEAST MCC tree, influenza B Victoria HA, 1019 tips, with location annotations

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `unified_global_vic.HA.mcc.tre.gz` (387963 bytes, sha256 `30cede97df6163dc...`)

## What extra data it carries

BEAST annotations: `location` (discrete phylogeography), `posterior`, `rate*`, `height*`, `length*` with HPD, `shapeSize`

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `unified_global_vic.HA.mcc.tre.gz` (nexus; 1 tree(s) in file)
- Tips: 1019; internal nodes: 1018; labelled internal nodes: 0; polytomies (non-root): 0; root children: 2
- Branch lengths: n=2036 min -0.2211 max 6.321 med 0.3539 max/med 17.86; zero 0 neg 23 missing 0; not ultrametric
- Kind: dated (time-scaled), heterochronous tips, not ultrametric; negative lengths present; units: years
- Where the lengths live: Newick `:length` plus BEAST comments
- Annotation keys found in comments: `height`, `height_95%_HPD`, `height_median`, `height_range`, `length`, `length_95%_HPD`, `length_median`, `length_range`, `location`, `posterior`, `rate`, `rate_95%_HPD`, `rate_median`, `rate_range`, `shapeSize`

## Linking tips to metadata

tip labels carry strain/place/date; the `location` annotation of every tip is inside the tree comment, no separate table

## Quirks

23 negative branch lengths (MCC node heights), heterochronous tips, large HPD annotation volume per node (file is 1.2 MB plain).

## GBIF match

Not computed for this dataset (tips are not plain species names; for Ensembl gene trees see the species list in members.tsv and the match rate of ens-ncrna-399, whose sample is its 101 species).

## Provenance

- Source: https://zenodo.org/records/4984136 (mcc-trees.zip member unified_global_vic.HA.mcc.tre; doi:10.5061/dryad.s1d37)
- Licence: CC0 1.0 (Zenodo record metadata license "cc-zero"; Dryad mirror)
- Citation: Langat P, Raghwani J, Dudas G, Bowden TA, Edwards S, Gall A, et al. (2017/2018) Genome-wide evolutionary dynamics of influenza B viruses on a global scale. Dryad doi:10.5061/dryad.s1d37 (PLoS Pathog reference UNVERIFIED from memory)
- How obtained: curl of https://zenodo.org/api/records/4984136/files/mcc-trees.zip/content (3.7 MB); one member read in memory with Python zipfile (the __MACOSX members were ignored).
