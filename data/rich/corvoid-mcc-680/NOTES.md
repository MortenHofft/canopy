# Dated corvoid songbird phylogeny (BEAST MCC), 680 tips

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `CC_MCC.tre.gz` (219203 bytes, sha256 `c73aa7a8b00d80b8...`)

## What extra data it carries

BEAST annotations: rate, rate_median, rate_range, height, height_95%_HPD, length, length_95%_HPD ...

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `CC_MCC.tre.gz` (nexus; 1 tree(s) in file)
- Tips: 680; internal nodes: 679; labelled internal nodes: 0; polytomies (non-root): 0; root children: 2
- Branch lengths: n=1358 min 0.03762 max 60.33 med 2.381 max/med 25.33; zero 0 neg 0 missing 0; ultrametric
- Kind: dated, ultrametric; units: million years (Ma; unverified)
- Where the lengths live: Newick `:length` plus BEAST comments
- Annotation keys found in comments: `height`, `height_95%_HPD`, `height_median`, `height_range`, `length`, `length_95%_HPD`, `length_median`, `length_range`, `posterior`, `rate`, `rate_95%_HPD`, `rate_median`, `rate_range`

## Linking tips to metadata

tip label = Genus_species (a few are genus-only, e.g. `Acanthisitta`); matches GBIF binomials

## Quirks

Per-branch rate annotations (relaxed clock) are a good colour-by-attribute test. Single-word tip labels exist.

## GBIF match

Not computed (run was not finished).

## Provenance

- Source: https://zenodo.org/records/4995552 (doi:10.5061/dryad.v0np1)
- Licence: CC0 1.0 (Zenodo record metadata license "cc-zero"; Dryad mirror)
- Citation: Jønsson KA, Fabre P-H, Kennedy JD, Holt BG et al. (2016) A supermatrix phylogeny of corvoid passerine birds (Aves: Corvides). Mol Phylogenet Evol 94:87-94, doi:10.1016/j.ympev.2015.08.020; data doi:10.5061/dryad.v0np1
- How obtained: curl of https://zenodo.org/api/records/4995552/files/CC_MCC.tre/content
