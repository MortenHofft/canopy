#!/usr/bin/env python3
"""Write clades.json next to a converted layout: test clades near 1k / 10k / 100k tips (two each, different regions) and
random tips for the root-to-tip path test. Used only by the measurement harness."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import treearrays

tree, out, cache = sys.argv[1], sys.argv[2], sys.argv[3]
a = treearrays.load_arrays(tree, cache)
n = len(a["parent"]); tips = len(a["node_of_tip"])
tc = a["tip_count"].astype(np.int64)
internal = a["subtree_end"] != np.arange(1, n + 1)
res = {"tips": tips, "nodes": n, "clades": []}
for target in (1000, 10000, 100000):
    if target * 3 > tips:
        continue
    cand = np.flatnonzero(internal & (np.abs(tc - target) <= target * 0.35))
    if not len(cand):
        continue
    # two clades from different regions of the preorder (first third / last third), closest to the target
    for lo, hi in ((0, n // 2), (n // 2, n)):
        c = cand[(cand >= lo) & (cand < hi)]
        if len(c):
            i = int(c[np.argmin(np.abs(tc[c] - target))])
            res["clades"].append({"target": target, "node": i, "end": int(a["subtree_end"][i]), "leaf_start": int(a["leaf_start"][i]), "tips": int(tc[i]), "nodes": int(a["subtree_end"][i] - i)})
rng = np.random.default_rng(7)
nt = a["node_of_tip"]
res["tip_nodes"] = [int(x) for x in rng.choice(nt, 8, replace=False)]
res["tip_ranks"] = [int(np.searchsorted(nt, x)) for x in res["tip_nodes"]]
json.dump(res, open(out, "w"))
print(out, [(c["target"], c["tips"]) for c in res["clades"]])
