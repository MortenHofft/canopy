#!/usr/bin/env python3
"""Collect the byte sizes of the served layout files (headline config: zstd, 64k rows, f32, tuned) into results/layout-sizes.json.
  python3 -I report/collect_layout_sizes.py SERVE_DIR"""
import json, os, sys
serve = sys.argv[1]; out = {}
for name in sorted(os.listdir(serve)):
    mp = os.path.join(serve, name, "manifest.json")
    if not os.path.exists(mp): continue
    m = json.load(open(mp))
    gz = os.path.getsize(os.path.join(serve, name, "tree.nwk.gz")) if os.path.exists(os.path.join(serve, name, "tree.nwk.gz")) else None
    out[name] = {"tips": m["tips"], "nodes": m["nodes"], "newick_gz": gz, "manifest": os.path.getsize(mp), "files": {k: v["bytes"] for k, v in m["files"].items()}, "footers": {k: v["footer"] for k, v in m["files"].items() if "footer" in v},
                 "row_groups": {k: v["row_groups"] for k, v in m["files"].items() if "row_groups" in v}, "overview_level_rows": m["overview"]["level_rows"], "overview_level_min_tips": m["overview"].get("level_min_tips"), "overview_tail_bytes": m["files"]["overview"]["bytes"] - m["overview"]["tail_start"]}
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "layout-sizes.json"), "w"), indent=1)
print(json.dumps(out["yule1M"], indent=1))
