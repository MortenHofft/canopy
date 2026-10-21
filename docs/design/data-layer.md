# Data layer: parsing tree files and matching tips to GBIF

Part B of the "build it ourselves" assessment; every viewer option (library or custom) needs this layer. Companion: [custom-renderer.md](custom-renderer.md). Criteria refer to [goal.md](../goal.md) (4 formats, 5 programmatic API, 7 licence, 15 scale).

Evidence conventions: **verified** = read in source or fetched/called during this research (path or URL given); **measured** = run by us; **UNVERIFIED** = general knowledge or not confirmed. Third-party repos were cloned read-only into the scratchpad; **no third-party code was executed**, so no third-party speed numbers exist here, only our own prototype's.

## 1. Summary and recommendation

- No existing JS package covers Newick + Nexus (TRANSLATE, multi-tree, `[&...]` annotations) + phyloXML + NeXML robustly *and* is licence-clean *and* scales to 1M tips with a flat memory layout. Each fails at least one test (table in section 2).
- **Recommended: write our own small parser module** (about 600 to 900 lines of TypeScript for Newick + Nexus, plus separate phyloXML and NeXML readers), emitting the struct-of-arrays `TreeData` of custom-renderer.md section 2.3. Base the Newick tokenizer on the stack-based, non-recursive approach used by Heng Li's MIT-licensed jstreeview `kn_parse` (the origin of Taxonium's and PhyloJS's parsers), but fix its known gaps (quoted labels, comments, annotations). Our prototype of that approach parsed a 1M-tip Newick (40.6 MB) in 1.5 s and a 200k-deep caterpillar without recursion (measured).
- If time-boxing is needed for an early spike: use **`@jasondavies/newick` (MIT)** only for small trees (recursive, no annotations), or `phylojs` **only after legal confirms its licence** (section 2.2). Archaeopteryx's `forester.js` (LGPL-3.0-or-later) has the most complete Nexus/BEAST reader found, and is a good **reference and test oracle**, not code to copy into an Apache-2.0 code base.
- Tip matching: GBIF has **no batch name-match endpoint documented**; plan for one request per distinct name against `/v2/species/match` (verified working), or, better, match tips against the **dataset's own names** by faceting occurrence search on the dataset. Details in section 5.

## 2. Existing parsers

### 2.1 Comparison

| Package | Version / activity (npm registry, repo) | Licence | Formats | Structure | Verdict |
|---------|------------------------------------------|---------|---------|-----------|---------|
| **phylotree.js** (`veg/phylotree.js`) | 2.6.0, published 2026-03-14; last commit 2026-04-15; about 14k downloads/month (npm API) | MIT in `LICENSE`; **`package.json` has no `license` field** (SBOM tools may report "none") | Newick, Nexus (TREES only), phyloXML, NeXML, BEAST via `[...]` delimiters | Object tree via d3.hierarchy | Not suitable as the parser (details below). Dependencies include jquery, lodash, moment, underscore (`package.json`). |
| **PhyloJS** (`clockor2/phylojs`) | 1.12.0, 2025-05-18; about 391 downloads/month | **Conflict**: `package.json` says MIT, but `LICENSE` is GNU GPL v3 and README says it "is derived from Tim Vaughan's IcyTree and is similarly licensed under version 3 of the GNU General Public License". Treat as **GPL-3.0** until the authors clarify. | Newick, Nexus, phyloXML, NeXML, own JSON | Class `Node` per node | Do not depend on it. Useful for study. |
| **@jasondavies/newick** | 1.0.0, 2026-09-23 | MIT | Newick only | Plain objects `{name, length, branchset}` | OK for small trees. **Recursive** (see 2.3). Drops all `[...]` comments (no annotations). |
| **newick** (npm; `octav47/newick.js`) | 3.0.1, 2025-05-21; about 229 downloads/month | MIT | Newick only | OOP wrapper | Source not read; UNVERIFIED quality. README only. |
| **biojs-io-newick** | 1.5.0, **2015-02-21** | Apache-2.0 | Newick | JSON | Dormant. |
| **forester.js / Archaeopteryx** | 3.24.0, 2026-10-07; about 4.7k downloads/month | **LGPL-3.0-or-later** | Newick, NHX, Nexus, phyloXML, Auspice JSON; BEAST/FigTree annotations | Own node model | Strongest parser coverage (reads `[&R]`/`[&U]`, TRANSLATE, FigTree colours; `forester.parseNexus`, line 5901). Not copyable into Apache-2.0; linkable. Pulls in the whole 500 KB `forester.js` and d3. |
| **jsPhyloSVG** | not checked | not checked | Newick, phyloXML (per comparison.md) | | UNVERIFIED, likely dormant. |
| **Taxonium utils** (`jstree.js`, `nexusToNewick.ts`) | in a GPL-3.0 repo | `jstree.js` is a derivative of Heng Li's jstreeview, MIT (header in the file); the rest GPL-3.0 | Newick; Nexus via a regex converter | | Reuse the **MIT original** (`lh3/jstreeview`), not Taxonium's copy. |

### 2.2 What the source shows (verified)

**phylotree.js** (`src/formats/newick.js`, `nexus.js`, `phyloxml.js`, `nexml.js`):
- Newick parser is an explicit state machine with a `clade_stack` (iterative, no recursion): good for deep trees.
- Unquoted whitespace is *skipped* inside names (`if (space.test(current_char)) continue;`), so `Homo sapiens` unquoted loses its space; underscores are **not** converted to spaces.
- For every internal node, `finishNodeDefinition` copies the label into `bootstrap_values`, so node names and support values are conflated (no heuristic).
- Branch length is kept as a string in `attribute`; comments in `{...}` (or `[...]` with options) go to `annotation` as raw text; NHX is parsed only when the delimiter is `[`.
- Nexus: finds `BEGIN TREES;`, cuts at the first `END;`, keeps lines starting with `TREE`, and parses **only the first**; no TRANSLATE handling; no TAXA block; a missing TREES block returns `''`.
- phyloXML: converts via DOM to JSON, takes the first `<phylogeny>` only, sets a default branch length of `"0.01"` when missing, takes `taxonomy.scientific_name` as name; recursion on `clade`.
- NeXML: `roots > 0` compares an array with a number (always false), so the declared root is ignored and the first node is used; edges only; first tree only.
- `getNewick` (export) is recursive.

**PhyloJS** (`src/io/readers/newick.ts`, `nexus.ts`):
- Newick reader is jstreeview's stack algorithm (iterative, header comment cites `lh3/jstreeview/knhx.js`) with annotation hooks for BEAST `[&...]` and NHX, and `#` hybrid labels.
- `kn_add_node` scans for the end of a label at the first `,` or `)`, so **a comma or parenthesis inside a quoted label breaks parsing**, and a quoted `''` escape is not handled (quotes are stripped only at label ends).
- Multi-tree Newick is split on `;\s*\n`; a single string with a newline keeps only the first line and warns.
- Nexus reader is **line-based** (`lines = nexus.split('\n')`): TRANSLATE is found by scanning lines for one that starts with `translate`, then splitting on commas and whitespace; quotes stripped by regex; tree lines matched with `/tree (\w|\.)+ *(\[&[^\]]*] *)* *= .../` (tree names with dashes or other punctuation will not match); case-insensitive; nodes are translated by label lookup (so internal labels equal to a numeric key would be mistranslated).
- Memory: one `Node` class instance per node, plus `children` arrays and `parent` pointers.

**@jasondavies/newick** (`src/newick.js`, 1.0.0): hand-written recursive-descent parser. `parseSubtree()` calls itself for each nesting level (verified), so depth is bounded by the JS call stack (typical V8 limits are in the order of 10k frames, UNVERIFIED; not run). Good quoting (`''` escape, error on newline in a quoted label), nested `[...]` comments skipped, underscores in unquoted labels converted to spaces, strict branch-length validation, serializer quotes labels containing underscore/space/punctuation.

**Taxonium** `nexusToNewick.ts`: regex-based; reads only the first tree; TRANSLATE entries accepted only when a line splits into exactly two space-separated parts (a translated name with a space is silently dropped); output is regex-substituted over the whole Newick string.

### 2.3 Recursion and memory on deep trees

| Parser | Recursion on caterpillar (depth equals tips) | Memory model |
|--------|---------------------------------------------|--------------|
| jstreeview / PhyloJS / phylotree.js Newick | iterative (stack) | JS objects per node |
| @jasondavies/newick | **recursive** | JS objects |
| d3.hierarchy (used by phylotree.js) | iterative (explicit stacks, `src/hierarchy/index.js`, `eachAfter.js`) | one `Node` object per node |
| phylotree.js `getNewick`, phyloXML `parsePhyloxml` | recursive | |
| Our prototype (`TreeData` arrays) | iterative | about 52 B per node typed arrays (see custom-renderer.md 2.3) |

Own measurements (Node 22, one thread, synthetic trees; see custom-renderer.md 2.2): 1M tips / 2M nodes: parse 1,520 ms; 100k tips: 148 ms; 200k-tip caterpillar: 101 ms. No published third-party 1M-tip parse benchmark was found (PhyloJS paper claims parsing "up to 10^6 tips"; the claim is second-hand in comparison.md and the paper was not read). For 1M tips expect 2M JS objects with the object-per-node parsers, which will cost hundreds of MB and noticeable GC (not measured).

### 2.4 Recommendation for the parser

Own module `@gbif/phylo-core/parse`:
1. **Newick**: single pass over the string, explicit stack, handling of: quoted labels with `''`, unquoted underscores, `[...]` comments (nested) captured *as annotation text* attached to the preceding node, branch length with exponent/sign, optional root branch length, missing lengths, missing labels, whitespace anywhere allowed, multiple trees separated by `;`.
2. **Annotations**: keep raw comment text per node in a side table (offset ranges into the source); parse lazily by dialect: NHX (`&&NHX:K=V:K=V`), BEAST/MrBayes/FigTree (`&key=value,key={a,b}`), see edge-case table.
3. **Nexus**: a proper tokenizer (words, quoted words, punctuation, `[...]` comments, `;` terminators), not line-based. Blocks: `TAXA` (TAXLABELS), `TREES` (TRANSLATE, TREE / UTREE with names, `*`, rooted flags), ignore unknown blocks (DATA/CHARACTERS may hold an alignment, which goal.md says some datasets will ship; keep that as a later extension).
4. **phyloXML / NeXML**: streaming or DOM reader into the same arrays; for large files prefer a SAX-style reader (`DOMParser` on a multi-hundred-MB document is memory heavy, UNVERIFIED). `fast-xml-parser` (MIT, a phylotree.js dependency) is a candidate dependency, UNVERIFIED for speed.
5. **Tests**: use Archaeopteryx's demo files and its parser behaviour (LGPL, read-only oracle, do not copy), ape/DendroPy/ETE-style fixtures regenerated by us, plus the edge-case table below. Run property tests: `parse(write(tree)) == tree`.
6. **Writers**: iterative Newick writer (quote when needed), Nexus writer optional.

Effort: Newick + Nexus parser and tests 3 weeks; phyloXML 1; NeXML 1; annotation dialects 1 to 1.5; writers 0.5; hardening against real publisher files 1 to 2. Total about **7 to 8 engineer-weeks**, tip matching service additional (section 5.5).

## 3. Edge cases that real files have

The "Source" column says where the rule or behaviour comes from. Rows marked UNVERIFIED are widely known practice but we did not confirm them in a primary source in this research.

| # | Edge case | Behaviour to implement | Source / status |
|---|-----------|------------------------|-----------------|
| 1 | Underscore in **unquoted** label | Convert to space (Newick and NEXUS). Inside quotes keep underscores literally. Keep the *raw* label too, because publishers key on it. | Newick spec: an underscore "stands for a blank" (https://phylipweb.github.io/phylip/newicktree.html, fetched); Wikipedia: "Underscore characters in unquoted strings are converted to blanks" (https://en.wikipedia.org/wiki/Newick_format, fetched) |
| 2 | Labels containing spaces, `:`, `;`, `,`, `()`, `[]` | Must be single-quoted; `'` inside is doubled `''`. | Wikipedia Newick: "Single quotes in the original string are represented as two consecutive single quote characters" (fetched); the PHYLIP page does not cover quoting (fetched) |
| 3 | Double-quoted labels | Some tools emit them; accept as a lenient extension. | phylotree.js and PhyloJS strip `"`/`'` (source); standard status UNVERIFIED |
| 4 | Comments `[...]` | Skip, but keep text when it starts with `&` (computer-generated data). Allow nesting. | Wikipedia: "Comments are enclosed in square brackets"; those starting `&` usually hold computer-generated data (fetched); nested comments handled by `@jasondavies/newick` (source) |
| 5 | NHX | `[&&NHX:S=Homo:D=N:B=95]` key/value after colons. | Named in Wikipedia Newick; spec page not fetchable (Google Sites login redirect). phylotree.js parses it only when the delimiter is `[` (source). |
| 6 | BEAST / MrBayes / FigTree annotations | `[&height=1.2,height_95%_HPD={0.9,1.5},posterior=1,!color=#ff0000]` after label, may appear before and after `:length`; values may be brace lists containing commas. | Archaeopteryx handles BEAST numbers/intervals and `!color` (`forester.js` lines 4895 to 4926, read). phylotree.js `beast.js` splits on `=`, `,`, `{`, `}` (read). Exact grammar UNVERIFIED (no spec fetched). |
| 7 | Rooted flags `[&R]` / `[&U]` | Before the tree (after `=` in NEXUS, or at start of a Newick string). `&R` rooted, `&U` unrooted, absent = unspecified. | Wikipedia Newick (Rich Newick prefix `[&U]`, `[&R]`); commonnexus docs: "The NEXUS standard does not specify whether rooted or unrooted is default" (https://commonnexus.readthedocs.io/en/latest/_modules/commonnexus/blocks/trees.html, fetched) |
| 8 | Missing branch lengths | Allowed; whole tree may have none (cladogram only). Do not invent zero; flag `hasBranchLengths = false`. Mixed presence: treat missing as 0 or as a default and warn. | Wikipedia: length is "empty or ':' followed by a number" (fetched) |
| 9 | Branch length syntax | Signed, decimal, exponent (`1e-5`), possibly `-0.0001` (negative lengths do occur from NJ, UNVERIFIED). Never `NaN` in layout: clamp or flag. | `@jasondavies/newick` validates signed decimals with exponent (source) |
| 10 | Root branch length | `(...)A:0.1;` allowed; ignore for layout or draw as a stem. | PHYLIP example shows a length after the outer parenthesis (fetched, not stated as a rule) |
| 11 | Internal node labels: **name vs support** | Ambiguous. Heuristic: numeric (or `a/b` of numbers, e.g. `87.5/99`, UNVERIFIED) => support value; otherwise => clade name. Offer an explicit option; keep raw. Never translate internal labels through TRANSLATE. | ape: "node labels will be support values rather than proper taxa names" and only tip labels are translated (https://rdrr.io/cran/ape/man/read.nexus.html, fetched). Archaeopteryx has `confidenceValuesAsInternalNames` and `confidenceValuesInBrackets` options (`parseNexus` signature, read). Wikipedia: grammar allows names, bootstrap in extended Newick fields (fetched). |
| 12 | Polytomies | Any number of children >= 2; layout and collapse must not assume binary. | Wikipedia examples `(,,(,));` (fetched) |
| 13 | Unary nodes / single-child internal nodes | Occur in exported trees; keep or contract by option; do not crash the layout. | UNVERIFIED |
| 14 | Unnamed leaves | `(,:1);` valid; show as unlabeled and unmatched. | `@jasondavies/newick` README (read) |
| 15 | Duplicate tip labels | Allowed in files; the tip-key map must handle many-to-one explicitly (list of node ids). | UNVERIFIED |
| 16 | Multi-tree files (Newick one per line, or Nexus `TREE` list; MCMC posterior samples can be thousands) | Parse a *list*; default to first (or the one marked `*`); let publisher or UI choose; guard against loading 10,000 trees. | ape reads "one or several trees"; names from NEXUS (fetched); phylotree.js takes the first only; PhyloJS has `readTreesFromNexus` (source) |
| 17 | NEXUS tree line | `TREE name = [&R] (...);` also `UTREE`; default-tree asterisk `TREE * name`; tree names may contain dots, dashes, quotes; comment may sit between name and `=`. | commonnexus `Tree`: optional `[*]`, name = first word or quoted word, rooted comment before the parenthesis (fetched); PhyloJS name regex too strict (source) |
| 18 | TRANSLATE | `TRANSLATE 1 Alpha, 2 'Beta gamma', ...;` must precede TREE; keys are usually integers but can be any token; values can be quoted; applies to tip labels only; the trailing pair has no comma. | commonnexus: "A TRANSLATE command, if present, must precede any TREE command" (fetched); ape: translation applies to tip labels (fetched). Taxonium's regex drops values with spaces (source). |
| 19 | TAXA block | `TAXLABELS` list; trees may refer to taxa by index number instead of name when no TRANSLATE exists. | commonnexus: "combines numeric TAXA indices with the TRANSLATE mapping; TRANSLATE overrides" (fetched); Wikipedia example `TaxLabels` (fetched) |
| 20 | NEXUS comments and case | Keywords case-insensitive; blocks `BEGIN x; ... END;` (also `ENDBLOCK;`, UNVERIFIED); comments in `[...]` anywhere. | Wikipedia Nexus: "keywords are case-insensitive" (fetched) |
| 21 | Tree string spanning many lines; huge single line (tens of MB) | Do not assume one tree per line. Tokenise on `;`. For 40 MB strings avoid `split`/regex copies. | PhyloJS keeps only first line of multi-line Newick (source); our measurements (40.6 MB single string) |
| 22 | Encoding/line endings | UTF-8 BOM, CRLF, tabs, trailing whitespace, gzip (`.gz`); non-ASCII species names. | UNVERIFIED general practice; Taxonium handles `.gz` with pako (source) |
| 23 | Missing final `;` or text after `;` | Be lenient on missing `;` (warn); error on junk. | `@jasondavies/newick` requires `;` (source); strictness is our choice |
| 24 | Labels with accession/IDs | `Genus_species_ABC123`, `OTU_17`, `BOLD:AAE1234`, `GCA_000001405.15`, `Genus_species|strain|id`. Need a configurable label parser (section 4). | UNVERIFIED general practice |
| 25 | Hybrid/network nodes `#H1` | Extended Newick; unsupported => warn and treat as tree. | PhyloJS parses `#` labels (source) |
| 26 | phyloXML | `<phylogeny rooted="true">`, nested `<clade>` with `<name>`, `<branch_length>` (element or attribute), `<confidence type="bootstrap">`, `<taxonomy><scientific_name>/<id>`, `<sequence>`, `<property>`; several `<phylogeny>` per file. | Element names as used by phylotree.js and PhyloJS readers (source). The official XSD page was not retrievable here, so the full schema is UNVERIFIED. |
| 27 | NeXML | `<otus>` + `<trees><tree><node otu=...><edge source target length>`; `root="true"` on nodes; networks possible; tips refer to OTU labels, not labels on the node. | phylotree.js reader (source, with its root bug). NeXML spec page returned HTTP 503; UNVERIFIED beyond that. |

## 4. Tip-label handling and matching

### 4.1 What the join needs (goal.md story 3 and 4)

The tree's tip label is the join key to GBIF occurrences or taxa. Keep four things per tip: `raw` (exactly as in the file), `display` (underscores converted, quotes removed), `key` (normalised for comparison), and the result of matching (`status`, `target`, `confidence`). Unmatched tips must stay visible with status `unmatched` (CLAUDE.md requirement).

Open question carried over from goal.md: do labels hold `occurrenceID`, `catalogNumber`, `scientificName`, or a mapping column? The matching strategy differs, so support a publisher-declared `labelType`: `occurrenceID` | `catalogNumber` | `scientificName` | `taxonID` | `mapping` (a CSV sidecar `label -> id`). A mapping column is the most robust (publisher says what each tip is) and avoids fuzzy matching altogether.

### 4.2 Normalisation ladder

1. **Exact** raw label equal to a key in the dataset's own table (occurrenceID, catalogNumber, taxonID, scientificName).
2. **Normalised**: underscore to space; trim; collapse spaces; strip quotes; case-insensitive; remove a configured accession suffix/prefix pattern (e.g. `_ABC123`, `|strain`); strip `sp.`/`cf.`/`aff.`; Unicode normalisation (NFC) and ASCII folding for diacritics.
3. **Taxon match through GBIF**: send the normalised binomial to species match; accept `EXACT` or `VARIANT`/`FUZZY` above a confidence threshold; show the matched name and let the UI mark "fuzzy".
4. **Higher rank** (`HIGHERRANK`) such as genus-only: link to the genus page but mark "not matched to species".
5. **Unmatched**: no link, shown with a distinct marker and listed in the table view.

### 4.3 GBIF APIs checked (our calls on 2026-10-08 unless noted)

| API | What we verified | Notes |
|-----|------------------|-------|
| `GET https://api.gbif.org/v2/species/match?scientificName=...` | Returns `usage` (key, name, rank, status), `classification` array, `diagnostics.matchType` and `.confidence`, plus `additionalStatus` (IUCN). Examples: `Puma concolor` EXACT 99; `Pumma concolour` **VARIANT 80** resolved to *Puma concolor*; `Puma_concolor` (underscore) **EXACT 99**, so the server tolerates underscores; `Puma sp.` **HIGHERRANK 94** returning genus *Puma*; `Homo sapiens_BOLD:AAA1234` **NONE**. Unknown query parameters are ignored (HTTP 200). CORS: `access-control-allow-origin: *` returned. | The v2 parameter is `scientificName`, not `name` (https://discourse.gbif.org/t/v1-match-versus-v2-match/6030, fetched; same thread says v1 "might disappear"). v2 also accepts `taxonID`, `scientificNameID`, `taxonConceptID` (identifier used first if both given) and `checklistKey`; response "includes additional information such as the IUCN RedList category" (https://techdocs.gbif.org/en/data-processing/taxonomy-interpretation, fetched). |
| `GET https://api.gbif.org/v1/species/match?name=...` | Returns `usageKey`, `matchType`, `confidence`, higher ranks. `strict=true` returned `matchType NONE` for the misspelling. | Documented in the GBIF data blog as using "fuzzy matching on canonical names to generate candidate matches" with `verbose=true` giving scores and alternatives (https://data-blog.gbif.org/post/gbif-species-api/, fetched). |
| Batch name matching | **None found.** The techdocs Species page text did not list it; a web search found only third-party wrappers that loop (UNVERIFIED conclusion: absence of evidence). The data blog says there is no bulk species export (fetched). | Plan one request per distinct name, with a concurrency limit and local cache. |
| `GET /v1/occurrence/search` | Parameters `occurrenceID`, `catalogNumber`, `datasetKey`, `taxonKey`, `scientificName`, `verbatimScientificName` all accepted (counts returned). **Repeated parameters work as OR**: `catalogNumber=1&catalogNumber=2&limit=0` returned `count 207922`. `limit` above 300 is silently capped to 300 (`limit=301` returned `"limit":300`). `facet=...&facetLimit=100000` returned 100,000 entries (3.1 MB) in one call. | An `occurrenceID=` lookup for a non-existent id returned `count 0` (cheap existence test). |
| Facet by dataset | `occurrence/search?datasetKey=D&facet=speciesKey&facetLimit=...&limit=0` returns every species key in a dataset with counts in one request (paged with `facetOffset`, UNVERIFIED offset parameter). | **Best batch route**: instead of N lookups, fetch the dataset's whole name list with counts and match tips to it locally. Also gives the "occurrence count" column for free. |
| Species page link / counts | `occurrence/count?taxonKey=2435099` returned a number; `taxonKey` and facet queries return counts. | For per-tip counts at scale use the dataset facet above, not per-tip queries. |

### 4.4 Rate limits and constraints

- The GBIF techdocs API overview (https://techdocs.gbif.org/en/openapi/, fetched): "Rapid or numerous queries to search APIs may be rate limited"; "The maximum rate changes depending on our server load; we do not guarantee any particular query rate will work"; if a script "will take more than 15 minutes using the occurrence search APIs it will be usually be faster" to request a download; "we highly recommend you set the HTTP `User-Agent` to a URL or email address" (a browser cannot set `User-Agent`; use a server-side cache/proxy for bulk work); endpoints not documented or marked experimental "may be changed or removed without warning".
- Responses from `api.gbif.org` carried `cache-control: public, max-age=600` (our header check on occurrence search), so the browser/CDN may cache repeated identical calls for 10 minutes.
- Some of our calls from the sandbox were reset by the proxy (`Recv failure: Connection reset`). We did not establish whether that was GBIF throttling or the sandbox proxy; do not treat it as a measured limit.
- Occurrence downloads (asynchronous, authenticated) are the documented bulk route; their predicate options were not examined (UNVERIFIED).

### 4.5 Design for the matching service

Two modes:
1. **Precomputed (preferred for published trees):** the preprocessing pipeline (custom-renderer.md 15.7) resolves tips once at ingestion, stores `tipKey -> {status, taxonKey, occurrenceKey(s), count}` in a sidecar (`tips.json.gz`, or a columnar chunk), and the viewer just reads it. Cache invalidation: when the tree or the dataset's occurrences change.
2. **On demand (small trees or dev):** the browser matches visible tips lazily (only rows in view, plus a cache) against `/v2/species/match` and `occurrence/search?occurrenceID=` with concurrency <= 4 and exponential backoff on HTTP 429/5xx; for occurrence pages, only the *one* highlighted tip needs resolving up front.

Deliverables: `matchTips(tree, {labelType, dataset, normaliser}) -> TipMatchTable` (headless, Worker-safe); `useTipMatches()` hook; a "match report" (counts by status, list of unmatched). Effort about **2 to 3 engineer-weeks** (2 if precomputed only), assuming the dataset-facet strategy works for the relevant datasets (checklists that are not occurrence datasets may need the checklist's own name usage API instead; not examined, UNVERIFIED).

## 5. Open questions affecting the data layer

1. Where are tree files stored, and are they CORS-accessible (goal.md)? Determines fetch strategy and Range support.
2. What do tip labels contain in real GBIF-bound trees? Collect 10 to 20 real publisher files before fixing the normalisation ladder.
3. Real tree sizes and shapes (ladderised? multi-tree Nexus?).
4. Licence ruling on PhyloJS if anyone proposes it (GPL text vs MIT metadata).
5. Whether GBIF wants Newick canonicalisation of everything at ingestion (recommended) so that only one parser path runs in production browsers.

## 6. Not verified

- Third-party parse speed on any large tree (no code executed; no published benchmarks found).
- Call-stack depth at which `@jasondavies/newick` fails.
- Source of `newick` (octav47) beyond its README; jsPhyloSVG status.
- Official NHX, phyloXML XSD and NeXML schema text (the pages were not retrievable); BEAST annotation grammar.
- Whether GBIF documents a batch match endpoint outside the pages we could read; v2 match stability (no status statement found).
- Real-world frequency of the edge cases above in publisher files (no sample of real GBIF files available here).
