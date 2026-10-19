# gbif-phylo

Exploration of how to show phylogenetic trees on [gbif.org](https://www.gbif.org).

## Goal

Datasets published to GBIF can include a supplementary file containing a phylogeny in a standard format (Newick, Nexus, and possibly phyloXML/NeXML). We want to:

1. **Dataset page:** add a *Phylogeny* tab where users can explore the tree supplied by the publisher.
2. **Occurrence pages:** when the dataset also contains occurrences, link each occurrence to a tip in the tree, and show that tip in its phylogenetic context on the occurrence detail page.

This repo is where we explore and decide how to do that. The outcome is either:

- a recommendation to adopt an existing library as-is, or
- a small library of our own (probably a thin wrapper/adaptor around an existing renderer) that gbif.org can embed.

## Key constraints

- Runs **in the browser**, pulling the tree from a remote archive (no per-user server process, no desktop dependencies).
- Handles trees from a few dozen tips up to hundreds of thousands.
- Embeddable as a component in the gbif.org frontend (which is a JavaScript/TypeScript app) and usable in both a full-page and a small "context" view.
- Licence compatible with GBIF's open-source code (Apache-2.0 for GBIF's own code; GPL/AGPL dependencies need a deliberate decision).
- Tip labels must be mappable to GBIF identifiers (occurrence IDs, taxon keys), with tolerance for messy labels.

## Documents

Start with [docs/recommendation.md](docs/recommendation.md): the consolidated findings, options with effort estimates, and proposed next steps.

- [docs/goal.md](docs/goal.md): the goal, user stories, the 18 evaluation criteria and the ETE screenshots that show the kind of customisation we want.
- [docs/recommendation.md](docs/recommendation.md): what the research found and what to do next.
- [docs/evaluation-framework.md](docs/evaluation-framework.md): gates, dimensions A to J, evidence levels and the result template for comparing viewers.
- [docs/spike-plan.md](docs/spike-plan.md): the brief for the next session: harness, adapters, scenarios S1 to S15, test data, measures and order of work.
- [docs/comparison.md](docs/comparison.md): first, shallow comparison of viewers (partly superseded; see the note at its top).
- [docs/ete-toolkit.md](docs/ete-toolkit.md) and [docs/ete-ideas.md](docs/ete-ideas.md): what ETE offers, why it is ruled out (GPL, Python server), and the ideas worth reimplementing.
- [docs/research/](docs/research/): source-level reports per candidate (Taxonium, Phylocanvas.gl, phylotree.js, Reactree, Heat-tree, Archaeopteryx.js, react-bio-viz, OneZoom, discovery of others) plus the custom-renderer and data-layer studies.

## Test data

[data/](data/) holds trees for benchmarking and testing: a real-tree size ladder (200 to 1.5M tips), 24 richer datasets (alignments, annotations, dates, GBIF-matchable names) and seeded synthetic trees in several shapes. See [data/README.md](data/README.md) for what each is for, licences and gaps.

## Status

Research and browser spike done. Ten demos (nine libraries and our own prototype) run through 15 scenarios in a shared GBIF-styled shell; results in [docs/results/](docs/results/summary.md), a deployable comparison site (see [docs/deploy-vercel.md](docs/deploy-vercel.md)), and an updated [recommendation](docs/recommendation.md). Open question: real tree sizes from publishers.
