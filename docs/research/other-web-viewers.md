# Other web viewers: Phylo.io, IcyTree, PhyD3, jsPhyloSVG, Auspice, Microreact

Researched 2026-10-08. Shorter checks than [archaeopteryx-js.md](archaeopteryx-js.md). Evidence was read from shallow clones (`git clone --depth 30`, nothing run), npm registry JSON and GitHub pages. Criteria numbers refer to [goal.md](../goal.md). "UNVERIFIED" means not confirmed from a primary source. "Clone" means the clone at `/tmp/claude-0/-home-user-gbif-phylo/755848e2-b52c-5a39-af58-27e7ed8b2655/scratchpad/o/<name>`; shallow clones only show recent history, so first-commit dates are not reported.

## Overview

| Viewer | Licence (verified) | Library? | Last activity | Verdict |
|---|---|---|---|---|
| Phylo.io | MIT in LICENSE.txt; `package.json` says ISC (inconsistent) | Yes, npm `phyloio` + CDN bundle; imperative, app-like UI | v2.2.5, 2026-01-30 | Maintained; SVG; no node-event API; not suited to large trees. Weak candidate |
| IcyTree | GPL-3.0 | No (web app; URL param `?url=`) | 2026-06-01 | Ruled out: GPL, no library mode. UX reference only |
| PhyD3 | MIT (classic app and alpha library) | Alpha TS library, returns an SVG | repo 2024-08-16; npm 2.0.0-alpha.0 from 2022-08-29 | Effectively dormant; tiny. Reference only |
| jsPhyloSVG | GPL (original readme) | Yes (2010 script + Raphael) | 2016-05-24 | Dormant and GPL. Ruled out |
| Auspice | AGPL-3.0-only | Whole app; React-Redux-coupled | 2026-10-07 | Ruled out on licence (AGPL) and coupling. Ideas only |
| Microreact | UNVERIFIED | UNVERIFIED | UNVERIFIED | Could not reach the source repo. Not assessed beyond its use of Phylocanvas |

Lead for the wider team (not one of my candidates, verified from the registry): `@phylocanvas/phylocanvas.gl` is **MIT**, latest 1.64.1 published 2026-07-13, maintained by `cgps-admin`, homepage phylocanvas.gl, repo `gitlab.com/cgps/phylocanvas/phylocanvas.gl`, peer dependency `deck.gl ^8.8.12` (https://registry.npmjs.org/@phylocanvas%2Fphylocanvas.gl). The older `@cgps/phylocanvas` 3.18.0 is LGPL-3.0-only (last publish 2020-03-06). comparison.md lists Phylocanvas.gl licence as unverified; this is the registry answer, not yet read in source.

---

## 1. Phylo.io

### Summary
1. Maintained SVG/d3 viewer from the Dessimoz Lab, built for comparing two trees side by side, with an embeddable `PhyloIO` JavaScript API and a CDN bundle.
2. Latest release 2.2.5 on 2026-01-30; releases in 2025-05, 2025-06, 2025-07, 2026-01 (x3). Active but low volume.
3. The embed API configures and loads trees; the only callbacks documented are two redirect hooks for the phylostratigraphy view. No node click/hover/select callback, no highlight/focus API.
4. It ships the whole Bootstrap 5.1.2 + Font Awesome UI (dist `phylo.js` is 3,995,095 bytes unminified-or-bundled plus two 1.4-2.9 MB worker bundles), d3 6.6.0 pinned. Heavy.
5. Verdict: not a fit for criteria 5, 11, 12, 13, 14 and 3. It is MIT licensed, which is the one thing going for it.

### Facts

| Fact | Value | Source | Verified? |
|---|---|---|---|
| Repo | https://github.com/DessimozLab/phylo-io (the `github.com/phylo-io/phylo-io` guess is 404) | git clone succeeded; README | Yes |
| npm | `phyloio` 2.2.5 (2026-01-30); earlier 2.1.0 (2025-05-06), 2.1.1 (2025-06-30), 2.2.2 (2025-07-02), 2.2.3 (2026-01-21), 2.2.4 (2026-01-27) | https://registry.npmjs.org/phyloio | Yes |
| Last commit | 2026-01-30 "2.2.5" (Adrian Altenhoff); other recent authors "F4llis" (17 commits in the clone window), Altenhoff (13) | clone `git log` | Yes |
| Licence | LICENSE.txt: "The MIT License (MIT) Copyright (c) 2022 Clement Train & the Dessimoz Lab". `package.json` `license` says `ISC` | clone LICENSE.txt, package.json | Yes. The mismatch should be raised with the maintainers before adoption |
| Dependencies | d3 `6.6.0` (exact), d3-v6-tip, bootstrap `5.1.2`, @popperjs/core, Font Awesome 5, biojs-io-newick, minhashjs, file-saver, sax | package.json | Yes |
| Rendering | SVG with d3 (`viewer.js` 2,735 lines; `<svg>` creation in `viewer.js`, `interface.js`, `utils.js`). No canvas in viewer.js | clone grep | Yes |
| Formats | Newick, extended Newick, phyloXML; JSON for the "Phylo Stack" view; CSV/TSV mapping files | README "Loading a Phylogenetic Tree" | Yes. Nexus: not mentioned, UNVERIFIED |
| Embedding | `PhyloIO.init()`, `phylo.create_container(div_id)`, `container.add_tree(newick, settings)`, `phylo.start()`; compare mode needs two containers | README "Initialisation" | Yes |
| Settings | per-tree: `display_leaves`, `use_branch_lenght`, `show_tooltips`, `subsample_label`, `align_tip`, `collapse_level`, `tree.{node_vertical_size, node_horizontal_size, node_radius, line_width, font_size}` | README | Yes |
| Callbacks | `callback_ancestral_genome_redirection(taxid)`, `callback_stack_redirection(taxid, parent_taxid)` in `API.settings`, both default to `console.log` | src/api.js:21-22 | Yes |
| Large trees | label subsampling, autocollapse depth slider, "Optimise view" (autocollapse + fit), "screen space scaling" removed by default for large trees. No numbers | README "Viewing Large Trees" | Yes (statement); no benchmark found |
| Export | SVG, PNG, PDF, session sharing via a beta.phylo.io server URL (`share_post`, `share_get`) | README, src/api.js:17-19 | Yes. Sharing needs their server; the viewer itself is client-side |
| Open issues / PRs | UNVERIFIED | the GitHub API is blocked in this session | Unknown |

### Criteria scorecard (brief)

| # | Rating | Note |
|---|---|---|
| 1 | Yes | Client-side; share links need their server but are optional |
| 2 | Partial | npm and CDN; imperative app-like API; Bootstrap UI inside |
| 3 | No (likely) | SVG; label subsampling and autocollapse; no numbers; UNVERIFIED at 100k |
| 4 | Partial | Newick, NHX, phyloXML yes; Nexus UNVERIFIED; no NeXML |
| 5 | No | no highlight/focus/metadata-by-id API found in README or `api.js` |
| 6 | Partial | rectangular only found; circular/unrooted UNVERIFIED |
| 7 | Yes | MIT (with ISC/MIT mismatch to clear up) |
| 8 | Partial | maintained in bursts, small team |
| 9 | Partial | Bootstrap theme; a11y and mobile UNVERIFIED |
| 10 | Yes | SVG, PNG, PDF |
| 11 | No | no node callbacks |
| 12 | No | no React component; the imperative container API could be wrapped |
| 13 | No | colouring via mapping files, internal-node data labels; no aligned columns except the specialised "Phylo Stack" histogram |
| 14 | Partial | autocollapse and label subsampling exist |
| 15 | Unknown | no figures |
| 16 | Partial | size/colour settings in JS and mapping-file-driven colour; no callbacks |

### Maintenance, licence, extension effort, risks
- Maintenance: see facts; two to three active committers; Lausanne lab-backed.
- Licence: MIT; verify with maintainers because `package.json` says ISC. Both are permissive. Dependencies Bootstrap (MIT), Font Awesome Free (icons CC BY 4.0, fonts OFL, code MIT; the ones shipped are v5 npm packages and a bundled 6.2.0 folder in `src/`), d3 6 (ISC).
- Extension effort (My judgement): adding callbacks is easy (small codebase, ~5.3k lines across `viewer.js`, `container.js`, `model.js`), but the architecture (SVG, UI bundled, jQuery-free but Bootstrap-coupled) would not meet scale or custom-columns goals. We would essentially be writing our own renderer.
- Risks: heavy bundle with workers, pinned d3 6.6.0, UI cannot be removed, compare-mode oriented, no events.
- Open questions: does `create_container` allow hiding the sidebar UI; is there any way to get node click events (DOM events on SVG nodes are possible but undocumented); behaviour at 10k and 100k tips.

---

## 2. IcyTree

### Summary
1. A single-page client-side web app by Tim Vaughan (the main committer), with good BEAST/Nexus annotation support and a manual.
2. Licence is GPL-3.0, which goal.md says needs deliberate sign-off and which effectively rules it out for embedding in gbif.org.
3. There is no library or embed mode: the manual's embedding story is a link to `https://icytree.org/?url=<tree-url>`.
4. Rendering is SVG (manual). Maintained: last commit 2026-06-01, 529 commits, 4 open issues, no releases.
5. Verdict: not usable as a dependency. Worth studying for UX (metadata attach, colour-by, tip search, collapse to focus on bulk structure) only.

### Facts

| Fact | Value | Source | Verified? |
|---|---|---|---|
| Repo | https://github.com/tgvaughan/icytree | clone | Yes |
| Licence | GPL-3.0: `COPYING` is "GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007"; README: "made available under the terms of the GNU General Public Licence version 3" | clone COPYING, README.md | Yes |
| Dependencies | jQuery, jQuery UI, PapaParse, plotly, FileSaver, all MIT per README | README.md | Yes |
| Library mode | None. No `package.json` at the repo root (listing: CNAME, COPYING, README.md, _config.yml, css, examples, images, index.html, jquery-ui, js, manual). Embedding documented only as links with `?url=` | clone `ls`; manual/manual.md:122-137 | Yes |
| Last commit | 2026-06-01 (Tim Vaughan, "Clarified manual section on re-rooting. Issue #59"); before that 2026-04-22 (merge PR #57 from Lars-B), 2026-04-21, 2026-02-04 (MrBayes annotations) | clone `git log` | Yes |
| Contributors in the clone window | Tim Vaughan 30, Lars-B 5, Chaoran Chen 1 | clone `git log` | Yes |
| Repo stats | 40 stars, 529 commits, 4 open issues, no releases | https://github.com/tgvaughan/icytree (WebFetch) | Yes |
| Rendering | SVG: "IcyTree uses Scalable Vector Graphics (SVG) to draw trees" | manual/manual.md:155 | Yes |
| Metadata | CSV attach (delimiters `, ; tab |`), colour-by attribute | manual/manual.md:144-150 | Yes |
| Scale | none stated; the manual suggests collapsing/focusing for large trees (manual.md:242-248) | manual | Yes (absence of numbers) |

### Criteria scorecard (brief)
1 Yes (static files). 2 No (app). 3 No/Unknown (SVG, no numbers). 4 Partial (Newick, Nexus with annotations; phyloXML/NeXML UNVERIFIED). 5 No. 6 Yes (UNVERIFIED which; the manual describes several layouts). 7 **No** (GPL-3.0). 8 Yes (active, one main maintainer, 4 open issues). 9 Partial (dark mode merged 2025-05-19). 10 Yes (SVG export per manual; others UNVERIFIED). 11-13 No. 14 Partial (collapse). 15 Unknown. 16 No (UI controls, not code hooks).

### Maintenance, licence, extension effort, risks
- Maintenance: good for an academic tool; no releases or tags, so no versioning.
- Licence: GPL-3.0 means our combined work would have to be GPL-compatible; Apache-2.0 plus GPLv3 code gives a GPLv3 combined distribution. Not acceptable without sign-off.
- Extension effort: would be a rewrite into a library under GPL; pointless.
- Open questions: none worth testing beyond UX inspection.

---

## 3. PhyD3

### Summary
1. PhyD3 is a d3-based phyloXML viewer from VIB Bioinformatics Core (Belgium), described in a 2018 BMC Bioinformatics paper.
2. The repo `vibbits/phyd3` now holds a 2.0 rewrite in TypeScript: `build(table)` returns a d3 SVG selection you insert yourself, with no parser included.
3. Licence is MIT (LICENSE: "Copyright (c) 2023 VIB Bioinformatics Core"). The npm package `@vibbioinfocore/phyd3` is `2.0.0-alpha.0`, published 2022-08-29 and never promoted. Last commit 2024-08-16 ("Address braces security alert").
4. Source is 218 lines of `src/index.ts`; options section of README is empty.
5. Verdict: dormant; not a candidate. Useful only as a reference for a minimal "build an SVG from a table" design.

### Facts

| Fact | Value | Source | Verified? |
|---|---|---|---|
| Repo | https://github.com/vibbits/phyd3 (`ibune/phyd3` and the like are 404) | clone | Yes |
| Licence | MIT; package.json `"license": "MIT"` | clone LICENSE, package.json | Yes |
| npm | `@vibbioinfocore/phyd3` 2.0.0-alpha.0, 2022-08-29; deps `d3-selection ^3`, `d3-zoom ^3` | https://registry.npmjs.org/@vibbioinfocore%2Fphyd3 | Yes |
| Last commits | 2024-08-16 (James Collier), 2023-07-19 (dependabot), 2023-01-19 | clone `git log` | Yes |
| API | `build(table)` -> d3 selection; parsing via `@vibbioinfocore/phyd3-parser-compat` or Phylio; README "Options" section blank | README.md | Yes |
| Classic PhyD3 (v1, 2018 app with PHP `fetch.php`) | still in `web/` (documentation.html, fetch.php) | clone `ls web` | Yes |
| Scale | none stated | README | Yes (absence) |

### Criteria scorecard (brief)
1 Yes. 2 Partial (npm alpha, no React). 3 No/Unknown (SVG; no numbers). 4 Partial (phyloXML via a separate parser; Newick UNVERIFIED). 5 No. 6 UNVERIFIED. 7 Yes (MIT). 8 No (dormant). 9 Unknown. 10 Unknown. 11-12 No. 13 Partial (the 2018 paper highlights annotation graphics such as domain/box-plot/pie annotations; UNVERIFIED in v2). 14-15 Unknown. 16 Unknown.

### Extension effort / risks
Not worth extending; risk is abandonment. Raw material at most.

---

## 4. jsPhyloSVG

### Summary
1. The 2010 library (BMC Bioinformatics, "jsPhyloSVG: A Javascript Library for Visualizing Interactive and Vector-Based Phylogenetic Trees on the Web", PMC2923619) using Raphaël for SVG/VML.
2. The GitHub fork `guyleonard/jsPhyloSVG` was last changed 2016-05-24 (merge of PR #5, "color").
3. Licence: the original readme says "This software is distributed under the GPL License." (README.md:71-73 of the fork).
4. Verdict: dormant and GPL: ruled out.

### Facts

| Fact | Value | Source | Verified? |
|---|---|---|---|
| Repo | https://github.com/guyleonard/jsPhyloSVG (fork carrying the original files `jsphylosvg.js`, `raphael-min.js`) | clone | Yes |
| Licence | GPL; the fork's README quotes "Original License: This software is distributed under the GPL License." Which GPL version: UNVERIFIED (a registry page suggests v2 or later) | clone README.md:68-73 | Yes for GPL; version UNVERIFIED |
| Last commit | 2016-05-24 | clone `git log` | Yes |
| Formats | Newick, phyloXML (per the paper; not re-read in code) | WebSearch results / PMC2923619 | Not verified in source |
| Scale | the paper says it slows beyond about 2,000 nodes (from comparison.md; I did not re-read the paper) | comparison.md | UNVERIFIED |
| Other repo | `uscbiostats/jsphylosvg`, an R htmlwidget wrapper with "Unknown, MIT licenses found" | WebSearch result | Not opened |

Criteria scorecard: 7 No (GPL), 8 No (dormant since 2016). Everything else not worth scoring; 3 No, 11-13 No.

---

## 5. Auspice / Nextstrain

### Summary
1. Auspice is the Nextstrain viewer: a React 16 + Redux application with an SVG tree (phyloTree, d3-selection), a map and frequency panels, driven by Auspice JSON datasets.
2. Licence is AGPL-3.0-only (package.json and LICENSE.txt). That is the one licence goal.md calls out as needing deliberate sign-off, and AGPL network-use terms are strictly harder than LGPL/GPL for a hosted site.
3. The tree component is not standalone: `src/components/tree/index.ts` wraps it with `connect(mapStateToProps)` from react-redux, and its props come from the app's Redux store. No library entry for the tree alone.
4. Very active: v3.0.0 on 2026-09-02, last commit 2026-10-07, 5,668 commits, 312 stars.
5. Verdict: ruled out for embedding; Archaeopteryx.js can import Auspice JSON, and Auspice's "tip label / colour-by / filter" UX is a useful reference.

### Facts

| Fact | Value | Source | Verified? |
|---|---|---|---|
| Repo | https://github.com/nextstrain/auspice | clone | Yes |
| Licence | `"license": "AGPL-3.0-only"`; LICENSE.txt "GNU AFFERO GENERAL PUBLIC LICENSE Version 3"; README: "made available under the terms of the GNU Affero General Public License (AGPL)" | clone package.json, LICENSE.txt; github.com page | Yes |
| Version / npm | 3.0.0, published 2026-09-02; `main: index.js`, `type: module` | clone package.json; https://registry.npmjs.org/auspice | Yes |
| Last commit | 2026-10-07 (merge of PR #2099) | clone `git log` | Yes |
| Stats | 312 stars, 5,668 commits | WebFetch of the repo page | Yes (point in time) |
| Stack | React `^16.8.6`, `d3-selection ^1.1.0`, `d3-zoom ^1.1.3`, Redux (react-redux `connect`) | registry deps; src/components/tree/index.ts:1-47 | Yes |
| Rendering | SVG: `svg: Selection<SVGGElement ...>` "the SVG element into which the tree is drawn", groups appended to it | src/components/tree/phyloTree/renderers.ts:15-36, phyloTree.ts:152-193 | Yes. No `getContext('2d')` found under `src/` in my grep, i.e. no canvas tree |
| Standalone tree? | Not as shipped. Connected via Redux; one would need to extract `phyloTree` (a d3 SVG module) from React/Redux and keep AGPL | src/components/tree/ | Yes (structure); extraction feasibility UNVERIFIED |
| Embedding story | Embeds of the whole app via iframe (changelog entries on URL query options for iframes); "Auspice as a library / CLI" refers to building custom Auspice bundles | docs/releases/changelog.md:632, 1144, 1671 | Yes |
| Large trees | changelog removed a "warning about large trees" when handing off to MicrobeTrace (v2.2) | docs/releases/changelog.md:78 | Yes. No numbers |
| Format | Auspice JSON v2 (read by Archaeopteryx.js too) | README / archaeopteryx-js.md | Yes |

### Criteria scorecard (brief)
1 Yes (static dataset JSON possible). 2 No (app). 3 Unknown (SVG; Nextstrain trees are thousands to tens of thousands of tips, UNVERIFIED). 4 No (own JSON; Newick via conversion). 5 Partial (URL state: filters, `?c=`, tree selection; no JS API found). 6 Yes (rectangular, radial, unrooted, clock, scatter: UNVERIFIED list). 7 **No** (AGPL-3.0). 8 Yes. 9 Partial (UNVERIFIED). 10 Yes (PNG/SVG). 11 No. 12 No (React 16, Redux). 13 Partial (colour-by, tip labels, no aligned columns). 14 Partial (zoom to clade, filter). 15 Unknown. 16 Partial (JSON colouring config).

### Risks and effort
AGPL: network-use clause requires source offer to users of a hosted modified version. Extracting `phyloTree` would produce an AGPL derivative. Not recommended.

---

## 6. Microreact

### Summary
1. Microreact is the CGPS (Centre for Genomic Pathogen Surveillance) web app for genomic epidemiology: tree, map, timeline, tables, charts.
2. Its tree panel is built on Phylocanvas (the app page for Phylocanvas states it is "utilised within Microreact"); Phylocanvas.gl is the WebGL successor, now **MIT** on npm (see Overview).
3. I could not reach the Microreact source repository from this session (github.com/microreact/microreact and a gitlab URL returned 404/403; raw GitHub and unpkg lookups failed), so licence and component reusability are **UNVERIFIED**.
4. Verdict: the app itself is not a library. The reusable part is Phylocanvas.gl, which the main comparison should assess separately (WebGL, MIT per registry, React wrappers exist).

### Facts

| Fact | Value | Source | Verified? |
|---|---|---|---|
| Source repo | not reached | n/a | UNVERIFIED |
| Licence | not reached | n/a | UNVERIFIED |
| Tree component | Phylocanvas / Phylocanvas.gl | https://npmjs.com/package/phylocanvas (statement), WebSearch results | Partial |
| `@phylocanvas/phylocanvas.gl` | MIT; 1.64.1 published 2026-07-13; peer `deck.gl ^8.8.12`; maintainer `cgps-admin` | https://registry.npmjs.org/@phylocanvas%2Fphylocanvas.gl | Yes (registry only; source not read) |
| `@cgps/phylocanvas` | LGPL-3.0-only, 3.18.0, 2020-03-06 | https://registry.npmjs.org/@cgps%2Fphylocanvas | Yes |
| Scale | Phylocanvas.gl paper claims 100K+ nodes (comparison.md); Taxonium authors reportedly saw Microreact lock up on a large tree (second-hand in comparison.md) | comparison.md | UNVERIFIED |

### Criteria scorecard
All rated Unknown for Microreact itself. For the successor component Phylocanvas.gl: 1 Yes, 3 Likely (WebGL, claim only), 7 Yes (MIT per registry), 8 Yes (2026-07 release), others to be determined by the team member assessing it.

### Open questions
Fetch the Microreact repo (GitHub org `microreact` or GitLab `cgps`) from an unrestricted machine, check LICENSE and whether the tree panel is separable from the Redux store; read Phylocanvas.gl source for node click/hover callbacks and custom drawing.

---

## What I could not verify in this session

- GitHub API (issues, contributors, releases) was blocked; counts for Archaeopteryx.js come from WebFetch of the HTML pages, and Phylo.io's open issues/PRs and contributor list were not obtained.
- Microreact's repo, licence and architecture.
- Live production deployments of Archaeopteryx.js (BV-BRC) were taken from repo comments, not from the BV-BRC site.
- Nothing was executed: no benchmarks, no bundler test, no browser run for any viewer.
