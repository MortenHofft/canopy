#!/usr/bin/env python3
# Not run with -I: Biopython is third-party (see dendropy-oracle.py). A test tool, not a data script.
"""Per-file summary of the phylogenies Biopython reads from phyloXML files, for phyloxml-biopython-corpus.mjs.

Usage: biopython-phyloxml-summary.py [--all] file.xml[.gz] ...   (one JSON object per file on stdout)

For each file: the number of phylogenies and, for the first, second and last (every one with --all), the tip labels (sorted), tip and node counts, the
number of branch lengths and their sum, the number of supports (the first numeric confidence of a clade) and their sum, the root's
number of children, and a hash of the shape with every edge length (the same as signature() in nexus-shape.mjs). A node is named by
its <name>, else its taxonomy's scientific name, else the first of taxonomy code, common name, sequence name and accession, as
parsePhyloXml does by default.
"""
import gzip
import hashlib
import io
import json
import math
import signal
import sys
import zlib

from Bio import Phylo


def label(c):
    if c.name:
        return c.name
    tax = c.taxonomies[0] if c.taxonomies else None
    if tax is not None and tax.scientific_name:
        return tax.scientific_name
    for t in c.taxonomies:
        if t.code:
            return t.code
        if t.common_names:
            return t.common_names[0]
    for s in c.sequences:
        if s.name:
            return s.name
        if s.accession is not None and s.accession.value:
            return s.accession.value
    return ""


def first_support(c):
    # Biopython also lists the confidence of the <events> element among the clade's confidences; it is the confidence of the
    # event, not of the branch, so it is left out here (as parsePhyloXml leaves it out of the support).
    own = list(c.confidences)
    if c.events is not None and c.events.confidence is not None:
        for conf in own:
            if conf.type == c.events.confidence.type and conf.value == c.events.confidence.value:
                own.remove(conf)
                break
    for conf in own:
        if conf.value is not None and not math.isnan(conf.value):
            return conf.value
    return None


def summary(tree):
    root = tree.root
    acc = {}
    items = []
    nodes = 0
    tips = 0
    labels = []
    lens = []
    sups = []
    for c in tree.find_clades(order="postorder"):
        nodes += 1
        kids = c.clades
        if kids:
            total = sum(acc[id(k)][0] for k in kids) % 2**32
            size = sum(acc[id(k)][1] for k in kids)
        else:
            lab = label(c)
            tips += 1
            labels.append(lab)
            total = zlib.crc32(lab.encode("utf-8"))
            size = 1
        acc[id(c)] = (total, size)
        s = first_support(c)
        if s is not None:
            sups.append(s)
        if c is not root:
            bl = c.branch_length
            if bl is not None:
                lens.append(bl)
            ln = "-" if bl is None else str(math.floor(bl * 1e9 + 0.5))
            items.append(f"{total}:{size}:{ln}")
    items.sort()
    return {
        "tips": tips,
        "nodes": nodes,
        "labels": sorted(labels),
        "nlen": len(lens),
        "lensum": sum(lens),
        "nsup": len(sups),
        "supsum": sum(sups),
        "rootChildren": len(root.clades),
        "sig": hashlib.sha1("\n".join(items).encode()).hexdigest()[:16],
    }


class Timeout(Exception):
    pass


def on_alarm(*_):
    raise Timeout()


signal.signal(signal.SIGALRM, on_alarm)

every = "--all" in sys.argv
for path in [a for a in sys.argv[1:] if a != "--all"]:
    out = {"file": path}
    signal.alarm(300)
    try:
        fh = gzip.open(path, "rb") if path.endswith(".gz") else open(path, "rb")
        with fh:
            raw = fh.read()
        trees = list(Phylo.parse(io.BytesIO(raw), "phyloxml"))
        if not trees and b"xmlns" not in raw:
            # Biopython requires the phyloXML namespace (the PANTHER files have none): add it in memory and read again
            out["namespaceAdded"] = True
            trees = list(Phylo.parse(io.BytesIO(raw.replace(b"<phyloxml", b'<phyloxml xmlns="http://www.phyloxml.org"', 1)), "phyloxml"))
        out["treeCount"] = len(trees)
        picks = list(range(len(trees))) if every else sorted({0, 1, len(trees) - 1} & set(range(len(trees))))
        out["trees"] = {str(i): summary(trees[i]) for i in picks}
    except Timeout:
        out["error"] = "timeout"
    except Exception as e:
        out["error"] = f"{type(e).__name__}: {str(e)[:200]}"
    signal.alarm(0)
    print(json.dumps(out), flush=True)
