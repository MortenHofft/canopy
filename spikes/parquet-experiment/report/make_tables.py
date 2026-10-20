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
    ls = json.load(open(os.path.join(RES, "layout-sizes.json")))
    print("### Whole-tree size (MB; zstd, 16,384 rows per group, f32, `tuned` encodings, rollups + occ_sum)\n")
    print("| Tree | Tips | Newick raw | Newick gzip -9 | Newick brotli | Parquet nodes | Parquet tips + tipmeta (node, label; occurrence_count, country) | overview + spine + open + manifest | Parquet total | total / gzip Newick | labels.parquet (optional) | flat binary zstd (cols) + labels zstd |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for n in names:
        j = d[n]; z = find(j, enc="tuned", codec="zstd", rg=16384, float="f32", cols="rollups+occ"); a = ls[n]
        fl = [x for x in j["flat"] if x["float"] == "f32" and x["cols"] == "rollups+occ"][0]
        extra = a["files"]["overview"] + a["files"]["spine"] + a["files"].get("open", 0) + a["manifest"]
        tot = z["nodes"] + a["files"]["tips"] + a["files"].get("tipmeta", 0) + extra
        print(f"| {n} | {j['tips']:,} | {mb(j['newick_raw'])} | {mb(j['newick_gzip9'])} | {mb(j['newick_brotli'])} | {mb(z['nodes'])} | {mb(a['files']['tips'] + a['files'].get('tipmeta', 0))} | {mb(extra)} | {mb(tot)} | {tot / j['newick_gzip9']:.2f}x | {mb(a['files']['labels'])} | {mb(fl['zstd3'])} + {mb(j['flat_labels']['zstd3'])} |")
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
        print(f"\n{n}: encoding profiles (64k, f32, rollups+occ; nodes MB / tips.parquet MB, the sweep wrote labels, node id and metadata in ONE tips file)\n")
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
    print("| Tree | Tips | Profile | Overview-first: s (KB, requests) | Full gz Newick: s (MB) | First view: overview wins by | Overview + one 10k-tip clade (with labels): s | ... wins by | Clade fetches (10k tips each) until the lead is gone |")
    print("|---|---|---|---|---|---|---|---|---|")
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
                return med([r["withLabels"]["ms"] for c in cs for r in c["reps"]])
            c10 = clade(10000) or clade(1000)
            tot = ov + c10 if c10 else None
            nstar = f"{(bl - ov) / c10:.0f}" if c10 else "-"
            print(f"| {t} | {d[t]['tips']:,} | {p} | {s(ov)} ({kb(ob)}, {orq}) | {s(bl)} ({bb / 1e6:.1f}) | {bl / ov:.1f}x | " + (f"{s(tot)} | {bl / tot:.1f}x | " if tot else "- | - | ") + f"{nstar} |")
if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "breakeven":
    breakeven(*sys.argv[2:3])


def _med(xs): return st.median(xs) if xs else float("nan")
def tables_other(pattern="browser-main*.json"):
    d = loadb(pattern)
    print("\n#### Decode cost, cache-hot, unthrottled profile (ms per 100k rows; best of 3)\n")
    print("| Tree | all 9 node columns | 2 columns (subtree_end, tip_count) | tip_label (100k tips) | occurrence_count (100k tips) |\n|---|---|---|---|---|")
    for t in TORDER:
        P = d.get(t, {}).get("profiles", {}).get("none")
        if not P or "decode" not in P: continue
        x = P["decode"]; print(f"| {t} | {x['nodesAll']['msPer100k']:.1f} | {x['nodesTwoCols']['msPer100k']:.1f} | {x['tipsLabels']['msPer100k']:.1f} | {x['tipsOcc']['msPer100k']:.1f} |")
    print("\n#### First usable overview: pieces (ms, median of the repetitions)\n")
    print("| Tree | Profile | manifest | overview tail | total | requests | bytes | overview typed arrays KB | afterwards: footers of nodes + tips (2 parallel requests) |\n|---|---|---|---|---|---|---|---|---|")
    for t in TORDER:
        for p in PORDER:
            P = d.get(t, {}).get("profiles", {}).get(p)
            if not P: continue
            o = P["overview"]
            print(f"| {t} | {p} | {_med([x['manifestMs'] for x in o]):.0f} | {_med([x['overviewMs'] for x in o]):.0f} | {_med([x['ms'] for x in o]):.0f} | {o[0]['requests']} | {o[0]['bytes']:,} | {o[0]['typedBytes'] / 1024:.0f} | {P['footers']['ms']:.0f} ms, {P['footers']['bytes'] / 1024:.0f} KB |")
    print("\n#### Clade fetch: nodes only / nodes + labels (median of repetitions and of the two clades; ms, requests, KB)\n")
    print("| Tree | Profile | target tips | nodes rows | nodes only | nodes + labels |\n|---|---|---|---|---|---|")
    for t in TORDER:
        for p in PORDER:
            P = d.get(t, {}).get("profiles", {}).get(p)
            if not P or p == "none": continue
            for tg in (1000, 10000, 100000):
                cs = [c for c in P["clades"] if c["target"] == tg]
                if not cs: continue
                a = [r["nodesOnly"] for c in cs for r in c["reps"]]; b = [r["withLabels"] for c in cs for r in c["reps"]]
                print(f"| {t} | {p} | {tg:,} (actual {', '.join(str(c['tips']) for c in cs)}) | {cs[0]['nodeRows']:,} | {_med([x['ms'] for x in a]):.0f} ms, {_med([x['requests'] for x in a]):.0f} req, {_med([x['bytes'] for x in a]) / 1024:,.0f} KB | {_med([x['ms'] for x in b]):.0f} ms, {_med([x['requests'] for x in b]):.0f} req, {_med([x['bytes'] for x in b]) / 1024:,.0f} KB |")
    print("\n#### Path, focus-a-tip, label lookup (median over 3 tips; ms, requests, KB)\n")
    print("| Tree | Profile | path root to tip | focusTip (path + clade >= 1000 tips + overview level) | label to rank |\n|---|---|---|---|---|")
    for t in TORDER:
        for p in PORDER:
            P = d.get(t, {}).get("profiles", {}).get(p)
            if not P or p == "none": continue
            f = lambda L: (f"{_med([x['ms'] for x in L]):.0f} ms, {_med([x['requests'] for x in L]):.0f} req, {_med([x['bytes'] for x in L]) / 1024:,.0f} KB" if L else "-")
            print(f"| {t} | {p} | {f(P.get('paths'))} | {f(P.get('focus'))} | {f(P.get('labelLookup'))} |")
    print("\n#### Per-tip columns for the tips of one clade (the 10k-tip clade) vs the whole column (ms, requests, KB)\n")
    print("| Tree | Profile | occurrence_count | occurrence_count + country | tip_label | all 3 | occurrence_count of ALL tips |\n|---|---|---|---|---|---|---|")
    for t in TORDER:
        for p in PORDER:
            P = d.get(t, {}).get("profiles", {}).get(p)
            if not P or p == "none" or "tipColumns" not in P: continue
            g = lambda k: (lambda x: f"{x['ms']:.0f} ms, {x['requests']} req, {x['bytes'] / 1024:,.0f} KB")(P["tipColumns"][k])
            print(f"| {t} | {p} | {g('occurrence_count')} | {g('occurrence_count+country')} | {g('tip_label')} | {g('tip_label+occurrence_count+country')} | {g('_allTips_occ')} |")
    print("\n#### Memory held after loading (forced GC; JS heap delta and typed-array bytes) vs baseline TreeModel\n")
    print("| Tree | Profile | Parquet: overview level 0 + one clade | JS heap Δ | typed arrays | Baseline TreeModel typed arrays | Baseline JS heap Δ |\n|---|---|---|---|---|---|---|")
    for t in TORDER:
        for p in ("wifi",):
            P = d.get(t, {}).get("profiles", {}).get(p)
            if not P or "memory" not in P: continue
            m = P["memory"]; b = P["baseline"][0] if P.get("baseline") else None
            print(f"| {t} | {p} | clade {P['memoryClade']['tips'] if P.get('memoryClade') else 0:,} tips | {m['heapDelta'] / 1e6:.1f} MB | {m['typedBytes'] / 1e6:.1f} MB | {b['typedBytes'] / 1e6:.1f} MB | {b['heapDelta'] / 1e6:.1f} MB |" if b else f"| {t} | {p} | - | {m['heapDelta'] / 1e6:.1f} MB | {m['typedBytes'] / 1e6:.1f} MB | - | - |")
    print("\n#### Baseline pieces (median, wifi profile): download / inflate / parse + build (ms)\n")
    print("| Tree | gz MB | fetch | inflate | parse + TreeModel | total |\n|---|---|---|---|---|---|")
    for t in TORDER:
        for p in ("none",):
            P = d.get(t, {}).get("profiles", {}).get(p)
            if not P or not P.get("baseline"): continue
            b = P["baseline"]
            print(f"| {t} ({p}) | {b[0]['bytes'] / 1e6:.1f} | {_med([x['fetchMs'] for x in b]):.0f} | {_med([x['inflateMs'] for x in b]):.0f} | {_med([x['parseBuildMs'] for x in b]):.0f} | {_med([x['totalMs'] for x in b]):.0f} |")

def variants():
    rows = [("browser-main-v1-64k-nodebudget.json", "yule1M", "zstd, 64k rows/group (first pass; the reference for the rows below)"),
            ("browser-variant-none.json", "yule1M__none", "uncompressed, 64k"),
            ("browser-variant-snappy.json", "yule1M__snappy", "snappy, 64k"),
            ("browser-variant-plainzstd.json", "yule1M__plainzstd", "zstd with PLAIN encodings, 64k"),
            ("browser-variant-rg256k.json", "yule1M__rg256k", "zstd, 256k rows/group"),
            ("browser-variant-paged.json", "yule1M__paged", "zstd, 64k rows + 64 KB pages + page index (`useOffsetIndex`)"),
            ("browser-variant-rg16k.json", "yule1M__rg16k", "zstd, 16k rows/group (first pass)"),
            ("browser-variant-rg64k.json", "yule1M__rg64k", "**second pass, final layout:** zstd, 64k rows/group"),
            ("browser-main.json", "yule1M", "**second pass, final layout:** zstd, 16k rows/group (the layout used for all main tables)"),
            ("browser-variant-rg8k.json", "yule1M__rg8k", "**second pass, final layout:** zstd, 8k rows/group")]
    print("| Variant (1M-tip Yule) | nodes.parquet MB | decode ms/100k rows (9 cols) | 4G: overview ms | 4G: 1k clade ms, KB, req | 4G: 10k clade ms, KB, req | 4G: 100k clade ms, MB, req |\n|---|---|---|---|---|---|---|")
    for fn, key, label in rows:
        f = os.path.join(RES, fn)
        if not os.path.exists(f): continue
        j = json.load(open(f))["results"].get(key)
        if not j: continue
        none, g4 = j["profiles"].get("none"), j["profiles"].get("4g")
        if not g4: continue
        dec = none["decode"]["nodesAll"]["msPer100k"] if none and "decode" in none else float("nan")
        def cl(tg):
            cs = [c for c in g4["clades"] if c["target"] == tg]
            if not cs: return "-"
            b = [r["withLabels"] for c in cs for r in c["reps"]]
            sc = 1024 if tg < 100000 else 1e6
            return f"{_med([x['ms'] for x in b]):.0f}, {_med([x['bytes'] for x in b]) / sc:,.1f}, {_med([x['requests'] for x in b]):.0f}"
        print(f"| {label} | {j['files']['nodes'] / 1e6:.1f} | {dec:.1f} | {_med([o['ms'] for o in g4['overview']]):.0f} | {cl(1000)} | {cl(10000)} | {cl(100000)} |")
if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "other": tables_other()
if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "variants": variants()


def crossings(pattern="browser-main.json"):
    """Tips at which overview-first stops being faster: baseline time is fitted as a + b * gzipped MB over the six trees (per profile);
    overview-first time is the median over the trees (it does not depend on tree size)."""
    d = loadb(pattern)
    print("| Profile | baseline fit: fixed s + s per MB of gzipped Newick | first view (overview only): s | tips where the full download takes as long | first view + one 10k-tip clade: s | tips where it takes as long |\n|---|---|---|---|---|---|")
    gz_per_tip = {t: d[t]["newickGz"] / d[t]["tips"] for t in TORDER if t in d}
    avg_gz_per_tip = sum(gz_per_tip.values()) / len(gz_per_tip)          # bytes of gzipped Newick per tip, mean of the trees
    for p in ("wifi", "4g", "3g"):
        xs, ys, ovs, tots = [], [], [], []
        for t in TORDER:
            P = d.get(t, {}).get("profiles", {}).get(p)
            if not P or not P.get("baseline"): continue
            xs.append(d[t]["newickGz"] / 1e6); ys.append(med([b["totalMs"] for b in P["baseline"]]) / 1000)
            ov = med([o["ms"] for o in P["overview"]]) / 1000; ovs.append(ov)
            cs = [c for c in P["clades"] if c["target"] == 10000] or [c for c in P["clades"] if c["target"] == 1000]
            tots.append(ov + med([r["withLabels"]["ms"] for c in cs for r in c["reps"]]) / 1000)
        n = len(xs); mx, my = sum(xs) / n, sum(ys) / n
        b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs); a = my - b * mx
        ov, tot = med(ovs), med(tots)
        def tips(T): return max(0.0, (T - a) / b * 1e6 / avg_gz_per_tip)
        print(f"| {p} | {a:.2f} s + {b:.2f} s/MB | {ov:.2f} | {tips(ov):,.0f} | {tot:.2f} | {tips(tot):,.0f} |")
if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "crossings": crossings(*sys.argv[2:3])
