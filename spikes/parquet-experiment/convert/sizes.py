#!/usr/bin/env python3
"""Size matrix: Newick raw/gzip vs Parquet (codec x row group x float width x column set x encoding) vs flat binary.
  python3 -I sizes.py NAME TREEFILE OUT.json --cache DIR --scratch DIR
Writes only nodes.parquet and tips.parquet per variant (overview/spine sizes are reported for the headline config only)."""
import argparse, gzip, io, json, os, sys, time, zlib, shutil
import numpy as np
import pyarrow as pa
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import treearrays, layout

ap = argparse.ArgumentParser()
ap.add_argument("name"); ap.add_argument("tree"); ap.add_argument("out")
ap.add_argument("--cache"); ap.add_argument("--scratch", required=True)
A = ap.parse_args()
a = treearrays.load_arrays(A.tree, A.cache)
res = {"name": A.name, "nodes": len(a["parent"]), "tips": len(a["node_of_tip"]), "has_lengths": bool(a["has_len"])}

op = gzip.open if A.tree.endswith(".gz") else open
raw = op(A.tree, "rb").read()
res["newick_raw"] = len(raw)
t = time.time(); res["newick_gzip9"] = len(zlib.compress(raw, 9) ) + 18 - 6 ; res["newick_gzip9_s"] = round(time.time() - t, 2)
res["newick_zstd3"] = len(pa.compress(raw, "zstd", asbytes=True)); res["newick_brotli"] = len(pa.compress(raw, "brotli", asbytes=True))
del raw

COLSETS = {"base": dict(rollups=False, occ=False), "rollups": dict(rollups=True, occ=False), "rollups+occ": dict(rollups=True, occ=True)}
rows = []
os.makedirs(A.scratch, exist_ok=True)
def run(enc, codec, rg, f64, cs):
    d = os.path.join(A.scratch, "v")
    shutil.rmtree(d, ignore_errors=True)
    cfg = dict(rg=rg, codec=codec, f64=f64, rollups=COLSETS[cs]["rollups"], occ=COLSETS[cs]["occ"], enc=enc)
    t0 = time.time()
    sz, _ = layout.write_all(a, d, cfg, only="nodes+tips")
    r = dict(enc=enc, codec=codec, rg=rg, float="f64" if f64 else "f32", cols=cs, nodes=sz["nodes"], tips=sz["tips"], write_s=round(time.time() - t0, 2))
    if codec == "none":
        for k in ("nodes", "tips"):
            r[k + "_gzip"] = len(zlib.compress(open(os.path.join(d, k + ".parquet"), "rb").read(), 9))
    rows.append(r)
    print(r, flush=True)
for codec in ("none", "snappy", "zstd"):
    for rg in (16384, 65536, 262144):
        for f64 in (False, True):
            for cs in COLSETS:
                run("tuned", codec, rg, f64, cs)
for enc in ("default", "plain", "bss"):
    for codec in ("none", "snappy", "zstd"):
        run(enc, codec, 65536, False, "rollups+occ")
res["parquet"] = rows

# headline layout incl. overview + spine
d = os.path.join(A.scratch, "headline")
shutil.rmtree(d, ignore_errors=True)
sz, man = layout.write_all(a, d, dict(rg=65536, codec="zstd", f64=False, rollups=True, occ=True, enc="tuned"))
res["headline_zstd_64k"] = sz
# label as dictionary for comparison
sz2, _ = layout.write_all(a, os.path.join(A.scratch, "labdict"), dict(rg=65536, codec="zstd", f64=False, rollups=True, occ=True, enc="tuned", label_dict=True), only="nodes+tips")
res["tips_label_dict_zstd"] = sz2["tips"]
shutil.rmtree(os.path.join(A.scratch, "labdict"), ignore_errors=True)

# flat binary: same columns as raw little-endian arrays + labels blob
def flat(f64, cs):
    cols = [a["parent"].astype("<i4"), a["subtree_end"].astype("<i4")]
    ft = "<f8" if f64 else "<f4"
    cols.append(a["len"].astype(ft))
    if COLSETS[cs]["rollups"]:
        cols += [a["leaf_start"].astype("<i4"), a["tip_count"].astype("<i4"), a["cum_len"].astype(ft), a["max_cum"].astype(ft), a["depth"].astype("<u2"), a["max_depth"].astype("<u2")]
    if COLSETS[cs]["occ"]:
        cols.append(a["occ_sum"].astype("<i8"))
    return cols
fl = []
for f64 in (False, True):
    for cs in COLSETS:
        cols = flat(f64, cs)
        blob = b"".join(c.tobytes() for c in cols)
        r = dict(float="f64" if f64 else "f32", cols=cs, raw=len(blob), gzip9=len(zlib.compress(blob, 9)), zstd3=len(pa.compress(blob, "zstd", asbytes=True)))
        # chunked (random access): compress each column in 64k-row chunks, sum
        ch = 0
        for c in cols:
            for s in range(0, len(c), 65536):
                ch += len(pa.compress(c[s:s + 65536].tobytes(), "zstd", asbytes=True))
        r["zstd3_chunked64k"] = ch
        # byte-shuffled + zstd (what BYTE_STREAM_SPLIT gives): shuffle each column
        sh = 0
        for c in cols:
            b = np.frombuffer(c.tobytes(), np.uint8).reshape(-1, c.dtype.itemsize).T.copy().tobytes()
            sh += len(pa.compress(b, "zstd", asbytes=True))
        r["zstd3_shuffled"] = sh
        fl.append(r)
        print(r, flush=True)
labels = "\n".join(a["tip_label"].tolist()).encode()
res["flat"] = fl
res["flat_labels"] = dict(raw=len(labels), gzip9=len(zlib.compress(labels, 9)), zstd3=len(pa.compress(labels, "zstd", asbytes=True)))
meta = ("tip_label\toccurrence_count\tcountry_code\n" + "\n".join("%s\t%d\t%s" % (l, o, c) for l, o, c in zip(a["tip_label"], a["occ"], a["country"]))).encode()
res["tsv_meta"] = dict(raw=len(meta), gzip9=len(zlib.compress(meta, 9)))
meta2 = ("occurrence_count\n" + "\n".join(str(o) for o in a["occ"])).encode()
res["tsv_occ_only"] = dict(raw=len(meta2), gzip9=len(zlib.compress(meta2, 9)))
json.dump(res, open(A.out, "w"), indent=1)
shutil.rmtree(os.path.join(A.scratch, "v"), ignore_errors=True)
