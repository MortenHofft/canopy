# ETE ideas worth reimplementing

ETE is GPL-3.0 and is **not an option** as a dependency or as code to port. Ideas and behaviours are fair to reimplement from scratch; do **not** copy or translate ETE source. Whoever implements these should work from this description, not from ETE's code.

Sources: ETE 4 [SmartView tutorial](https://etetoolkit.github.io/ete/tutorial/tutorial_smartview.html), [`explorer.py`](https://github.com/etetoolkit/ete/blob/ete4/ete4/smartview/explorer.py) and [`draw.py`](https://github.com/etetoolkit/ete/blob/ete4/ete4/smartview/draw.py) (read via summaries; JS frontend not inspected).

## Ideas

| # | Idea | What ETE does | Why it matters for gbif.org |
|---|------|---------------|-----------------------------|
| 1 | **Viewport-driven level of detail** | Draw only what is visible; collapse nodes smaller than a minimum pixel height into an outline/skeleton; hide content below a content-height threshold | Makes large trees usable without drawing every node |
| 2 | **Off-screen culling** | Skip nodes outside the viewport | Same |
| 3 | **Independent x/y zoom + smart zoom** | Zoom axes separately; magnify the node under the cursor | Dense trees are tall, not wide |
| 4 | **Layouts as stackable functions** | Several layouts active at once; later ones add decorations or override style | Lets us add GBIF layers (occurrence counts, match status) without touching the core |
| 5 | **Faces with positions/columns** | Text, circle, rect, sequence, image, legend elements at top/bottom/left/right/aligned, stacked in columns | Per-tip badges: occurrence count, thumbnail, IUCN status |
| 6 | **Rich search** | Plain text, regex, expression over node properties, topological pattern | Find tips by name, by metadata, or by matched/unmatched status |
| 7 | **Selections** | Tag a set of nodes, then collapse/highlight them | "All tips with occurrences in this country" |
| 8 | **Hover property popup** | Choose which node properties show | Tip to occurrence/taxon preview |
| 9 | **Subtree addressing** | Subtree identified by child-index path (`tree,1,0,1`) | A stable way to show "this tip plus its clade" on an occurrence page |
| 10 | **Viewport protocol (optional)** | Server returns only graphics for the current view | Escape hatch if trees outgrow the browser: a static tree file chunked/indexed by region |
| 11 | **Minimap** | Overview navigator | Orientation in big trees |

## Mapping to candidate libraries

| Library | Already has | Gaps where ETE's ideas help |
|---------|-------------|-----------------------------|
| **phylotree.js** (SVG) | Collapse, selection callbacks, layouts | Needs LOD, culling and clade aggregation (1, 2) to survive thousands of tips; no faces, no minimap |
| **Archaeopteryx.js** (SVG) | Search, metadata colouring, heat maps, tip thinning; manual collapse was removed | LOD/culling (1, 2), programmatic tip focus (9), faces-like badges (5) |
| **Taxonium** (WebGL) | Scale, optional backend loading, metadata | Layout stacking (4), richer search (6); GPL-3.0 licence still needs sign-off |
| **Heat-tree** | Embeddable, MIT | Unknown; check first |

## Suggested approach

1. Pick the base library via the spike in `comparison.md` on the `research` branch.
2. Build the GBIF layer first (parsing, tip matching, highlight/focus API).
3. Add ideas 1, 2, 9 first: they decide whether a large tree and an occurrence-page view work at all. The rest are enhancements.
4. If the base library draws SVG, plan for a thin canvas or virtualised renderer rather than patching per-node DOM.
