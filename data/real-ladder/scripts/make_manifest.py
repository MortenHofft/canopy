#!/usr/bin/env python3
"""Build manifest.json and README.md from a directory of derived rungs, or verify them.

    python3 -I make_manifest.py build  OUT_DIR            (maintainer; needs all sources derived)
    python3 -I make_manifest.py readme                    (rewrites README.md from manifest.json)
    python3 -I make_manifest.py verify MANIFEST OUT_DIR   (used by fetch.sh)

OUT_DIR contains <id>.nwk.gz and <id>.nwk.sha256 as written by ladder.py.
"""
import gzip, hashlib, json, os, sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nwk  # noqa: E402

ROOT = os.path.dirname(HERE)
COMMIT_LIMIT = 10 * 1024 * 1024

SOURCES = {
    "otl": {
        "name": "Open Tree of Life synthetic tree, release opentree16.1 (labelled_supertree_simplified_ottnames.tre)",
        "url": "https://files.opentreeoflife.org/synthesis/opentree16.1/output/labelled_supertree/labelled_supertree_simplified_ottnames.tre",
        "source_sha256": "8101a8d13b6114fcadd4d4e199ab7238442ede705d227ee15d8d7a9056d96d11",
        "source_bytes": 86390779,
        "licence": "CC0 public domain dedication, 'where not limited by pre-existing terms of use' (https://tree.opentreeoflife.org/about/licenses, read 2026-10-08)",
        "licence_status": "open",
        "licence_caveat": "The CC0 statement carries the qualifier 'where not limited by pre-existing terms of use'; the synthesis is built from many published studies, whose individual terms were not audited here.",
        "citation": "Open Tree of Life synthesis release opentree16.1 (synth_id from API, created 2025-12-20, taxonomy OTT 3.7draft3), https://tree.opentreeoflife.org. Method paper: Hinchliff et al. 2015, PNAS 112(41):12764-12769, doi:10.1073/pnas.1423041112 (DOI from memory, unverified).",
        "attribution": "None legally required under CC0; citing the release is good practice.",
        "tip_labels": "species names with Open Tree taxonomy id suffix, e.g. Canis_lupus_ott247341 (binomials; a few tips are higher taxa or subspecies). Join to GBIF needs stripping '_ott<id>' and underscores, or the OTT taxonomy id cross-references (not checked here).",
        "branch_lengths": "none (topology only)",
        "internal_labels": "every internal node is named: taxon names (Canidae_ott770319) or unnamed-node ids (mrcaott42ott240665); no support values",
        "units": "n/a",
    },
    "gtdb": {
        "name": "GTDB release R11-RS232 (v232, 2026-04-15), ar53_r232.tree.gz and bac120_r232.tree.gz",
        "url": "https://data.gtdb.ecogenomic.org/releases/release232/232.0/ (bac120_r232.tree.gz, ar53_r232.tree.gz; same bytes as releases/latest/ on 2026-10-08)",
        "source_sha256": "bac120 8c51060f740da69ff7076ed0305250a881b23093413108450c90fc233fd54c19; ar53 fc879fdef7928e6f7ddb48e2e10893869bfd010da2828b72f9592b50b06ea397 (md5 matches GTDB MD5SUM.txt)",
        "licence": "Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0) (https://gtdb.ecogenomic.org/downloads: 'This work is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License', read 2026-10-08)",
        "licence_status": "open-sharealike",
        "licence_caveat": "ShareAlike: the committed subtrees are adaptations and are therefore redistributed under CC BY-SA 4.0 too. Not CC0/CC-BY; confirm that SA is acceptable before reusing these files outside this test-data folder.",
        "citation": "Parks, D.H. et al. (2025) GTDB release 10: a complete and systematic taxonomy for 715 230 bacterial and 17 245 archaeal genomes. Nucleic Acids Research gkaf1040, https://doi.org/10.1093/nar/gkaf1040 (as listed on https://gtdb.ecogenomic.org/about). Also Parks et al. 2020 Nat Biotechnol, doi:10.1038/s41587-020-0501-8.",
        "attribution": "Required (CC BY): credit GTDB, cite the papers, link the licence, indicate changes (we pruned/re-serialised).",
        "tip_labels": "genome accessions with RefSeq/GenBank prefix (RS_GCF_..., GB_GCA_...), one species-representative genome per species cluster. NOT species names: matching to the GBIF backbone needs the GTDB taxonomy TSV (not included).",
        "branch_lengths": "yes",
        "internal_labels": "support value, optionally followed by a colon and GTDB taxon string, quoted, e.g. '98.0:c__Nitrososphaeria'; some internal nodes carry only a number",
        "units": "not stated in the release files; assumed substitutions per site (FastTree/IQ-TREE per GTDB about page): unverified",
    },
    "fish": {
        "name": "Fish Tree of Life (Rabosky et al. 2018), 12k-species trees: actinopt_12k_treePL.tre.xz (dated) and actinopt_12k_raxml.tre.xz",
        "url": "https://fishtreeoflife.org/downloads/",
        "source_sha256": "treePL.xz 543221541758e2bce063a5a76d6858f4f83a8a770225ee96c4292f7917188da2; raxml.xz 306f83016a3ba172a8f415549093400ef11b36bb718a5b9f23e264e140681686",
        "licence": "UNCLEAR for these files: no licence statement found on fishtreeoflife.org (downloads page read 2026-10-08). The authors' Dryad deposit doi:10.5061/dryad.fc71cp4 is CC0-1.0 (verified through the Dryad API) but Dryad only lists one 116 MB Archive.zip and anonymous download is refused, so it was not possible to confirm that the website files are the same as the CC0 deposit.",
        "licence_status": "unclear",
        "licence_caveat": "NOT committed. Reference only, fetched by fetch.sh for local benchmarking.",
        "citation": "Rabosky, D.L. et al. (2018) An inverse latitudinal gradient in speciation rate for marine fishes. Nature 559:392-395, https://doi.org/10.1038/s41586-018-0273-1 (DOI taken from the Dryad record).",
        "attribution": "n/a (not redistributed)",
        "tip_labels": "species names, Genus_species (11,638 ray-finned fishes)",
        "branch_lengths": "yes",
        "internal_labels": "none",
        "units": "treePL tree: millions of years (unverified; root-to-tip 368.03 is consistent with the ~370 Ma crown age of ray-finned fishes); RAxML tree: substitutions per site (unverified)",
    },
}

# id -> (ladder rung label, source key, derivation)
RUNGS = {
    "otl-0200-canidae": ("200", "otl", "Clade extraction: subtree below node 'Canidae_ott770319' (all descendants verbatim, no pruning; the clade root's own label is kept, it has no branch length)."),
    "otl-1k-testudines": ("1k", "otl", "Clade extraction below 'Testudines_ott639666'."),
    "otl-10k-amphibia": ("10k", "otl", "Clade extraction below 'Amphibia_ott544595'."),
    "otl-100k-vertebrata": ("100k", "otl", "Clade extraction below 'Vertebrata_ott801601' (90,938 tips, -9% from 100k)."),
    "otl-1m-metazoa": ("1M", "otl", "Clade extraction below 'Metazoa_ott691846' (1.49M tips; mostly arthropods). The whole synthetic tree has 2,385,875 tips, above the 2M cap."),
    "otl-1k-vertebrata-random": ("1k (alt, random)", "otl", "Random tip sample: the 1,000 tips of Vertebrata_ott801601 with the smallest sha256('gbif-phylo-ladder-1:'+tip label); ancestors kept, single-child nodes collapsed (no lengths exist)."),
    "otl-10k-vertebrata-random": ("10k (alt, random)", "otl", "As above with 10,000 tips."),
    "gtdb-0200-iainarchaeia": ("200 (with lengths)", "gtdb", "Clade extraction from ar53_r232 below the node labelled '99.0:p__Iainarchaeota; c__Iainarchaeia'. Branch lengths unchanged; root edge dropped."),
    "gtdb-1k-nitrososphaeria": ("1k (with lengths)", "gtdb", "Clade extraction from ar53_r232 below '98.0:c__Nitrososphaeria'."),
    "gtdb-10k-archaea": ("10k (with lengths)", "gtdb", "Whole archaeal tree ar53_r232, re-serialised (same labels and length strings)."),
    "gtdb-100k-bacteria-random": ("100k (with lengths)", "gtdb", "Random tip sample of 100,000 of the 189,801 tips of bac120_r232 (smallest sha256('gbif-phylo-ladder-1:'+tip label)). No named clade has 70k-130k tips (largest phylum Pseudomonadota 46,828). Unary nodes created by pruning are collapsed: the branch lengths along the collapsed path are SUMMED into the child edge, the collapsed node's support label is dropped."),
    "gtdb-190k-bacteria": ("extra: full bacterial tree", "gtdb", "Whole bacterial tree bac120_r232, re-serialised."),
    "fish-0200-random": ("200 (dated)", "fish", "Random tip sample of 200 tips of actinopt_12k_treePL (same hash rule); unary nodes collapsed, lengths summed along collapsed paths (keeps the tree ultrametric)."),
    "fish-1k-random": ("1k (dated)", "fish", "As above with 1,000 tips."),
    "fish-12k-timetree": ("10k (dated)", "fish", "Whole actinopt_12k_treePL tree, re-serialised."),
    "fish-12k-raxml": ("10k (non-ultrametric)", "fish", "Whole actinopt_12k_raxml tree, re-serialised."),
}
ORDER = list(RUNGS)


def fmt(x):
    if x is None:
        return "-"
    if isinstance(x, float):
        return "%.4g" % x
    return str(x)


def verify(manifest, out):
    m = json.load(open(manifest))
    bad = 0
    for r in m["rungs"]:
        p = os.path.join(out, r["id"] + ".nwk.sha256")
        if not os.path.exists(p):
            continue
        got = open(p).read().strip()
        ok = got == r["sha256_nwk"]
        print(("ok   " if ok else "FAIL ") + r["id"])
        bad += not ok
    sys.exit(1 if bad else 0)


def build(out):
    rungs = []
    for rid in ORDER:
        label, src, deriv = RUNGS[rid]
        gz = os.path.join(out, rid + ".nwk.gz")
        st = nwk.stats(gz)
        size_gz = os.path.getsize(gz)
        sha = open(os.path.join(out, rid + ".nwk.sha256")).read().strip()
        committed = SOURCES[src]["licence_status"] != "unclear" and size_gz <= COMMIT_LIMIT and rid != "otl-1m-metazoa"
        if size_gz > COMMIT_LIMIT:
            committed = False
        s = SOURCES[src]
        rungs.append({
            "id": rid, "rung": label, "source": src,
            "file": ("trees/%s.nwk.gz" % rid) if committed else None,
            "status": "committed" if committed else "fetched",
            "fetch": None if committed else "./fetch.sh %s  -> fetched/%s.nwk.gz" % ({"otl": "otl", "gtdb": "gtdb", "fish": "fish"}[src], rid),
            "tips": st["tips"], "internal_nodes": st["internal_nodes"], "unary_internal_nodes": st["unary_internal_nodes"],
            "max_children": st["max_children"], "max_depth_edges": st["max_depth_edges"],
            "unique_tip_labels": st["unique_tip_labels"], "tips_binomial_like": st["tips_binomial_like"],
            "internal_nodes_with_label": st["internal_with_label"], "internal_labels_numeric_only": st["internal_labels_numeric"],
            "internal_labels": s["internal_labels"], "tip_labels": s["tip_labels"],
            "branch_lengths": st["branch_lengths"], "branch_length_units": s["units"],
            "bytes_raw": st["bytes_raw"], "bytes_gzip9": size_gz,
            "sha256_nwk": sha, "sha256_gz": hashlib.sha256(open(gz, "rb").read()).hexdigest(),
            "derivation": deriv, "licence": s["licence"], "licence_status": s["licence_status"],
            "licence_caveat": s["licence_caveat"], "citation": s["citation"], "attribution": s["attribution"],
        })
        if committed:
            os.makedirs(os.path.join(ROOT, "trees"), exist_ok=True)
            with open(gz, "rb") as a, open(os.path.join(ROOT, "trees", rid + ".nwk.gz"), "wb") as b:
                b.write(a.read())
    manifest = {"generated_by": "scripts/make_manifest.py", "hash_seed": "gbif-phylo-ladder-1",
                "ultrametric_tolerance": "(max-min root-to-tip) <= 1e-3 * max root-to-tip",
                "sources": SOURCES, "rungs": rungs}
    with open(os.path.join(ROOT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
        f.write("\n")
    return manifest


def human(n):
    return "%.1f MB" % (n / 1048576) if n >= 1048576 else "%.0f KB" % (n / 1024)


def readme():
    m = json.load(open(os.path.join(ROOT, "manifest.json")))
    L = []
    w = L.append
    w("# Real-tree size ladder\n")
    w("Real published phylogenies at roughly 200, 1k, 10k, 100k and 1M tips, for benchmarking tree viewers for gbif.org. Everything is derived by the scripts in [scripts/](scripts/) (pure Python 3 standard library, iterative, no recursion). Generated from [manifest.json](manifest.json) by `scripts/make_manifest.py readme`; do not edit the tables by hand.\n")
    w("## Read this first\n")
    w("* **Two families, because no single source has everything.** The Open Tree of Life (OTL) family has species-name tips (joinable to the GBIF backbone) and reaches 1M tips, but it is **topology only: it has no branch lengths**. The GTDB family and the fish tree have **real branch lengths** but cover fewer sizes, and GTDB tips are genome accessions, not species names.")
    w("* **Dated (ultrametric) tree:** only the Fish Tree of Life (11,638 tips, millions of years). Its licence is unclear, so it is **fetched, not committed**. **Non-ultrametric trees:** GTDB (substitutions per site, assumed) and the fish RAxML tree. No dated tree above 12k tips was obtained (see *Not found*).")
    w("* The 1M rung (OTL Metazoa, 1.49M tips) is **not committed** (15 MB gzipped); run `./fetch.sh otl`.")
    w("* Committed: %d files, %s in total. Fetched: the rest." % (sum(r["status"] == "committed" for r in m["rungs"]), human(sum(r["bytes_gzip9"] for r in m["rungs"] if r["status"] == "committed"))))
    w("* GTDB files are CC BY-SA 4.0 (ShareAlike), not CC0/CC-BY: see *Sources and licences*.\n")
    w("## Rungs\n")
    w("`sha256` is of the uncompressed Newick (the gzip bytes can differ between zlib builds). Size is raw / gzip -9.\n")
    w("| rung | id / file | tips | internal nodes | source | licence | derivation | size raw / gz | sha256 (nwk) | status |")
    w("|---|---|---:|---:|---|---|---|---|---|---|")
    short = {"otl": "OTL synthesis opentree16.1", "gtdb": "GTDB R11-RS232", "fish": "Fish Tree of Life 12k"}
    lic = {"open": "CC0", "open-sharealike": "CC BY-SA 4.0", "unclear": "unclear (not redistributed)"}
    for r in m["rungs"]:
        f = ("[%s](%s)" % (r["id"], r["file"])) if r["file"] else "`%s` (`fetched/`)" % r["id"]
        w("| %s | %s | %s | %s | %s | %s | %s | %s / %s | `%s` | %s |" % (
            r["rung"], f, format(r["tips"], ","), format(r["internal_nodes"], ","), short[r["source"]], lic[r["licence_status"]],
            r["derivation"].split(". ")[0].rstrip(".") + ".", human(r["bytes_raw"]), human(r["bytes_gzip9"]), r["sha256_nwk"], r["status"]))
    w("")
    w("## Tree properties\n")
    w("Branch-length columns are over all edges that carry a length (root edge excluded). Ultrametric = root-to-tip distance varies by at most 0.1 percent. `max/med` is max length divided by median length (outlier indicator).\n")
    w("| id | lengths | ultrametric | units | min | median | max | max/med | zero / neg / missing | max depth (edges) | max children | unary nodes | internal labels |")
    w("|---|---|---|---|---:|---:|---:|---:|---|---:|---:|---:|---|")
    for r in m["rungs"]:
        b = r["branch_lengths"]
        if b["present"]:
            row = ("yes", "yes" if b["ultrametric"] else "no", {"gtdb": "subst./site (assumed, unverified)", "fish": ("Myr (unverified)" if "timetree" in r["id"] or "random" in r["id"] else "subst./site (unverified)")}[r["source"]],
                   fmt(b["min"]), fmt(b["median"]), fmt(b["max"]), fmt(b["max_over_median"]),
                   "%d / %d / %d" % (b["zero_length_edges"], b["negative_length_edges"], b["edges_missing_length"]))
        else:
            row = ("no", "n/a", "n/a", "-", "-", "-", "-", "-")
        w("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %d | %d | %d | %s |" % ((r["id"],) + row + (
            r["max_depth_edges"], r["max_children"], r["unary_internal_nodes"], r["internal_labels"].split(":")[0][:50])))
    w("")
    w("Notes: (1) the minimum GTDB length of 1e-06 and zero-length edges in the bacterial tree are as published. (2) OTL clade files keep single-child (monotypic) internal nodes exactly as published; only the random samples collapse them. (3) OTL internal labels are taxon names or `mrcaottXottY` ids, never support values; GTDB internal labels are `support` or `support:taxon` strings, and some are quoted with spaces and semicolons (parser stress test); `fish` has no internal labels. (4) Tip identifiers: OTL `Genus_species_ott<id>` (about 99.9 percent binomial-like labels), GTDB `RS_GCF_...`/`GB_GCA_...` accessions, fish `Genus_species`.\n")
    w("## How branch lengths are handled when pruning\n")
    w("* **Clade extraction** (`clade`): the subtree is written verbatim; all descendant lengths and labels are unchanged; only the extracted root loses its own (incoming) branch length.")
    w("* **Whole tree** (`whole`): re-serialised, length strings kept byte-for-byte.")
    w("* **Random tip sampling** (`sample`): keep tips ranked by sha256(`gbif-phylo-ladder-1:` + tip label) (independent of the Python version); ancestors of kept tips are kept; any node left with a single child is removed and **the lengths along the collapsed path are summed into the surviving edge** (rounded to 12 digits; this preserves root-to-tip distances, so a dated tree stays ultrametric). A collapsed node's own label (support value or name) is dropped. A sample is rooted at the MRCA of the kept tips, not at the original root.\n")
    w("## Expanded rung: 10M tips (stress test, partly synthetic)\n")
    w("`./expand.sh` (needs `./fetch.sh otl` first) grows the full 2.39M-tip Open Tree synthesis to **10,000,000 tips** with `scripts/expand_tips.py`: every tip becomes a clade of about 4 tips on average (1 to 13), labelled `<tip label>_s1` .. `_sk`, with the original tip label kept on the clade root as an internal name (as genera are in Open Tree). Everything above the species level is the real tree, byte for byte (polytomies with thousands of children, 99-deep paths, quoted labels); everything below it is synthetic (random joins of 2 to 4 sub-clades, so mostly bifurcating with some polytomies). The result has no branch lengths, like its source; `LENGTHS=1 ./expand.sh` draws a length for every edge (exponential, mean 0.05, arbitrary units) for phylogram tests. It is **generated, not committed**: expect about 450 MB of Newick (under 100 MB gzipped; the 400k test measured 47 bytes per tip raw and 7 gzipped) and, with pyarrow installed, the Parquet layout of `spikes/parquet-experiment` next to it (about 300 MB scaled from the 400k test, `nodes.parquet` the largest at about 130 MB because the expansion adds 1.8 nodes per tip). The tip count is exact; the sha256 is written next to the file and depends on the seed and the CPython version. Checked on the committed 91k-tip file grown to 400k tips: parses with `nwk.py`, converts with `convert.py` and passes `verify.py` (2026-10-21). The expanded tips are not real taxa: do not use this rung for GBIF matching, only for size.\n")
    w("## Sources and licences\n")
    for k, s in m["sources"].items():
        w("### %s\n" % short[k])
        w("* Source: %s" % s["name"])
        w("* URL: %s" % s["url"])
        w("* Source sha256: `%s`" % s["source_sha256"])
        w("* Licence: %s" % s["licence"])
        w("* Caveat: %s" % s["licence_caveat"])
        w("* Citation: %s" % s["citation"])
        w("* Attribution: %s" % s["attribution"])
        w("* Tip labels: %s" % s["tip_labels"])
        w("* Branch lengths: %s; units: %s" % (s["branch_lengths"], s["units"]))
        w("* Internal labels: %s\n" % s["internal_labels"])
    w("Items marked unverified were not checked against a primary source.\n")
    w("## Derivation, step by step\n")
    for r in m["rungs"]:
        w("* `%s`: %s" % (r["id"], r["derivation"]))
    w("")
    w("## Reproducing\n")
    w("```\n./fetch.sh            # all sources (about 130 MB), writes fetched/*.nwk.gz, checks sha256 against manifest.json\n./fetch.sh otl        # only the OTL source (needed for the 1M rung)\npython3 -I scripts/nwk.py stats trees/otl-10k-amphibia.nwk.gz   # tips, depth, lengths, sizes as JSON\n```\n")
    w("Tools in `scripts/`: `nwk.py` (iterative parser, `stats`, `clades`, `extract`, `sample`, `check`), `ladder.py` (rung definitions and derivation), `make_manifest.py` (manifest, README, verification). Tip counts were cross-checked with a separate regular-expression count on every output file, and the OTL total (2,385,875) matches the count reported by the Open Tree API.\n")
    w("## Not found / not done\n")
    w("* No **dated tree above 12k tips**: Zanne et al. 2014 (32k tips, Dryad doi:10.5061/dryad.63q27, CC0 per the Dryad API) and Rabosky 2018's Dryad archive could not be downloaded (Dryad API needs a bearer token; direct file URLs return 403). Smith and Brown 2018 (79k) lives on GitHub releases, which the proxy blocks (the repository carries no licence file that could be seen). Upham mammals, Jetz birds, VertLife and TimeTree were not attempted.")
    w("* **No real tree with branch lengths at 1M tips.** The only 1M real tree obtained (OTL) has none. The largest tree with lengths is GTDB bacteria at 189,801 tips. Greengenes2, SILVA and UShER/SARS-CoV-2 trees were not attempted.")
    w("* The fish 200/1k rungs are random samples (the tree has no internal names to cut clades by).")
    w("* OTL has no branch lengths by design (synthesis supertree); fish tree is licence-unclear and therefore only fetched.")
    open(os.path.join(ROOT, "README.md"), "w").write("\n".join(L) + "\n")


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "verify":
        verify(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 2 and sys.argv[1] == "readme":
        readme()
    elif len(sys.argv) == 3 and sys.argv[1] == "build":
        build(sys.argv[2])
    else:
        sys.exit(__doc__)
