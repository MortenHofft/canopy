#!/usr/bin/env python3
# Not run with -I: DendroPy is third-party (see dendropy-oracle.py). A test tool, not a data script.
"""Per-file summary of the trees DendroPy reads from NEXUS files, for nexus-dendropy-corpus.mjs.

Usage: dendropy-nexus-summary.py file.nex ...   (one JSON object per file on stdout)

For each file: the number of trees and, for the first, second and last tree, the tip labels (sorted), tip and node
counts, the number of branch lengths and their sum, and the root's number of children. Underscores are kept
(preserve_underscores) because gbif-phylo keeps them too. Files are read as latin-1 so that a stray non-UTF-8 byte
does not decide the outcome; the JS side reads them the same way.
"""
import json
import signal
import sys

import dendropy


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
        with open(path, encoding="latin-1") as fh:
            text = fh.read()
        trees = dendropy.TreeList.get(data=text, schema="nexus", preserve_underscores=True)
        out["treeCount"] = len(trees)
        picks = sorted({0, 1, len(trees) - 1} & set(range(len(trees))))
        out["trees"] = {str(i): summary(trees[i]) for i in picks}
    except Timeout:
        out["error"] = "timeout"
    except Exception as e:  # DendroPy raises its own error classes
        out["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    signal.alarm(0)
    print(json.dumps(out), flush=True)
