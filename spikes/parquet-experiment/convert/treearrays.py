"""Newick -> numpy preorder arrays with every per-node rollup the Parquet layout stores.

Pure iterative (no recursion). Parsing is delegated to data/real-ladder/scripts/nwk.py (stdlib only).
Run python with -I; the repo path is added explicitly below.
"""
import gzip, os, re, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "data", "real-ladder", "scripts"))
import nwk  # noqa: E402

NUM = re.compile(r"^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(?::(.*))?$", re.S)  # same rule as shared/tree.ts


def split_internal(label):
    """(support, name): '98.0:c__X' -> (98.0,'c__X'); '0.95' -> (0.95,''); 'Canidae_ott1' -> (nan,'Canidae_ott1')"""
    if not label:
        return float("nan"), ""
    m = NUM.match(label)
    if not m:
        return float("nan"), label
    return float(m.group(1)), m.group(2) or ""


def synth_meta(n_tips, seed=20261020):
    """Deterministic SYNTHETIC per-tip metadata (not real GBIF data): zero-inflated heavy-tailed occurrence counts and a
    Zipf-like country code. Shape is plausible, values are not."""
    rng = np.random.default_rng(seed)
    occ = np.floor(rng.lognormal(2.0, 2.2, n_tips)).astype(np.int64)
    occ[rng.random(n_tips) < 0.35] = 0
    occ = np.minimum(occ, 2_000_000).astype(np.int32)
    codes = np.array([a + b for a in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" for b in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"])[:250]
    w = 1.0 / np.arange(1, 251) ** 1.1
    w /= w.sum()
    country = codes[rng.choice(250, n_tips, p=w)]
    return occ, country


def load_arrays(path, cache_dir=None):
    key = os.path.basename(path).replace(".gz", "").replace(".nwk", "")
    if cache_dir:
        cp = os.path.join(cache_dir, key + ".npz")
        if os.path.exists(cp):
            z = np.load(cp, allow_pickle=True)
            return {k: z[k] for k in z.files} | {"timing": z["timing"].item()}
    t0 = time.time()
    tree = nwk.Tree.load(path)
    t_parse = time.time() - t0
    n = len(tree)
    par = np.array(tree.parent, dtype=np.int32)
    nch = np.array(tree.nchild, dtype=np.int32)
    is_tip = nch == 0
    leaf_prefix = np.concatenate(([0], np.cumsum(is_tip, dtype=np.int64))).astype(np.int64)  # tips among nodes < i
    leaf_start = leaf_prefix[:n].astype(np.int32)
    p = tree.parent
    end = list(range(1, n + 1))
    depth = [0] * n
    for i in range(1, n):
        depth[i] = depth[p[i]] + 1
    for i in range(n - 1, 0, -1):
        if end[i] > end[p[i]]:
            end[p[i]] = end[i]
    end = np.array(end, dtype=np.int32)
    tip_count = (leaf_prefix[end] - leaf_prefix[:n]).astype(np.int32)
    depth_a = np.array(depth, dtype=np.int32)
    # branch lengths: raw (NaN when missing) and clamped cumulative (negative / missing count as 0, as layout.ts does)
    raw = np.array([float(x) if x is not None else np.nan for x in tree.length], dtype=np.float64)
    raw[0] = np.nan if tree.length[0] is None else raw[0]
    has_len = bool(np.isfinite(raw[1:]).any())
    cum = [0.0] * n
    if has_len:
        cl = np.where(np.isfinite(raw) & (raw > 0), raw, 0.0).tolist()
        for i in range(1, n):
            cum[i] = cum[p[i]] + cl[i]
    cum = np.array(cum, dtype=np.float64)
    # rollups bottom-up
    maxd = depth_a.tolist()
    maxc = cum.tolist()
    for i in range(n - 1, 0, -1):
        q = p[i]
        if maxd[i] > maxd[q]:
            maxd[q] = maxd[i]
        if maxc[i] > maxc[q]:
            maxc[q] = maxc[i]
    max_depth = np.array(maxd, dtype=np.int32)
    max_cum = np.array(maxc, dtype=np.float64)
    # labels
    support = np.full(n, np.nan)
    names = [None] * n
    tip_labels = []
    node_of_tip = np.flatnonzero(is_tip).astype(np.int32)
    for i in range(n):
        lab = tree.label[i]
        if is_tip[i]:
            tip_labels.append(lab or "")
        elif lab:
            s, nm = split_internal(lab)
            support[i] = s
            if nm:
                names[i] = nm
    t_total = time.time() - t0
    occ, country = synth_meta(len(node_of_tip))
    occ_node = np.zeros(n, dtype=np.int64)
    occ_node[node_of_tip] = occ
    # occ_sum by prefix sums over tip rank (exact), later verified independently by a different method
    pref = np.concatenate(([0], np.cumsum(occ.astype(np.int64))))
    occ_sum = pref[leaf_prefix[end]] - pref[leaf_prefix[:n]]
    out = dict(parent=par, subtree_end=end, leaf_start=leaf_start, tip_count=tip_count, depth=depth_a, max_depth=max_depth,
               len=raw, cum_len=cum, max_cum=max_cum, support=support, node_of_tip=node_of_tip, occ_sum=occ_sum,
               tip_label=np.array(tip_labels, dtype=object), name=np.array(names, dtype=object), occ=occ, country=country,
               has_len=np.array(has_len), timing={"parse_s": t_parse, "arrays_s": t_total - t_parse})
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        np.savez(cp, **out)
    return out
