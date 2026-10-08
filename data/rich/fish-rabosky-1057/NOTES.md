# Dated ray-finned fish phylogeny (Rabosky subset), 1057 tips

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `Rabosky1057.tre` (50286 bytes, sha256 `c7b7ab2fd13c0b3d...`)
- `gbif_match_sample.tsv` (23375 bytes, sha256 `094bdc00d277fc21...`)

## What extra data it carries

Plain Newick with dated branch lengths; species tips only

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `Rabosky1057.tre` (newick; 1 tree(s) in file)
- Tips: 1057; internal nodes: 1056; labelled internal nodes: 0; polytomies (non-root): 0; root children: 2
- Branch lengths: n=2112 min 0.001771 max 57.99 med 2.633 max/med 22.03; zero 0 neg 0 missing 0; ultrametric
- Kind: dated, ultrametric; units: million years (Ma; unverified)
- Where the lengths live: Newick `:length`

## Linking tips to metadata

tip label = Genus_species; no metadata table

## Quirks

No internal labels, strictly bifurcating. Good GBIF-matching test.

## GBIF match (sample)

Evenly spaced sample of 200 tip names against `https://api.gbif.org/v1/species/match` (underscores to spaces, `_ott<id>` removed), occurrence counts from `/v1/occurrence/search?taxonKey=..&limit=0`, run on 2026-10-08. Sample table: `gbif_match_sample.tsv`.

- matched (EXACT or FUZZY): 200 of 200 = 1.0
- EXACT at rank SPECIES: 199 of 200 = 0.995
- median occurrence count of matched names: 138.0; matched names with zero occurrences: 4

## Provenance

- Source: https://zenodo.org/records/4944999 (doi:10.5061/dryad.9bq5n41)
- Licence: CC0 1.0 (Zenodo record metadata license "cc-zero"; Dryad mirror)
- Citation: Ribeiro ED et al. (2018) Proc R Soc B 285:20182010 (data deposit); the tree is a subset of Rabosky et al. 2018 Nature 559:392 (UNVERIFIED provenance statement)
- How obtained: curl of https://zenodo.org/api/records/4944999/files/Rabosky1057.tre/content (Zenodo returned a transient TLS error once; retried).
