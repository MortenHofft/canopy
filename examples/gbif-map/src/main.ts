// A tree whose tips are matched to GBIF taxa by a sidecar, with the public API of @canopy/viewer and @canopy/io and nothing else:
//  - a Newick tree and a CSV (taxonKey, scientificName, nameInTree), read with parseNewick and parseSidecar (idColumn names the column
//    that holds the tip labels and node names) and bound to the tree; the root is a named node, Acacia, with a row of its own
//  - the names: the name GBIF interprets the label as, the label as it is in the tree, or both (formatLabel(label, node))
//  - a popup on a tip, or on a node that has a row (an Overlay), with links to the taxon on gbif.org and to an occurrence search
//  - the match report of the sidecar: tips without a row, rows without a tip
// The matching itself (label to taxon key) is assumed done by an earlier step, as GBIF does for occurrences: the CSV is its result.
// `npm run dev` in this folder, then open the printed URL. ?cpu=1 uses the CPU canvas (headless browsers without a GPU).

import '../../shared/gbif-tokens.css';
import '@canopy/viewer/viewer.css';
import './style.css';
import { parseNewick, parseSidecar } from '@canopy/io';
import { Fit, Overlay, Search, Tooltip, TreeViewer, Zoom, type TreeEvent } from '@canopy/viewer';

async function fetchText(path: string): Promise<string> {
  const r = await fetch(`/data/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.text();
}

const [newick, csv] = await Promise.all([fetchText('gbif-map/acacia.nwk'), fetchText('gbif-map/acacia.taxa.csv')]);
const tree = parseNewick(newick);
const binding = parseSidecar(csv, { idColumn: 'nameInTree' }).bind(tree);

// ---------------------------------------------------------------- names

/** The label as the tree has it, readable: Newick writes a space as an underscore. */
const original = (label: string): string => label.replace(/_/g, ' ');

type NameMode = 'interpreted' | 'original' | 'both';
/** formatLabel gets the node too, so the name is read from the sidecar by node, for a tip and for a named inner node alike. */
function formatterFor(mode: NameMode): (label: string, node: number) => string {
  return (label, node) => {
    const gbif = binding.get(node, 'scientificName');
    if (mode === 'original' || gbif === undefined) return original(label); // a node with no match keeps the name it came with
    return mode === 'interpreted' ? String(gbif) : `${gbif} (${original(label)})`;
  };
}

// ---------------------------------------------------------------- the viewer

const viewer = new TreeViewer({
  target: document.getElementById('tree')!,
  tree,
  controls: [new Zoom(), new Fit(), new Search({ highlight: true })],
  options: { formatLabel: formatterFor('interpreted'), softwareCanvas: new URLSearchParams(location.search).get('cpu') === '1' },
});
viewer.addControl(new Tooltip());

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="names"]'))
  input.addEventListener('change', () => input.checked && viewer.setOptions({ formatLabel: formatterFor(input.value as NameMode) }));

// ---------------------------------------------------------------- the popup

const card = new Overlay({ positioning: 'bottom-center', offset: [0, -14], className: 'tip-card' });
viewer.addControl(card);

function link(href: string, text: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function showCard(e: TreeEvent): void {
  const label = e.isTip ? e.tipId! : tree.nodeName(e.node); // a tip, or a named inner node with a row
  const gbif = binding.get(e.node, 'scientificName');
  const key = binding.get(e.node, 'taxonKey');
  const h = document.createElement('h3');
  h.textContent = String(gbif ?? original(label));
  const dl = document.createElement('dl');
  const rows: [string, string][] = [
    ['In the tree', label],
    ['GBIF name', String(gbif ?? 'no match')],
    ['Taxon key', String(key ?? 'no match')],
    ...(e.isTip ? [] : ([['Tips', String(e.tipCount)]] as [string, string][])),
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  const links = document.createElement('p');
  links.className = 'links';
  if (key !== undefined) links.append(link(`https://www.gbif.org/taxon/${encodeURIComponent(String(key))}`, 'Taxon on gbif.org'));
  links.append(link(`https://www.gbif.org/occurrence/search?verbatimScientificName=${encodeURIComponent(label)}`, 'Occurrences with this name'));
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.onclick = () => card.setPosition(null);
  card.element.replaceChildren(h, dl, links, close);
  card.element.dataset.tipId = label;
  card.setPosition({ node: e.node });
}
viewer.on('click', (e) => {
  // a tip, or the marker of a named inner node that the CSV has a row for, gets this card; other clades keep what the viewer does
  if (!e.isTip && !(e.kind === 'node' && binding.rowOf[e.node] >= 0)) return;
  e.preventDefault();
  showCard(e);
});

// ---------------------------------------------------------------- the match report

const report = binding.report;
document.getElementById('summary')!.textContent =
  `${tree.tipCount - report.tipsWithoutRow.length} of ${tree.tipCount} tips matched a row of the CSV` +
  (report.duplicateIds.length ? `; ${report.duplicateIds.length} IDs are in more than one row` : '') +
  '.';
function fill(id: string, items: string[]): void {
  const ul = document.getElementById(id)!;
  for (const text of items.length ? items : ['none']) {
    const li = document.createElement('li');
    li.textContent = text;
    ul.append(li);
  }
}
fill('unmatched', report.tipsWithoutRow);
fill('unused', report.unmatchedIds);

Object.assign(window, { __example: { viewer, card } });
