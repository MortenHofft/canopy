// A tree whose tips are matched to GBIF taxa by a CSV sidecar, and the occurrences of the clades you pick on a map: the idea of the
// proof of concept phylogeny-tool.gbif.org (labs-phylogeny), on this viewer.
//  - a click on a node colours it in the tree and puts it in the legend; the map shows the occurrences of its taxon keys, one layer per
//    selection (maplibre, GBIF's basemaps and occurrence map)
//  - the legend: colour, show or hide on the map, order (drag), zoom to the clade in the tree, the same occurrences on gbif.org, remove
//  - in the tree: the layout toggle, fit and the minimap
// The matching of the tree's names to taxon keys is assumed done earlier, when the tree was ingested: the CSV is its result.
// `npm run dev` in this folder, then open the printed URL. ?cpu=1 uses the CPU canvas of the tree (headless browsers without a GPU).

import '../../shared/gbif-tokens.css';
import '@canopy/viewer/viewer.css';
import './style.css';
import { parseNewick, parseSidecar } from '@canopy/io';
import { Fit, LayoutToggle, OverviewControl, Tooltip, TreeViewer } from '@canopy/viewer';
import { Legend } from './legend.ts';
import { BASEMAPS, OccurrenceMap } from './map.ts';
import { nextColour, nodeName, paletteFromTokens, taxonKeysOf, type SelectedNode } from './selection.ts';

async function fetchText(path: string): Promise<string> {
  const r = await fetch(`/data/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.text();
}

const [newick, csv] = await Promise.all([fetchText('gbif-map/acacia.nwk'), fetchText('gbif-map/acacia.taxa.csv')]);
const tree = parseNewick(newick);
const binding = parseSidecar(csv, { idColumn: 'nameInTree' }).bind(tree);

// ---------------------------------------------------------------- the tree

const viewer = new TreeViewer({
  target: document.getElementById('tree')!,
  tree,
  controls: [new Fit({ position: 'top-right' }), new LayoutToggle({ position: 'top-right' }), new OverviewControl()],
  options: {
    // the name GBIF interprets the label as, read from the sidecar by node; a node with no match keeps its own name
    formatLabel: (label, node) => String(binding.get(node, 'scientificName') ?? label.replace(/_/g, ' ')),
    softwareCanvas: new URLSearchParams(location.search).get('cpu') === '1',
  },
});
viewer.addControl(new Tooltip());

// ---------------------------------------------------------------- the selection

const palette = paletteFromTokens(getComputedStyle(document.documentElement));
let items: SelectedNode[] = []; // the first is drawn on top of the map

const occurrenceMap = new OccurrenceMap(document.getElementById('map')!);
const legend = new Legend(document.getElementById('legend')!, {
  colour: (node, colour) => change((i) => (i.node === node ? { ...i, colour } : i), false),
  visible: (node, visible) => change((i) => (i.node === node ? { ...i, visible } : i)),
  zoom: (node) => viewer.zoomToNode(node, true),
  remove: (node) => update(items.filter((i) => i.node !== node)),
  clear: () => update([]),
  move: (from, to) => {
    const next = items.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    update(next, items[from].node);
  },
});

/** The selection changed: tree, map and legend follow. `redraw` false keeps the legend as it is (a colour being picked). */
function update(next: SelectedNode[], focusNode?: number, redraw = true): void {
  items = next;
  viewer.setClades(items.map((i) => ({ node: i.node, colour: i.colour, label: i.name })));
  occurrenceMap.sync(items);
  if (redraw) legend.render(items, focusNode);
}
function change(f: (i: SelectedNode) => SelectedNode, redraw = true): void {
  update(items.map(f), undefined, redraw);
}

function toggle(node: number): void {
  if (items.some((i) => i.node === node)) return update(items.filter((i) => i.node !== node));
  const { keys, total } = taxonKeysOf(tree, binding, node);
  const item: SelectedNode = {
    node,
    colour: nextColour(
      palette,
      items.map((i) => i.colour),
    ),
    visible: true,
    keys,
    total,
    name: nodeName(tree, binding, node),
    tips: tree.leafEnd[node] - tree.leafStart[node],
  };
  update([item, ...items]);
}

// a click on any node, a tip, a marker, a collapsed clade or a branch, picks it or lets it go; the viewer's own menu is not shown
viewer.on('click', (e) => {
  if (e.run) return; // a run of small siblings is not one node
  e.preventDefault();
  toggle(e.node);
});

// ---------------------------------------------------------------- the basemap

const select = document.getElementById('basemap') as HTMLSelectElement;
for (const b of BASEMAPS) select.append(new Option(b.title, b.id, false, b.id === 'gbif-light'));
select.addEventListener('change', () => occurrenceMap.setBasemap(select.value));

legend.render(items);
Object.assign(window, { __example: { viewer, map: occurrenceMap.map, legend, selected: () => items } });
