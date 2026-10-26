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

## Sidecar table (TSV or CSV)

A table next to the tree adds columns to its nodes: country, host, date, even a sequence. The first column is named `ID` (any case) and holds
a tip label, or the name of an internal node. The delimiter is a tab if the header line has one, else a comma; fields may be "quoted"
(commas, newlines and `""` inside).

The table is kept apart from the tree and is read lazily, so a large table, or a long sequence in every row, does not grow the tree or
cost anything until it is used:

```ts
import { parseNewick, parseSidecar } from '@gbif-phylo/io';

const tree = parseNewick(newickText); // or parseNexus(text).tree
const sidecar = parseSidecar(tsvText); // throws SidecarError if the first column is not ID; only row positions are indexed
const b = sidecar.bind(tree); // match rows to nodes: an Int32Array by node (b.rowOf) and a report

b.report.unmatchedIds; // rows that named no tip and no internal node
b.report.tipsWithoutRow; // tip labels no row named
b.report.duplicateIds; // IDs of rows that matched a node an earlier row had matched (the later row wins)

b.get(node, 'country'); // one cell of one node: 'US', or a number if it reads as one ('007' stays a string); undefined if none
b.record(node); // all its non-empty cells by column, for a popup
const cat = b.categories('country'); // one column as integer codes by node, most frequent value first: for colouring
```

- **Memory.** The sidecar keeps the text it was given (a cell is a slice of it) and 4 bytes per row; a binding is 4 bytes per node, a
  `categories` result 4 bytes per node. Nothing is stored per cell, and nothing is written into `tree.annotations`.
- **Time.** On a laptop-class machine, 100,000 rows with a 1 kB sequence each (103 MB of text) parse in about 30 ms, bind in 90 ms and give
  a column of categories in 35 ms; a cell or a row is read in microseconds. 1,000,000 rows bind in about 1.3 s, most of it the tree's own
  label index. A text is one JavaScript string, so about 500 MB at most.
- **Edits of the tree.** Node numbers change when tree-ops edits a tree. Call `bind` again on the result (matching is by label, so nothing is
  lost); a binding is for the tree it was made from.

A label several tips carry gives the row to every one of them. Nothing is dropped silently: show the report, so a mismatch between the
two files (a renamed tip, a different spelling) is seen. `@gbif-phylo/viewer`'s `colourBy(tree, cat, theme)` turns `categories` into tip
colours, a legend and a swatch column.

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
