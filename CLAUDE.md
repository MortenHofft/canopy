# CLAUDE.md

## What this repo is

A research/prototyping repo for adding phylogenetic tree visualisation to gbif.org. See [README.md](README.md) for the goal and [docs/](docs/) for findings.

## Working conventions

- Default branch is `main`. Develop on feature branches; do not open pull requests unless asked.
- Research claims in `docs/` must say where they came from. Mark anything not verified against primary sources (docs, repo, paper) as **unverified** rather than stating it as fact.
- Keep the decision-relevant criteria in [docs/goal.md](docs/goal.md) up to date; the comparison in [docs/comparison.md](docs/comparison.md) is judged against them.
- Prefer web-native, browser-only solutions: the target is a static frontend fetching tree files from a remote archive.
- Check licences before recommending a dependency (GPL/AGPL matter for embedding in gbif.org).
- Any UI prototype should follow GBIF design tokens (see the `gbif-design-tokens` skill if available).

## Domain notes

- Formats: Newick (most common), Nexus (may wrap trees plus a taxa/translate block), phyloXML, NeXML.
- Tip labels in the supplied tree are the join key to GBIF occurrences/taxa; matching can be exact or fuzzy and must be explicit about unmatched tips.
- Large trees need level-of-detail rendering (collapse/aggregate clades, Canvas/WebGL), not one SVG element per node.

## Code

None yet. When code is added, document build/test commands here.
