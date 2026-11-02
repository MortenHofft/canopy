# gbif-map: a small tree with a sidecar of GBIF matches

Test data for `examples/gbif-map`: a Newick tree whose tip labels are not GBIF names, and the CSV that an ingestion step would have
made, matching each label to a GBIF taxon key and the name GBIF interprets it as.

| File             | What                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `acacia.nwk`     | 11 tips: vernacular names with underscores (`Australian_Blackwood`), one misspelt Latin name (`Acacia_salinga`), one correct one (`Acacia_verticillata`), and `Wattle_sp_nov`, which has no row in the CSV, to show an unmatched tip |
| `acacia.taxa.csv` | `ID` (the tip label, as the sidecar needs), `taxonKey`, `scientificName` (the name GBIF interprets it as)                                                                                                                           |

**Provenance.** The taxon keys, scientific names and vernacular names are taken from GBIF's taxon records for ten _Acacia_ species, as
supplied by Morten Høfft (the GBIF names are CC0). **Unverified:** that each key still resolves to that name today. The tree is
invented: its topology and branch lengths are arbitrary, and it is not a phylogeny of these species. Which label stands for which
species (for example `Acacia_salinga` for _Acacia saligna_) was chosen for the demo. No licence issue: nothing here comes from a third-party tree.
