# Example: the table view

A tree as a table, in the manner of [TBrowse](https://warelab.github.io/tbrowse/playground): one row per tip at a fixed height, the
wheel scrolls rows instead of zooming, and the tree is one column among data columns, each with a header and a handle to resize it. The
overview strip on the right is the scrollbar. Built on the public API of `@gbif-phylo/viewer` only, without a framework, to find out what
the viewer still lacks for such a view ([#50](https://github.com/MortenHofft/gbif-phylo/issues/50)). The gaps are listed below.

```
npm run dev -w examples/table    # http://127.0.0.1:5312 (?tree=<id> from src/trees.json)
```

## What it shows

| TBrowse                                        | Here                                                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| row and font sliders                           | **Row** sets the `rowHeight` option (px), **Font** the theme's `labelSize` (`updateTheme`)                                   |
| vertical scrolling only                        | the wheel, over the tree, a column or the overview, scrolls whole rows; nothing zooms ([`src/scroll.ts`](src/scroll.ts))     |
| Tree column, collapsed clade as a triangle     | the viewer's rectangular tree; a click on a clade collapses it to one row (`setCollapsed`), a second click opens it           |
| Labels, "2/6 fields", dotted leaders           | `alignLabels` with its leaders; **Label fields** picks the fields: the first is the label, the others text columns after it |
| MSA                                            | an `alignment` column from the tree's FASTA                                                                                  |
| Gene structure                                 | **Gene location**, a custom column (Ensembl only): each gene's span on its chromosome, with its strand                       |
| Expression heatmap with the value in the cell | **Expression**, a custom column: one cell per tissue coloured on a ramp of CSS custom properties, the value written in it    |
| Scores                                         | **Score**, a `bar` column                                                                                                    |
| column headers with resize handles             | a header row laid over the viewer's header band, one handle per column ([`src/header.ts`](src/header.ts))                   |
| "zones" (width, visible) in the URL            | `?cols=tree:420,f.species:150,!msa`: widths in px, `!` hidden; also `?row=` and `?font=`                                      |
| hover a node / hover a row / selected          | the readouts under the table: the `hover` event, a row under the pointer over the columns, the `selectionchange` event       |

Search (the built-in `Search` control, placed in the toolbar) brings a tip into view without zooming.

## How it is split

The viewer is the frame: rows, the tree, the columns it draws, the overview. The columns are this page's list of column specs keyed by tip
label, and a **data source** fills them ([`src/sources.ts`](src/sources.ts)): it says which fields the tips have and which data columns it
offers, with their renderers ([`src/renderers.ts`](src/renderers.ts)). Which columns are shown, in which order and width, is the page's
state (in the URL), as TBrowse's zones are. The viewer is given the widths and the specs, and the header reports the resizes. Another
source, such as GBIF occurrences or traits, would plug other fields and renderers into the same frame.

The trees (in [`src/trees.json`](src/trees.json); the site build copies their files). Issue #50 asks for "the Reactree trees", but
there is no Reactree example in this repository, so the page uses small trees of `data/` that each show something a table is for: an
Ensembl gene tree with an alignment and per-member data (the closest to TBrowse's own gene trees), a nucleotide alignment, and two Open
Tree subtrees without branch lengths (a cladogram, 211 and 888 tips: long enough to scroll, with names to read out of the labels).

- **Ensembl protein family, Murinae** (54 tips, `data/rich/ens-protein-54`): the protein alignment, and from `members.tsv` the species
  (strain), gene symbol and location of each protein.
- **HCV 2k IQ-TREE** (19 tips, `data/rich/hcv-2k-iqtree-alignment`): a nucleotide alignment; the country, accession and year are read
  out of the tip labels where they have them.
- **Open Tree, Canidae** (211 tips) and **Open Tree, Testudines** (888 tips) from `data/real-ladder` (no branch lengths, so a
  cladogram): the name and the OTT id are read out of the tip labels.

**The Score and Expression values are sample data**: generated in `sources.ts` from a hash of each tip label, so they are the same on
every load, and mean nothing.

## Gaps

What the viewer cannot do for this view yet, and how the page works around it. Each has its own issue.

1. **No scroll-only navigation** ([#98](https://github.com/MortenHofft/gbif-phylo/issues/98)). The wheel zooms the rows; Ctrl or Shift and the wheel, pinch, double click and
   the + and - keys zoom too, and `focusTip` (the search) zooms in to rows of at least 26 px. Workaround: [`src/scroll.ts`](src/scroll.ts)
   catches the wheel, the zoom keys and the double click on the frame in the capture phase, before the viewer, and turns the wheel into
   `setViewport` by whole rows; after any other change of the window (pinch, drag, search, resize) it puts the window back to the fitted
   height and the full tree width, and stops the rows at the first and last tip (the viewer lets a zoomed view overscroll by 15%). Such
   a zoom is made by the viewer and then undone by the page.
2. **No header row of its own** ([#99](https://github.com/MortenHofft/gbif-phylo/issues/99)). The viewer draws each column's header text on the canvas (11 px, not a theme
   token) in a 24 px band above the plot, with no resize handle, no place for the app's own content (a settings button, the tissues of
   the heatmap, an overview of the alignment) and no event when a column is resized; the tree and the labels have no header at all.
   Workaround: the page passes empty headers and lays a DOM header row over that band ([`src/header.ts`](src/header.ts)): one cell per
   column with a handle that calls `setColumns` (or `setOptions({ treeWidth })` for the Labels handle) and writes the width to the URL.
   The band's height (24 px) is copied from the viewer's source; without data columns the viewer leaves 8 px instead, and the page moves
   the tree down itself.
3. **No public geometry of the columns and the tree area** ([#100](https://github.com/MortenHofft/gbif-phylo/issues/100)). Nothing says where a column, the tree area or the
   aligned label column is. Workaround: `header.ts` takes a column's left edge from `columnCell` of a row in view that has a value (2 px
   less for a bar column, whose box is the bar), the start of the labels from `nodePosition` of two tips in view (the screen x of layout
   x = 1) plus the label gap, and the end of the tree area from the first column less the gap between columns; the label gap (8 px), the
   column gap (6 px) and the overview strip (56 + 8 px) are copied from the viewer's source.
4. **The labels are not a column, and have one field** ([#101](https://github.com/MortenHofft/gbif-phylo/issues/101)). A tip label is one string (`formatLabel`), drawn in at most
   40% of the tree area and cut off by the next column without an ellipsis; its width cannot be set apart from the tree's. Workaround:
   the first field is the label, the others are `text` columns right after the tree; the Labels header spans the label area and its
   handle sets `treeWidth`. Text columns use their own font size (at most 12 px, not `labelSize`) and squeeze text that is too long.
5. **A custom renderer cannot read its own theme tokens** ([#102](https://github.com/MortenHofft/gbif-phylo/issues/102)). The heatmap
   is a custom `ColumnRenderer` on purpose ([`src/renderers.ts`](src/renderers.ts)): as decided on #50, it moves into the core only if it
   proves generic, like `bar`. But a renderer only gets the viewer's `TreeTheme`, so its colours cannot be theme tokens of its own.
   Workaround: the page keeps them as CSS custom properties (`--table-heat-low`, `--table-heat-high`, `--table-heat-text`,
   `--table-heat-text-strong`), reads them itself and reads them again on `themechange`, then asks for a redraw. A cell is the high
   colour over the low one at the value's share, with the value written in it when the row is tall enough.
6. **No row events over the columns** ([#103](https://github.com/MortenHofft/gbif-phylo/issues/103)). `hover` and `click` report only the tree (tips, nodes, branches, labels); over
   a column `hitTest` is null, so "hover a row" has nothing to listen to. Workaround: a `pointermove` on the frame finds the row from
   `columnCell` of a row in view and the pointer's y, and the layout's `rowNode` / `rankOfRow` for its tip.
7. **Columns wider than the room run under the overview** ([#104](https://github.com/MortenHofft/gbif-phylo/issues/104)). The tree area shrinks to its least (120 px) and the
   columns go on past the right edge, under the overview strip; there is no horizontal scrolling of the columns. Workaround: the page
   scales its default column widths to the frame so that the tree keeps 42%; widths the user set are kept as they are, and can still
   overflow.
8. **A new row height or tree width scrolls back to the top** ([#105](https://github.com/MortenHofft/gbif-phylo/issues/105)). `setOptions` with `rowHeight` or `treeWidth` refits
   the view, which with a fixed row height is the first rows. Workaround: the page notes the first row in view and scrolls back to it
   after the change (`keepTop` in [`src/main.ts`](src/main.ts)).

Not tried here: reordering columns by dragging their headers (app state: the page would reorder its specs), TBrowse's "compressed"
clades (a clade drawn with lower rows rather than collapsed to one), and pruning or swapping clades.

The browser check is `tests/browser/scripts/check-table.mjs`. It runs in `npm run test:browser` (`--only table`), against the built page
and against the built site. `window.__table()` returns the `TreeViewer`.
