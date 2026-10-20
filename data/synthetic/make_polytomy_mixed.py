#!/usr/bin/env python3
"""Writes newick/polytomy_mixed_22800.nwk.gz: a MIXED polytomy, for the run merging in the level-of-detail cut (issue 13).

    python3 -I make_polytomy_mixed.py      (deterministic, standard library only, no recursion)

Tips (22,800): two balanced clades of 1,000 tips (branch length 1) and one node with 8,000 children, hanging off the root by a
branch of length 10 (so its tips sit near the outer edge in radial layout): 1,000 single tips, 6,900 pairs (clades of 2 tips)
and 100 balanced clades of 60 tips, all with child branch length 1. The small children are shuffled with a fixed linear
congruential generator and the 100 large clades are spread evenly through the order (one after every 79 small children). It
mimics the Polyphaga polytomy of the Open Tree of Life (8,550 children, a few large clades among thousands of small ones).
Labels are `Genus_species_N`; CC0, generated, no real data. scripts/check-radial-cut.mjs section 10 builds the same shape.
"""
import gzip, os, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))


def balanced(n, genus):
    """Balanced binary clade as Newick text, built bottom-up (no recursion)."""
    level = ["%s_sp_%d:1" % (genus, i) for i in range(n)]
    while len(level) > 1:
        nxt = ["(%s,%s):1" % (level[j], level[j + 1]) for j in range(0, len(level) - 1, 2)]
        if len(level) % 2:
            nxt.append(level[-1])
        level = nxt
    return level[0]


small = ["Single_sp_%d:1" % j for j in range(1000)]
small += ["(Pair%d_a:1,Pair%d_b:1):1" % (j, j) for j in range(6900)]
state = 12345
for j in range(len(small) - 1, 0, -1):  # Fisher-Yates with a fixed LCG
    state = (state * 1103515245 + 12345) & 0xFFFFFFFF
    q = (state * (j + 1)) >> 32
    small[j], small[q] = small[q], small[j]
kids = []
for b in range(100):
    kids += small[b * 79:(b + 1) * 79]
    kids.append(balanced(60, "Large%d" % b))

text = "(%s,%s,(%s):10);\n" % (balanced(1000, "Alpha"), balanced(1000, "Beta"), ",".join(kids))
out = os.path.join(HERE, "newick", "polytomy_mixed_22800.nwk.gz")
with gzip.GzipFile(out, "wb", mtime=0) as f:
    f.write(text.encode("utf-8"))
print(out, len(text), "bytes uncompressed,", os.path.getsize(out), "bytes gzipped")
