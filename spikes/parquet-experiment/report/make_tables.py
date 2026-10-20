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
    print("| Tree | Profile | manifest | overview tail | total | requests | bytes | overview typed arrays KB |\n|---|---|---|---|---|---|---|---|")
    for t in TORDER:
        for p in PORDER:
            P = d.get(t, {}).get("profiles", {}).get(p)
            if not P: continue
            o = P["overview"]
            print(f"| {t} | {p} | {_med([x['manifestMs'] for x in o]):.0f} | {_med([x['overviewMs'] for x in o]):.0f} | {_med([x['ms'] for x in o]):.0f} | {o[0]['requests']} | {o[0]['bytes']:,} | {o[0]['typedBytes'] / 1024:.0f} |")
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
    names = [("yule1M", "main (zstd, 64k rows, tuned)"), ("yule1M__none", "uncompressed"), ("yule1M__snappy", "snappy"), ("yule1M__plainzstd", "zstd, PLAIN encodings"), ("yule1M__rg16k", "zstd, 16k rows/group"), ("yule1M__rg256k", "zstd, 256k rows/group"), ("yule1M__paged", "zstd, 64k rows + 64 KB pages + page index (useOffsetIndex)")]
    print("| Variant (1M-tip Yule) | nodes.parquet MB | decode ms/100k rows (9 cols) | 4G: overview ms | 4G: 1k clade ms, KB, req | 4G: 10k clade ms, KB, req | 4G: 100k clade ms, MB, req |\n|---|---|---|---|---|---|---|")
    for key, label in names:
        f = glob.glob(os.path.join(RES, f"browser-variant-{key.split('__')[1]}.json")) if "__" in key else glob.glob(os.path.join(RES, "browser-main.json"))
        if not f: continue
        j = json.load(open(f[0]))["results"].get(key)
        if not j: continue
        none, g4 = j["profiles"].get("none"), j["profiles"].get("4g")
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
