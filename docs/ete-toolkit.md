# ETE Toolkit

Sources: [etetoolkit.org](https://etetoolkit.org/), [github.com/etetoolkit/ete](https://github.com/etetoolkit/ete), [ETE 4 SmartView tutorial](https://etetoolkit.github.io/ete/tutorial/tutorial_smartview.html), [ete4 on PyPI](https://pypi.org/project/ete4/). Items marked **unverified** were not confirmed against primary sources.

## What it is

ETE (Environment for Tree Exploration) is a **Python** framework for building, manipulating, analysing and visualising trees, mostly phylogenetic. Licence: **GPL** (ETE 4 repo: GPL-3.0).

Two generations exist, which is a common source of confusion:

- **ETE 3** (`ete3`, the docs still at etetoolkit.org): visualisation via a **Qt (PyQt) desktop GUI**, plus static export to PNG/PDF/SVG.
- **ETE 4** (`ete4`, docs at etetoolkit.github.io/ete): adds **SmartView**, a browser-based explorer. Qt `treeview` remains an optional extra.

## Why it is interesting

- Very rich **programmatic annotation**: layouts and "faces" let you draw arbitrary node attributes (text, charts, heatmaps, sequence alignments) next to the tree.
- Strong **tree algorithms**: traversal, pruning, rooting, comparison (Robinson-Foulds), NCBI taxonomy integration (`ete-ncbiquery`). The NCBI taxonomy link is conceptually close to GBIF's taxon matching.
- Reads/writes **Newick and Nexus** (per the ETE 4 README; phyloXML and NHX **unverified** for ETE 4).
- **Huge-tree support** in SmartView via adaptive zoom/level of detail.
- Jupyter integration, mature, widely used in comparative genomics.

## How SmartView works (ETE 4)

From the tutorial:

- `tree.explore()` starts a **Python backend server** (default port 5000) that serves a GUI (`/static/gui.html`) and answers drawing requests.
- The browser asks the server what to draw: `GET /trees/<id>/draw?...` with the current viewport (zoom, x/y, w/h), collapsed nodes, active layouts, labels. The server replies with only the graphics needed for that view.
- Layouts are **Python functions** (`draw_node`, `draw_tree`) executed server-side.
- Remote use is supported by SSH port-forwarding to a machine running the server.
- Dependencies seen in the repo README: Cython, bottle, cheroot, brotli, numpy, scipy (compiled extension).
- The tutorial describes no static HTML export of the explorer, only Newick/image download from the GUI.

## Fit for gbif.org

**Poor as a direct component, useful as inspiration or a backend.**

| Aspect | Assessment |
|--------|------------|
| Runtime | Needs a stateful Python process holding the tree in memory and rendering per viewport. Not static-hostable. |
| Embedding | The GUI is a page served by ETE's server, not a documented npm component. Embedding means iframing a server, or reimplementing the client. (Frontend stack **unverified**; `smartview/static/` not inspected.) |
| Scaling in production | One server-side tree per session/dataset; need caching, auth, process management, CORS. Doable but a new service for GBIF to operate. |
| Customisation | Layouts are Python, so GBIF-specific behaviour (highlight occurrence tip, link to taxon page) lives server-side, away from the gbif.org frontend. |
| Licence | GPL-3.0: linking/embedding in gbif.org code is a legal question; running it as a separate service is easier but still copyleft for modifications. |
| Maturity | ETE 3 is mature; ETE 4/SmartView is newer; API and docs still in motion (docs warn the etetoolkit.org pages are legacy ETE 3). |

Your instinct is right: ETE's design centre is a Python workstation or a server a scientist runs, not a generic browser pulling from a remote archive.

## Where ETE could still help

- **Offline preprocessing**: validate trees, convert Nexus/phyloXML to Newick/JSON, prune, compute clade summaries or tip-to-taxon matching in a pipeline before publication on gbif.org.
- **Reference behaviour**: its collapse/level-of-detail and face-based annotation model are good UX references.
