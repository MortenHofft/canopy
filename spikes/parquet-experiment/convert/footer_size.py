#!/usr/bin/env python3
"""Footer (Parquet metadata) size of nodes.parquet with and without column statistics, by row-group size.  python3 -I footer_size.py TREE CACHE"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pyarrow.parquet as pq
import treearrays, layout
a = treearrays.load_arrays(sys.argv[1], sys.argv[2])
print("rows/group  groups  footer with stats  footer without stats")
for rg in (4096, 8192, 16384, 65536):
    res = []
    for stats in (True, False):
        d = tempfile.mkdtemp()
        cfg = dict(rg=rg, codec="zstd", f64=False, rollups=True, occ=True, enc="tuned")
        orig = layout.writer_opts
        layout.writer_opts = lambda c, cols, o=orig, st=stats: {**o(c, cols), "write_statistics": st}
        layout.write_all(a, d, cfg, only="nodes+tips")
        layout.writer_opts = orig
        m = pq.ParquetFile(os.path.join(d, "nodes.parquet")).metadata
        res.append((m.num_row_groups, m.serialized_size + 8, os.path.getsize(os.path.join(d, "nodes.parquet"))))
    print(f"{rg:>8} {res[0][0]:>8} {res[0][1]:>12,} B {res[1][1]:>12,} B   (file {res[0][2]/1e6:.2f} MB / {res[1][2]/1e6:.2f} MB)")
