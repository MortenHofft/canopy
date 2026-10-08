# data/rich: real trees with more than tip names

Test datasets for richer viewer features (alignments, annotations, trait/domain columns, dates, GBIF-matchable names), collected 2026-10-08. All files are real data from open sources, except `edge-cases/` (hand-made, labelled). Every dataset has a sub-folder with a `NOTES.md`; `manifest.json` is the machine-readable form of this table. Counts and statistics are computed from the committed files by `scripts/treecheck.py` (pure Python 3 stdlib, iterative).

## Catalogue

| id | folder | format(s) | tips | extra data carried | source | licence | size (bytes) | sha256 of main tree file |
|---|---|---|---|---|---|---|---|---|
| ens-ncrna-102 | [ens-ncrna-102](ens-ncrna-102/) | Newick, NHX, FASTA (aligned), TSV | 102 | Substitution-scale branch lengths; NHX tags (D duplication, G gene id, T NCBI taxon id); aligned ncRNA FASTA (557 columns); members.tsv with species, ... | https://ftp.ensembl.org/pub/release-116/emf/ensembl-compara/homologies/Compara.116.ncrna_default.aln.emf.gz | Ensembl "no restriction" (see caveat) | 81676 | `5cc0a88f820761abe82ffc2099d3b6e5b2582c539425d479c59c03b784b00f6b` |
| ens-ncrna-399 | [ens-ncrna-399](ens-ncrna-399/) | Newick, NHX, FASTA (aligned), TSV | 399 | As ens-ncrna-102 but 399 sequences x 1148 alignment columns | https://ftp.ensembl.org/pub/release-116/emf/ensembl-compara/homologies/Compara.116.ncrna_default.aln.emf.gz | Ensembl "no restriction" (see caveat) | 125424 | `8773231d8d058a54def1d447c8ca953955bde9756628486097b4efe6bdd83835` |
| ens-protein-54 | [ens-protein-54](ens-protein-54/) | Newick, NHX, FASTA (aligned), TSV | 54 | Substitution-scale branch lengths; NHX duplication flags; aligned protein FASTA; members.tsv with species (strain), gene id, gene symbol where ... | https://ftp.ensembl.org/pub/release-116/emf/ensembl-compara/homologies/Compara.116.protein_murinae.aln.emf.gz | Ensembl "no restriction" (see caveat) | 74950 | `9247a9d3a229e0dfdc8c1fee1d42527cfa98c36067b4a538fc277f5aba96a88a` |
| ens-protein-110 | [ens-protein-110](ens-protein-110/) | Newick, NHX, FASTA (aligned), TSV | 110 | Substitution-scale branch lengths; NHX duplication flags; aligned protein FASTA; members.tsv with species (strain), gene id, gene symbol where ... | https://ftp.ensembl.org/pub/release-116/emf/ensembl-compara/homologies/Compara.116.protein_murinae.aln.emf.gz | Ensembl "no restriction" (see caveat) | 142308 | `f998da507d3042559e63e3f39aabf6c7671831e48190dbab4eea0413fa10adb5` |
| ens-protein-197 | [ens-protein-197](ens-protein-197/) | Newick, NHX, FASTA (aligned), TSV | 197 | Substitution-scale branch lengths; NHX duplication flags; aligned protein FASTA; members.tsv with species (strain), gene id, gene symbol where ... | https://ftp.ensembl.org/pub/release-116/emf/ensembl-compara/homologies/Compara.116.protein_murinae.aln.emf.gz | Ensembl "no restriction" (see caveat) | 52865 | `d70375524159ae3adf492ffde680612eab1a5df380044229f93bd6931a409a2b` |
| ens-protein-386 | [ens-protein-386](ens-protein-386/) | Newick, NHX, FASTA (aligned), TSV | 386 | Substitution-scale branch lengths; NHX duplication flags; aligned protein FASTA; members.tsv with species (strain), gene id, gene symbol where ... | https://ftp.ensembl.org/pub/release-116/emf/ensembl-compara/homologies/Compara.116.protein_murinae.aln.emf.gz | Ensembl "no restriction" (see caveat) | 109978 | `94e972fa5f622a32cc95aeb2ec3e233b51b4782e3cc48f2a4221d3dc6b648540` |
| ens-phyloxml | [ens-phyloxml](ens-phyloxml/) | phyloXML | 101 | phyloXML clade elements: `taxonomy` (NCBI id, scientific_name, common_name), `sequence` (accession, symbol name, genomic location), `confidence` ... | https://ftp.ensembl.org/pub/release-116/xml/ensembl-compara/homologies/Compara.116.ncrna_default.tree.phyloxml.xml.tar | Ensembl "no restriction" (see caveat) | 195565 | `a69f9c9f4ca079224704026702b2d0f91513bde3d7a195846776fc9539570c0a` |
| phylogenes-PTHR11444 | [phylogenes-PTHR11444](phylogenes-PTHR11444/) | phyloXML, CSV | 85 | phyloXML with tip `taxonomy`, UniProt `sequence/accession`, internal `events` (speciation/duplication; polytomies); CSV is a per-tip table: Uniprot ... | https://zenodo.org/records/4435322 | CC-BY 4.0 | 112529 | `9813200b44fa4840c37733de887c314b1ece4d5cd758a081cc3ad38024496ac1` |
| phylogenes-PTHR24009 | [phylogenes-PTHR24009](phylogenes-PTHR24009/) | phyloXML, CSV | 292 | phyloXML with tip `taxonomy`, UniProt `sequence/accession`, internal `events` (speciation/duplication; polytomies); CSV is a per-tip table: Uniprot ... | https://zenodo.org/records/4435322 | CC-BY 4.0 | 49973 | `dad663ad310a55d5fd42a6356250ecded7a0492619607cc02f63cc97de8d7e15` |
| phylogenes-PTHR10766 | [phylogenes-PTHR10766](phylogenes-PTHR10766/) | phyloXML, CSV | 756 | phyloXML with tip `taxonomy`, UniProt `sequence/accession`, internal `events` (speciation/duplication; polytomies); CSV is a per-tip table: Uniprot ... | https://zenodo.org/records/4435322 | CC-BY 4.0 | 166728 | `27b481dbace1d0c304690fa1e2c7eb57134eb85fe82b22f1dd185fdb0d030dc7` |
| beast-fluA-h3-swine | [beast-fluA-h3-swine](beast-fluA-h3-swine/) | Nexus (BEAST), TSV | 76 | BEAST annotations in [&...] comments: height, height_95%_HPD, height_median, height_range, length*, posterior, rate*. Genotype.txt: per-tip lineage ... | https://zenodo.org/records/4997840 | CC0 1.0 | 89753 | `5bd13498b0c9592830392d8f4b3d8600dbdae533bb40f47e5cdcbcbad2d0dda8` |
| beast-hcv-2k1b | [beast-hcv-2k1b](beast-hcv-2k1b/) | Nexus (BEAST) | 109 | BEAST [&...] annotations incl. discrete trait `COO` (country of origin) with `COO.prob`, `COO.set`, `COO.set.prob`, `COO.rate*`, height/length HPDs ... | https://zenodo.org/records/4970094 | CC0 1.0 | 39406 | `201c47ad895e409f6a5e34078beafd8fa44264bf5c04d18e9fbe2cd90f1aa78c` |
| hcv-2k-iqtree-alignment | [hcv-2k-iqtree-alignment](hcv-2k-iqtree-alignment/) | Nexus, FASTA (aligned) | 19 | Midpoint-rooted ML tree plus the aligned nucleotide FASTA (genome-length alignment) used to infer it | https://zenodo.org/records/4970094 | CC0 1.0 | 20391 | `34e5cf23ec2154eb62307299bcf418ad9ae52f07ee005f286d9a9152a47ce375` |
| beast-fluB-vic-ha | [beast-fluB-vic-ha](beast-fluB-vic-ha/) | Nexus (BEAST) | 1019 | BEAST annotations: `location` (discrete phylogeography), `posterior`, `rate*`, `height*`, `length*` with HPD, `shapeSize` | https://zenodo.org/records/4984136 | CC0 1.0 | 387963 | `30cede97df6163dc147586e43b4131824cdd1c5aac78d13322f36645a2aa53e5` |
| fish-carangaria-mcc | [fish-carangaria-mcc](fish-carangaria-mcc/) | Nexus (BEAST, TAXA + TRANSLATE) | 135 | BEAST MCC tree with node-height annotations (height, height_95%_HPD, ...); NEXUS TAXA block + TRANSLATE table | https://zenodo.org/records/4944999 | CC0 1.0 | 111429 | `d6ab0bfd0108196487ac61dd2292c2000fbd12f375d1ce20b522abf1095e0527` |
| fish-rabosky-1057 | [fish-rabosky-1057](fish-rabosky-1057/) | Newick | 1057 | Plain Newick with dated branch lengths; species tips only | https://zenodo.org/records/4944999 | CC0 1.0 | 73661 | `c7b7ab2fd13c0b3d0e070e64638dcd609b8e418ff63375917426f4ef56593cd9` |
| corvoid-mcc-680 | [corvoid-mcc-680](corvoid-mcc-680/) | Nexus (BEAST, TAXA + TRANSLATE, [&R]) | 680 | BEAST annotations: rate, rate_median, rate_range, height, height_95%_HPD, length, length_95%_HPD ... | https://zenodo.org/records/4995552 | CC0 1.0 | 241818 | `c73aa7a8b00d80b892a48966a7b571855385515b00ef5574527fc56d5b9830fe` |
| birdtree-100-posterior | [birdtree-100-posterior](birdtree-100-posterior/) | Nexus (multi-tree, no TAXA/TRANSLATE) | 380 x100 trees | 100 trees (tree_0000 ...), each with the same 380 species; header comments cite Jetz et al. 2012. Good for a multi-tree selector or tree-set tests | https://zenodo.org/records/8328753 | CC0 1.0 | 623742 | `27773da491bd8ecc1f21ff3c16851cafab78347ee3cb9629d0ad31ac134b01da` |
| butterflies-europe-496 | [butterflies-europe-496](butterflies-europe-496/) | Newick | 496 | Time-calibrated species tree; the same Zenodo record has trait/climatic-risk tables only as XLSX (not copied) | https://zenodo.org/records/12802644 | CC-BY 4.0 | 43180 | `98bf3f88cefef5801fc9c13283a931c636e7bc1c388eeba75f42c2ccfe627f18` |
| mammals-4071 | [mammals-4071](mammals-4071/) | Newick, CSV | 4071 | total_dataset.csv: per-species reflectance measures (B2.TOT/UV/VIS/NIR ...), class (Aves/Mammalia/...), source columns - a trait table for aligned ... | https://zenodo.org/records/19210896 | CC-BY 4.0 | 243375 | `75fe877c54ed0dcca2f433c64de059461b3fb6a85f61279b4ace91c0da8affbe` |
| nlr-plants-3816 | [nlr-plants-3816](nlr-plants-3816/) | Newick (support in brackets), iTOL TREE_COLORS text, FASTA (unaligned) | 3816 | Large gene-family tree; iTOL `TREE_COLORS` file (per-tip and per-branch colours, line style, width); protein sequences (unaligned) of the family ... | https://zenodo.org/records/17067745 | CC-BY 4.0 | 1735557 | `2b84cc0887ef976ed4b2131e00123e7530b52c267a2c5468bcc79f6bd1d09a8b` |
| otol-carnivora | [otol-carnivora](otol-carnivora/) | Newick | 728 | Taxonomic/synthesis tree: internal node labels (mrcaottXXXXottYYYY or taxon names with ott ids), labels `Name_ottID`, many polytomies, subspecies ... | https://api.opentreeoflife.org/v3/tree_of_life/subtree | CC0 1.0 | 51027 | `6a3788cf1c4e410ce245d7a286838fcd6dfc6c66310e06cf90932c35462b24eb` |
| otol-primates | [otol-primates](otol-primates/) | Newick | 748 | As otol-carnivora | https://api.opentreeoflife.org/v3/tree_of_life/subtree | CC0 1.0 | 32175 | `eaa7deed17cc5375306c3317c9de90904a2c61d4c7d617557b813f1b44852b09` |
| otol-mammalia | [otol-mammalia](otol-mammalia/) | Newick | 9328 | As otol-carnivora, larger | https://api.opentreeoflife.org/v3/tree_of_life/subtree | CC0 1.0 | 118293 | `7e8c814062c6baa4188d1945774517d41a672d8d9ce1c3262b9225455a403f36` |
| otol-aves | [otol-aves](otol-aves/) | Newick | 18988 | As otol-carnivora, ~19k tips (largest real tree in this folder) | https://api.opentreeoflife.org/v3/tree_of_life/subtree | CC0 1.0 | 255446 | `b598dece71456a39812bdf36a0a3f0a56ed440be918cf268b120888c78ebcb32` |

Citations, exact licence wording, and "how obtained" are in each `NOTES.md` and in `manifest.json`.

## Branch lengths (all main trees)

Lengths live in different places by format: Newick `:len`; phyloXML `branch_length` attribute (Ensembl) or child element (PhyloGenes); BEAST `[&length=..,height=..]` comments hold *node heights and HPDs in addition to* the colon length; Auspice stores cumulative `node_attrs.div` and dates in `num_date` instead of per-branch lengths. Ultrametric is tested as relative spread of root-to-tip distance < 1e-4. "max/med" = max branch length over median branch length.

| id | kind | units | where | min | max | median | max/med | zero | negative | missing |
|---|---|---|---|---|---|---|---|---|---|---|
| ens-ncrna-102 | substitutions per site (gene tree, not ultrametric) | substitutions/site (Compara ncRNA, unverified model) | Newick `:length` and NHX | 0 | 0.1957 | 0.01575 | 12.42 | 41 | 0 | 0 |
| ens-ncrna-399 | substitutions per site (gene tree) | substitutions/site | Newick `:length` and NHX | 0 | 0.3793 | 0.02039 | 18.61 | 181 | 0 | 0 |
| ens-protein-54 | substitutions per site (gene tree) | substitutions/site | Newick `:length` and NHX | 0 | 0.07066 | 1e-06 | 7.066e+04 | 49 | 0 | 0 |
| ens-protein-110 | substitutions per site (gene tree) | substitutions/site | Newick `:length` and NHX | 1e-06 | 1.287 | 1e-06 | 1.287e+06 | 0 | 0 | 0 |
| ens-protein-197 | substitutions per site (gene tree) | substitutions/site | Newick `:length` and NHX | 1e-06 | 1.195 | 1e-06 | 1.195e+06 | 0 | 0 | 0 |
| ens-protein-386 | substitutions per site (gene tree) | substitutions/site | Newick `:length` and NHX | 1e-06 | 0.6708 | 1e-06 | 6.708e+05 | 0 | 0 | 0 |
| ens-phyloxml | substitutions per site (gene tree) | substitutions/site | phyloXML `branch_length` attribute on <clade> | 0 | 0.2803 | 0 | median 0 | 112 | 0 | 0 |
| phylogenes-PTHR11444 | relative divergence (PANTHER tree, not ultrametric; branch lengths appear capped at 2.0, unverified) | unknown (PANTHER branch length) | phyloXML `<branch_length>` child element of <clade> | 0 | 2 | 0.032 | 62.5 | 5 | 0 | 0 |
| phylogenes-PTHR24009 | relative divergence (PANTHER tree, not ultrametric; branch lengths appear capped at 2.0, unverified) | unknown (PANTHER branch length) | phyloXML `<branch_length>` child element of <clade> | 0 | 2 | 0.088 | 22.73 | 20 | 0 | 0 |
| phylogenes-PTHR10766 | relative divergence (PANTHER tree, not ultrametric; branch lengths appear capped at 2.0, unverified) | unknown (PANTHER branch length) | phyloXML `<branch_length>` child element of <clade> | 0 | 2 | 0.031 | 64.52 | 57 | 0 | 0 |
| beast-fluA-h3-swine | dated (time-scaled, BEAST MCC), heterochronous tips, so NOT ultrametric | years | Newick `:length` plus BEAST comments `[&height=..,height_95%_HPD={..},length=..,rate=..,posterior=..]` | 0.04157 | 3.499 | 0.6166 | 5.675 | 0 | 0 | 0 |
| beast-hcv-2k1b | dated (time-scaled), heterochronous tips, not ultrametric | years | Newick `:length` plus BEAST comments (height, length, *_95%_HPD) | -0.8048 | 62.26 | 19.23 | 3.237 | 0 | 1 | 0 |
| hcv-2k-iqtree-alignment | substitutions per site (ML tree), midpoint rooted, not ultrametric | substitutions/site | Newick `:length` | 0.000815 | 0.09055 | 0.03537 | 2.56 | 0 | 0 | 0 |
| beast-fluB-vic-ha | dated (time-scaled), heterochronous tips, not ultrametric; negative lengths present | years | Newick `:length` plus BEAST comments | -0.2211 | 6.321 | 0.3539 | 17.86 | 0 | 23 | 0 |
| fish-carangaria-mcc | dated, ultrametric | million years (Ma; unverified) | Newick `:length` plus BEAST comments | 0.9754 | 105.4 | 9.082 | 11.6 | 0 | 0 | 0 |
| fish-rabosky-1057 | dated, ultrametric | million years (Ma; unverified) | Newick `:length` | 0.001771 | 57.99 | 2.633 | 22.03 | 0 | 0 | 0 |
| corvoid-mcc-680 | dated, ultrametric | million years (Ma; unverified) | Newick `:length` plus BEAST comments | 0.03762 | 60.33 | 2.381 | 25.33 | 0 | 0 | 0 |
| birdtree-100-posterior | dated, ultrametric (100 trees; stats are for tree 0) | million years | Newick `:length` | 0.0001282 | 73.22 | 4.27 | 17.15 | 0 | 0 | 0 |
| butterflies-europe-496 | dated, ultrametric | million years (Ma; unverified) | Newick `:length` | 0.04334 | 87.88 | 2.725 | 32.26 | 0 | 0 | 0 |
| mammals-4071 | dated, ultrametric up to rounding | million years (Ma) | Newick `:length` | 0.022 | 135.8 | 2.883 | 47.1 | 0 | 0 | 0 |
| nlr-plants-3816 | substitutions per site (ML gene tree), not ultrametric | substitutions/site | Newick `:length`; support in `[a/b]` comments | 0 | 10 | 0.07311 | 136.8 | 10 | 0 | 0 |
| otol-carnivora | none (topology only) | - | absent | - | - | - | - | - | - | 1251 |
| otol-primates | none (topology only) | - | absent | - | - | - | - | - | - | 1332 |
| otol-mammalia | none (topology only) | - | absent | - | - | - | - | - | - | 14681 |
| otol-aves | none (topology only) | - | absent | - | - | - | - | - | - | 32054 |

## GBIF match rates (sample of up to 200 tips, species/match API)

| id | sampled | matched (EXACT/FUZZY) | EXACT species rank | median occurrences |
|---|---|---|---|---|
| ens-ncrna-399 | 101 | 0.97 | 0.861 | 3538.5 |
| fish-rabosky-1057 | 200 | 1.0 | 0.995 | 138.0 |
| corvoid-mcc-680 | 200 | 1.0 | 0.975 | 4002.0 |
| birdtree-100-posterior | 200 | 1.0 | 1.0 | 1129250.5 |
| butterflies-europe-496 | 200 | 0.98 | 0.965 | 7667.5 |
| mammals-4071 | 200 | 0.945 | 0.855 | 368 |
| otol-carnivora | 200 | 0.75 | 0.575 | 160.5 |
| otol-aves | 200 | 0.765 | 0.575 | 488 |

## Licence summary and caveats

- CC0 (Dryad mirrors on Zenodo, Open Tree of Life): free to redistribute; cite anyway.
- CC-BY 4.0 (mammals-4071, butterflies-europe-496, nlr-plants-3816, PhyloGenes): redistribution allowed with attribution; the citation in each NOTES.md is the attribution.
- Ensembl (ens-*): terms are "available without restriction" per the Ensembl disclaimer, but that page was not fetchable from the sandbox (HTTP 403); wording taken from a search summary. Treat as unverified until someone opens the page. Third-party assemblies inside Compara may have own terms.
- Open Tree of Life: CC0 per the project, but the Zenodo record for synthesis release 12.3 shows CC-BY 1.0 (conflict noted).
- NOT copied (licence unclear or copyleft): Nextstrain/Auspice dataset JSONs (data.nextstrain.org gives no explicit dataset licence; only screenshots are CC-BY 4.0 and the docs say redistribution of some data is restricted), forester/Archaeopteryx test data (GPL/LGPL repository).

## Other folders

- `edge-cases/`: HAND-MADE small test files (README there). Not real data.
- `scripts/`: `treecheck.py` (parse + statistics), `ensembl_emf_extract.py`, `ensembl_phyloxml_extract.py`, `zip_range_extract.py`, `gbif_match.py`, `make_caterpillar.py`, `build_catalogue.py` (rebuilds this folder from raw downloads). Run with `python3 -I`.
