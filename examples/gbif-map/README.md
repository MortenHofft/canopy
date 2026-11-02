# Example: GBIF map view (the tree, first step)

A Newick tree whose tips are not GBIF names, and a CSV that matches them: the tree shown with the library as it is, no change to any
package. It is the start of a view like `gbif/labs-phylogeny`, where tips matched to GBIF taxon keys are shown on a map of their
occurrences; this step has no map yet.

The matching itself (label to taxon key) is assumed done earlier, when the tree was ingested, as GBIF does for occurrences. The CSV is
its result: `ID` (the tip label), `taxonKey`, `scientificName` (the name GBIF interprets the label as). The tree and the CSV are in
[`data/gbif-map`](../../data/gbif-map) (11 tips, invented tree, one tip with no match).

| What you see                                       | API                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| The tree and the CSV, kept apart                   | `parseNewick`, `parseSidecar(csv).bind(tree)` from `@canopy/io`                                              |
| GBIF name, name in the tree, or both on the tips   | `formatLabel` through `viewer.setOptions`. It gets the label only, so the names are looked up by label       |
| A popup on a tip with links to gbif.org            | `viewer.on('click')` with `preventDefault()`, and `Overlay`                                                  |
| Tips with no row, rows with no tip                 | `binding.report` (`tipsWithoutRow`, `unmatchedIds`)                                                          |

```
npm run dev -w examples/gbif-map     # http://127.0.0.1:5311 (?cpu=1 for a CPU canvas)
```

The browser check is `tests/browser/scripts/check-gbif-map.mjs`.
