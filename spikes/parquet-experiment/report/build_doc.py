#!/usr/bin/env python3
"""Assemble docs/results/parquet-experiment.md from report/doc-template.md and the JSON in results/ (so every table is generated, not typed).
  python3 -I report/build_doc.py"""
import contextlib, glob, io, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, ".."); RES = os.path.join(ROOT, "results")
sys.path.insert(0, HERE)
import make_tables as mt

def cap(fn, *a):
    b = io.StringIO()
    with contextlib.redirect_stdout(b):
        fn(*a)
    return b.getvalue().strip()

def verify_summary():
    rows = ["| Tree | Checks passed | Result |", "|---|---|---|"]
    for f in sorted(glob.glob(os.path.join(RES, "verify-*.txt"))):
        n = os.path.basename(f)[7:-4]
        t = open(f).read()
        rows.append(f"| {n} | {t.count('PASS ')} | {'ALL PASS' if 'ALL PASS' in t else 'FAIL'} |")
    return "\n".join(rows)

def nodew_table():
    out = ["| Tree | Writer | Codec | Parse | Arrays | Write | Total | nodes | tips | tipmeta | overview | labels |", "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    ls = json.load(open(os.path.join(RES, "layout-sizes.json")))
    py = {}
    for line in open(os.path.join(RES, "python-convert-times.txt")):
        m = re.match(r"(\S+) python total wall s ([\d.]+) write_s ([\d.]+) parse_arrays_s ([\d.]+)", line)
        if m: py[m.group(1)] = (float(m.group(2)), float(m.group(3)), float(m.group(4)))
    for t in ("yule100k", "yule1M"):
        a = ls.get(t)
        if a:
            p = py.get(t)
            out.append(f"| {t} | pyarrow 26.0 (Python 3.13, reference) | zstd | | {p[2]:.1f} s (parse + arrays) | {p[1]:.1f} s | {p[0]:.1f} s | {a['files']['nodes'] / 1e6:.2f} MB | {a['files']['tips'] / 1e6:.2f} MB | {a['files']['tipmeta'] / 1e6:.2f} MB | {a['files']['overview'] / 1e6:.2f} MB | {a['files']['labels'] / 1e6:.2f} MB |" if p else f"| {t} | pyarrow | zstd | | | | | {a['files']['nodes'] / 1e6:.2f} MB | | | | |")
        for codec in ("zstd", "snappy"):
            f = os.path.join(RES, f"node-writer-{t}-{codec}.json")
            if not os.path.exists(f): continue
            j = json.load(open(f)); T = j["timings"]; S = j["sizes"]
            out.append(f"| {t} | hyparquet-writer 0.17.0 (Node 22.22) | {codec} | {T['parse_ms'] / 1000:.1f} s | {T['arrays_ms'] / 1000:.1f} s | {T['write_ms'] / 1000:.1f} s | {T['total_ms'] / 1000:.1f} s | {S['nodes'] / 1e6:.2f} MB | {S['tips'] / 1e6:.2f} MB | {S['tipmeta'] / 1e6:.2f} MB | {S['overview'] / 1e6:.2f} MB | {S['labels'] / 1e6:.2f} MB |")
    return "\n".join(out)

def layout_sizes():
    ls = json.load(open(os.path.join(RES, "layout-sizes.json")))
    out = ["| Tree | Newick gzip | manifest.json | overview.parquet (all levels) | overview level rows | overview tail (level 0 + footer) | nodes.parquet (footer, row groups) | tips.parquet (node, label) | tipmeta.parquet | spine + open.json | labels.parquet |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    for t in mt.TORDER:
        a = ls.get(t)
        if not a: continue
        out.append(f"| {t} | {a['newick_gz'] / 1e6:.2f} MB | {a['manifest'] / 1024:.1f} KB | {a['files']['overview'] / 1e6:.2f} MB | {'+'.join(map(str, a['overview_level_rows']))} | {a['overview_tail_bytes'] / 1024:.0f} KB | {a['files']['nodes'] / 1e6:.2f} MB ({a['footers']['nodes'] / 1024:.0f} KB, {a['row_groups']['nodes']}) | {a['files']['tips'] / 1e6:.2f} MB | {a['files']['tipmeta'] / 1e6:.2f} MB | {(a['files']['spine'] + a['files'].get('open', 0)) / 1024:.0f} KB | {a['files']['labels'] / 1e6:.2f} MB |")
    return "\n".join(out)

_other_cache = {}
def other_section(prefix):
    if "all" not in _other_cache:
        txt = cap(mt.tables_other)
        parts = re.split(r"(?m)^#### ", txt)
        _other_cache["all"] = {p.split("\n", 1)[0]: "#### " + p for p in parts if p.strip()}
    for k, v in _other_cache["all"].items():
        if k.startswith(prefix):
            return v
    return ""
def other_except(prefixes):
    other_section("x")
    return "\n\n".join(v for k, v in _other_cache["all"].items() if not any(k.startswith(p) for p in prefixes))

def tips_saving():
    d = mt.loadb(); sz = mt.load()
    out = ["| Tree | TSV with all three columns (gzip) | TSV `occurrence_count` only (gzip) | Parquet: `occurrence_count` for the tips of a 10k-tip clade | ... for ALL tips (the whole column) | Parquet: `tip_label` for the 10k clade | Parquet: all 3 columns for the 10k clade |", "|---|---|---|---|---|---|---|", ]
    for t in mt.TORDER:
        P = d.get(t, {}).get("profiles", {}).get("4g")
        if not P or "tipColumns" not in P: continue
        tc = P["tipColumns"]; j = sz.get(t)
        tsv3 = f"{j['tsv_meta']['gzip9'] / 1e6:.2f} MB" if j else "-"
        tsv1 = f"{j['tsv_occ_only']['gzip9'] / 1e6:.2f} MB" if j else "-"
        f = lambda k: f"{tc[k]['bytes'] / 1024:,.0f} KB ({tc[k]['requests']} req, {tc[k]['ms']:.0f} ms on 4G)"
        out.append(f"| {t} | {tsv3} | {tsv1} | {f('occurrence_count')} | {f('_allTips_occ')} | {f('tip_label')} | {f('tip_label+occurrence_count+country')} |")
    return "\n".join(out)

tokens = {
    "SHORT": lambda: open(os.path.join(HERE, "part-short.md")).read().strip(),
    "BREAKEVEN_TEXT": lambda: open(os.path.join(HERE, "part-breakeven.md")).read().strip(),
    "RECOMMENDATION": lambda: open(os.path.join(HERE, "part-recommendation.md")).read().strip(),
    "CROSSINGS": lambda: cap(mt.crossings),
    "FIRSTVIEW": lambda: other_section("First usable overview"),
    "CLADES": lambda: other_section("Clade fetch"),
    "TIPSAVING": lambda: tips_saving() + "\n\n" + other_section("Per-tip columns"),
    "OTHER": lambda: other_except(["First usable overview", "Clade fetch", "Per-tip columns"]),
    "SIZES": lambda: cap(mt.sizes),
    "BREAKEVEN": lambda: cap(mt.breakeven),
    "VARIANTS": lambda: cap(mt.variants),
    "NODEW_TABLE": nodew_table,
    "LAYOUT_SIZES": layout_sizes,
    "VERIFY": verify_summary,
    "OVL": lambda: "```\n" + open(os.path.join(RES, "overview-vs-layout.txt")).read().strip() + "\n```",
    "TREESOURCE": lambda: open(os.path.join(HERE, "part-treesource.md")).read().strip(),
    "NODEW_SECTION": lambda: open(os.path.join(HERE, "part-nodew.md")).read().strip(),
    "HYPARQUET": lambda: open(os.path.join(HERE, "part-hyparquet.md")).read().strip(),
    "RISKS": lambda: open(os.path.join(HERE, "part-risks.md")).read().strip(),
}
tpl = open(os.path.join(HERE, "doc-template.md")).read()
def sub(m):
    k = m.group(1)
    return tokens[k]()
out = re.sub(r"\{\{([A-Z_]+)\}\}", sub, tpl)
# parts may contain tokens too
out = re.sub(r"\{\{([A-Z_]+)\}\}", sub, out)
dst = os.path.join(ROOT, "..", "..", "docs", "results", "parquet-experiment.md")
open(dst, "w").write(out + "\n")
print("wrote", os.path.abspath(dst), len(out), "chars")
