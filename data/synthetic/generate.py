#!/usr/bin/env python3
"""Deterministic synthetic phylogenetic tree generator (pure Python 3 stdlib).

Everything is iterative (no recursion) so it works at 1,000,000 tips, and
everything is seeded: the same arguments always give byte-identical files.
Only random.Random.random() is used (plus our own helpers), so output does
not depend on the version-specific behaviour of randrange/sample/shuffle.

Usage:
  python3 generate.py --out DIR --sizes 200,1000,10000
  python3 generate.py --out DIR --sizes 100000,1000000
  python3 generate.py --out DIR --sizes 200 --shapes yule,mixed

Output layout under DIR: newick/ nexus/ meta/ align/ (+ timings.json).
See README.md for the shapes, variants and what each is meant to stress.
"""
import argparse
import bisect
import json
import math
import os
import random
import sys
import time
import zlib

SHAPES = ["yule", "birthdeath", "balanced", "caterpillar", "bushy", "mixed"]
HEIGHT = 100.0           # root-to-tip height of ultrametric trees (arbitrary units, "Myr")
BASE_SEED = 20261008
LARGE_FROM = 100000      # from this tip count, only a reduced set of variants is written

# suffix -> (tip names, branch lengths, internal labels)
VARIANTS = {
    "": ("species", True, None),
    "_nobl": ("species", False, None),
    "_ids": ("ids", True, None),
    "_support": ("species", True, "support"),
    "_nodenames": ("species", True, "names"),
}
LARGE_VARIANTS = {"yule": list(VARIANTS), "caterpillar": ["", "_nobl"]}


# ----------------------------------------------------------------- randomness
class Rng:
    def __init__(self, *key):
        s = zlib.crc32(("|".join(str(k) for k in (BASE_SEED,) + key)).encode())
        self.r = random.Random(s)
        self.u = self.r.random

    def below(self, n):
        return int(self.u() * n)

    def exp(self, rate):
        return -math.log(1.0 - self.u()) / rate

    def gauss(self):
        return math.sqrt(-2.0 * math.log(1.0 - self.u())) * math.cos(2.0 * math.pi * self.u())

    def shuffle(self, a):
        for i in range(len(a) - 1, 0, -1):
            j = self.below(i + 1)
            a[i], a[j] = a[j], a[i]


# ------------------------------------------------------------ topology models
# Every *_arrays(n, rng) returns (kids, t): kids[i] is a tuple of child ids
# (empty tuple = tip), t[i] is the node time in [0, 1] (root 0, tips 1 for
# ultrametric shapes). Node 0 is the root and children always have larger ids
# than their parent (this lets later passes run as simple forward/backward loops).

def yule_arrays(n, rng):
    if n == 1:
        return [()], [1.0]
    kids, t, tips, now = [()], [0.0], [0], 0.0
    while len(tips) < n:
        k = len(tips)
        if k > 1:
            now += rng.exp(k)
        i = rng.below(k)
        x = tips[i]
        a = len(kids)
        kids[x] = (a, a + 1)
        t[x] = now
        kids.append(())
        kids.append(())
        t.append(0.0)
        t.append(0.0)
        tips[i] = a
        tips.append(a + 1)
    end = now + rng.exp(n)
    t = [v / end for v in t]
    for x in tips:
        t[x] = 1.0
    return kids, t


def birthdeath_arrays(n, rng, lam=1.0, mu=0.5):
    """Forward birth-death simulation until n lineages are extant, then prune
    extinct lineages and collapse the resulting unary nodes (reconstructed tree)."""
    tot = lam + mu
    pb = lam / tot
    while True:
        parent, t, ext, now = [-1], [0.0], [0], 0.0
        while 0 < len(ext) < n:
            k = len(ext)
            now += rng.exp(tot * k)
            i = rng.below(k)
            x = ext[i]
            t[x] = now
            if rng.u() < pb:
                a = len(parent)
                parent.extend((x, x))
                t.extend((0.0, 0.0))
                ext[i] = a
                ext.append(a + 1)
            else:
                ext[i] = ext[-1]
                ext.pop()
        if ext:
            break          # else: whole clade died out, retry with the same stream
    end = now + rng.exp(tot * n)
    N = len(parent)
    keep = [False] * N
    for x in ext:
        keep[x] = True
        t[x] = end
    kc = [0] * N
    for i in range(N - 1, 0, -1):
        if keep[i]:
            p = parent[i]
            keep[p] = True
            kc[p] += 1
    removed = [keep[i] and kc[i] == 1 for i in range(N)]
    ep = [-1] * N
    newid = [-1] * N
    m = 0
    for i in range(N):
        if not keep[i]:
            continue
        p = parent[i]
        if p >= 0:
            ep[i] = ep[p] if removed[p] else p
        if not removed[i]:
            newid[i] = m
            m += 1
    kl = [None] * m
    tt = [0.0] * m
    for i in range(N):
        j = newid[i]
        if j < 0:
            continue
        tt[j] = t[i]
        e = ep[i]
        if e >= 0:
            ne = newid[e]
            if kl[ne] is None:
                kl[ne] = [j]
            else:
                kl[ne].append(j)
    kids = [tuple(l) if l else () for l in kl]
    t0 = tt[0]
    span = end - t0
    return kids, [(v - t0) / span for v in tt]


def balanced_arrays(n, rng=None):
    size, depth, kids, i = [n], [0], [], 0
    D = max(1, (n - 1).bit_length())
    while i < len(size):
        m = size[i]
        if m == 1:
            kids.append(())
        else:
            a = (m + 1) // 2
            c = len(size)
            size.extend((a, m - a))
            depth.extend((depth[i] + 1, depth[i] + 1))
            kids.append((c, c + 1))
        i += 1
    t = [1.0 if not kids[i] else depth[i] / D for i in range(len(kids))]
    return kids, t


def caterpillar_arrays(n, rng):
    """Fully ladderised: every internal node has one tip (listed first) and the
    next spine node. Depth n-1. Spine split times are cumulative Exp(1)
    increments rescaled to [0,1], so the tree is ultrametric and almost all
    spine edges are tiny relative to the root height."""
    if n == 1:
        return [()], [1.0]
    N = 2 * n - 1
    kids = [()] * N
    t = [1.0] * N
    for j in range(n - 1):
        kids[2 * j] = (2 * j + 1, 2 * j + 2)
    c, cum = 0.0, [0.0]
    for _ in range(n - 1):
        c += rng.exp(1.0)
        cum.append(c)
    for j in range(n - 1):
        t[2 * j] = cum[j] / c
    return kids, t


def bushy_arrays(n, rng):
    """Random polytomies: each internal node has a random degree in 2..20 (capped
    by the number of tips below it) and its tips are split at random cut points."""
    size, kids, i = [n], [], 0
    while i < len(size):
        m = size[i]
        if m == 1:
            kids.append(())
        else:
            dmax = min(20, m)
            d = 2 + rng.below(dmax - 1)
            if d == m:
                parts = [1] * m
            else:
                cuts = set()
                while len(cuts) < d - 1:
                    cuts.add(1 + rng.below(m - 1))
                cs = sorted(cuts)
                parts = [b - a for a, b in zip([0] + cs, cs + [m])]
            c = len(size)
            size.extend(parts)
            kids.append(tuple(range(c, c + d)))
        i += 1
    N = len(kids)
    h = [0] * N
    for i in range(N - 1, -1, -1):
        ch = kids[i]
        if ch:
            h[i] = 1 + max(h[c] for c in ch)
    H = h[0] or 1
    return kids, [(H - h[i]) / H for i in range(N)]


SUBTREE = {"yule": yule_arrays, "cat": caterpillar_arrays, "bushy": bushy_arrays}


def mixed_arrays(n, rng):
    """Yule backbone whose tips are replaced by clades: 3 giant clades (50% of
    tips: two Yule, one polytomous), 6 caterpillar subtrees (~20% of tips) and
    many small Yule clades (the rest), grafted at random times so the whole tree
    stays ultrametric."""
    giants = [int(n * f) for f in (0.25, 0.15, 0.10)]
    cats = [max(3, int(n * 0.2 / 6 * (0.5 + rng.u()))) for _ in range(6)]
    R = max(6, int(math.sqrt(n) / 2))
    rest = n - sum(giants) - sum(cats)
    assert rest >= R, "n too small for the mixed shape"
    w = [rng.exp(1.0) for _ in range(R)]
    W = sum(w)
    others = [1 + int((rest - R) * x / W) for x in w]
    others[0] += rest - sum(others)
    sizes = giants + cats + others
    kinds = ["yule", "yule", "bushy"] + ["cat"] * 6 + ["yule"] * R
    kids, t = yule_arrays(len(sizes), rng)
    par = [-1] * len(kids)
    for p, ch in enumerate(kids):
        for c in ch:
            par[c] = p
    btips = [i for i, ch in enumerate(kids) if not ch]
    rng.shuffle(btips)
    for x, m, kind in zip(btips, sizes, kinds):
        p = par[x]
        t0 = t[p] + (0.2 + 0.6 * rng.u()) * (1.0 - t[p])
        if m == 1:
            t[x] = 1.0
            continue
        ks, ts = SUBTREE[kind](m, rng)
        base = len(kids)
        kids[x] = tuple(base + c - 1 for c in ks[0])
        t[x] = t0
        for l in range(1, len(ks)):
            kids.append(tuple(base + c - 1 for c in ks[l]))
            t.append(1.0 if not ks[l] else t0 + (1.0 - t0) * ts[l])
    return kids, t


MODELS = {"yule": yule_arrays, "birthdeath": birthdeath_arrays, "balanced": balanced_arrays,
          "caterpillar": caterpillar_arrays, "bushy": bushy_arrays, "mixed": mixed_arrays}


def make_tree(shape, n):
    kids, t = MODELS[shape](n, Rng("topology", shape, n))
    return kids, [v * HEIGHT for v in t]


# ---------------------------------------------------------------------- labels
ONSETS = ["b", "c", "d", "f", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z",
          "ch", "th", "ph", "tr"]
SYL = [o + v for o in ONSETS for v in "aeiou"]                       # 100 syllables
SUFFIX = ["us", "a", "ia", "ella", "is", "ium", "ina", "odon"]
GENUS_SPACE = 100 ** 3 * len(SUFFIX)                                 # 8,000,000 genera
STEMS = ("alba nigra rubra viridis minor major vulgaris communis gracilis elegans robusta "
         "pumila montana sylvestris aquatica maritima orientalis occidentalis australis "
         "borealis hirsuta glabra lata longa brevis parva magna rara vera nova antiqua "
         "pallida fusca lutea rosea caerulea aurea argentea tenuis crassa").split()
PREFIX = ["", "sub", "pseudo", "neo", "micro", "macro", "para", "eu", "pro", "mega"]
EPITHETS = [p + s for p in PREFIX for s in STEMS]                    # 400 epithets
STRIDES = [3, 7, 9, 11, 13, 17, 19, 21, 23, 27, 29, 31, 33, 37, 39]  # coprime with 400


def genus_name(g):
    x = (g * 2654435761 + 97) % GENUS_SPACE          # bijection on the genus space
    x, s = divmod(x, len(SUFFIX))
    a, r = divmod(x, 10000)
    b, c = divmod(r, 100)
    return (SYL[a] + SYL[b] + SYL[c] + SUFFIX[s]).capitalize()


def species_names(n):
    """n unique Genus_species names in blocks (a genus owns consecutive tips)."""
    rng = Rng("names", n)
    out, g = [], 0
    while len(out) < n:
        m = min(n - len(out), 1 + int(-math.log(1.0 - rng.u()) * 4.0), 40)
        gen = genus_name(g)
        g += 1
        start, stride = rng.below(400), STRIDES[rng.below(len(STRIDES))]
        out.extend(gen + "_" + EPITHETS[(start + j * stride) % 400] for j in range(m))
    return out


def opaque_ids(n):
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = []
    for k in range(n):
        x = (k * 2654435761 + 777) % 36 ** 7
        s = ""
        for _ in range(7):
            x, d = divmod(x, 36)
            s = digits[d] + s
        out.append("t" + s)
    return out


# ---------------------------------------------------------------------- output
def leaf_order(kids):
    out, st = [], [0]
    while st:
        x = st.pop()
        ch = kids[x]
        if ch:
            st.extend(reversed(ch))
        else:
            out.append(x)
    return out


def tip_labels(kids, names):
    lab = [None] * len(kids)
    for x, nm in zip(leaf_order(kids), names):
        lab[x] = nm
    return lab


def internal_labels(kids, kind, shape, n):
    if kind is None:
        return None
    if kind == "names":
        return ["n%d" % i if ch else "" for i, ch in enumerate(kids)]
    rng = Rng("support", shape, n)
    return ["%.2f" % (1.0 - rng.u() ** 3) if ch else "" for ch in kids]


def newick_body(kids, t, lab, with_bl, ilab):
    """Iterative Newick writer (no trailing ';'). lab[i] = tip label."""
    N = len(kids)
    plen = None
    if with_bl:
        plen = [""] * N
        for p, ch in enumerate(kids):
            tp = t[p]
            for c in ch:
                plen[c] = ":%.6f" % (t[c] - tp)
    out, push = [], None
    push = out.append
    st = [0]
    spush, spop = st.append, st.pop
    while st:
        x = spop()
        if x.__class__ is str:
            push(x)
            continue
        ch = kids[x]
        if ch:
            push("(")
            close = ")"
            if ilab is not None:
                close += ilab[x]
            if plen is not None and x:
                close += plen[x]
            spush(close)
            for idx in range(len(ch) - 1, -1, -1):
                spush(ch[idx])
                if idx:
                    spush(",")
        else:
            push(lab[x] if plen is None else lab[x] + plen[x])
    return "".join(out)


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="\n") as f:
        f.write(text)


def write_nexus(path, taxa, trees, note):
    parts = ["#NEXUS\n[%s]\n\nBEGIN TAXA;\n\tDIMENSIONS NTAX=%d;\n\tTAXLABELS\n" % (note, len(taxa))]
    parts.extend("\t\t%s\n" % x for x in taxa)
    parts.append("\t;\nEND;\n\nBEGIN TREES;\n\tTRANSLATE\n")
    parts.append(",\n".join("\t\t%d %s" % (i + 1, x) for i, x in enumerate(taxa)))
    parts.append("\n\t;\n")
    parts.extend("\tTREE %s = [&R] %s;\n" % (nm, body) for nm, body in trees)
    parts.append("END;\n")
    write_text(path, "".join(parts))


def tree_stats(kids):
    N = len(kids)
    d = [0] * N
    mx = 0
    for p, ch in enumerate(kids):
        for c in ch:
            d[c] = d[p] + 1
    mx = max(d)
    tips = sum(1 for ch in kids if not ch)
    return {"tips": tips, "nodes": N, "max_depth": mx}


# ------------------------------------------------------------ metadata / align
COUNTRIES = ("US GB DE FR AU BR CN ES CA NL SE NO DK FI MX CO ZA IN JP AR IT CH PE NZ").split()


def write_metadata(path, shape, n, kids, t, lab):
    rng = Rng("meta", shape, n)
    N = len(kids)
    trait = [0.0] * N
    for p, ch in enumerate(kids):
        for c in ch:
            trait[c] = trait[p] + 0.1 * math.sqrt(t[c] - t[p]) * rng.gauss()
    cum, s = [], 0.0
    for i in range(len(COUNTRIES)):
        s += 1.0 / (i + 1)
        cum.append(s)
    cur = COUNTRIES[0]
    rows, extra = [], 0
    for x in leaf_order(kids):
        if rng.u() < 0.15:   # country changes along the leaf order: clade-correlated runs
            cur = COUNTRIES[min(bisect.bisect(cum, rng.u() * s), len(COUNTRIES) - 1)]
        cnt = 0 if rng.u() < 0.08 else min(int(rng.u() ** (-1 / 0.7)), 10 ** 8)  # Pareto(alpha=0.7)
        if rng.u() < 0.02:
            continue         # deliberately missing: tip without metadata
        rows.append("%s\t%d\t%s\t%.4f" % (lab[x], cnt, cur, 5.0 + trait[x]))
    for i in range(3):       # deliberately extra: metadata row without tip
        rows.append("Extra_unmatched_%03d\t%d\t%s\t%.4f" % (i + 1, 1 + rng.below(50), COUNTRIES[i], 5.0))
    rng.shuffle(rows)
    write_text(path, "tip_label\toccurrence_count\tcountry_code\ttrait_value\n" + "\n".join(rows) + "\n")
    return len(rows)


def write_alignment(path, shape, n, kids, t, lab, ncol=200, mu=0.01):
    rng = Rng("align", shape, n)
    rates = [0.1, 0.5, 1.0, 2.4]          # 4 discrete site-rate classes
    site = [rng.below(4) for _ in range(ncol)]
    seq = {0: [rng.below(4) for _ in range(ncol)]}
    N = len(kids)
    for p in range(N):
        sp = seq.pop(p) if kids[p] else seq[p]
        for c in kids[p]:
            bl = t[c] - t[p]
            pc = [0.75 * (1.0 - math.exp(-4.0 / 3.0 * mu * r * bl)) for r in rates]   # Jukes-Cantor
            sc = list(sp)
            for s in range(ncol):
                if rng.u() < pc[site[s]]:
                    sc[s] = (sc[s] + 1 + rng.below(3)) & 3
            seq[c] = sc
    out = []
    for x in leaf_order(kids):
        s = "".join("ACGT"[v] for v in seq[x])
        if rng.u() < 0.1:    # some tips get a gap run
            L, a = 1 + rng.below(20), rng.below(ncol - 20)
            s = s[:a] + "-" * L + s[a + L:]
        out.append(">%s\n%s\n" % (lab[x], s))
    write_text(path, "".join(out))


# ------------------------------------------------------------------------ main
def run(out, sizes, shapes, timings):
    def tm(key, t0):
        timings[key] = round(time.perf_counter() - t0, 3)

    for n in sizes:
        for shape in shapes:
            T0 = time.perf_counter()
            kids, t = make_tree(shape, n)
            tm("build:%s_%d" % (shape, n), T0)
            names_sp = species_names(n)
            variants = LARGE_VARIANTS.get(shape, [""]) if n >= LARGE_FROM else list(VARIANTS)
            for suf in variants:
                nm, bl, internal = VARIANTS[suf]
                t1 = time.perf_counter()
                lab = tip_labels(kids, names_sp if nm == "species" else opaque_ids(n))
                body = newick_body(kids, t, lab, bl, internal_labels(kids, internal, shape, n))
                write_text(os.path.join(out, "newick", "%s_%d%s.nwk" % (shape, n, suf)), body + ";\n")
                tm("write:%s_%d%s" % (shape, n, suf), t1)
            lab = tip_labels(kids, names_sp)
            if shape == "yule" and n in (1000, 10000):
                write_metadata(os.path.join(out, "meta", "yule_%d.meta.tsv" % n), shape, n, kids, t, lab)
            if shape == "yule" and n in (200, 1000):
                write_alignment(os.path.join(out, "align", "yule_%d.fasta" % n), shape, n, kids, t, lab)
            if (shape, n) in (("yule", 200), ("mixed", 1000)):
                order = leaf_order(kids)
                num = [None] * len(kids)
                for k, x in enumerate(order):
                    num[x] = str(k + 1)
                il = internal_labels(kids, "support", shape, n) if shape == "mixed" else None
                write_nexus(os.path.join(out, "nexus", "%s_%d.nex" % (shape, n)), [lab[x] for x in order],
                            [("%s_%d" % (shape, n), newick_body(kids, t, num, True, il))],
                            "Synthetic %s tree, %d tips; TRANSLATE uses numeric ids" % (shape, n))
            if (shape, n) == ("yule", 200):
                taxa = [lab[x] for x in leaf_order(kids)]
                trees = []
                for r in range(10):
                    rr = Rng("multi", r)
                    k2, t2 = make_tree("yule", n) if r == 0 else (None, None)
                    if r:
                        k2, t2 = yule_arrays(n, rr)
                        t2 = [v * HEIGHT for v in t2]
                    perm = list(range(n))
                    rr.shuffle(perm)
                    num = [None] * len(k2)
                    for k, x in enumerate(leaf_order(k2)):
                        num[x] = str(perm[k] + 1)
                    trees.append(("rep_%03d" % (r + 1), newick_body(k2, t2, num, True, None)))
                write_nexus(os.path.join(out, "nexus", "multi_yule_200_x10.nex"), taxa, trees,
                            "10 Yule trees on the same 200 taxa (random tip assignment per tree)")
            tm("total:%s_%d" % (shape, n), T0)
            print("done %s n=%d  %.1fs" % (shape, n, timings["total:%s_%d" % (shape, n)]), file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--sizes", default="200,1000,10000")
    ap.add_argument("--shapes", default=",".join(SHAPES))
    a = ap.parse_args()
    timings = {}
    run(a.out, [int(x) for x in a.sizes.split(",")], a.shapes.split(","), timings)
    p = os.path.join(a.out, "timings.json")
    old = {}
    if os.path.exists(p):
        with open(p) as f:
            old = json.load(f)
    old.update(timings)
    with open(p, "w") as f:
        json.dump(old, f, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
