# Open Tree of Life synthetic subtree: Aves, ~19k tips, no branch lengths

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `aves.nwk.gz` (230444 bytes, sha256 `b598dece71456a39...`)

## What extra data it carries

As otol-carnivora, ~19k tips (largest real tree in this folder)

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `aves.nwk.gz` (newick; 1 tree(s) in file)
- Tips: 18988; internal nodes: 13067; labelled internal nodes: 4137; polytomies (non-root): 1773; root children: 2
- Branch lengths: none
- Kind: none (topology only); units: -
- Where the lengths live: absent

## Linking tips to metadata

as otol-carnivora

## Quirks

1773 polytomies, 4137 labelled internal nodes. Tips are mostly species.

## GBIF match

Not computed (run was not finished).

## Provenance

- Source: https://api.opentreeoflife.org/v3/tree_of_life/subtree (node ott81461)
- Licence: CC0 1.0 (Open Tree of Life: "where not limited by pre-existing terms of use, all data are published with a CC0 public domain dedication", https://tree.opentreeoflife.org/about/open-tree-of-life; also stated in Hinchliff et al. 2015). Caveat: the Zenodo record of synthesis release 12.3 (doi:10.5281/zenodo.3937742) lists CC-BY 1.0 instead; attribution is given here in any case.
- Citation: Open Tree of Life synthetic tree, synth_id opentree16.1, taxonomy OTT 3.x; Hinchliff CE et al. (2015) PNAS 112:12764-12769, doi:10.1073/pnas.1423041112; Redelings & Holder (2017) PeerJ 5:e3058
- How obtained: POST https://api.opentreeoflife.org/v3/tree_of_life/subtree with JSON {"node_id":"ott81461","format":"newick","label_format":"name_and_id"}; the `newick` field of the response saved verbatim. Retrieved 2026-10-08.
