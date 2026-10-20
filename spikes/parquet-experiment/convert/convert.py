#!/usr/bin/env python3
"""Reference converter: Newick -> Parquet layout.
  python3 -I convert.py TREE.nwk[.gz] OUTDIR [--rg 65536] [--codec zstd|snappy|none] [--f64] [--no-rollups] [--no-occ] [--enc default|tuned]
Needs numpy and pyarrow (see README)."""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import treearrays, layout

ap = argparse.ArgumentParser()
ap.add_argument("tree"); ap.add_argument("out")
ap.add_argument("--rg", type=int, default=65536)
ap.add_argument("--codec", default="zstd")
ap.add_argument("--f64", action="store_true")
ap.add_argument("--no-rollups", action="store_true")
ap.add_argument("--no-occ", action="store_true")
ap.add_argument("--enc", default="tuned")
ap.add_argument("--label-dict", action="store_true")
ap.add_argument("--cache", default=None)
A = ap.parse_args()
t0 = time.time()
a = treearrays.load_arrays(A.tree, A.cache)
t1 = time.time()
sizes, man = layout.write_all(a, A.out, dict(rg=A.rg, codec=A.codec, f64=A.f64, rollups=not A.no_rollups, occ=not A.no_occ, enc=A.enc, label_dict=A.label_dict))
print(json.dumps({"parse_arrays_s": round(t1 - t0, 2), "write_s": round(time.time() - t1, 2), "sizes": sizes}, indent=1))
