#!/usr/bin/env python3
"""Writes newick/radial_depth_<N>_support.nwk.gz: tips that end at very different radii, for the radial spacing work (issue 117, for 110).

    python3 -I make_radial_depth.py        (deterministic, seeded, standard library only, no recursion)

Radial layout gives every tip the same angle step, 2 pi / tips, and puts a tip at the radius of its root distance. Tips at 30% of
the radius therefore sit a third as far apart (in pixels) as tips at the full radius. Three groups of clades hang off the root
(a flat polytomy under the root, so the root has one child per clade), interleaved round the circle in a shuffled order:

  inner_NNN  30 clades, each a polytomy of 20 to 60 tips, tips at 0.30 +- 0.02 of the full root distance (crowded)
  mid_NNN    14 clades, each a random binary clade of 15 to 45 tips, tips at 0.60 +- 0.02
  outer_NNN  30 clades, each a random binary clade of 15 to 45 tips, tips all at 1.00 (the full radius, well spaced)

Root distance 1.0 is the longest tip. With about 2,500 tips and a radial view of radius R px, neighbouring tips are about
2 pi R / N * depth apart; the script prints this for a few zooms. CC0, generated, no real data. Every internal node, the root included, has a support value 1 - u^3 (two decimals), so Bootstrap and collapse by support have
something to show. Labels `inner_017`, `mid_042`,
`outer_204` (numbered within the group in leaf order), so it is clear on screen which tips are crowded.
"""
import gzip, math, os, sys, zlib, random

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = zlib.crc32(b"radial_depth_v1")
GROUPS = [  # name, clades, min tips, max tips, tip depth, binary?
    ("inner", 30, 20, 60, 0.30, False),
    ("mid", 14, 15, 45, 0.60, True),
    ("outer", 30, 15, 45, 1.00, True),
]


def num(x):
    return ("%.4f" % x).rstrip("0").rstrip(".") or "0"


def support(rnd):
    """Support value on an internal node: 1 - u^3, two decimals (the same as the other synthetic trees' `_support` files)."""
    return "%.2f" % (1 - rnd.random() ** 3)


def binary_clade(n, start, tip_depth, rnd, labels):
    """Newick of a random binary clade of n tips: its root at root distance `start`, internal nodes spread in between, every tip
    at about `tip_depth`. Iterative: a stack of text pieces and pending (n, depth, parent depth) nodes, popped in output order."""
    out = []
    stack = [(n, start, 0.0)]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            out.append(item)
            continue
        k, depth, parent = item
        tail = ":" + num(depth - parent)
        if k == 1:
            out.append(labels.pop(0) + tail)
            continue
        left = 1 + int(rnd.random() * (k - 1))
        step = lambda: depth + (tip_depth - depth) * (0.3 + 0.35 * rnd.random())
        stack.append(")" + support(rnd) + tail)
        stack.append((k - left, step() if k - left > 1 else tip_depth + 0.02 * (rnd.random() - 0.5), depth))
        stack.append(",")
        stack.append((left, step() if left > 1 else tip_depth + 0.02 * (rnd.random() - 0.5), depth))
        stack.append("(")
    return "".join(out)


def build():
    rnd = random.Random(SEED)
    plan = []  # (group index, tip count)
    for gi, (name, clades, lo, hi, depth, binary) in enumerate(GROUPS):
        for _ in range(clades):
            plan.append((gi, lo + int(rnd.random() * (hi - lo + 1))))
    for i in range(len(plan) - 1, 0, -1):  # Fisher-Yates with random(), so the order does not depend on the Python version
        j = int(rnd.random() * (i + 1))
        plan[i], plan[j] = plan[j], plan[i]
    counters = [0] * len(GROUPS)
    clades = []
    for gi, n in plan:
        name, _, _, _, depth, binary = GROUPS[gi]
        labels = ["%s_%03d" % (name, counters[gi] + i + 1) for i in range(n)]
        counters[gi] += n
        if binary:
            clades.append(binary_clade(n, 0.45 * depth, depth, rnd, labels))
        else:
            parent = 0.65 * depth
            tips = ["%s:%s" % (lab, num(depth + 0.04 * (rnd.random() - 0.5) - parent)) for lab in labels]
            clades.append("(" + ",".join(tips) + ")" + support(rnd) + ":" + num(parent))
    return clades, counters, plan


def main():
    clades, counters, plan = build()
    text = "(" + ",".join(clades) + ")" + support(random.Random(SEED + 1)) + ";\n"
    tips = sum(counters)
    out = os.path.join(HERE, "newick", "radial_depth_%d_support.nwk.gz" % tips)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with gzip.GzipFile(out, "wb", mtime=0) as f:
        f.write(text.encode("utf-8"))
    print(out, tips, "tips", dict(zip([g[0] for g in GROUPS], counters)), len(text), "bytes,", os.path.getsize(out), "gzipped")
    # spacing between neighbouring tips (px) at radius fraction f of the longest tip: 2 pi R f / N, R = radius of the full view * zoom
    print("zoom  R px   inner (0.30)  mid (0.60)  outer (1.00)   [arc between neighbouring tips, px]")
    for zoom, r in ((1, 300), (4, 1200), (8, 2400), (12, 3600), (16, 4800), (24, 7200)):
        a = [2 * math.pi * r * f / tips for f in (0.30, 0.60, 1.00)]
        print("%4d %6d %12.1f %11.1f %13.1f" % (zoom, r, *a))


if __name__ == "__main__":
    main()
