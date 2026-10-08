# BEAST MCC tree, hepatitis C 2k/1b with discrete phylogeography, 109 tips

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `2k1b_fullGenome_9GTR1clock_COO_BSSVSMJ.MCC.tree.gz` (39406 bytes, sha256 `201c47ad895e409f...`)

## What extra data it carries

BEAST [&...] annotations incl. discrete trait `COO` (country of origin) with `COO.prob`, `COO.set`, `COO.set.prob`, `COO.rate*`, height/length HPDs (BSSVS + Markov jumps run) = geography on every node

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `2k1b_fullGenome_9GTR1clock_COO_BSSVSMJ.MCC.tree.gz` (nexus; 1 tree(s) in file)
- Tips: 109; internal nodes: 108; labelled internal nodes: 0; polytomies (non-root): 0; root children: 2
- Branch lengths: n=216 min -0.8048 max 62.26 med 19.23 max/med 3.237; zero 0 neg 1 missing 0; not ultrametric
- Kind: dated (time-scaled), heterochronous tips, not ultrametric; units: years
- Where the lengths live: Newick `:length` plus BEAST comments (height, length, *_95%_HPD)
- Annotation keys found in comments: `COO`, `COO.prob`, `COO.rate`, `COO.rate_95%_HPD`, `COO.rate_median`, `COO.rate_range`, `COO.set`, `COO.set.prob`, `height`, `height_95%_HPD`, `height_median`, `height_range`, `length`, `length_95%_HPD`, `length_median`, `length_range`, `posterior`

## Linking tips to metadata

tip labels encode lineage_place_accession_year (e.g. `2k1b_Austria_wg_S3_KY780123_2013`); no separate metadata file; the year at the end is the sampling date

## Quirks

Contains one NEGATIVE branch length (-0.80; likely an artefact of summarising node heights on heterochronous data, cause unverified), `[&R]` rooted flag, a trailing `begin figtree` block, TAXA block without TRANSLATE (labels written in full in the tree).

## GBIF match

Not computed for this dataset (tips are not plain species names; for Ensembl gene trees see the species list in members.tsv and the match rate of ens-ncrna-399, whose sample is its 101 species).

## Provenance

- Source: https://zenodo.org/records/4970094 (doi:10.5061/dryad.v8j2vk5)
- Licence: CC0 1.0 (Zenodo record metadata license "cc-zero"; Dryad mirror)
- Citation: Hostager R, Raggonet-Cronin M, Murrell B, Hedskog C et al. (2019) Data from: Hepatitis C virus genotype 1 and 2 recombinant genomes and the phylogeographic history of the 2k/1b lineage. Dryad, doi:10.5061/dryad.v8j2vk5 (journal reference not verified)
- How obtained: curl of https://zenodo.org/api/records/4970094/files/2k1b_fullGenome_9GTR1clock_COO_BSSVSMJ.MCC.tree/content
