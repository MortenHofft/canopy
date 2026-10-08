# Plant NLR NB-ARC phylogeny (3816 tips) with iTOL colour annotation and sequences

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `tree_nbarc.nwk.gz` (80132 bytes, sha256 `2b84cc0887ef976e...`)
- `tree_nbarc_colour.txt.gz` (57513 bytes, sha256 `1babca453739db80...`)
- `nlr_sequences.fasta.gz` (1597912 bytes, sha256 `082c0ef2d342c6a2...`)

## What extra data it carries

Large gene-family tree; iTOL `TREE_COLORS` file (per-tip and per-branch colours, line style, width); protein sequences (unaligned) of the family members

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `tree_nbarc.nwk.gz` (newick; 1 tree(s) in file)
- Tips: 3816; internal nodes: 3815; labelled internal nodes: 0; polytomies (non-root): 0; root children: 2
- Branch lengths: n=7630 min 0 max 10 med 0.07311 max/med 136.8; zero 10 neg 0 missing 0; not ultrametric
- Kind: substitutions per site (ML gene tree), not ultrametric; units: substitutions/site
- Where the lengths live: Newick `:length`; support in `[a/b]` comments

## Linking tips to metadata

tip label (e.g. `Marpal_utg000069g0117411_0`) = colour-file first column; the FASTA ids are the labels without the trailing `_0` for 3637 of 3816 tips (verified); 3775 sequences vs 3816 tips, the rest differ in spelling and are not reconciled. The colour file has 7636 data lines (tips and branches); 3785 tip labels match the tree

## Quirks

Support values are written as bracketed comments after the length, e.g. `:0.9097[100/100]` (SH-aLRT/UFBoot style): a bracket comment that is data, not a comment; some branch lengths are 1e-6; 10 zero-length branches; max/median ratio 137.

## GBIF match

Not computed for this dataset (tips are not plain species names; for Ensembl gene trees see the species list in members.tsv and the match rate of ens-ncrna-399, whose sample is its 101 species).

## Provenance

- Source: https://zenodo.org/records/17067745 (doi:10.5281/zenodo.17067745)
- Licence: CC-BY 4.0 (Zenodo record metadata license "cc-by-4.0")
- Citation: Castel B. Sequences and phylogeny of land plant NLRs. Zenodo, doi:10.5281/zenodo.17067745 (2025)
- How obtained: curl of https://zenodo.org/api/records/17067745/files/tree_nbarc.nwk/content and the other two files of the record.
