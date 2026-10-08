# Dated mammal phylogeny (4071 tips) with colour/NIR reflectance trait table

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `mammals.tree` (137855 bytes, sha256 `75fe877c54ed0dcc...`)
- `total_dataset.csv` (83191 bytes, sha256 `699cee0e9d96a704...`)
- `gbif_match_sample.tsv` (22329 bytes, sha256 `11441c862c82e1eb...`)

## What extra data it carries

total_dataset.csv: per-species reflectance measures (B2.TOT/UV/VIS/NIR ...), class (Aves/Mammalia/...), source columns - a trait table for aligned columns (only 94 rows have class=Mammalia and 65 of those match a tree tip after lower-casing (verified); the other classes (Aves 204, Squamata 73, Aranea 36, ...) belong to other trees in the same deposit and are not in this tree)

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `mammals.tree` (newick; 1 tree(s) in file)
- Tips: 4071; internal nodes: 4070; labelled internal nodes: 0; polytomies (non-root): 0; root children: 2
- Branch lengths: n=8140 min 0.022 max 135.8 med 2.883 max/med 47.1; zero 0 neg 0 missing 0; ultrametric
- Kind: dated, ultrametric up to rounding; units: million years (Ma)
- Where the lengths live: Newick `:length`

## Linking tips to metadata

tree tip (lower-case, e.g. `isoodon_obesulus_affinis`, includes subspecies) <-> CSV `animal` (Capitalised Genus_species) after lower-casing; `treetax_initial_class` column holds the tree label spelling for some rows

## Quirks

CSV is NOT UTF-8 (Latin-1/Windows-1252 bytes such as 0xEF); tip names are lower case and include trinomials; tree is near-ultrametric to rounding (root-to-tip spread 0.006 on 202).

## GBIF match (sample)

Evenly spaced sample of 200 tip names against `https://api.gbif.org/v1/species/match` (underscores to spaces, `_ott<id>` removed), occurrence counts from `/v1/occurrence/search?taxonKey=..&limit=0`, run on 2026-10-08. Sample table: `gbif_match_sample.tsv`.

- matched (EXACT or FUZZY): 189 of 200 = 0.945
- EXACT at rank SPECIES: 171 of 200 = 0.855
- median occurrence count of matched names: 368; matched names with zero occurrences: 2

## Provenance

- Source: https://zenodo.org/records/19210896 (doi:10.5281/zenodo.19210896)
- Licence: CC-BY 4.0 (Zenodo record metadata license "cc-by-4.0")
- Citation: Goldenberg J et al. Color and near-infrared reflectance covary in distinct ways across taxa. Ecol Evol 2026, doi:10.1002/ece3.73381 (via Zenodo record text); mammal tree "from Alvarez et al. 2022" per the record description (reference not verified)
- How obtained: curl of https://zenodo.org/api/records/19210896/files/mammals.tree/content and `total_dataset.csv` from the same record.
