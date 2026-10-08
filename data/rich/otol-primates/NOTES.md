# Open Tree of Life synthetic subtree: Primates, ~748 tips, no branch lengths

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `primates.nwk` (32175 bytes, sha256 `eaa7deed17cc5375...`)

## What extra data it carries

As otol-carnivora

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `primates.nwk` (newick; 1 tree(s) in file)
- Tips: 748; internal nodes: 585; labelled internal nodes: 259; polytomies (non-root): 81; root children: 4
- Branch lengths: none
- Kind: none (topology only); units: -
- Where the lengths live: absent

## Linking tips to metadata

as otol-carnivora

## Quirks

Root has 4 children (non-binary root). 81 polytomies.

## GBIF match

Not computed for this dataset (tips are not plain species names or the dataset is a sibling of one that was computed).

## Provenance

- Source: https://api.opentreeoflife.org/v3/tree_of_life/subtree (node ott913935)
- Licence: CC0 1.0 (Open Tree of Life: "where not limited by pre-existing terms of use, all data are published with a CC0 public domain dedication", https://tree.opentreeoflife.org/about/open-tree-of-life; also stated in Hinchliff et al. 2015). Caveat: the Zenodo record of synthesis release 12.3 (doi:10.5281/zenodo.3937742) lists CC-BY 1.0 instead; attribution is given here in any case.
- Citation: Open Tree of Life synthetic tree, synth_id opentree16.1, taxonomy OTT 3.x; Hinchliff CE et al. (2015) PNAS 112:12764-12769, doi:10.1073/pnas.1423041112; Redelings & Holder (2017) PeerJ 5:e3058
- How obtained: POST https://api.opentreeoflife.org/v3/tree_of_life/subtree with JSON {"node_id":"ott913935","format":"newick","label_format":"name_and_id"}; the `newick` field of the response saved verbatim. Retrieved 2026-10-08.
