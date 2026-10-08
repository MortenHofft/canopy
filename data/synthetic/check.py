#!/usr/bin/env python3
"""Independent checker for the synthetic files (pure stdlib, iterative, shares no
code with generate.py). It re-parses the Newick/NEXUS text and verifies tip count,
internal nodes, depth, balanced parentheses and unique labels, plus shape-specific
expectations; it can write or verify manifest.json.

  python3 check.py ROOT                     # check every file under ROOT
  python3 check.py ROOT --update manifest.json   # also merge results into the manifest
  python3 check.py ROOT --verify manifest.json   # compare sha256 + stats with the manifest
ROOT contains newick/ nexus/ meta/ align/. A newick/X.nwk.gz is used when X.nwk is absent.
"""
import argparse
import gzip
import hashlib
import json
import math
import os
import re
import sys

TOKEN = re.compile(r"[(),;]|[^(),;\s]+")
NAME = re.compile(r"^(yule|birthdeath|balanced|caterpillar|bushy|mixed)_(\d+)(_nobl|_ids|_support|_nodenames)?\.nwk$")
BINOMIAL = re.compile(r"^[A-Z][a-z]+_[a-z]+$")
COMMIT_RAW_MAX, COMMIT_GZ_MAX = 1000, 10000   # 10k: only the main (no-suffix) files, gzipped


def scan_newick(text):
    """Return stats for one Newick string; raise ValueError on any structural problem."""
    depth = maxd = tips = internal = polytomies = maxdeg = 0
    deg, mm = [], []              # per open '(': child count; (min,max) tip distance below
    tiplabels, intlabels = set(), []
    nlen = nnodes = 0
    prev = None
    pend = None                   # closed internal node waiting for its label/length
    done = False
    root_mm = None

    def parse(tok):               # "label:length" -> (label, length or None)
        lab, sep, ln = tok.rpartition(":")
        if not sep:
            return tok, None
        return lab, float(ln)

    def merge(node_mm, ln):       # add the node's own edge, merge into the parent level
        nonlocal root_mm
        lo, hi = node_mm
        if ln is not None:
            lo, hi = lo + ln, hi + ln
        if mm:
            m = mm[-1]
            m[0] = min(m[0], lo)
            m[1] = max(m[1], hi)
        else:
            root_mm = (lo, hi)

    for m in TOKEN.finditer(text):
        tok = m.group()
        if done:
            raise ValueError("content after ';'")
        if tok in ",);" and pend is not None:
            merge(pend, None)
            pend = None
        if tok == "(":
            if prev not in (None, "(", ","):
                raise ValueError("bad '(' position")
            deg.append(1)
            mm.append([math.inf, -math.inf])
            depth += 1
            maxd = max(maxd, depth)
            prev = "("
        elif tok == ",":
            if not deg or prev in ("(", ","):
                raise ValueError("bad ','")
            deg[-1] += 1
            prev = ","
        elif tok == ")":
            if not deg or prev in ("(", ","):
                raise ValueError("bad ')'")
            d = deg.pop()
            lo, hi = mm.pop()
            depth -= 1
            internal += 1
            nnodes += 1
            maxdeg = max(maxdeg, d)
            polytomies += d > 2
            pend = (lo, hi)
            prev = ")"
        elif tok == ";":
            if deg:
                raise ValueError("unbalanced parentheses")
            done = True
        else:
            lab, ln = parse(tok)
            if prev in ("(", ",", None):          # tip
                if not lab:
                    raise ValueError("unlabelled tip")
                if lab in tiplabels:
                    raise ValueError("duplicate tip label " + lab)
                tiplabels.add(lab)
                tips += 1
                nnodes += 1
                maxd = max(maxd, depth)
                if ln is not None:
                    nlen += 1
                    merge((0.0, 0.0), ln)
                else:
                    merge((0.0, 0.0), None)
                prev = "label"
            elif prev == ")":                      # internal label
                if lab:
                    intlabels.append(lab)
                if ln is not None:
                    nlen += 1
                merge(pend, ln)
                pend = None
                prev = "label"
            else:
                raise ValueError("unexpected token " + tok)
    if not done or deg:
        raise ValueError("missing ';' or unbalanced parentheses")
    if tips == 0:
        raise ValueError("no tips")
    kind = "none"
    if intlabels:
        if len(intlabels) != internal:
            raise ValueError("only some internal nodes labelled")
        try:
            vals = [float(x) for x in intlabels]
            if not all(0.0 <= v <= 1.0 for v in vals):
                raise ValueError("support outside [0,1]")
            kind = "support"
        except ValueError as e:
            if "support" in str(e):
                raise
            if len(set(intlabels)) != len(intlabels):
                raise ValueError("duplicate internal names")
            kind = "names"
    # root is unlabelled unless internal labels exist; edge count is nodes-1 (+root if it has one)
    has_bl = nlen >= nnodes - 1 and nlen > 0
    ultra = None
    if has_bl and root_mm:
        lo, hi = root_mm
        ultra = (hi - lo) <= 1e-3 * max(hi, 1e-12)
    ids = all(re.fullmatch(r"t[0-9a-z]{7}", x) for x in tiplabels)
    species = all(BINOMIAL.match(x) for x in tiplabels)
    return {"tips": tips, "internal_nodes": internal, "nodes": nnodes, "max_depth": maxd,
            "max_degree": maxdeg, "polytomies": polytomies, "branch_lengths": has_bl,
            "ultrametric": ultra, "internal_labels": kind,
            "tip_labels": "species" if species else "ids" if ids else "other"}, tiplabels


def expect(cond, msg):
    if not cond:
        raise ValueError(msg)


def check_shape(shape, n, suf, st):
    expect(st["tips"] == n, "tip count %d != %d" % (st["tips"], n))
    expect(st["tip_labels"] == ("ids" if suf == "_ids" else "species"), "tip label kind " + st["tip_labels"])
    expect(st["branch_lengths"] == (suf != "_nobl"), "branch length presence")
    expect(st["internal_labels"] == {"_support": "support", "_nodenames": "names"}.get(suf, "none"), "internal label kind")
    if shape in ("yule", "birthdeath", "balanced", "caterpillar"):
        expect(st["internal_nodes"] == n - 1 and st["max_degree"] == 2, "not fully binary")
    if shape in ("yule", "birthdeath", "balanced", "caterpillar") and st["branch_lengths"]:
        expect(st["ultrametric"], "expected ultrametric")
    if shape == "balanced":
        expect(st["max_depth"] == (n - 1).bit_length(), "balanced depth")
    if shape == "caterpillar":
        expect(st["max_depth"] == n - 1, "caterpillar depth")
    if shape == "bushy":
        expect(2 <= st["max_degree"] <= 20 and st["polytomies"] > 0, "bushy degree")
        expect(st["internal_nodes"] < n - 1, "bushy should have fewer internal nodes than binary")
    if shape == "mixed":
        expect(st["internal_nodes"] <= n - 1 and st["max_degree"] <= 20, "mixed degree")
        expect(st["ultrametric"] in (True, None), "mixed should be ultrametric")


def read_bytes(path):
    if os.path.exists(path):
        with open(path, "rb") as f:
            return f.read(), None
    with gzip.open(path + ".gz", "rb") as f:
        return f.read(), path + ".gz"


def file_entry(rel, data, gzpath):
    e = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    if gzpath:
        with open(gzpath, "rb") as f:
            g = f.read()
        e["gz_bytes"] = len(g)
        e["gz_sha256_gzip9n"] = hashlib.sha256(g).hexdigest()
    return e


def check_nexus(data, name):
    text = data.decode()
    taxa = re.search(r"TAXLABELS\s+(.*?)\s*;\s*END;", text, re.S).group(1).split()
    ntax = int(re.search(r"NTAX=(\d+)", text).group(1))
    expect(ntax == len(taxa) == len(set(taxa)), "TAXA count/unique")
    tr = re.search(r"^\s*TRANSLATE\s+(.*?)\s*;\s*TREE", text, re.S | re.M).group(1)
    tmap = {}
    for item in tr.split(","):
        k, v = item.split()
        tmap[k] = v
    expect(list(tmap.values()) == taxa and list(tmap) == [str(i + 1) for i in range(ntax)], "TRANSLATE vs TAXA")
    trees = re.findall(r"^\s*TREE\s+(\S+)\s*=\s*(?:\[&R\]\s*)?(\(.*;)\s*$", text, re.M)
    expect(trees, "no TREE lines")
    out = []
    for nm, nw in trees:
        st, labs = scan_newick(nw)
        expect(labs == set(tmap), "tree %s tips != TRANSLATE keys" % nm)
        expect(st["tips"] == ntax, "tree %s tip count" % nm)
        out.append(st)
    return {"ntax": ntax, "trees": len(trees), "tips_per_tree": ntax,
            "max_depth": [s["max_depth"] for s in out], "internal_nodes": [s["internal_nodes"] for s in out]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--update")
    ap.add_argument("--verify")
    a = ap.parse_args()
    res = {}
    names = set()
    nd = os.path.join(a.root, "newick")
    if os.path.isdir(nd):
        for f in os.listdir(nd):
            if f.endswith(".nwk") or f.endswith(".nwk.gz"):
                names.add(f[:-3] if f.endswith(".gz") else f)
    for f in sorted(names):
        m = NAME.match(f)
        expect(m, "unexpected file name " + f)
        shape, n, suf = m.group(1), int(m.group(2)), m.group(3) or ""
        data, gz = read_bytes(os.path.join(nd, f))
        text = data.decode("ascii")
        expect(text.endswith(";\n") and text.count("\n") == 1, f + ": expected one line ending in ';'")
        st, _ = scan_newick(text)
        check_shape(shape, n, suf, st)
        e = {"shape": shape, "variant": suf or "main"}
        e.update(st)
        e.update(file_entry(f, data, gz))
        e["storage"] = ("raw" if n <= COMMIT_RAW_MAX else
                        "gz" if n <= COMMIT_GZ_MAX and not suf else "generate-on-demand")
        res["newick/" + f] = e
    for sub, ext in (("nexus", ".nex"), ("meta", ".tsv"), ("align", ".fasta")):
        d = os.path.join(a.root, sub)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            with open(os.path.join(d, f), "rb") as fh:
                data = fh.read()
            if sub == "nexus":
                e = check_nexus(data, f)
            elif sub == "meta":
                rows = [l.split("\t") for l in data.decode().splitlines()]
                expect(all(len(r) == 4 for r in rows) and rows[0][0] == "tip_label", f + ": TSV shape")
                labs = [r[0] for r in rows[1:]]
                expect(len(labs) == len(set(labs)), f + ": duplicate tip labels")
                tree = os.path.join(a.root, "newick", f.split(".")[0] + ".nwk")
                tdata, _ = read_bytes(tree)
                _, tl = scan_newick(tdata.decode())
                e = {"rows": len(labs), "tips_without_row": len(tl - set(labs)),
                     "rows_without_tip": len(set(labs) - tl)}
                expect(e["tips_without_row"] > 0 and e["rows_without_tip"] == 3, f + ": unmatched design")
            else:
                lines = data.decode().splitlines()
                expect(len(lines) % 2 == 0 and all(l.startswith(">") for l in lines[::2]), f + ": FASTA")
                lens = {len(l) for l in lines[1::2]}
                labs = [l[1:] for l in lines[::2]]
                tree = os.path.join(a.root, "newick", f.split(".")[0] + ".nwk")
                tdata, _ = read_bytes(tree)
                _, tl = scan_newick(tdata.decode())
                expect(lens == {200} and set(labs) == tl and len(labs) == len(tl), f + ": alignment vs tree")
                e = {"sequences": len(labs), "columns": 200}
            e.update(file_entry(f, data, None))
            res["%s/%s" % (sub, f)] = e
    print("checked %d files OK" % len(res))
    if a.update:
        old = {}
        if os.path.exists(a.update):
            with open(a.update) as fh:
                old = json.load(fh)
        old.update(res)
        with open(a.update, "w") as fh:
            json.dump(old, fh, indent=1, sort_keys=True)
            fh.write("\n")
        print("manifest updated:", a.update)
    if a.verify:
        with open(a.verify) as fh:
            man = json.load(fh)
        bad = 0
        for k, e in res.items():
            m = man.get(k)
            if m is None:
                print("NOT IN MANIFEST", k)
                bad += 1
                continue
            for field in e:
                if field.startswith("gz_"):
                    continue
                if m.get(field) != e[field]:
                    print("MISMATCH", k, field, m.get(field), e[field])
                    bad += 1
        print("verify: %d files compared, %d problems" % (len(res), bad))
        sys.exit(1 if bad else 0)


if __name__ == "__main__":
    try:
        main()
    except ValueError as e:
        print("CHECK FAILED:", e)
        sys.exit(1)
