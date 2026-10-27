# @gbif-phylo/io

Parsers for phylogenetic tree files and the tree model they produce.

- `parseNewick(text, options?)`: an iterative, quote-aware Newick parser. There is no recursion, so a 1,000,000-deep caterpillar tree parses. It handles comments (BEAST `[&...]`, NHX), internal labels (names, support values, `support:name`), and missing, zero and negative lengths.
- `parseNexus(text, treeIndex?, options?)` (or `parseNexus(text, options)`): reads a NEXUS `TREES` block, including a `TRANSLATE` table and files with several trees.
- `nexusIndex(text, options?)` and `nexusTrees(text, options?)`: for NEXUS files with many trees (posterior samples, bootstrap sets). `nexusIndex` makes one fast pass that parses no tree and returns `index.trees` (for each tree: `index`, `name`, the offsets `start`/`end` of its TREE command in the text (JavaScript string indices, UTF-16 code units, not bytes), `isDefault` for `TREE *`, `rooted` from `[&R]`/`[&U]`, `weight` from `[&W n]` (null unless a finite number), and `state`, the MCMC state in the names `STATE_n` (BEAST) and `gen.n` (MrBayes)), the notes about the file (`index.ignored`) and `index.parse(i)`, which reads tree `i` alone with the TRANSLATE table and TAXA block that apply to it, in time that does not depend on `i`. `nexusTrees` is a generator over the same: `for (const { tree, info } of nexusTrees(text)) ...`. Each result also has `translateEntries` and the notes that depend on that tree's tips (`ignored`: taxa mismatch, taxon numbers, the sequence blocks against the tips). An error in one tree is thrown when that tree is asked for; the trees before it stay readable. The index and its `trees` are frozen. Made-up posterior of 10,000 trees of 200 tips (`npm run bench:posterior`, one random tree repeated; Node 22, this sandbox, one run each): 43 MB, index 65 ms, one tree 1.5 to 10 ms, all trees 2.4 s, heap 63 MB; with a comment on every node (`-- --annotated`): 163 MB, index 376 ms, all trees 4.0 s, heap 184 MB. Real files: `npm run bench`.
- `parsePhyloXml(text, treeIndex?, options?)` (or `parsePhyloXml(text, options)`): reads one `<phylogeny>` of a phyloXML file (see below).
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
| `unknown-translate-id` | NEXUS TREE references a numeric id not in the TRANSLATE table |
| `invalid-nhx-syntax` | `[&&NHX:name]` entry has no `=` |

### What a NEXUS file holds besides the tree

A tip is named, in this order, by its TRANSLATE token, by a taxon label, or by a taxon number (its 1-based position in the TAXA block the TREES block refers to), the order of the NEXUS standard and of DendroPy. Taxon numbers count only when every tip the table does not name is such a number (as in forester; DendroPy decides per tip): a tree that mixes names and numbers keeps its numbers as names.

`parseNexus` (built on `nexusIndex`) looks through the whole file, not only up to the tree it returns, and lists what it did not read or could not connect in `result.ignored` (`{ code, message, block, position }`; empty when the file holds just the trees and the taxa they use). These are not problems with the tree, so they are not in `tree.warnings` and `strict` does not throw for them. `result.treeCount` is the number of trees in the file.

| Code | Meaning |
|---|---|
| `nexus-ignored-block` | a block that is not TAXA, TREES, CHARACTERS or DATA (FigTree, MrBayes, SETS, NOTES, ...) is not read |
| `nexus-block-unreadable` | part of a block could not be read (an unterminated quote) |
| `nexus-scan-stopped` | the scan after the returned tree hit a quote or comment it could not close; the tree is fine |
| `nexus-other-trees` | the file holds more trees than the one returned |
| `nexus-taxa-unused` | a TAXA block that the returned tree does not use (several TAXA blocks). On `index.ignored`: a TAXA block that no TREES block uses |
| `nexus-translate-malformed` | TRANSLATE entries that are not a token and a name (an unquoted name with spaces, an odd number of words): skipped, not guessed |
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

## Sidecar table (TSV or CSV)

A table next to the tree adds columns to its nodes: country, host, date, even a sequence. The first column is named `ID` (any case) and holds
a tip label, or the name of an internal node. The delimiter is a tab if the header line has one, else a comma; fields may be "quoted"
(commas, newlines and `""` inside).

The table is kept apart from the tree and is read lazily, so a large table, or a long sequence in every row, does not grow the tree or
cost anything until it is used:

```ts
import { parseNewick, parseSidecar } from '@gbif-phylo/io';

const tree = parseNewick(newickText); // or parseNexus(text).tree
const sidecar = parseSidecar(tsvText); // throws SidecarError if the first column is not ID or a quoted field is not closed; only row positions are indexed
const b = sidecar.bind(tree); // match rows to nodes: an Int32Array by node (b.rowOf) and a report

b.report.unmatchedIds; // rows that named no tip and no internal node
b.report.tipsWithoutRow; // tip labels no row named
b.report.duplicateIds; // IDs of rows that matched a node an earlier row had matched (the later row wins)

b.get(node, 'country'); // one cell of one node: 'US', or a number if it reads as one ('007' stays a string); undefined if none
b.record(node); // all its non-empty cells by column, for a popup
const cat = b.categories('country'); // one column as integer codes by node, most frequent value first: for colouring
```

- **Memory.** The sidecar keeps the text it was given (a cell is a slice of it) and 8 bytes per row (where each row starts and ends; a temporary list of twice that many numbers is built while reading); a binding is 4 bytes per node, a
  `categories` result 4 bytes per node. Nothing is stored per cell, and nothing is written into `tree.annotations`.
- **Time.** On a laptop-class machine, 100,000 rows with a 1 kB sequence each (103 MB of text) parse in about 30 ms (about 0.4 s when the text holds a `"` anywhere, as the scan then follows quotes character by character), bind in 90 ms and give
  a column of categories in 35 ms; a cell or a row is read in microseconds. 1,000,000 rows bind in about 1.3 s, most of it the tree's own
  label index. A text is one JavaScript string, so about 500 MB at most.
- **Edits of the tree.** Node numbers change when tree-ops edits a tree. Call `bind` again on the result (matching is by label, so nothing is
  lost); a binding is for the tree it was made from.

A label several tips carry gives the row to every one of them. When an ID names both a tip and an internal node, the tip gets the row; of several internal nodes with one name, the first does. A row with an empty ID matches nothing and is listed in `unmatchedIds`. A quote opens a quoted field only at its start (`12" screen` is text). `categories` leaves out values that no tip has (a sidecar for a larger tree). Nothing is dropped silently: show the report, so a mismatch between the
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

## Tests and benchmark

`npm test` runs the unit tests. For NEXUS, `test/nexus-tools.test.mjs` covers the shapes BEAST 1, BEAST 2 and MrBayes write (the MrBayes and BEAST 2 files are written by hand in their format, not real output), LF, CRLF and CR line endings, and every NEXUS tree in `data/rich` against the numbers in its `manifest.json` (made by an independent Python parser). `test/nexus-edge-fixtures.test.mjs` runs 161 small NEXUS cases taken from or inspired by the tests of DendroPy, Biopython, forester, `ape`, `treeio` and phylotree.js (sources and licences in `tests/bench/parsers/fixtures/edge`). `tests/bench/parsers` compares the reader with DendroPy on every NEXUS file in its test data, and on those cases ([parser comparison](../../docs/design/parser-comparison.md)). `npm run bench -- [--reps 7] [file.nex[.gz] ...]` prints parse time per NEXUS file (default: `data/synthetic/nexus` and the NEXUS trees in `data/rich`).

## phyloXML

`parsePhyloXml(text, treeIndex?, options?)` reads phylogeny number `treeIndex` (default 0, a non-negative integer, also accepted as `options.treeIndex`) of a phyloXML document with a small XML scanner of our own (no DOM, no dependencies, no recursion: a 1,000,000-deep tree and a 100,000-tip star parse). It returns `{ tree, treeName, rooted, lengthUnit, treeCount, ignored }`; `tree` is a `TreeModel` like the ones the Newick and NEXUS parsers give.

- **Read:** the nesting of `<clade>`, `<name>` (the first one if there are several), the branch length (the `branch_length` attribute or element), `<confidence>` (the first numeric one of a clade is its `support`), the phylogeny's `<name>`, `rooted` and `branch_length_unit`.
- **Annotations** (`{ annotations: true }`, as for Newick): `name`, `id_source`, `node_id`, `width`, `confidence.<type>`, `taxonomy.id | code | scientific_name | common_name | rank`, `sequence.accession | name | symbol | location`, `events.type | duplications | speciations | losses | confidence.<type>`, `color.red | green | blue` and `property.<ref>` (numbers where the text is a number; the first one if a key repeats). The confidence inside `<events>` is the confidence of the event, so it is an annotation and not the support of the branch.
- **Names.** A node is named by its `<name>`, else its taxonomy's scientific name, else the first of the taxonomy's code and common name and the sequence's name and accession. `{ labelBy: 'scientific_name' }` puts the scientific name first, which is what GBIF can match (Ensembl names its clades by gene id and carries the species in the taxonomy). Note that, as for Newick, an internal node named like a number (`<name>12</name>`) is read as a support value by the tools that take support from internal labels.
- **Numbers** are decimals and exponents (`0.5`, `.5`, `1e-3`); hex, `Infinity`, `INF`, a comma decimal and an empty string are not numbers.
- **Not read** and counted in `result.ignored` (`{ code: 'phyloxml-ignored-element', path, message, position }`, one note per place, with the number of times): `distribution`, `reference`, `date`, `binary_characters`, `mol_seq`, `domain_architecture`, `clade_relation`, `sequence_relation` and so on. An element inside an element that is read as text (a `<clade>` inside a `<name>`) is skipped without a note. Attributes other than the ones above (`type`, `rerootable`, `collapse`, a taxonomy id's `provider`, a property's `applies_to`, a confidence's `stddev`) are not read, and not noted.
- **Namespaces.** Only elements in the phyloXML namespace, or in none (the PANTHER files declare none), are read. Elements of other namespaces, which phyloXML allows anywhere, are counted as not read under `{namespace}name`, and an attribute with a prefix (another namespace) is not read.
- **Errors** (a `NewickError` with a position): malformed XML (an element that does not close, a mismatched end tag, an unterminated comment, CDATA, attribute or DOCTYPE, a `/` or `=` where an attribute name belongs), a root that is not `<phyloxml>`, a phylogeny without a clade (the schema allows it, a tree cannot be empty), more than one root clade, a `treeIndex` that is not a non-negative integer or is past the last phylogeny. An error after the phylogeny that was asked for does not fail its read: the rest of the file is left unread, the note `phyloxml-scan-stopped` says why, and `treeCount` then counts only up to there.
- **Warnings** on `tree.warnings` (`{ strict: true }` throws): `non-numeric-length` (a branch length that is not a number: the length is missing), `conflicting-branch-length` (an attribute and an element that differ: the attribute is used) and `non-numeric-support` (a `<confidence>` that is not a number).
- **Not handled:** entities declared in a DOCTYPE (the five predefined ones and numeric references are decoded; a reference to a surrogate or beyond U+10FFFF is kept as written), encodings other than the string you pass in. There is no iterator over many phylogenies: each call scans the whole file (about 0.4 s for 20 MB), so reading all of 2,000 phylogenies one by one would take minutes; the Ensembl and PANTHER files hold one each.

Checked against: the three real Ensembl Compara gene trees and the three PANTHER trees in `data/rich`, with the numbers of `treecheck.py` (an independent Python reader); Biopython's phyloXML reader on 65 files (Biopython's own tests, the phyloxml.org examples, `data/rich`, forester's test data) phylogeny by phylogeny: tips, labels, branch lengths, the supports (the full sorted list) and a hash of shape with every edge length agree on 61, and Biopython itself fails on the other four (foreign-namespace attributes and elements, an empty `<property/>`). `npm run bench:phyloxml` times it (Node 22, this sandbox, repeated runs differ by about a third): 23 to 35 MB/s on a made-up 100,000-tip file (25 MB, 0.7 to 1.1 s, 1.1 to 1.2 s with annotations), 16 to 176 MB/s on the real files (the small ones are dominated by start-up cost). See `docs/design/parser-comparison.md`.
