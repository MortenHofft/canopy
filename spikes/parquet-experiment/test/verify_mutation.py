#!/usr/bin/env python3
"""Negative test: tamper with one rollup in a copy of the sample layout and check that convert/verify.py FAILS.
  python3 -I test/verify_mutation.py   (needs pyarrow, numpy)"""
import os, shutil, subprocess, sys, tempfile
import pyarrow.parquet as pq, pyarrow as pa, numpy as np
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(here)
tree = os.path.join(root, "..", "..", "data", "synthetic", "newick", "yule_1000.nwk")
for col in ("tip_count", "max_cum", "max_depth", "occ_sum", "leaf_start"):
    d = tempfile.mkdtemp()
    shutil.copytree(os.path.join(root, "sample", "yule1k"), d, dirs_exist_ok=True)
    t = pq.read_table(os.path.join(d, "nodes.parquet"))
    v = t.column(col).to_numpy().copy(); v[len(v) // 2] += 1
    t = t.set_column(t.column_names.index(col), t.schema.field(col), pa.array(v, t.schema.field(col).type))
    pq.write_table(t, os.path.join(d, "nodes.parquet"), row_group_size=512)
    r = subprocess.run([sys.executable, "-I", os.path.join(root, "convert", "verify.py"), tree, d], capture_output=True, text=True)
    print(("OK  " if r.returncode != 0 else "BAD ") + f"tampered {col}: verify exit code {r.returncode}")
    shutil.rmtree(d)
