# Example: GBIF map view (a tree and a map of the clades you click)

The idea of the proof of concept [phylogeny-tool.gbif.org](https://phylogeny-tool.gbif.org) (`gbif/labs-phylogeny`) on this viewer: a tree
whose tips are matched to GBIF taxon keys, and a map of the GBIF occurrences of the clades you pick. No package of this repository
needed a map or a GBIF-specific change; the page uses the public API, [maplibre](https://maplibre.org) (BSD-3-Clause) for the map, and
GBIF's basemaps and occurrence map (vector tiles).

The matching of the tree's names to taxon keys is assumed done earlier, when the tree was ingested. The CSV is its result:
[`data/gbif-map`](../../data/gbif-map) (11 tips, invented tree, the root `Acacia`). The taxon keys are of GBIF's checklist
`7ddf754f-d193-4cc9-b351-99906754a03b`, and the map and the occurrence search only know them with `checklistKey=<that>` (`CHECKLIST_KEY`
in [`src/selection.ts`](src/selection.ts)).

| What you do or see                                              | How                                                                                                                                                      |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Click a node: it takes a colour in the tree and joins the legend | `viewer.on('click')` with `preventDefault()`, `viewer.setClades`. A node with a row of its own uses its key (the root, `LV7`), else its matched tips' keys |
| Its occurrences on the map                                      | one maplibre layer per selection from `api.gbif.org/v2/map/occurrence/adhoc`, at most 200 taxon keys (as the proof of concept), `src/map.ts`            |
| Colour, eye, drag to reorder, remove, remove all                | the legend, `src/legend.ts`; the eye hides the layer on the map and leaves the colour in the tree. The first row is drawn on top                         |
| Zoom to the clade in the tree                                   | `viewer.zoomToNode`                                                                                                                                      |
| The same occurrences on gbif.org                                | a link to the occurrence search (`view=MAP`) with the same keys                                                                                          |
| Rectangular or circular, fit, minimap                           | `LayoutToggle`, `Fit` (top right of the tree), `OverviewControl`                                                                                         |
| The names                                                       | `formatLabel(label, node)` reads the GBIF name from the sidecar by node (`parseSidecar` with `idColumn`)                                                 |

```
npm run dev -w examples/gbif-map-view     # http://127.0.0.1:5312 (?cpu=1 for a CPU canvas of the tree)
```

The browser check is `tests/browser/scripts/check-gbif-map-view.mjs`. It stubs GBIF's servers and needs WebGL (SwiftShader in the cloud
sandbox).
