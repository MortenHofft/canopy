#!/usr/bin/env python3
"""Markdown tables from results/sizes-*.json and results/browser-*.json (pure stdlib).  python3 -I report/make_tables.py sizes|browser"""
import glob, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); RES = os.path.join(HERE, "..", "results")
ORDER = ["yule100k", "gtdb190k", "yule1M", "otl1.49M"]
def mb(x): return "%.2f" % (x / 1e6)
def load(): 
    d = {}
    for f in glob.glob(os.path.join(RES, "sizes-*.json")):
        j = json.load(open(f)); d[j["name"]] = j
    return d
def find(j, **kw):
    for r in j["parquet"]:
        if all(r.get(k) == v for k, v in kw.items()): return r
def sizes():
    d = load(); names = [n for n in ORDER if n in d]
    print("### Whole-tree size (MB, f32, 64k row groups, `tuned` encodings, zstd, rollups + occ_sum)\n")
    print("| Tree | Tips | Newick raw | Newick gzip -9 | Newick brotli | Parquet nodes | Parquet tips (label, node, occ, country) | overview+spine+manifest | Parquet total | total / gzip Newick | flat binary zstd (cols) + labels zstd |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for n in names:
        j = d[n]; h = j["headline_zstd_64k"]; z = find(j, enc="tuned", codec="zstd", rg=65536, float="f32", cols="rollups+occ")
        fl = [x for x in j["flat"] if x["float"] == "f32" and x["cols"] == "rollups+occ"][0]
        tot = z["nodes"] + z["tips"] + h["overview"] + h.get("spine", 0) + h["manifest"]
        print(f"| {n} | {j['tips']:,} | {mb(j['newick_raw'])} | {mb(j['newick_gzip9'])} | {mb(j['newick_brotli'])} | {mb(z['nodes'])} | {mb(z['tips'])} | {mb(h['overview'] + h.get('spine', 0) + h['manifest'])} | {mb(tot)} | {tot / j['newick_gzip9']:.2f}x | {mb(fl['zstd3'])} + {mb(j['flat_labels']['zstd3'])} |")
    for n in names:
        j = d[n]
        print(f"\n### {n}: nodes.parquet bytes (MB) by codec, row group, float width, column set (`tuned` encodings)\n")
        print("| codec | rows/group | f32 base | f32 +rollups | f32 +rollups+occ | f64 base | f64 +rollups | f64 +rollups+occ | gzip of uncompressed (f32 +rollups+occ) |")
        print("|---|---|---|---|---|---|---|---|---|")
        for codec in ("none", "snappy", "zstd"):
            for rg in (16384, 65536, 262144):
                cells = []
                for fw in ("f32", "f64"):
                    for cs in ("base", "rollups", "rollups+occ"):
                        r = find(j, enc="tuned", codec=codec, rg=rg, float=fw, cols=cs); cells.append(mb(r["nodes"]) if r else "-")
                r = find(j, enc="tuned", codec=codec, rg=rg, float="f32", cols="rollups+occ")
                g = mb(r["nodes_gzip"]) if r and "nodes_gzip" in r else "-"
                print(f"| {codec} | {rg // 1024}k | " + " | ".join(cells) + f" | {g} |")
        print(f"\n{n}: encoding profiles (64k, f32, rollups+occ; nodes MB / tips MB)\n")
        print("| encoding | none | snappy | zstd |\n|---|---|---|---|")
        for enc in ("default", "plain", "bss", "tuned"):
            row = []
            for codec in ("none", "snappy", "zstd"):
                r = find(j, enc=enc, codec=codec, rg=65536, float="f32", cols="rollups+occ"); row.append(f"{mb(r['nodes'])} / {mb(r['tips'])}" if r else "-")
            print(f"| {enc} | " + " | ".join(row) + " |")
        print(f"\n{n}: flat binary (same columns, little-endian, no row groups), MB\n")
        print("| float | cols | raw | gzip -9 | zstd | zstd 64k chunks | zstd byte-shuffled |\n|---|---|---|---|---|---|---|")
        for x in j["flat"]:
            print(f"| {x['float']} | {x['cols']} | {mb(x['raw'])} | {mb(x['gzip9'])} | {mb(x['zstd3'])} | {mb(x['zstd3_chunked64k'])} | {mb(x['zstd3_shuffled'])} |")
        print(f"\n{n}: labels flat = raw {mb(j['flat_labels']['raw'])} / gzip {mb(j['flat_labels']['gzip9'])} / zstd {mb(j['flat_labels']['zstd3'])}; tips.parquet with label dictionary (zstd) {mb(j['tips_label_dict_zstd'])} vs plain {mb(find(j, enc='tuned', codec='zstd', rg=65536, float='f32', cols='rollups+occ')['tips'])}; TSV tip_label+occurrence_count+country raw {mb(j['tsv_meta']['raw'])} / gzip {mb(j['tsv_meta']['gzip9'])}; TSV occurrence_count only raw {mb(j['tsv_occ_only']['raw'])} / gzip {mb(j['tsv_occ_only']['gzip9'])}")
if __name__ == "__main__":
    if sys.argv[1] == "sizes": sizes()


# ------------------------------------------------------------------ browser tables
import statistics as st
def med(xs): return st.median(xs) if xs else float("nan")
def loadb(pattern="browser-main*.json"):
    out = {}
    for f in sorted(glob.glob(os.path.join(RES, pattern))):
        j = json.load(open(f))
        for t, r in j["results"].items(): out.setdefault(t, {"tips": r["tips"], "nodes": r["nodes"], "files": r["files"], "newickGz": r["newickGz"], "profiles": {}})["profiles"].update(r["profiles"])
        out.setdefault("_meta", j)
    return out
PORDER = ["none", "wifi", "4g", "3g"]
TORDER = ["yule10k", "otl91k", "yule100k", "gtdb190k", "yule1M", "otl1.49M"]
def s(ms): return f"{ms / 1000:.2f}"
def kb(b): return f"{b / 1024:,.0f}"
def breakeven(pattern="browser-main*.json"):
    d = loadb(pattern)
    print("| Tree | Tips | Profile | Overview-first: s (bytes KB, requests) | Full gz Newick: s (download + inflate + parse) (MB) | Overview wins by | 10k-tip clade: s (KB, requests) | 1k clade: s (KB) | 100k clade: s (MB) | zooms of 10k clades before the lead is gone |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for t in TORDER:
        if t not in d: continue
        for p in PORDER:
            P = d[t]["profiles"].get(p)
            if not P or p == "none": continue
            ov = med([o["ms"] for o in P["overview"]]); ob = P["overview"][0]["bytes"]; orq = P["overview"][0]["requests"]
            bl = med([b["totalMs"] for b in P.get("baseline", [])]) if P.get("baseline") else float("nan")
            bb = P["baseline"][0]["bytes"] if P.get("baseline") else 0
            def clade(target):
                cs = [c for c in P["clades"] if c["target"] == target]
                if not cs: return None
                ms = med([r["withLabels"]["ms"] for c in cs for r in c["reps"]]); by = med([r["withLabels"]["bytes"] for c in cs for r in c["reps"]]); rq = med([r["withLabels"]["requests"] for c in cs for r in c["reps"]])
                return ms, by, rq
            c1, c10, c100 = clade(1000), clade(10000), clade(100000)
            n_star = (bl - ov) / c10[0] if c10 and bl == bl else None
            print(f"| {t} | {d[t]['tips']:,} | {p} | {s(ov)} ({kb(ob)}, {orq}) | {s(bl)} ({bb / 1e6:.1f}) | {bl / ov:.1f}x | " + (f"{s(c10[0])} ({kb(c10[1])}, {c10[2]:.0f})" if c10 else "-") + " | " + (f"{s(c1[0])} ({kb(c1[1])})" if c1 else "-") + " | " + (f"{s(c100[0])} ({c100[1] / 1e6:.1f})" if c100 else "-") + f" | {n_star:.0f} |" if n_star is not None else f"| {t} | {d[t]['tips']:,} | {p} | {s(ov)} | - | - | - | - | - | - |")
if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "breakeven":
    breakeven(*sys.argv[2:3])
