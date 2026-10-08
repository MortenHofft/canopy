# Comparison of tree viewers for gbif.org

Judged against the criteria in [goal.md](goal.md). Facts come from the project pages and papers listed at the end. Anything in *italics* is **unverified** (from general knowledge or not confirmed in this research round) and must be checked before we rely on it. Maintenance status in particular needs a proper look at commit/release history.

## Summary table

| Tool | Runtime | Rendering | Formats | Scale | Licence | Embeddable | Notes |
|------|---------|-----------|---------|-------|---------|------------|-------|
| **ETE 4 SmartView** | Python server | Server-computed, browser draws | Newick, Nexus | Huge (adaptive zoom) | GPL-3.0 | Awkward (iframe a server) | Rich Python annotation; needs backend |
| **ETE 3 treeview** | Desktop (Qt) | Qt | Newick, NHX, more | Moderate | GPL | No | Static export only |
| **Taxonium** | Browser (+ optional Node backend) | WebGL (deck.gl) | Newick + CSV/TSV metadata, UShER protobuf | Millions of nodes | GPL-3.0 | Yes, React component | Built for viral phylogenies; works with static files |
| **phylotree.js** | Browser | SVG (D3) | Newick (+ HyPhy extensions), PhyloXML, NeXML parsing; Nexus annotations only | Thousands of tips | MIT | Yes, npm + TS types | Middleware for apps; selection, rerooting, collapse |
| **Phylo.io** | Browser | SVG (D3) | Newick | Small/medium | MIT | Yes (embeddable) | Tree comparison focus; *maintenance unknown* |
| **Phylocanvas (original / GL)** | Browser | Canvas / WebGL | Newick | Medium | LGPL-3.0 | Yes | Sanger page says it is no longer updated |
| **Auspice (Nextstrain)** | Browser | *SVG/Canvas* | Auspice JSON | *Large* | AGPL-3.0 per docs; *recheck current licence* | Heavy, full app | Opinionated Nextstrain data model |
| **Heat-tree** | Browser (JS; R/Python wrappers) | *Not confirmed* | Newick | *Unknown* | MIT (R package) | Yes, designed for embedding | 2026 preprint, new; *needs hands-on evaluation* |
| **jsPhyloSVG** | Browser | SVG | Newick, phyloXML | Small | *Unknown* | Yes | 2010, *likely dormant* |
| **IcyTree, iTOL, Microreact** | Hosted apps | n/a | n/a | n/a | n/a | Not libraries | Useful UX references; *not assessed* |

## Deployment: pros and cons

### Server-driven (ETE 4)

- **Pros:** can handle trees too big to ship to the browser; heavy logic (layouts, annotation) in Python; no client-side parser.
- **Cons:** stateful service for GBIF to run and secure; per-tree memory; hard to cache on a CDN; GPL; GBIF-specific interaction (occurrence highlighting) is awkward to wire into the gbif.org app; ETE 4 explorer not documented as an embeddable component.

### Client-only (phylotree.js, Phylo.io, Heat-tree, Taxonium static mode)

- **Pros:** tree file is just a static asset next to the dataset; trivial to host and cache; the component lives inside the gbif.org app; full control of events and styling; no new infrastructure.
- **Cons:** the browser parses and holds the whole tree (fine to ~100k tips, strained beyond without WebGL and good data structures); SVG libraries slow down in the thousands of nodes; we own the Nexus/phyloXML parsing and tip-to-occurrence matching.

### Hybrid

Preprocess trees at ingestion (could use ETE/Python or any parser): normalise to one format, compute clade summaries or an indexed/chunked JSON, then serve static files to a client-only viewer. This keeps the runtime static while reusing ETE's strengths offline.

## Feature view

- **Large trees:** Taxonium (WebGL) and ETE 4 (server LOD) are the proven options. phylotree.js/SVG tools need collapse-by-default and clade aggregation above a few thousand tips.
- **Annotation / metadata on tips:** ETE (faces) is richest; Taxonium takes CSV/TSV metadata; phylotree.js gives hooks but you draw yourself.
- **Programmatic highlight/focus (key for occurrence pages):** phylotree.js (selection callbacks, D3-based, you control the DOM) and Taxonium (component props) both appear suitable; ETE would require server-side layout code.
- **Nexus:** supported by ETE; phylotree.js only for annotations; Taxonium unconfirmed. Likely we parse Nexus ourselves (extract tree block + translate table) and hand Newick to the viewer.
- **Licensing:** MIT (phylotree.js, Phylo.io, Heat-tree) is easiest. LGPL (Phylocanvas) workable. GPL/AGPL (ETE, Taxonium, Auspice) needs a decision on how gbif.org may combine them.

## Preliminary recommendation (to be tested)

1. Do **not** build on ETE as the web runtime. Consider it only for offline preprocessing or as a UX reference.
2. Shortlist for a client-side core: **phylotree.js** (MIT, middleware design, SVG) for small to medium trees and **Taxonium** (WebGL, React, GPL-3.0) for large trees; **Heat-tree** as a new MIT candidate worth a hands-on check.
3. Likely outcome is a thin GBIF layer: Newick/Nexus/phyloXML parsing, tip-to-GBIF matching, a stable component API (`load`, `highlight`, `focus`, events), and a renderer swappable behind it.

## Next steps

- Build small spikes with phylotree.js, Taxonium and Heat-tree against: a 50-tip tree, a 5k-tip tree, a 100k-tip tree, a Nexus file with a translate block.
- Measure load time, interaction frame rate, bundle size.
- Check maintenance (latest releases/commits) and licences of the shortlist.
- Inspect the ETE 4 `smartview/static` frontend to settle whether it could be reused standalone.

## Sources

- [ETE site](https://etetoolkit.org/), [ETE 4 repo](https://github.com/etetoolkit/ete), [SmartView tutorial](https://etetoolkit.github.io/ete/tutorial/tutorial_smartview.html)
- [Taxonium repo](https://github.com/theosanderson/taxonium)
- [phylotree.js repo](https://github.com/veg/phylotree.js), [phylotree.js paper](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6060545/)
- [Phylocanvas at Sanger](https://sanger.ac.uk/tool/phylocanvas), [npm](https://npmjs.com/package/phylocanvas)
- [Phylo.io paper](https://academic.oup.com/mbe/article/33/8/2163/2579233)
- [Auspice docs](https://docs.nextstrain.org/projects/auspice)
- [Heat-tree preprint](https://arxiv.org/pdf/2605.01109), [heattree on CRAN](https://cran.r-project.org/web/packages/heattree/index.html)
- [jsPhyloSVG paper](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2923619/)
- [Wikipedia list of tree visualisation software](https://en.wikipedia.org/wiki/List_of_phylogenetic_tree_visualization_software)
