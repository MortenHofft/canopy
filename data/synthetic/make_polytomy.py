#!/usr/bin/env python3
"""Writes newick/polytomy_demo_17000.nwk.gz: a tree with huge polytomies, for the level-of-detail work on wide nodes.

    python3 -I make_polytomy.py            (deterministic, standard library only, no recursion)

Tips (17,000):  two balanced clades of 2,000 tips (branch length 1), a star of 10,000 tips whose children all have length 1
(the pure-cladogram case: a slice with a clean outer edge), and a star of 3,000 tips with varied child lengths 0.2 to 2.2
(the case where the tips end at different depths). The star nodes hang off the root by a branch of length 10, so their tips
sit near the outer edge in radial layout. Labels are `Genus_species_N`; CC0, generated, no real data.
"""
import gzip, os, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))


def balanced(n, prefix):
    """Balanced binary clade as Newick text, built bottom-up (no recursion)."""
    level = ["%s_sp_%d:1" % (prefix, i) for i in range(n)]
    while len(level) > 1:
        nxt = ["(%s,%s):1" % (level[j], level[j + 1]) for j in range(0, len(level) - 1, 2)]
        if len(level) % 2:
            nxt.append(level[-1])
        level = nxt
    return level[0]


def star(n, prefix, varied):
    parts = []
    for i in range(n):
        length = 1.0 if not varied else 0.2 + 2.0 * (((i * 7919) % 1000) / 999.0)  # deterministic spread 0.2 to 2.2
        parts.append("%s_sp_%d:%s" % (prefix, i, ("%.3f" % length).rstrip("0").rstrip(".")))
    return "(" + ",".join(parts) + "):10"


text = "(%s,%s,%s,%s);\n" % (balanced(2000, "Alpha"), star(10000, "Starus", False), balanced(2000, "Beta"), star(3000, "Wideus", True))
out = os.path.join(HERE, "newick", "polytomy_demo_17000.nwk.gz")
with gzip.GzipFile(out, "wb", mtime=0) as f:
    f.write(text.encode("utf-8"))
print(out, len(text), "bytes uncompressed,", os.path.getsize(out), "bytes gzipped")
