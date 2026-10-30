Throwaway branch holding large Open Tree of Life test trees (opentree16.1, CC0 with the OTL caveat) for the gbif-phylo demo. Delete this branch when done.

- `trees/otl-1m-metazoa.nwk.gz`, `trees/otl-2m-full.nwk.gz`: the trees as the synthesis names them.
- `trees/otl-2m-relabelled.nwk.gz`: `otl-2m-full` with its labels cleaned, made by `data/real-ladder/scripts/relabel_otl.py` on `main`. The `mrcaott…` placeholder names of internal nodes are removed, and so is the trailing `_ott<id>` of internal nodes and tips, except where the bare name would be shared by several nodes, which keep it (3,482 internal nodes and 919 tips). Tree shape is unchanged.
