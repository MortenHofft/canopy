# Evaluation framework

How we compare tree viewers (libraries, wrappers, or our own build) for gbif.org. The goals and the numbered criteria 1 to 20 are in [goal.md](goal.md); this document organises them into **gates** and **dimensions**, defines **evidence levels**, and gives the template for recording results. Existing facts per candidate are in [research/](research/) and the summary in [recommendation.md](recommendation.md).

## Rules for scoring

1. **Gates first.** A candidate must pass or be flagged on every gate. Do not hide a gate failure inside an average.
2. **No single total score.** Show the profile across dimensions. Weights are set by the team (see "Priorities").
3. **Every cell has a capability and an evidence level.** Capability: **Y** yes, **P** partial, **N** no, **?** unknown. Evidence level (letter after it, for example `Y-S`):

| Level | Meaning |
|-------|---------|
| **M** | Measured or demonstrated by us, in a browser, with date and exact version recorded |
| **S** | Verified by reading source or registry metadata |
| **D** | Stated in the project's own documentation |
| **C** | Claimed (paper, README prose, third-party description) without us checking |
| **N** | Looked for and not found |
| **U** | Not looked at |

4. Prefer **M** over **S** over **D**. A claim at level **C** or **D** about performance does not count as evidence for the scale dimension.
5. Record the **version** (npm version or commit) and the **date** for every candidate. Libraries here change fast (several had releases within days of our research).
6. Where a gap exists, record the **cost to close it**: patch, plugin or wrapper, fork, or rewrite, and whether the licence allows it.

## Gates

| Gate | Pass condition |
|------|----------------|
| G1 Licence | Compatible with an Apache-2.0 project shipping a browser bundle, or clearly flagged for GBIF legal review (GPL, AGPL, LGPL, source-available, missing licence fields) |
| G2 Browser-only | Runs in the browser from static files, with no per-user server process |
| G3 React-embeddable | A React 18/19 component, or an imperative API that a thin wrapper can drive with clean mount and unmount |
| G4 Not abandoned | A release or commit in the last 12 months, not archived, with a maintainer who answers (or we accept owning a fork) |

## Dimensions

Criteria numbers refer to [goal.md](goal.md).

### A. Project health
Last commit and last release dates; release cadence; share of commits by the top contributor (bus factor); open versus closed issues and typical response time; institutional backing; adoption (npm downloads, dependents); freshness of dependencies and peer ranges (React version, pinned deck.gl or d3); API stability (breaking changes in recent majors); signs of churn (many releases in a short burst). Criterion 8.

### B. Integration
React component, wrapper or imperative handle; controlled and uncontrolled state; several instances on one page (singletons are a failure); SSR safety; clean unmount; global side effects (for example capturing Ctrl/Cmd+F); bundle size (minified and gzipped, and whether it tree-shakes); ESM and TypeScript types; CSP friendliness. Criteria 2, 12.

### C. Interaction
Click and hover on tips; click and hover on **internal nodes and branches** with the descendant tip set in the payload (19); tip label as a **real link** (an anchor, which is easy in SVG or HTML and needs an overlay in canvas or WebGL); programmatic highlight, focus and zoom-to-node; viewport control; selection model; keyboard operation; context menu; shareable state (URL round-trip). Criteria 5, 11, 19.

### D. Customisation
Hide or disable built-in features (headless or modular, versus a fixed app UI); add features through slots, plugins or props (versus forking); per-node and per-branch style callbacks; **programmatic clade colouring** (20); CSS tokens, dark mode and fonts (and how styling works: CSS for SVG and HTML, props or callbacks for canvas and WebGL); custom labels; internal-node markers; aligned per-tip columns, including React-rendered content; tooltips. Criteria 13, 16, 20.

### E. Visual features
Rectangular, circular and unrooted layouts; **phylogram and cladogram with branch lengths**, scale bar and time axis (18); collapse; whole-tree overview and minimap (17); semantic zoom and summaries at low zoom (14); search; export (SVG, PNG, Newick). Criteria 6, 10, 14, 17, 18.

### F. Scale and performance
Measured, never claimed, at the rungs in [../data/README.md](../data/README.md): parse time, first render, pan and zoom frame rate, interaction latency, memory, and the size at which it becomes unusable, each with 0 and 3 custom columns. Criterion 15.

### G. Data and logic
Formats read (Newick, Nexus with TRANSLATE and multiple trees, phyloXML, NeXML, NHX and BEAST annotations); robustness (quoted labels, deep trees, no recursion limits); loading of large files (streaming, web worker); tree model; built-in tree operations (reroot, ladderize, prune, subtree, MRCA, distances) and whether they are separable from the renderer; behaviour when operations are unavailable on big trees (capability tiers in [recommendation.md](recommendation.md)). Criterion 4.

### H. Accessibility
Keyboard navigation, ARIA roles, a text or table fallback, touch gestures, contrast, reduced motion.

### I. Licence detail
SPDX of the package and of key dependencies; mismatches between `package.json` and LICENSE files; ShareAlike or non-commercial terms on any bundled data; what the licence requires for a minified bundle. Criterion 7, gate G1.

### J. Cost to adapt
For each gap against the dimensions above: patch, plugin or wrapper, fork, or rewrite; rough effort; who would maintain it.

## Priorities (proposal; the team sets the final weights)

| Priority | Dimensions and criteria |
|----------|--------------------------|
| **Must** | Gates G1 to G4; interaction on tips and internal nodes (11, 19); programmatic highlight and clade colouring (5, 20); React state control (12); branch lengths (18); scale at the sizes real GBIF trees turn out to have (15) |
| **Should** | Custom per-tip content and columns (13); styling hooks and tokens (16); rectangular and circular layouts (6); formats Newick and Nexus (4); overview and semantic zoom (14, 17); several instances per page |
| **Nice** | Unrooted layout; export (10); built-in tree operations; minimap; keyboard shortcuts beyond basics; alignment panels |

## Mapping from criteria to dimensions

| Criterion | Dimension |
|-----------|-----------|
| 1 static, browser-only | Gate G2 |
| 2 embeddable | Gate G3, B |
| 3, 15 scale | F |
| 4 formats | G |
| 5 programmatic API | C |
| 6 layouts | E |
| 7 licence | Gate G1, I |
| 8 maintenance | Gate G4, A |
| 9 accessibility, theming, mobile | H, D |
| 10 export | E |
| 11 interaction callbacks | C |
| 12 React integration | B |
| 13 custom rendering | D |
| 14 semantic zoom | E, F |
| 16 styling | D |
| 17 whole-tree overview | E |
| 18 branch lengths | E |
| 19 events on any node | C |
| 20 clade colouring | D |

## Template for a candidate result

Copy to `docs/results/<candidate>.md`. One file per candidate and version; link the evidence (source file and line, URL, or the measurement run).

```
# <name> <version> (<date>)

Gates: G1 <pass/flag + note>, G2 ..., G3 ..., G4 ...

| Dimension | Item | Capability+evidence | Notes and evidence link |
|-----------|------|---------------------|-------------------------|
| A | last release | Y-S | npm time field, <date> |
| C | internal node click with tip set | P-S | <file:line> |
| F | 100k tips, pan/zoom fps (Chromium, <machine>) | M | <run id> |
...

Cost to adapt: <gap> -> <patch|wrapper|fork|rewrite>, <effort>, <licence ok?>
Verdict (3 lines).
```

`docs/results/matrix.md` collects one row per candidate and one column per dimension (capability letter only, with a link to the candidate file), regenerated by hand after each round.
