# @gbif-phylo/io

Parsers for phylogenetic tree files and the tree model they produce.

- `parseNewick(text, options?)`: an iterative, quote-aware Newick parser. There is no recursion, so a 1,000,000-deep caterpillar tree parses. It handles comments (BEAST `[&...]`, NHX), internal labels (names, support values, `support:name`), and missing, zero and negative lengths.
- `parseNexus(text, treeIndex?, options?)` (or `parseNexus(text, options)`): reads a NEXUS `TREES` block, including a `TRANSLATE` table and files with several trees.
- `toNewick(tree, options?)`: writes a tree back to Newick. `{ annotations: true }` writes `tree.annotations` back in BEAST syntax.
- `toNexus(tree, options?)`: writes a NEXUS file (a TAXA block and the tree, through a TRANSLATE table unless `translate: false`; `treeName`; `annotations: true` as for `toNewick`).
- `TreeModel`: a rooted tree on typed arrays in preorder. The descendant tips of every node are a contiguous rank range, and every query is iterative. It satisfies the `TreeData` interface of `@gbif-phylo/viewer`, so it can be passed to the viewer as it is.

Only single-quoted labels are handled, not double-quoted ones. Underscores in labels are kept, so tip ids equal the text in the file.

## Warnings and strict mode

Real-world tree files carry quirks: a missing trailing `;`, a stray comma, a non-numeric branch
length. The parser accepts these and surfaces them as warnings on the tree, so the viewer can
tell the publisher without refusing to render the file. A validator that would rather fail hard
passes `{ strict: true }`.

```ts
const tree = parseNewick(text);              // never throws for recoverable issues
if (tree.warnings.length) {                   // readonly ParserWarning[]
  for (const w of tree.warnings) console.warn(`[${w.code}] ${w.message} (char ${w.position})`);
}

parseNewick(text, { strict: true });          // throws NewickError on the first warning
parseNexus(text, { strict: true });           // same for NEXUS, plus 'missing-nexus-header'
```

Each `ParserWarning` has `{ code, message, position }`. Codes are stable identifiers:

| Code | Meaning |
|---|---|
| `non-numeric-length` | `(A:xyz,B);` — branch length isn't a number; treated as missing |
| `dangling-colon` | `(A:,B);` — `:` with no number after it; treated as missing |
| `empty-tip` | `(A,,B);`, `(A,B,);`, `(,A,B);` — a stray comma created an unnamed tip |
| `missing-trailing-semicolon` | tree input didn't end with `;` |
| `double-colon` | `(A:1:2,B);` — a second `:` overwrites the first length (last wins) |
| `extra-paren-root` | `((A:1,B:1):10);` — root wraps a single unlabeled internal child |
| `missing-nexus-header` | NEXUS file didn't start with `#NEXUS` |

### What a NEXUS file holds besides the tree

A tip is named, in this order, by its TRANSLATE token, by a taxon label, or by a taxon number (its 1-based position in the TAXA block the TREES block refers to), the order of the NEXUS standard and of DendroPy.

`parseNexus` looks through the whole file, not only up to the tree it returns, and lists what it did not read or could not connect to that tree in `result.ignored` (`{ code, message, block, position }`; empty when the file holds just the trees and the taxa they use). These are not problems with the tree, so they are not in `tree.warnings` and `strict` does not throw for them. `result.treeCount` is the number of trees in the file.

| Code | Meaning |
|---|---|
| `nexus-ignored-block` | a block that is not TAXA, TREES, CHARACTERS or DATA (FigTree, MrBayes, SETS, NOTES, ...) is not read |
| `nexus-block-unreadable` | part of a block could not be read (an unterminated quote) |
| `nexus-scan-stopped` | the scan after the returned tree hit a quote or comment it could not close; the tree is fine |
| `nexus-other-trees` | the file holds more trees than the one returned |
| `nexus-taxa-unused` | a TAXA block that the returned tree does not use (several TAXA blocks) |
| `nexus-taxa-ambiguous` | several TAXA blocks and the TREES block has no `LINK TAXA=`; the last one before it was assumed |
| `nexus-taxa-link-unresolved` | `LINK TAXA=` names a title no TAXA block has |
| `nexus-taxa-mismatch` | tips that are not in the TAXA block, and taxa with no tip (by label) |
| `nexus-ntax-mismatch` | the TAXA block says `NTAX=n` but lists another number of taxa (DendroPy refuses such a file; we read it) |
| `nexus-taxon-numbers` | some tips were taxon numbers (not a TRANSLATE token, not a taxon label) and were replaced by the label at that position in the TAXA block |
| `nexus-sequences-ignored` | a CHARACTERS or DATA block is not read; every row matches a tip by label |
| `nexus-sequences-unlinked` | the same, but some rows match no tip or some tips have no row (the message gives the counts), or the rows could not be told apart from wrapped lines |

Names are compared the way NEXUS reads them: an unquoted `_` is a space, so `t2_the_name` and `'t2 the name'` are one taxon.

Structurally broken input (unmatched parens, unterminated quote or comment), double-quoted labels
(`("A","B");`), and a quote mid-token (`(A'q',B);`) always throw `NewickError` regardless of
`strict`. `{ strict: true }` promotes every warning in the table above to a `NewickError` of
the form `[<code>] <message> (at character <pos>)`.

A clean parse has an empty `warnings` array in both modes.

## Duplicate tip labels

Tip labels are lookup keys, not the identity of a tip: the same label can be on several tips (several sequences of one species, labels
made for display), and every tip is kept. `tree.duplicateTipLabels()` reports them after a parse (a map from each label that more than one
tip carries to those tips' node indexes, in preorder; empty when the labels are unique), so an app can warn. `tipIndex(label)` is the
first tip with a label, and `tipIndices(label)` every one (`mrcaOf` takes node numbers, so pass it `tipIndices(label)` to count every tip of a label). To tell the tips apart, use their node
indexes (the viewer's node ids).

```ts
const tree = parseNewick(text);
const dup = tree.duplicateTipLabels();
if (dup.size) console.warn(`${dup.size} tip labels are on more than one tip, e.g. ${[...dup.keys()][0]}`);
tree.tipIndices('Homo_sapiens'); // [3, 4, 7]
```

## Annotations

BEAST / FigTree `[&key=value,...]` comments and NHX `[&&NHX:key=value:...]` comments are skipped by default, which costs nothing. Pass `{ annotations: true }` to `parseNewick` or `parseNexus` to keep them in `tree.annotations` (`null` otherwise). `parseNexus` takes the options as `parseNexus(text, options)` (with `treeIndex` in them if needed) or `parseNexus(text, treeIndex, options)`.

```ts
const tree = parseNexus(text, { annotations: true }).tree;
tree.annotations.get(nodeIndex, 'posterior'); // 0.98
tree.annotations.get(nodeIndex, 'height_95%_HPD'); // [3.2, 13.0]   ({a,b} ranges and sets are arrays)
tree.annotations.get(nodeIndex, 'rate', 'edge'); // BEAST's annotation after the ':' belongs to the edge above the node
tree.annotations.keys(); // every key in use
tree.annotations.column('posterior'); // Float64Array by node index, NaN where absent or not a single number
```

- **Values.** A number, a string (quoted or not in the file) or an array. Numbers with leading zeros (`007`) stay strings so that identifiers survive. The store is sparse: `annotations.node` and `annotations.edge` are `Map`s from node index to a record, holding only the nodes that have annotations. BEAST comments before the `:` are the node's and after it the edge's; NHX comments are always the node's. Flags without a value (`[&R]`) are not annotations. Quoted values may hold brackets (`[&s="a]b"]`) when annotations are kept; the default skip does not track quotes, because that made parsing a tree full of annotations about 30% slower.
- **Where comments are dropped.** Only comments after a node (after its tip label, after `)` or the internal label, or around the `:`) are annotations. Not read: a comment before a tip's label, a comment in the tree statement before `=` (`tree X [&lnP=-1.2] = ...`), and comments in the TAXA block (`taxlabels` entries such as `name[&!color=#ff0000]`).
- **Support from an annotation.** `tree.support` is not changed by annotations (it is the numeric internal label). `supportFrom(tree, 'posterior')` returns a new `Float64Array` in the same layout (NaN for tips and nodes without the key). For compound values, such as IQ-TREE's `SH-aLRT_UFB="85.5/61"`, pass `pick`: `supportFrom(tree, 'SH-aLRT_UFB', (v) => parseFloat(String(v).split('/')[1]))`. To use the values where tree-ops reads `tree.support`, copy them in on purpose: `tree.support.set(supportFrom(tree, 'posterior'))`. Chosen over a `supportKey` parse option so that the parse never decides what support means. Showing these values as node labels in the viewer is not done here; it moves to #16.
- **Writing.** `toNewick(tree, { annotations: true })` and `toNexus` write the annotations back as `name[&k=v]:[&k=v]length`, ranges as `{a,b}`, strings in double quotes (single quotes if they hold a `"`). NHX input comes back in BEAST syntax. Reading the output with `annotations: true` gives the same table (minus left-out entries). An entry the syntax cannot hold (a key with whitespace or `[ ] { } , = " '`, a string with both kinds of quote) is left out and reported once with `console.warn`; the rest is written. NHX values are never read as quoted. A root length is written when there is one (`(A,B):3;`); it is not an annotation, but a round trip keeps it.
- **Tree operations.** Annotations are keyed by node index. A tree-ops result has a `map` (old index to new, -1 removed); carry the table over with `tree.annotations.remap(result.map, oldTree, result.tree)` and attach it by building the model with it:

  ```ts
  const r = reroot(tree, node);
  const next = new TreeModel({ ...r.tree, annotations: tree.annotations.remap(r.map, tree, r.tree) });
  ```

  (`TreeModel` throws if the table is for a tree of another size.) Node annotations follow their node. Edge annotations follow the undirected edge: after `reroot` the edges between the new and the old root move to the node that is now below them, and the edge that the new root splits is copied to both halves. Dropped: the edge of a removed node, and the edge that `reroot` merges when the old root is suppressed (the surviving child's own annotation wins). The records are copied. tree-ops does not do this itself, so it stays free of the annotation types.

- **Size.** The reader is part of the parser (a plain option, no second import), so `parseNewick` alone is about 2.7 kB minified larger than before (6.3 to 9.0 kB). `scripts/check-packages.mjs` records both sizes.

## Tests and benchmark

`npm test` runs the unit tests. For NEXUS, `test/nexus-tools.test.mjs` covers the shapes BEAST 1, BEAST 2 and MrBayes write (the MrBayes and BEAST 2 files are written by hand in their format, not real output), LF, CRLF and CR line endings, and every NEXUS tree in `data/rich` against the numbers in its `manifest.json` (made by an independent Python parser). `npm run bench -- [--reps 7] [file.nex[.gz] ...]` prints parse time per NEXUS file (default: `data/synthetic/nexus` and the NEXUS trees in `data/rich`).
