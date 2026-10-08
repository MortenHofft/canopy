# Open Tree of Life synthetic subtree: Carnivora, ~728 tips, no branch lengths

*Real data, redistributed under the licence below. Retrieved 2026-10-08.*

## Contents

- `carnivora.nwk` (28010 bytes, sha256 `6a3788cf1c4e410c...`)

## What extra data it carries

Taxonomic/synthesis tree: internal node labels (mrcaottXXXXottYYYY or taxon names with ott ids), labels `Name_ottID`, many polytomies, subspecies included. No branch lengths at all

## Tree facts (computed by `scripts/treecheck.py`)

- Main tree file: `carnivora.nwk` (newick; 1 tree(s) in file)
- Tips: 728; internal nodes: 524; labelled internal nodes: 233; polytomies (non-root): 78; root children: 2
- Branch lengths: none
- Kind: none (topology only); units: -
- Where the lengths live: absent

## Linking tips to metadata

tip label `Genus_species_ott<id>`: strip `_ott<id>` for GBIF name matching; the OTT id is the key to Open Tree taxonomy (which maps to GBIF ids)

## Quirks

Polytomies (78), 233 labelled internal nodes, no lengths: layout must handle length-less trees (cladogram). Underscores for spaces.

## GBIF match

Not computed (run was not finished).

## Provenance

- Source: https://api.opentreeoflife.org/v3/tree_of_life/subtree (node ott44565)
- Licence: CC0 1.0 (Open Tree of Life: "where not limited by pre-existing terms of use, all data are published with a CC0 public domain dedication", https://tree.opentreeoflife.org/about/open-tree-of-life; also stated in Hinchliff et al. 2015). Caveat: the Zenodo record of synthesis release 12.3 (doi:10.5281/zenodo.3937742) lists CC-BY 1.0 instead; attribution is given here in any case.
- Citation: Open Tree of Life synthetic tree, synth_id opentree16.1, taxonomy OTT 3.x; Hinchliff CE et al. (2015) PNAS 112:12764-12769, doi:10.1073/pnas.1423041112; Redelings & Holder (2017) PeerJ 5:e3058
- How obtained: POST https://api.opentreeoflife.org/v3/tree_of_life/subtree with JSON {"node_id":"ott44565","format":"newick","label_format":"name_and_id"}; the `newick` field of the response saved verbatim. Retrieved 2026-10-08.
