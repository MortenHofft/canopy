# Dated fish phylogeny (Carangaria BEAST MCC), 135 tips

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `Carangaria-MCC.tre` (111429 bytes, sha256 `d6ab0bfd01081964...`)

## What extra data it carries

BEAST MCC tree with node-height annotations (height, height_95%_HPD, ...); NEXUS TAXA block + TRANSLATE table

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `Carangaria-MCC.tre` (nexus; 1 tree(s) in file)
- Tips: 135; internal nodes: 134; labelled internal nodes: 0; polytomies (non-root): 0; root children: 2
- Branch lengths: n=268 min 0.9754 max 105.4 med 9.082 max/med 11.6; zero 0 neg 0 missing 0; ultrametric
- Kind: dated, ultrametric; units: million years (Ma; unverified)
- Where the lengths live: Newick `:length` plus BEAST comments
- Annotation keys found in comments: `height`, `height_95%_HPD`, `height_median`, `height_range`, `length`, `length_95%_HPD`, `length_median`, `length_range`, `posterior`, `rate`

## Linking tips to metadata

tip labels are order/id-prefixed species names (e.g. `O066_Trachurus_lathami`, `Eupercaria_Gasterosteus_aculeatus`); strip the leading order or O### token to get a binomial

## Quirks

Mixed prefix conventions in tip labels. Fully bifurcating, strictly ultrametric.

## GBIF match

Not computed for this dataset (tips are not plain species names or the dataset is a sibling of one that was computed).

## Provenance

- Source: https://zenodo.org/records/4944999 (doi:10.5061/dryad.9bq5n41)
- Licence: CC0 1.0 (Zenodo record metadata license "cc-zero"; Dryad mirror)
- Citation: Ribeiro ED, Davis AM, Rivero-Vega RA, Ortí G, Betancur-R R (2018) Post-Cretaceous bursts of evolution along the benthic-pelagic axis in marine fishes. Proc R Soc B 285:20182010, doi:10.1098/rspb.2018.2010 (author list beyond first four not verified); data doi:10.5061/dryad.9bq5n41
- How obtained: curl of https://zenodo.org/api/records/4944999/files/Carangaria-MCC.tre/content
