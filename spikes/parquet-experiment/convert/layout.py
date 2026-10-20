"""Write the Parquet layout (nodes / overview / tips / spine / manifest) from the arrays of treearrays.load_arrays.

Layout v1 (see docs/results/parquet-experiment.md):
  nodes.parquet     one row per node in PREORDER (row index = node id). Row groups of `rg` rows.
  tips.parquet      one row per tip in preorder rank; row groups aligned to the node row groups (the tips of node group g).
  overview.parquet  pyramid: one row group per level; rows carry their own node id and all rollups.
  spine.parquet     the ancestors of the first node of every node row group (cheap root->tip paths).
  manifest.json     counts, row-group boundaries as preorder ranges, overview levels, file sizes.
"""
import json, os
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

OVERVIEW_BUDGETS = [1024, 4096, 16384, 65536]  # internal nodes expanded per pyramid level (cumulative top-B by tip_count)


def budgets_for(n_internal):
    """Keep only levels that stay at or below 1/8 of the internal nodes, so the overview never approaches the full tree."""
    b = [x for x in OVERVIEW_BUDGETS if x <= n_internal // 8]
    return b or [max(1, n_internal // 4)]


def _table(a, idx, cfg, extra=None):
    """Node-table columns for row index array/slice idx."""
    f = np.float64 if cfg["f64"] else np.float32
    cols = {}
    if extra is not None:
        cols.update(extra)
    cols["parent"] = pa.array(a["parent"][idx], pa.int32())
    cols["subtree_end"] = pa.array(a["subtree_end"][idx], pa.int32())
    cols["len"] = pa.array(a["len"][idx].astype(f))
    if cfg.get("support", True) and bool(np.isfinite(a["support"]).any()):
        cols["support"] = pa.array(a["support"][idx].astype(f))
    if cfg["rollups"]:
        cols["leaf_start"] = pa.array(a["leaf_start"][idx], pa.int32())
        cols["tip_count"] = pa.array(a["tip_count"][idx], pa.int32())
        cols["cum_len"] = pa.array(a["cum_len"][idx].astype(f))
        cols["max_cum"] = pa.array(a["max_cum"][idx].astype(f))
        cols["depth"] = pa.array(a["depth"][idx].astype(np.uint16), pa.uint16())
        cols["max_depth"] = pa.array(a["max_depth"][idx].astype(np.uint16), pa.uint16())
    if cfg["occ"]:
        cols["occ_sum"] = pa.array(a["occ_sum"][idx], pa.int64())
    return cols


def required(tbl, optional=("name",)):
    """REQUIRED (non-nullable) fields: hyparquet then returns typed arrays instead of arrays with null checks."""
    return tbl.cast(pa.schema([f.with_nullable(f.name in optional) for f in tbl.schema]))


def _names(a, idx):
    return pa.array(a["name"][idx].tolist(), pa.string())


def writer_opts(cfg, cols):
    """pyarrow write options for the chosen encoding profile."""
    codec = {"none": "NONE", "snappy": "SNAPPY", "zstd": "ZSTD"}[cfg["codec"]]
    o = dict(compression=codec, write_statistics=True, data_page_version="2.0")
    if codec == "ZSTD":
        o["compression_level"] = cfg.get("zstd_level", 3)
    if cfg.get("page_kb"):          # small data pages + page index: lets a reader fetch single pages of a row group
        o["data_page_size"] = cfg["page_kb"] * 1024
        o["write_page_index"] = True
    if cfg["enc"] == "plain":      # PLAIN everywhere except dictionary for low-cardinality strings
        o["use_dictionary"] = [c for c in ("country", "name") if c in cols]
    elif cfg["enc"] == "bss":      # PLAIN integers, BYTE_STREAM_SPLIT floats
        o["use_dictionary"] = [c for c in ("country", "name") if c in cols]
        o["column_encoding"] = {c: "BYTE_STREAM_SPLIT" for c in ("len", "cum_len", "max_cum", "support") if c in cols}
    elif cfg["enc"] == "tuned":
        delta = [c for c in ("parent", "subtree_end", "leaf_start", "tip_count", "depth", "max_depth", "node") if c in cols]
        bss = [c for c in ("len", "cum_len", "max_cum", "support") if c in cols]
        dic = [c for c in ("country", "name") if c in cols]
        enc = {c: "DELTA_BINARY_PACKED" for c in delta}
        enc.update({c: "BYTE_STREAM_SPLIT" for c in bss})
        o["use_dictionary"] = dic
        o["column_encoding"] = enc
    return o


def select_overview(a, budgets=None):
    """Return (sel_level, rows_by_level). sel_level[i] = pyramid level at which internal node i becomes expanded (255 never).
    Selection = the top-B internal nodes by tip_count (ties: lower preorder first), which is ancestor-closed."""
    n = len(a["parent"])
    tc = a["tip_count"]
    internal = a["subtree_end"] != np.arange(1, n + 1)
    cand = np.flatnonzero(internal)
    budgets = budgets or budgets_for(len(cand))
    order = cand[np.lexsort((cand, -tc[cand].astype(np.int64)))]
    sel = np.full(n, 255, dtype=np.uint8)
    prev = 0
    for L, B in enumerate(budgets):
        sel[order[prev:B]] = L
        prev = max(prev, B)
    par = a["parent"]
    rows = []
    for L in range(len(budgets)):
        new_sel = np.flatnonzero(sel == L)
        # stub children of nodes that became expanded at this level and are not themselves expanded at <= L
        isnew = np.zeros(n, bool)
        isnew[new_sel] = True
        child = np.flatnonzero(isnew[par[1:]]) + 1  # all children of newly expanded nodes
        stubs = child[sel[child] > L]
        r = np.union1d(new_sel, stubs)
        # nodes selected at L are also children of a node selected earlier; they are in new_sel already
        rows.append(r.astype(np.int64))
    return sel, rows


def write_all(a, outdir, cfg, only=None):
    """cfg: rg, codec, f64, rollups, occ, enc ('default'|'tuned'), label_dict. Returns dict of file sizes."""
    os.makedirs(outdir, exist_ok=True)
    n = len(a["parent"])
    ntips = len(a["node_of_tip"])
    rg = cfg["rg"]
    sizes = {}
    # ---------------- nodes
    bounds = list(range(0, n, rg)) + [n]
    rg_node_start = bounds[:-1]
    path = os.path.join(outdir, "nodes.parquet")
    idx = np.arange(n)
    cols = _table(a, idx, cfg)
    if a["name"].astype(bool).any() if a["name"].dtype == object and any(x is not None for x in a["name"][:200000]) else False:
        pass
    has_names = any(x is not None for x in a["name"])
    if has_names:
        cols["name"] = _names(a, idx)
    tbl = required(pa.table(cols))
    wr = pq.ParquetWriter(path, tbl.schema, **writer_opts(cfg, set(tbl.column_names)))
    for s, e in zip(bounds[:-1], bounds[1:]):
        wr.write_table(tbl.slice(s, e - s), row_group_size=e - s)
    wr.close()
    sizes["nodes"] = os.path.getsize(path)
    # ---------------- tips (aligned)
    if cfg.get("tips", True):
        lp = np.concatenate(([0], np.cumsum(a["subtree_end"] == np.arange(1, n + 1))))  # tips among nodes < i
        rg_tip_start = [int(lp[s]) for s in rg_node_start] + [ntips]
        tc = {"node": pa.array(a["node_of_tip"], pa.int32()),
              "tip_label": pa.array(a["tip_label"].tolist(), pa.string()),
              "occurrence_count": pa.array(a["occ"], pa.int32()),
              "country": pa.array(a["country"].tolist(), pa.string())}
        tt = required(pa.table(tc))
        tcfg = dict(cfg)
        o = writer_opts(tcfg, set(tt.column_names))
        if cfg["enc"] in ("default", "plain", "bss"):
            o["use_dictionary"] = ["country"] + (["tip_label"] if cfg.get("label_dict") else [])
        else:
            o["use_dictionary"] = ["country"] + (["tip_label"] if cfg.get("label_dict") else [])
            o["column_encoding"] = {"node": "DELTA_BINARY_PACKED"}
        path = os.path.join(outdir, "tips.parquet")
        wr = pq.ParquetWriter(path, tt.schema, **o)
        for s, e in zip(rg_tip_start[:-1], rg_tip_start[1:]):
            wr.write_table(tt.slice(s, e - s), row_group_size=max(1, e - s))
        wr.close()
        sizes["tips"] = os.path.getsize(path)
    else:
        rg_tip_start = None
    if only == "nodes+tips":
        return sizes, None
    # ---------------- overview
    sel, rows = select_overview(a)
    ov_cfg = dict(cfg, rollups=True, f64=cfg["f64"])
    parts = []
    lvl_rows = []
    for r in rows:
        c = _table(a, r, ov_cfg, extra={"node": pa.array(r.astype(np.int32), pa.int32())})
        c["sel_level"] = pa.array(sel[r], pa.uint8())
        parts.append(required(pa.table(c)))
        lvl_rows.append(int(len(r)))
    path = os.path.join(outdir, "overview.parquet")
    wr = pq.ParquetWriter(path, parts[0].schema, **writer_opts(cfg, set(parts[0].column_names)))
    for p_ in reversed(parts):          # deepest level first, level 0 LAST: level 0 + footer are one contiguous tail
        wr.write_table(p_, row_group_size=len(p_))
    wr.close()
    sizes["overview"] = os.path.getsize(path)
    sizes["overview_levels"] = []
    # per level compressed bytes from the file metadata (file order is reversed: deepest level first)
    md = pq.ParquetFile(path).metadata
    for g in range(md.num_row_groups):
        sizes["overview_levels"].append({"level": md.num_row_groups - 1 - g, "rows": md.row_group(g).num_rows, "bytes": sum(md.row_group(g).column(k).total_compressed_size for k in range(md.num_columns))})
    last = md.row_group(md.num_row_groups - 1)
    ov_tail_start = min((c.dictionary_page_offset or c.data_page_offset) for c in (last.column(k) for k in range(md.num_columns)))
    # ---------------- spine: ancestors of the first node of each node row group
    par = a["parent"]
    open_ids = []
    for s in rg_node_start:
        chain = []
        i = int(par[s]) if s > 0 else -1
        while i >= 0:
            chain.append(i)
            i = int(par[i])
        open_ids.append(chain[::-1])
    uniq = np.array(sorted({x for c in open_ids for x in c}), dtype=np.int64)
    if len(uniq):
        c = _table(a, uniq, dict(cfg, rollups=True), extra={"node": pa.array(uniq.astype(np.int32), pa.int32())})
        sp = required(pa.table(c))
        path = os.path.join(outdir, "spine.parquet")
        pq.write_table(sp, path, **writer_opts(cfg, set(sp.column_names)), row_group_size=len(uniq))
        sizes["spine"] = os.path.getsize(path)
    manifest = {
        "version": 1, "nodes": n, "tips": ntips, "has_lengths": bool(a["has_len"]), "has_support": bool(np.isfinite(a["support"]).any()),
        "has_names": has_names, "max_depth": int(a["max_depth"][0]), "max_cum": float(a["max_cum"][0]), "root_occ_sum": int(a["occ_sum"][0]),
        "float": "f64" if cfg["f64"] else "f32", "codec": cfg["codec"], "rg_rows": rg,
        "rg_node_start": rg_node_start + [n], "rg_tip_start": rg_tip_start,
        "overview": {"budgets": budgets_for(int((a["subtree_end"] != np.arange(1, n + 1)).sum())), "level_rows": lvl_rows},
        "rg_open": open_ids, "spine_nodes": [int(x) for x in uniq],
        "files": {"nodes": "nodes.parquet", "tips": "tips.parquet", "overview": "overview.parquet", "spine": "spine.parquet"},
        "notes": "len is raw (NaN when missing); cum_len/max_cum clamp negative or missing lengths to 0; occ_sum is SYNTHETIC test metadata",
    }
    manifest["overview"]["tail_start"] = int(ov_tail_start)   # [tail_start, EOF) = level 0 rows + footer
    manifest["overview"]["file_order"] = "deepest level first, level 0 last"
    fi = {}
    for k, fn in manifest["files"].items():
        fp = os.path.join(outdir, fn)
        if os.path.exists(fp):
            m = pq.ParquetFile(fp).metadata
            fi[k] = {"file": fn, "bytes": os.path.getsize(fp), "footer": m.serialized_size + 8, "row_groups": m.num_row_groups}
    manifest["files"] = fi
    with open(os.path.join(outdir, "manifest.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    sizes["manifest"] = os.path.getsize(os.path.join(outdir, "manifest.json"))
    return sizes, manifest
