# gbif-map: a small tree with a sidecar of GBIF matches

Test data for `examples/gbif-map`: a Newick tree whose tip labels are not GBIF names, and the CSV that an ingestion step would have
made, matching each label to a GBIF taxon key and the name GBIF interprets it as.

| File             | What                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `acacia.nwk`     | 11 tips: vernacular names with underscores (`Australian_Blackwood`), one misspelt Latin name (`Acacia_salinga`), one correct one (`Acacia_verticillata`), and `Wattle_sp_nov`, which has no row in the CSV, to show an unmatched tip. The root is named `Acacia` |
| `acacia.taxa.csv` | `taxonKey`, `scientificName` (the name GBIF interprets it as) and `nameInTree` (the tip label or node name, the column that holds the ID: read with `idColumn`). The row `Acacia` is the root |

**Provenance.** The taxon keys, scientific names and vernacular names are taken from GBIF's taxon records for ten _Acacia_ species, as
supplied by Morten Høfft (the GBIF names are CC0). **Unverified:** that each key still resolves to that name today. The tree is
invented: its topology and branch lengths are arbitrary, and it is not a phylogeny of these species. Which label stands for which
species (for example `Acacia_salinga` for _Acacia saligna_) was chosen for the demo. No licence issue: nothing here comes from a third-party tree.

The root, `Acacia`, has key `LV7` (https://www.gbif.org/taxon/LV7) from Morten Høfft. Its name `Acacia Mill.` is taken from the match of the
genus name against GBIF's backbone (`api.gbif.org/v1/species/match?name=Acacia`, key 2978223). **Unverified:** that `LV7` is the same
name: the v1 species API does not take `LV7`.
