#!/usr/bin/env python3
"""Derive every ladder rung from the downloaded source files and write manifest data.

    python3 -I ladder.py CACHE_DIR OUT_DIR [rung-id ...]

CACHE_DIR holds the untouched downloads (see fetch.sh for names). Rungs are written to
OUT_DIR/<id>.nwk.gz (gzip level 9, mtime 0, no file name) and OUT_DIR/<id>.stats.json.
The sha256 of the UNCOMPRESSED .nwk is the identity of a rung (the gzip bytes can differ between
zlib builds). Only the standard library is used; downloaded content is parsed, never executed.
"""
import gzip, hashlib, io, json, lzma, os, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # -I removes the script dir from sys.path; add it back for nwk.py only
import nwk  # noqa: E402

SEED = "gbif-phylo-ladder-1"

# source key -> (file in cache, loader)
SOURCES = {
    "otl": "opentree16.1/labelled_supertree_simplified_ottnames.tre",
    "gtdb-ar53": "gtdb/ar53.tree.gz",
    "gtdb-bac120": "gtdb/bac120.tree.gz",
    "fish-timetree": "fishtree/actinopt_12k_treePL.tre.xz",
    "fish-raxml": "fishtree/actinopt_12k_raxml.tre.xz",
}

# id, source, op, argument, K (for sample)
RUNGS = [
    ("otl-0200-canidae", "otl", "clade", "Canidae_ott770319", None),
    ("otl-1k-testudines", "otl", "clade", "Testudines_ott639666", None),
    ("otl-10k-amphibia", "otl", "clade", "Amphibia_ott544595", None),
    ("otl-100k-vertebrata", "otl", "clade", "Vertebrata_ott801601", None),
    ("otl-1m-metazoa", "otl", "clade", "Metazoa_ott691846", None),
    ("otl-2m-full", "otl", "whole", None, None),
    ("otl-1k-vertebrata-random", "otl", "sample", "Vertebrata_ott801601", 1000),
    ("otl-10k-vertebrata-random", "otl", "sample", "Vertebrata_ott801601", 10000),
    ("gtdb-0200-iainarchaeia", "gtdb-ar53", "clade", "'99.0:p__Iainarchaeota; c__Iainarchaeia'", None),
    ("gtdb-1k-nitrososphaeria", "gtdb-ar53", "clade", "'98.0:c__Nitrososphaeria'", None),
    ("gtdb-10k-archaea", "gtdb-ar53", "whole", None, None),
    ("gtdb-100k-bacteria-random", "gtdb-bac120", "sample", None, 100000),
    ("gtdb-190k-bacteria", "gtdb-bac120", "whole", None, None),
    ("fish-0200-random", "fish-timetree", "sample", None, 200),
    ("fish-1k-random", "fish-timetree", "sample", None, 1000),
    ("fish-12k-timetree", "fish-timetree", "whole", None, None),
    ("fish-12k-raxml", "fish-raxml", "whole", None, None),
]


def read_text(path):
    if path.endswith(".xz"):
        op = lzma.open
    elif path.endswith(".gz"):
        op = gzip.open
    else:
        op = open
    with op(path, "rb") as f:
        return f.read().decode("utf-8", errors="replace")


def gz_write(path, data):
    with open(path, "wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as g:
            g.write(data)


def main(argv):
    if len(argv) < 3:
        sys.exit(__doc__)
    cache, out = argv[1], argv[2]
    want = set(argv[3:])
    os.makedirs(out, exist_ok=True)
    trees = {}
    for rid, src, op, arg, k in RUNGS:
        if want and rid not in want:
            continue
        if src not in trees:
            trees.clear()
            print("parsing", src, flush=True)
            trees[src] = nwk.Tree.parse(read_text(os.path.join(cache, SOURCES[src])))
        t = trees[src]
        keep = [t.nchild[i] == 0 for i in range(len(t))]
        root, collapse = 0, False
        if op == "clade":
            hits = [i for i in range(len(t)) if t.label[i] == arg and t.nchild[i]]
            assert len(hits) == 1, (rid, arg, len(hits))
            root = hits[0]
        elif op == "sample":
            if arg:
                hits = [i for i in range(len(t)) if t.label[i] == arg and t.nchild[i]]
                assert len(hits) == 1, (rid, arg, len(hits))
                root = hits[0]
            end = t.end()[root]
            cand = [i for i in range(root, end) if t.nchild[i] == 0]
            rank = sorted(cand, key=lambda i: (hashlib.sha256(
                ("%s:%s" % (SEED, t.label[i])).encode()).hexdigest(), i))
            keep = [False] * len(t)
            for i in rank[:k]:
                keep[i] = True
            collapse = True
        buf = io.StringIO()
        n = t.write(buf, keep, root=root, collapse_unary=collapse)
        data = buf.getvalue().encode("utf-8")
        gz_write(os.path.join(out, rid + ".nwk.gz"), data)
        with open(os.path.join(out, rid + ".nwk.sha256"), "w") as f:
            f.write(hashlib.sha256(data).hexdigest() + "\n")
        print(rid, "tips", n, "bytes", len(data), flush=True)


if __name__ == "__main__":
    main(sys.argv)
