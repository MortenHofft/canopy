#!/usr/bin/env python3
"""Verify a converted layout against ground truth.
  python3 -I verify.py TREE.nwk[.gz] LAYOUTDIR [--cache DIR]
1. every node column read back from nodes.parquet equals the ground truth recomputed from the Newick (floats: ground truth cast to the stored width)
2. independent recomputation of the integer rollups from the parent column only (prefix sums over tips, sparse-table range max)
3. overview: each level tiles the tip range exactly once, rows equal the node table, triangles can be derived from overview rows alone
   (and equal the renderer's XMAX/ROW-free definition: height = tip_count, width = (max_cum - cum_len)/max_cum_root)
4. tips.parquet aligned with node row groups; spine + rg_open reproduce the root->node path for random nodes
"""
import json, os, sys, argparse
import numpy as np
import pyarrow.parquet as pq
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import treearrays

ap = argparse.ArgumentParser(); ap.add_argument("tree"); ap.add_argument("dir"); ap.add_argument("--cache"); A = ap.parse_args()
a = treearrays.load_arrays(A.tree, A.cache)
man = json.load(open(os.path.join(A.dir, "manifest.json")))
n = man["nodes"]
f32 = man["float"] == "f32"
fails = []
def check(name, ok, extra=""):
    print(("PASS " if ok else "FAIL ") + name + (" " + extra if extra else ""))
    if not ok: fails.append(name)

nt = pq.read_table(os.path.join(A.dir, "nodes.parquet"))
cols = nt.column_names
def col(c): return nt.column(c).to_numpy()
def fl(x): return x.astype(np.float32) if f32 else x
check("rows == node count", nt.num_rows == n)
exp = {"parent": a["parent"], "subtree_end": a["subtree_end"]}
for c in ["leaf_start", "tip_count", "depth", "max_depth"]:
    if c in cols: exp[c] = a[c]
for c, k in [("len", "len"), ("cum_len", "cum_len"), ("max_cum", "max_cum"), ("support", "support")]:
    if c in cols: exp[c] = fl(a[k])
if "occ_sum" in cols: exp["occ_sum"] = a["occ_sum"]
for c, e in exp.items():
    got = col(c)
    ok = np.array_equal(got.astype(e.dtype), e, equal_nan=True) if e.dtype.kind == "f" else np.array_equal(got.astype(np.int64), e.astype(np.int64))
    check("nodes." + c + " == ground truth", ok)
# 2. independent recompute from parent only
par = col("parent").astype(np.int64); N = n
idx = np.arange(N)
tip = np.ones(N, bool); tip[par[1:]] = False        # a node is a tip iff nobody has it as parent
pref = np.concatenate(([0], np.cumsum(tip)))
end = np.empty(N, np.int64)                         # subtree_end by iterating: end[i] = first j>i with depth[j]<=depth[i]
dep = np.zeros(N, np.int64)
# depth via pointer jumping on parent (log rounds), independent of the loops used in treearrays
dep = np.zeros(N, np.int64)
jump = np.where(idx > 0, par, 0); step = (idx > 0).astype(np.int64)
for _ in range(24):
    nstep = step + step[jump]
    njump = jump[jump]
    if np.array_equal(njump, jump) and np.array_equal(nstep, step): break
    step, jump = nstep, njump
dep = step
# subtree_end = next index with depth <= depth[i] (monotonic stack)
nxt = np.full(N, N, np.int64)
stack = []
dl = dep.tolist()
for i in range(N):
    while stack and dl[stack[-1]] >= dl[i]:
        nxt[stack.pop()] = i
    stack.append(i)
end = nxt
check("independent subtree_end (stack scan)", np.array_equal(end, col("subtree_end")))
if "tip_count" in cols:
    check("independent tip_count (tip prefix sums)", np.array_equal(pref[end] - pref[:N], col("tip_count")))
    check("independent leaf_start", np.array_equal(pref[:N], col("leaf_start")))
    check("independent depth (pointer jumping)", np.array_equal(dep, col("depth")))
    # sparse table range max for max_depth and max_cum
    def rmax(vals):
        tab = [vals]; k = 1
        while 2 * k <= N:
            prev = tab[-1]; tab.append(np.maximum(prev[:-k] if len(prev) > k else prev, prev[k:])); k *= 2
        L = end - idx
        lg = np.floor(np.log2(L)).astype(np.int64)
        out = np.empty(N, vals.dtype)
        for j in range(len(tab)):
            m = lg == j
            if m.any():
                s = idx[m]; e2 = end[m] - (1 << j)
                out[m] = np.maximum(tab[j][s], tab[j][e2])
        return out
    check("independent max_depth (sparse table)", np.array_equal(rmax(dep), col("max_depth")))
    if man["has_lengths"]:
        cum = a["cum_len"]  # ground truth cumulative (float64) from the Newick
        mc = rmax(cum)
        check("independent max_cum (sparse table over cum_len)", np.array_equal(fl(mc), col("max_cum")))
        # renderer definition: XMAX = max X in subtree, X = cum/maxLen (float32): the triangle width fraction
        root = float(col("max_cum")[0]); xm = (col("max_cum").astype(np.float64) / root).astype(np.float32)
        ref = (a["cum_len"] / a["cum_len"].max()).astype(np.float32); refmax = rmax(ref)
        check("max_cum/root == renderer XMAX (float32 tolerance 1e-6)", np.allclose(xm, refmax, atol=1e-6))
    if True:
        # independent layout row: tip rank + .5 for tips; internal = midpoint of rows of first child (i+1) and last child (end of the sibling chain)
        rowc = np.zeros(N); tpos = np.flatnonzero(tip); rowc[tpos] = np.arange(len(tpos)) + 0.5
        lastc = np.full(N, -1, np.int64)
        for i in range(1, N): lastc[par[i]] = i
        for i in range(N - 1, -1, -1):
            if lastc[i] >= 0: rowc[i] = (rowc[i + 1] + rowc[lastc[i]]) / 2
        ovr = pq.read_table(os.path.join(A.dir, "overview.parquet"))
        okr = np.array_equal(fl(rowc)[ovr.column("node").to_numpy()], ovr.column("row").to_numpy())
        check("overview.row == layout ROW (midpoint of first/last child), stored width", okr)
        np.save(os.path.join(os.environ.get("TMPDIR", "/tmp"), "verify_rowc.npy"), rowc) if os.environ.get("KEEP_ROWC") else None
    if "occ_sum" in cols:
        tt = pq.read_table(os.path.join(A.dir, "tips.parquet"), columns=["occurrence_count"]).column(0).to_numpy().astype(np.int64)
        op = np.concatenate(([0], np.cumsum(tt)))
        check("independent occ_sum (from tips.parquet via prefix sums)", np.array_equal(op[pref[end]] - op[pref[:N]], col("occ_sum")))
# tips
tp = pq.ParquetFile(os.path.join(A.dir, "tips.parquet"))
tn = tp.read(columns=["node", "tip_label"])
check("tips.node == positions of tips", np.array_equal(tn.column("node").to_numpy(), np.flatnonzero(tip)))
check("tips.label == Newick labels", tn.column("tip_label").to_pylist() == a["tip_label"].tolist())
nrg = pq.ParquetFile(os.path.join(A.dir, "nodes.parquet")).metadata
ok = tp.metadata.num_row_groups == nrg.num_row_groups and all(
    tp.metadata.row_group(g).num_rows == man["rg_tip_start"][g + 1] - man["rg_tip_start"][g] for g in range(nrg.num_row_groups)) and all(
    pref[man["rg_node_start"][g]] == man["rg_tip_start"][g] for g in range(nrg.num_row_groups))
check("tips row groups aligned with node row groups", ok)
# 3. overview
ov = pq.ParquetFile(os.path.join(A.dir, "overview.parquet"))
levels = ov.metadata.num_row_groups
for L in range(levels):
    t = ov.read_row_groups([levels - 1 - l for l in range(L + 1)])
    node = t.column("node").to_numpy().astype(np.int64)
    sel = t.column("sel_level").to_numpy()
    expanded = sel <= L
    # rows equal the node table
    ok = all(np.array_equal(t.column(c).to_numpy().astype(np.float64), col(c)[node].astype(np.float64), equal_nan=True) for c in ["parent", "subtree_end", "tip_count", "leaf_start", "len", "cum_len", "max_cum", "depth", "max_depth"] if c in t.column_names and c in cols)
    check(f"overview level {L}: rows ({len(node)}) equal node-table rows", ok)
    # draw set = non-expanded rows whose parent is expanded (stubs, tips); must tile [0, tips) exactly once
    pe = set(node[expanded].tolist())
    draw = [i for i, (nd, e) in enumerate(zip(node, expanded)) if (not e) and (int(par[nd]) in pe)]
    ls = t.column("leaf_start").to_numpy()[draw].astype(np.int64); tc = t.column("tip_count").to_numpy()[draw].astype(np.int64)
    o = np.argsort(ls); ls, tc = ls[o], tc[o]
    tiles = (ls[0] == 0) and np.array_equal(ls[1:], (ls + tc)[:-1]) and (ls[-1] + tc[-1] == man["tips"])
    check(f"overview level {L}: {len(draw)} stub/tip rows tile the {man['tips']} tips exactly once", bool(tiles))
    if man["has_lengths"]:
        cl = t.column("cum_len").to_numpy()[draw]; mcv = t.column("max_cum").to_numpy()[draw]
        wid = (mcv - cl)
        check(f"overview level {L}: triangle widths non-negative and finite", bool(np.all(np.isfinite(wid)) and np.all(wid >= 0)))
# 4. spine / path
rng = np.random.default_rng(1)
sp = pq.read_table(os.path.join(A.dir, "spine.parquet")) if os.path.exists(os.path.join(A.dir, "spine.parquet")) else None
good = True
rgs = np.array(man["rg_node_start"])
spnode = {int(x): k for k, x in enumerate(sp.column("node").to_numpy())} if sp is not None else {}
sp_par = sp.column("parent").to_numpy() if sp is not None else None
for t_ in rng.choice(np.flatnonzero(tip), min(2000, man["tips"]), replace=False):
    g = int(np.searchsorted(rgs, t_, side="right") - 1)
    chain = []
    i = int(t_)
    while i >= rgs[g] and i > 0:
        chain.append(i); i = int(par[i])         # inside the group: parent column of that group only
    if i >= 0 and i < rgs[g] or i == 0 and rgs[g] > 0:
        chain += [x for x in reversed(man["rg_open"][g]) if int(end[x]) > t_]
    elif i == 0 and rgs[g] == 0:
        chain.append(0)
    truth = []
    i = int(t_)
    while True:
        truth.append(i)
        if i == 0: break
        i = int(par[i])
    if sorted(set(chain)) != sorted(truth): good = False; break
check("path root->tip from one node row group + rg_open (2000 random tips)", good)
print("\nALL PASS" if not fails else "\nFAILED: " + ", ".join(fails))
sys.exit(1 if fails else 0)
