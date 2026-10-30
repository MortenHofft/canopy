Throwaway branch holding large Open Tree of Life test trees (opentree16.1, CC0 with the OTL caveat) for the gbif-phylo demo. Delete this branch when done.

- `trees/otl-1m-metazoa.nwk.gz`, `trees/otl-2m-full.nwk.gz`: the trees as the synthesis names them.
- `trees/otl-2m-relabelled.nwk.gz`: `otl-2m-full` with its internal labels cleaned, made by `data/real-ladder/scripts/relabel_otl.py` on `main`. The `mrcaott…` placeholder names are removed and so is the trailing `_ott<id>` of the other internal nodes, except where the bare name would be shared by several nodes (3,398 of them), which keep it. Tips and tree shape are unchanged.
