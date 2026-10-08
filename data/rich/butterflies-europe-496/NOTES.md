# Dated phylogeny of European butterflies, 496 species

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `Butterflies_Europe_phylogeny_dated.nwk.txt` (21797 bytes, sha256 `98bf3f88cefef580...`)
- `gbif_match_sample.tsv` (21383 bytes, sha256 `4e96f4a312207f7c...`)

## What extra data it carries

Time-calibrated species tree; the same Zenodo record has trait/climatic-risk tables only as XLSX (not copied)

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `Butterflies_Europe_phylogeny_dated.nwk.txt` (newick; 1 tree(s) in file)
- Tips: 496; internal nodes: 495; labelled internal nodes: 0; polytomies (non-root): 0; root children: 2
- Branch lengths: n=990 min 0.04334 max 87.88 med 2.725 max/med 32.26; zero 0 neg 0 missing 0; ultrametric
- Kind: dated, ultrametric; units: million years (Ma; unverified)
- Where the lengths live: Newick `:length`

## Linking tips to metadata

tip label = Genus_species (European species); matches GBIF

## Quirks

File has a .txt extension; plain Newick; strictly bifurcating, ultrametric.

## GBIF match (sample)

Evenly spaced sample of 200 tip names against `https://api.gbif.org/v1/species/match` (underscores to spaces, `_ott<id>` removed), occurrence counts from `/v1/occurrence/search?taxonKey=..&limit=0`, run on 2026-10-08. Sample table: `gbif_match_sample.tsv`.

- matched (EXACT or FUZZY): 196 of 200 = 0.98
- EXACT at rank SPECIES: 193 of 200 = 0.965
- median occurrence count of matched names: 7667.5; matched names with zero occurrences: 0

## Provenance

- Source: https://zenodo.org/records/12802644 (doi:10.5281/zenodo.12802644)
- Licence: CC-BY 4.0 (Zenodo record metadata license "cc-by-4.0") (README states CC-BY)
- Citation: Gianuca AT, Schweiger O, Bini LM, Wiemers M, di Cavalcanti VR, Diniz-Filho JA, WallisDeVries MF, Zimmermann NE, Settele J (2024) Disentangling the influence of phylogeny and traits on climatic risk of European butterflies. Glob Ecol Biogeogr; tree from Wiemers M et al. (2020) ZooKeys 938:97-124, doi:10.3897/zookeys.938.50878
- How obtained: curl of https://zenodo.org/api/records/12802644/files/Butterflies_Europe_phylogeny_dated.nwk.txt/content
