#!/usr/bin/env python3
# Not run with -I: DendroPy is third-party (see dendropy-oracle.py). A test tool, not a data script.
"""Per-file summary of the trees DendroPy reads from NEXUS files, for nexus-dendropy-corpus.mjs.

Usage: dendropy-nexus-summary.py file.nex ...   (one JSON object per file on stdout)

For each file: the number of trees and, for the first, second and last tree, the tip labels (sorted), tip and node
counts, the number of branch lengths and their sum, and the root's number of children. Underscores are kept
(preserve_underscores) because gbif-phylo keeps them too. Files are read as UTF-8, or as latin-1 if they are not UTF-8,
so that a stray byte does not decide the outcome; the JS side reads them the same way.
"""
import hashlib
import json
import math
import signal
import sys
import zlib

import dendropy


def signature(tree):
    """A hash of the tree's shape and lengths: for every node but the root, the sum of the CRC32 of the labels of its tips
    (mod 2^32), its tip count and its edge length times 1e9, rounded half up (like Math.round). nexus-dendropy-corpus.mjs computes the same."""
    acc = {}
    items = []
    for node in tree.postorder_node_iter():
        kids = node.child_nodes()
        if kids:
            total = sum(acc[id(k)][0] for k in kids) % 2**32
            size = sum(acc[id(k)][1] for k in kids)
        else:
            total = zlib.crc32((node.taxon.label if node.taxon is not None else "").encode("utf-8"))
            size = 1
        acc[id(node)] = (total, size)
        if node is not tree.seed_node:
            ln = "-" if node.edge_length is None else str(math.floor(node.edge_length * 1e9 + 0.5))
            items.append(f"{total}:{size}:{ln}")
    items.sort()
    return hashlib.sha1("\n".join(items).encode()).hexdigest()[:16]


def summary(tree):
    leaves = list(tree.leaf_node_iter())
    nodes = list(tree.preorder_node_iter())
    lens = [n.edge_length for n in nodes if n is not tree.seed_node and n.edge_length is not None]
    return {
        "tips": len(leaves),
        "nodes": len(nodes),
        "labels": sorted((l.taxon.label if l.taxon is not None else "") for l in leaves),
        "nlen": len(lens),
        "lensum": sum(lens),
        "rootChildren": len(tree.seed_node.child_nodes()),
        "sig": signature(tree),
    }


class Timeout(Exception):
    pass


def on_alarm(*_):
    raise Timeout()


signal.signal(signal.SIGALRM, on_alarm)

for path in sys.argv[1:]:
    out = {"file": path}
    signal.alarm(60)
    try:
        raw = open(path, "rb").read()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("latin-1")
        try:
            trees = dendropy.TreeList.get(data=text, schema="nexus", preserve_underscores=True)
        except dendropy.dataio.nexusreader.NexusReader.TooManyTaxaError:
            # several TAXA blocks: TreeList reads one taxon namespace only, DataSet reads them all. The trees of its tree
            # lists, block after block, are numbered as parseNexus numbers them.
            data = dendropy.DataSet.get(data=text, schema="nexus", preserve_underscores=True)
            trees = [t for tl in data.tree_lists for t in tl]
            out["via"] = "DataSet"
        out["treeCount"] = len(trees)
        picks = sorted({0, 1, len(trees) - 1} & set(range(len(trees))))
        out["trees"] = {str(i): summary(trees[i]) for i in picks}
    except Timeout:
        out["error"] = "timeout"
    except Exception as e:  # DendroPy raises its own error classes
        out["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    signal.alarm(0)
    print(json.dumps(out), flush=True)
