# Real-tree size ladder

Real published phylogenies at roughly 200, 1k, 10k, 100k and 1M tips, for benchmarking tree viewers for gbif.org. Everything is derived by the scripts in [scripts/](scripts/) (pure Python 3 standard library, iterative, no recursion). Generated from [manifest.json](manifest.json) by `scripts/make_manifest.py readme`; do not edit the tables by hand.

## Read this first

* **Two families, because no single source has everything.** The Open Tree of Life (OTL) family has species-name tips (joinable to the GBIF backbone) and reaches 1M tips, but it is **topology only: it has no branch lengths**. The GTDB family and the fish tree have **real branch lengths** but cover fewer sizes, and GTDB tips are genome accessions, not species names.
* **Dated (ultrametric) tree:** only the Fish Tree of Life (11,638 tips, millions of years). Its licence is unclear, so it is **fetched, not committed**. **Non-ultrametric trees:** GTDB (substitutions per site, assumed) and the fish RAxML tree. No dated tree above 12k tips was obtained (see *Not found*).
* The 1M rung (OTL Metazoa, 1.49M tips) and the full OTL tree (2.39M tips) are **not committed** (15 MB and 24 MB gzipped); run `./fetch.sh otl`, which takes them from this repo's `data/otl-large` branch and checks them against the manifest.
* Committed: 11 files, 5.2 MB in total. Fetched: the rest.
* GTDB files are CC BY-SA 4.0 (ShareAlike), not CC0/CC-BY: see *Sources and licences*.

## Rungs

`sha256` is of the uncompressed Newick (the gzip bytes can differ between zlib builds). Size is raw / gzip -9.

| rung | id / file | tips | internal nodes | source | licence | derivation | size raw / gz | sha256 (nwk) | status |
|---|---|---:|---:|---|---|---|---|---|---|
| 200 | [otl-0200-canidae](trees/otl-0200-canidae.nwk.gz) | 211 | 156 | OTL synthesis opentree16.1 | CC0 | Clade extraction: subtree below node 'Canidae_ott770319' (all descendants verbatim, no pruning; the clade root's own label is kept, it has no branch length). | 10 KB / 3 KB | `cba94fba5b05bcc9771ff2ad25911832d82e41947211c0121c05d760062d7d1f` | committed |
| 1k | [otl-1k-testudines](trees/otl-1k-testudines.nwk.gz) | 888 | 577 | OTL synthesis opentree16.1 | CC0 | Clade extraction below 'Testudines_ott639666'. | 41 KB / 13 KB | `545308207036d07435957320226ce976addffe863e2431a49c513f6532b1bab5` | committed |
| 10k | [otl-10k-amphibia](trees/otl-10k-amphibia.nwk.gz) | 10,018 | 4,856 | OTL synthesis opentree16.1 | CC0 | Clade extraction below 'Amphibia_ott544595'. | 444 KB / 126 KB | `67cadc63876657b623ad9f068d804301f636f496f5fc0d66b095c38b47782c4c` | committed |
| 100k | [otl-100k-vertebrata](trees/otl-100k-vertebrata.nwk.gz) | 90,938 | 47,708 | OTL synthesis opentree16.1 | CC0 | Clade extraction below 'Vertebrata_ott801601' (90,938 tips, -9% from 100k). | 3.9 MB / 1.1 MB | `93d744bb2217b68f185949951ac3d5d50a2db91880617caa7292ca713bdc14e7` | committed |
| 1M | `otl-1m-metazoa` (`fetched/`) | 1,490,245 | 227,168 | OTL synthesis opentree16.1 | CC0 | Clade extraction below 'Metazoa_ott691846' (1.49M tips; mostly arthropods). | 50.7 MB / 14.3 MB | `00b46794cf8bb561d2a15f7ae93fdf854779a278fb3048fba61f3599de17d543` | fetched |
| extra: full OTL tree | `otl-2m-full` (`fetched/`) | 2,385,875 | 339,807 | OTL synthesis opentree16.1 | CC0 | Whole synthetic tree opentree16.1, re-serialised. | 82.4 MB / 22.9 MB | `86bcd162bf307763225f0ba8e473c89b541231994269746e080a23fae66a9305` | fetched |
| 1k (alt, random) | [otl-1k-vertebrata-random](trees/otl-1k-vertebrata-random.nwk.gz) | 1,000 | 897 | OTL synthesis opentree16.1 | CC0 | Random tip sample: the 1,000 tips of Vertebrata_ott801601 with the smallest sha256('gbif-phylo-ladder-1:'+tip label); ancestors kept, single-child nodes collapsed (no lengths exist). | 52 KB / 22 KB | `41b26c1e719ea34562c2e698dedc567c736a76bb4ae6fbbcc83bbfd5002a22cc` | committed |
| 10k (alt, random) | [otl-10k-vertebrata-random](trees/otl-10k-vertebrata-random.nwk.gz) | 10,000 | 6,660 | OTL synthesis opentree16.1 | CC0 | As above with 10,000 tips. | 469 KB / 170 KB | `7e61e91d419182cd13e00aa998eb360481a2ef418721cf4c0bb87225273daeec` | committed |
| 200 (with lengths) | [gtdb-0200-iainarchaeia](trees/gtdb-0200-iainarchaeia.nwk.gz) | 215 | 214 | GTDB R11-RS232 | CC BY-SA 4.0 | Clade extraction from ar53_r232 below the node labelled '99.0:p__Iainarchaeota; c__Iainarchaeia'. | 10 KB / 4 KB | `ddb84ea0b9799e517309cc164c45cf4fbb38fe806998e048264195e9cc12863f` | committed |
| 1k (with lengths) | [gtdb-1k-nitrososphaeria](trees/gtdb-1k-nitrososphaeria.nwk.gz) | 932 | 931 | GTDB R11-RS232 | CC BY-SA 4.0 | Clade extraction from ar53_r232 below '98.0:c__Nitrososphaeria'. | 43 KB / 14 KB | `602d79681fbc30dd1ca68e734b6774a588b3d2e766079ed50dbbb067b18582d1` | committed |
| 10k (with lengths) | [gtdb-10k-archaea](trees/gtdb-10k-archaea.nwk.gz) | 10,122 | 10,121 | GTDB R11-RS232 | CC BY-SA 4.0 | Whole archaeal tree ar53_r232, re-serialised (same labels and length strings). | 478 KB / 151 KB | `e55e24b4c3b0b62b45ff351ed0257ed6d7067c7e7c4aa25fff486efdfe00ef79` | committed |
| 100k (with lengths) | [gtdb-100k-bacteria-random](trees/gtdb-100k-bacteria-random.nwk.gz) | 100,000 | 99,999 | GTDB R11-RS232 | CC BY-SA 4.0 | Random tip sample of 100,000 of the 189,801 tips of bac120_r232 (smallest sha256('gbif-phylo-ladder-1:'+tip label)). | 4.6 MB / 1.2 MB | `4e65e7e05a515f5b5263f7aa7b9aff1b532ea8a504e3e747dc2cad56c04fc033` | committed |
| extra: full bacterial tree | [gtdb-190k-bacteria](trees/gtdb-190k-bacteria.nwk.gz) | 189,801 | 189,800 | GTDB R11-RS232 | CC BY-SA 4.0 | Whole bacterial tree bac120_r232, re-serialised. | 9.0 MB / 2.3 MB | `9034e52f25ed0caead4e2153def93ee80ba0f513a0a2f65030127839a26fe02d` | committed |
| 200 (dated) | `fish-0200-random` (`fetched/`) | 200 | 199 | Fish Tree of Life 12k | unclear (not redistributed) | Random tip sample of 200 tips of actinopt_12k_treePL (same hash rule); unary nodes collapsed, lengths summed along collapsed paths (keeps the tree ultrametric). | 8 KB / 5 KB | `7e78f66459b6973bf73a142eca6c8f7ab26ec12d9990748e1306c382900d1d45` | fetched |
| 1k (dated) | `fish-1k-random` (`fetched/`) | 1,000 | 999 | Fish Tree of Life 12k | unclear (not redistributed) | As above with 1,000 tips. | 41 KB / 20 KB | `d58c3d4173014d798be363e267fac22380d48d9d98b8ac33e2b43f216490b5c8` | fetched |
| 10k (dated) | `fish-12k-timetree` (`fetched/`) | 11,638 | 11,637 | Fish Tree of Life 12k | unclear (not redistributed) | Whole actinopt_12k_treePL tree, re-serialised. | 472 KB / 195 KB | `a075a8f4ef59773b64547b2de812167a298243d7a16ea3cbd48e6d3ddbb14252` | fetched |
| 10k (non-ultrametric) | `fish-12k-raxml` (`fetched/`) | 11,638 | 11,637 | Fish Tree of Life 12k | unclear (not redistributed) | Whole actinopt_12k_raxml tree, re-serialised. | 810 KB / 354 KB | `73f454e279089cadf8d300f5c80173372ef1a5841295edebda18a11e9b1e0386` | fetched |

## Tree properties

Branch-length columns are over all edges that carry a length (root edge excluded). Ultrametric = root-to-tip distance varies by at most 0.1 percent. `max/med` is max length divided by median length (outlier indicator).

| id | lengths | ultrametric | units | min | median | max | max/med | zero / neg / missing | max depth (edges) | max children | unary nodes | internal labels |
|---|---|---|---|---:|---:|---:|---:|---|---:|---:|---:|---|
| otl-0200-canidae | no | n/a | n/a | - | - | - | - | - | 30 | 31 | 22 | every internal node is named |
| otl-1k-testudines | no | n/a | n/a | - | - | - | - | - | 21 | 61 | 124 | every internal node is named |
| otl-10k-amphibia | no | n/a | n/a | - | - | - | - | - | 42 | 408 | 188 | every internal node is named |
| otl-100k-vertebrata | no | n/a | n/a | - | - | - | - | - | 76 | 448 | 6194 | every internal node is named |
| otl-1m-metazoa | no | n/a | n/a | - | - | - | - | - | 99 | 8550 | 61282 | every internal node is named |
| otl-2m-full | no | n/a | n/a | - | - | - | - | - | 111 | 12964 | 83305 | every internal node is named |
| otl-1k-vertebrata-random | no | n/a | n/a | - | - | - | - | - | 35 | 11 | 0 | every internal node is named |
| otl-10k-vertebrata-random | no | n/a | n/a | - | - | - | - | - | 57 | 55 | 0 | every internal node is named |
| gtdb-0200-iainarchaeia | yes | no | subst./site (assumed, unverified) | 0.00326 | 0.07023 | 0.6804 | 9.689 | 0 / 0 / 0 | 22 | 2 | 0 | support value, optionally followed by a colon and  |
| gtdb-1k-nitrososphaeria | yes | no | subst./site (assumed, unverified) | 1e-06 | 0.01468 | 0.5573 | 37.95 | 0 / 0 / 0 | 47 | 2 | 0 | support value, optionally followed by a colon and  |
| gtdb-10k-archaea | yes | no | subst./site (assumed, unverified) | 1e-06 | 0.02726 | 1.639 | 60.13 | 0 / 0 / 0 | 60 | 2 | 0 | support value, optionally followed by a colon and  |
| gtdb-100k-bacteria-random | yes | no | subst./site (assumed, unverified) | 0 | 0.0114 | 0.6033 | 52.92 | 14 / 0 / 0 | 95 | 2 | 0 | support value, optionally followed by a colon and  |
| gtdb-190k-bacteria | yes | no | subst./site (assumed, unverified) | 0 | 0.00856 | 0.6033 | 70.48 | 40 / 0 / 0 | 103 | 2 | 0 | support value, optionally followed by a colon and  |
| fish-0200-random | yes | yes | Myr (unverified) | 0.5046 | 23.59 | 333.4 | 14.13 | 0 / 0 / 0 | 29 | 2 | 0 | none |
| fish-1k-random | yes | yes | Myr (unverified) | 0.007197 | 14.06 | 339.7 | 24.16 | 0 / 0 / 0 | 39 | 2 | 0 | none |
| fish-12k-timetree | yes | yes | Myr (unverified) | 0.002346 | 5.189 | 320.9 | 61.85 | 0 / 0 / 0 | 67 | 2 | 0 | none |
| fish-12k-raxml | yes | no | subst./site (unverified) | 1e-06 | 0.02487 | 1.029 | 41.37 | 0 / 0 / 0 | 67 | 2 | 0 | none |

Notes: (1) the minimum GTDB length of 1e-06 and zero-length edges in the bacterial tree are as published. (2) OTL clade files keep single-child (monotypic) internal nodes exactly as published; only the random samples collapse them. (3) OTL internal labels are taxon names or `mrcaottXottY` ids, never support values; GTDB internal labels are `support` or `support:taxon` strings, and some are quoted with spaces and semicolons (parser stress test); `fish` has no internal labels. (4) Tip identifiers: OTL `Genus_species_ott<id>` (about 99.9 percent binomial-like labels), GTDB `RS_GCF_...`/`GB_GCA_...` accessions, fish `Genus_species`.

## How branch lengths are handled when pruning

* **Clade extraction** (`clade`): the subtree is written verbatim; all descendant lengths and labels are unchanged; only the extracted root loses its own (incoming) branch length.
* **Whole tree** (`whole`): re-serialised, length strings kept byte-for-byte.
* **Random tip sampling** (`sample`): keep tips ranked by sha256(`gbif-phylo-ladder-1:` + tip label) (independent of the Python version); ancestors of kept tips are kept; any node left with a single child is removed and **the lengths along the collapsed path are summed into the surviving edge** (rounded to 12 digits; this preserves root-to-tip distances, so a dated tree stays ultrametric). A collapsed node's own label (support value or name) is dropped. A sample is rooted at the MRCA of the kept tips, not at the original root.

## Sources and licences

### OTL synthesis opentree16.1

* Source: Open Tree of Life synthetic tree, release opentree16.1 (labelled_supertree_simplified_ottnames.tre)
* URL: https://files.opentreeoflife.org/synthesis/opentree16.1/output/labelled_supertree/labelled_supertree_simplified_ottnames.tre
* Source sha256: `8101a8d13b6114fcadd4d4e199ab7238442ede705d227ee15d8d7a9056d96d11`
* Licence: CC0 public domain dedication, 'where not limited by pre-existing terms of use' (https://tree.opentreeoflife.org/about/licenses, read 2026-10-08)
* Caveat: The CC0 statement carries the qualifier 'where not limited by pre-existing terms of use'; the synthesis is built from many published studies, whose individual terms were not audited here.
* Citation: Open Tree of Life synthesis release opentree16.1 (synth_id from API, created 2025-12-20, taxonomy OTT 3.7draft3), https://tree.opentreeoflife.org. Method paper: Hinchliff et al. 2015, PNAS 112(41):12764-12769, doi:10.1073/pnas.1423041112 (DOI from memory, unverified).
* Attribution: None legally required under CC0; citing the release is good practice.
* Tip labels: species names with Open Tree taxonomy id suffix, e.g. Canis_lupus_ott247341 (binomials; a few tips are higher taxa or subspecies). Join to GBIF needs stripping '_ott<id>' and underscores, or the OTT taxonomy id cross-references (not checked here).
* Branch lengths: none (topology only); units: n/a
* Internal labels: every internal node is named: taxon names (Canidae_ott770319) or unnamed-node ids (mrcaott42ott240665); no support values

### GTDB R11-RS232

* Source: GTDB release R11-RS232 (v232, 2026-04-15), ar53_r232.tree.gz and bac120_r232.tree.gz
* URL: https://data.gtdb.ecogenomic.org/releases/release232/232.0/ (bac120_r232.tree.gz, ar53_r232.tree.gz; same bytes as releases/latest/ on 2026-10-08)
* Source sha256: `bac120 8c51060f740da69ff7076ed0305250a881b23093413108450c90fc233fd54c19; ar53 fc879fdef7928e6f7ddb48e2e10893869bfd010da2828b72f9592b50b06ea397 (md5 matches GTDB MD5SUM.txt)`
* Licence: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0) (https://gtdb.ecogenomic.org/downloads: 'This work is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License', read 2026-10-08)
* Caveat: ShareAlike: the committed subtrees are adaptations and are therefore redistributed under CC BY-SA 4.0 too. Not CC0/CC-BY; confirm that SA is acceptable before reusing these files outside this test-data folder.
* Citation: Parks, D.H. et al. (2025) GTDB release 10: a complete and systematic taxonomy for 715 230 bacterial and 17 245 archaeal genomes. Nucleic Acids Research gkaf1040, https://doi.org/10.1093/nar/gkaf1040 (as listed on https://gtdb.ecogenomic.org/about). Also Parks et al. 2020 Nat Biotechnol, doi:10.1038/s41587-020-0501-8.
* Attribution: Required (CC BY): credit GTDB, cite the papers, link the licence, indicate changes (we pruned/re-serialised).
* Tip labels: genome accessions with RefSeq/GenBank prefix (RS_GCF_..., GB_GCA_...), one species-representative genome per species cluster. NOT species names: matching to the GBIF backbone needs the GTDB taxonomy TSV (not included).
* Branch lengths: yes; units: not stated in the release files; assumed substitutions per site (FastTree/IQ-TREE per GTDB about page): unverified
* Internal labels: support value, optionally followed by a colon and GTDB taxon string, quoted, e.g. '98.0:c__Nitrososphaeria'; some internal nodes carry only a number

### Fish Tree of Life 12k

* Source: Fish Tree of Life (Rabosky et al. 2018), 12k-species trees: actinopt_12k_treePL.tre.xz (dated) and actinopt_12k_raxml.tre.xz
* URL: https://fishtreeoflife.org/downloads/
* Source sha256: `treePL.xz 543221541758e2bce063a5a76d6858f4f83a8a770225ee96c4292f7917188da2; raxml.xz 306f83016a3ba172a8f415549093400ef11b36bb718a5b9f23e264e140681686`
* Licence: UNCLEAR for these files: no licence statement found on fishtreeoflife.org (downloads page read 2026-10-08). The authors' Dryad deposit doi:10.5061/dryad.fc71cp4 is CC0-1.0 (verified through the Dryad API) but Dryad only lists one 116 MB Archive.zip and anonymous download is refused, so it was not possible to confirm that the website files are the same as the CC0 deposit.
* Caveat: NOT committed. Reference only, fetched by fetch.sh for local benchmarking.
* Citation: Rabosky, D.L. et al. (2018) An inverse latitudinal gradient in speciation rate for marine fishes. Nature 559:392-395, https://doi.org/10.1038/s41586-018-0273-1 (DOI taken from the Dryad record).
* Attribution: n/a (not redistributed)
* Tip labels: species names, Genus_species (11,638 ray-finned fishes)
* Branch lengths: yes; units: treePL tree: millions of years (unverified; root-to-tip 368.03 is consistent with the ~370 Ma crown age of ray-finned fishes); RAxML tree: substitutions per site (unverified)
* Internal labels: none

Items marked unverified were not checked against a primary source.

## Derivation, step by step

* `otl-0200-canidae`: Clade extraction: subtree below node 'Canidae_ott770319' (all descendants verbatim, no pruning; the clade root's own label is kept, it has no branch length).
* `otl-1k-testudines`: Clade extraction below 'Testudines_ott639666'.
* `otl-10k-amphibia`: Clade extraction below 'Amphibia_ott544595'.
* `otl-100k-vertebrata`: Clade extraction below 'Vertebrata_ott801601' (90,938 tips, -9% from 100k).
* `otl-1m-metazoa`: Clade extraction below 'Metazoa_ott691846' (1.49M tips; mostly arthropods). The whole synthetic tree (otl-2m-full) has 2,385,875 tips.
* `otl-2m-full`: Whole synthetic tree opentree16.1, re-serialised. Taken from the data/otl-large branch by fetch.sh.
* `otl-1k-vertebrata-random`: Random tip sample: the 1,000 tips of Vertebrata_ott801601 with the smallest sha256('gbif-phylo-ladder-1:'+tip label); ancestors kept, single-child nodes collapsed (no lengths exist).
* `otl-10k-vertebrata-random`: As above with 10,000 tips.
* `gtdb-0200-iainarchaeia`: Clade extraction from ar53_r232 below the node labelled '99.0:p__Iainarchaeota; c__Iainarchaeia'. Branch lengths unchanged; root edge dropped.
* `gtdb-1k-nitrososphaeria`: Clade extraction from ar53_r232 below '98.0:c__Nitrososphaeria'.
* `gtdb-10k-archaea`: Whole archaeal tree ar53_r232, re-serialised (same labels and length strings).
* `gtdb-100k-bacteria-random`: Random tip sample of 100,000 of the 189,801 tips of bac120_r232 (smallest sha256('gbif-phylo-ladder-1:'+tip label)). No named clade has 70k-130k tips (largest phylum Pseudomonadota 46,828). Unary nodes created by pruning are collapsed: the branch lengths along the collapsed path are SUMMED into the child edge, the collapsed node's support label is dropped.
* `gtdb-190k-bacteria`: Whole bacterial tree bac120_r232, re-serialised.
* `fish-0200-random`: Random tip sample of 200 tips of actinopt_12k_treePL (same hash rule); unary nodes collapsed, lengths summed along collapsed paths (keeps the tree ultrametric).
* `fish-1k-random`: As above with 1,000 tips.
* `fish-12k-timetree`: Whole actinopt_12k_treePL tree, re-serialised.
* `fish-12k-raxml`: Whole actinopt_12k_raxml tree, re-serialised.

## Reproducing

```
./fetch.sh            # all sources (about 130 MB), writes fetched/*.nwk.gz, checks sha256 against manifest.json
./fetch.sh otl        # only the two large OTL trees (1M and 2M rungs, 39 MB), from the data/otl-large branch
python3 -I scripts/nwk.py stats trees/otl-10k-amphibia.nwk.gz   # tips, depth, lengths, sizes as JSON
```

Tools in `scripts/`: `nwk.py` (iterative parser, `stats`, `clades`, `extract`, `sample`, `check`), `ladder.py` (rung definitions and derivation), `make_manifest.py` (manifest, README, verification). Tip counts were cross-checked with a separate regular-expression count on every output file, and the OTL total (2,385,875) matches the count reported by the Open Tree API.

## Not found / not done

* No **dated tree above 12k tips**: Zanne et al. 2014 (32k tips, Dryad doi:10.5061/dryad.63q27, CC0 per the Dryad API) and Rabosky 2018's Dryad archive could not be downloaded (Dryad API needs a bearer token; direct file URLs return 403). Smith and Brown 2018 (79k) lives on GitHub releases, which the proxy blocks (the repository carries no licence file that could be seen). Upham mammals, Jetz birds, VertLife and TimeTree were not attempted.
* **No real tree with branch lengths at 1M tips.** The only 1M real tree obtained (OTL) has none. The largest tree with lengths is GTDB bacteria at 189,801 tips. Greengenes2, SILVA and UShER/SARS-CoV-2 trees were not attempted.
* The fish 200/1k rungs are random samples (the tree has no internal names to cut clades by).
* OTL has no branch lengths by design (synthesis supertree); fish tree is licence-unclear and therefore only fetched.
