from the etetoolkit website for comparison

# ete-example: gene tree with support values and an alignment

Supplied by the repository owner on 2026-10-20 as the example from the ETE toolkit website (exact page URL not recorded; **unverified**). Licence of the data: **unknown, not verified** (the ETE toolkit itself is GPL-3; that says nothing about this data). Do not redistribute outside this repository until the source is confirmed.

- `tree.nwk`: Newick, 82 tips, branch lengths on every edge, internal labels are support values (about 0.46 to 0.99985), rooted, binary.
- `alignment.fa`: aligned protein FASTA, 82 records, all 1083 columns, 18% gaps, 1,057 `X` residues. Checked 2026-10-20: record ids equal the tree's tip labels exactly (82 of 82, no extras).
- `members.tsv`: generated from the tip labels only (`python3` split at the first `.`): `protein_id`, `ncbi_taxid`, `accession`. Tips look like `<NCBI taxon id>.<protein accession>` (Ensembl-style). No external lookups; the taxon ids are NCBI, not GBIF keys, so matching to GBIF would need a name step (see issue 6).
