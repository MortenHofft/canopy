# 100 posterior trees of North American birds (BirdTree subsample), 380 tips each

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `output2.nex.gz` (601687 bytes, sha256 `27773da491bd8ecc...`)
- `gbif_match_sample.tsv` (22055 bytes, sha256 `89b7b40f25938b7e...`)

## What extra data it carries

100 trees (tree_0000 ...), each with the same 380 species; header comments cite Jetz et al. 2012. Good for a multi-tree selector or tree-set tests

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `output2.nex.gz` (nexus; 100 tree(s) in file)
- Tips: 380; internal nodes: 379; labelled internal nodes: 0; polytomies (non-root): 0; root children: 2
- Branch lengths: n=758 min 0.0001282 max 73.22 med 4.27 max/med 17.15; zero 0 neg 0 missing 0; ultrametric
- Kind: dated, ultrametric (100 trees; stats are for tree 0); units: million years
- Where the lengths live: Newick `:length`

## Linking tips to metadata

tip label = Genus_species; the same record (CC-BY part, doi 10.5061/dryad.j0zpc86mg) also holds trait CSVs (not copied)

## Quirks

Multiple trees in one TREES block without TRANSLATE; branch lengths differ across trees; ultrametric.

## GBIF match (sample)

Evenly spaced sample of 200 tip names against `https://api.gbif.org/v1/species/match` (underscores to spaces, `_ott<id>` removed), occurrence counts from `/v1/occurrence/search?taxonKey=..&limit=0`, run on 2026-10-08. Sample table: `gbif_match_sample.tsv`.

- matched (EXACT or FUZZY): 200 of 200 = 1.0
- EXACT at rank SPECIES: 200 of 200 = 1.0
- median occurrence count of matched names: 1129250.5; matched names with zero occurrences: 0

## Provenance

- Source: https://zenodo.org/records/8328753 (doi:10.5061/dryad.j0zpc86mg; file output2.nex)
- Licence: CC0 1.0 (Zenodo record metadata license "cc-zero"; Dryad mirror)
- Citation: Stevens H. Data from: Species-specific ecological traits, phylogeny, and geography underpin vulnerability to population declines for North American birds. Dryad doi:10.5061/dryad.j0zpc86mg; trees from Jetz W et al. (2012) The global diversity of birds in space and time. Nature 491:444-448, doi:10.1038/nature11631 (as stated in the file header)
- How obtained: curl of https://zenodo.org/api/records/8328753/files/output2.nex/content
