# PhyloGenes/PANTHER family PTHR11444 (lyase), 85 tips, GO annotation matrix

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `PTHR11444.xml` (98380 bytes, sha256 `9813200b44fa4840...`)
- `PTHR11444.csv` (14149 bytes, sha256 `2bf8ebe5f03ed458...`)

## What extra data it carries

phyloXML with tip `taxonomy`, UniProt `sequence/accession`, internal `events` (speciation/duplication; polytomies); CSV is a per-tip table: Uniprot ID, gene, gene id, gene name, organism, PANTHER subfamily name, then one column per GO term with 0 / EXP / IBA (experimental vs inferred annotation), i.e. a presence/absence + evidence matrix for aligned columns

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `PTHR11444.xml` (phyloxml; 1 tree(s) in file)
- Tips: 85; internal nodes: 69; labelled internal nodes: 0; polytomies (non-root): 8; root children: 2
- Branch lengths: n=153 min 0 max 2 med 0.032 max/med 62.5; zero 5 neg 0 missing 0; not ultrametric
- Kind: relative divergence (PANTHER tree, not ultrametric; branch lengths appear capped at 2.0, unverified); units: unknown (PANTHER branch length)
- Where the lengths live: phyloXML `<branch_length>` child element of <clade>

## Linking tips to metadata

phyloXML `<sequence><accession>` (UniProt) = CSV `Uniprot ID` (100% of tips); `<name>` is a gene id that matches CSV `Gene ID` for most tips only; organism = `<taxonomy><scientific_name>` = CSV `Organism` (binomials, real species)

## Quirks

Tree is a rooted phyloXML without namespace declaration (plain <phyloxml>); branch_length are child elements <branch_length>, not attributes. Max branch length 2.0 (capped, so max/median is partly a cap artefact: unverified). Polytomies in speciation nodes. Mixed model organisms and plants; some `name` values contain "=" (e.g. MGI=95530).

## GBIF match

Not computed for this dataset (tips are not plain species names; for Ensembl gene trees see the species list in members.tsv and the match rate of ens-ncrna-399, whose sample is its 101 species).

## Provenance

- Source: https://zenodo.org/records/4435322 (phyloXML.zip, CSV.zip; members PTHR11444.xml / PTHR11444.csv)
- Licence: CC-BY 4.0 (Zenodo record metadata license "cc-by-4.0"); PhyloGenes data derive from PANTHER/GO (GO is CC-BY 4.0)
- Citation: Zhang P, Berardini T, Reiser L et al. Gene family data from the PhyloGenes (release version 2.2, phylogenes.org). Zenodo, doi:10.5281/zenodo.4435322 (2021)
- How obtained: HTTP Range reads of the remote ZIPs (69 MB and 34 MB) via `python3 -I scripts/zip_range_extract.py extract "https://zenodo.org/api/records/4435322/files/phyloXML.zip/content" <outdir> PTHR11444.xml` and `.../CSV.zip/content ... PhylogenesCSV/PTHR11444.csv`. Zenodo ranges are intermittently 504; the script retries.
