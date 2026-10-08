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

- [docs/goal.md](docs/goal.md): the goal, user stories and evaluation criteria in more detail.
- [docs/ete-toolkit.md](docs/ete-toolkit.md): what ETE is, why it is interesting, and how well it fits a web deployment.
- [docs/comparison.md](docs/comparison.md): ETE compared with web-native alternatives, with pros/cons for deployment and features.

## Status

Early research. No code yet.
