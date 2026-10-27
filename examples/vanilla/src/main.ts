// @gbif-phylo/viewer without a framework. What this page shows, top to bottom:
//  - a tree and its metadata loaded with fetch and parsed with @gbif-phylo/io
//  - built-in controls in the corners (zoom, fit, search, legend, overview), one outside the viewer (the layout toggle in the page header)
//  - a control of our own (tips in view), built on BaseControl and the viewchange event
//  - columns: a built-in bar column and a custom renderer (a heat strip of a trait value)
//  - a popup of our own for tips (an Overlay that follows the tip when the view moves) and the built-in node menu for clades
//  - the built-in tooltip, a dark theme that is only CSS custom properties, and an event log
// `npm run dev` in this folder, then open the printed URL. ?cpu=1 uses the CPU canvas (headless browsers without a GPU).

import '@gbif-phylo/viewer/viewer.css';
import './style.css';
import { parseNewick, parseSidecar } from '@gbif-phylo/io';
import {
  BaseControl,
  Fit,
  LayoutToggle,
  Legend,
  NodeMenu,
  Overlay,
  OverviewControl,
  Search,
  Tooltip,
  TreeViewer,
  Zoom,
  colourBy,
  type Column,
  type ColumnRenderer,
  type Control,
  type LegendItem,
  type TreeEvent,
} from '@gbif-phylo/viewer';

// ---------------------------------------------------------------- data

async function fetchText(path: string): Promise<string> {
  const r = await fetch(`/data/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  if (!path.endsWith('.gz')) return r.text();
  return new Response(r.body!.pipeThrough(new DecompressionStream('gzip'))).text();
}

interface TipMeta {
  occurrences: number;
  country: string;
  trait: number;
}

const [newick, tsv] = await Promise.all([fetchText('synthetic/newick/yule_1000.nwk'), fetchText('synthetic/meta/yule_1000.meta.tsv')]);
const tree = parseNewick(newick);
// the same table is a sidecar, kept apart from the tree: its first column must be named ID (this file calls it tip_label). Only the
// row positions are indexed; a cell is read when it is asked for (the popup below) or when a column colours the tree
const sidecar = parseSidecar(tsv.replace(/^tip_label/, 'ID')).bind(tree);
const meta = new Map<string, TipMeta>();
for (const line of tsv.split('\n').slice(1)) {
  const [tip, occ, country, trait] = line.split('\t');
  if (tip) meta.set(tip, { occurrences: Number(occ), country, trait: Number(trait) });
}

// ---------------------------------------------------------------- columns

const occurrences: Record<string, number> = {};
const traits: Record<string, number> = {};
for (const [tip, m] of meta) {
  occurrences[tip] = m.occurrences;
  traits[tip] = m.trait;
}

/** A custom column: a heat strip of the trait value. prepare() turns the values into an array by tip rank and a colour index per tip,
 *  once; draw() paints the visible rows, or one sample per pixel row when rows are thinner than a pixel. */
const HEAT = Array.from({ length: 32 }, (_, k) => `hsl(${220 - (k / 31) * 190} 70% ${40 + (k / 31) * 15}%)`);
const heat: ColumnRenderer<number, Int8Array> = {
  prepare({ values, tipLabels }) {
    let lo = Infinity,
      hi = -Infinity;
    for (const l of tipLabels) {
      const v = values[l];
      if (v !== undefined) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
    }
    return Int8Array.from(tipLabels, (l) => {
      const v = values[l];
      return v === undefined ? -1 : Math.round(((v - lo) / (hi - lo || 1)) * 31);
    });
  },
  draw(ctx, f, data) {
    const step = f.rowHeight >= 1 ? 1 : Math.ceil(1 / f.rowHeight); // rows per pixel row
    const h = Math.max(1, f.rowHeight >= 4 ? f.rowHeight - 1 : f.rowHeight * step);
    for (let r = f.r0; r <= f.r1; r += step) {
      const k = data[r];
      if (k < 0) continue;
      ctx.fillStyle = HEAT[k];
      ctx.fillRect(f.x, f.oy + r * f.rowHeight, f.width, h);
    }
  },
};

const columns: Column[] = [
  { id: 'occ', kind: 'bar', header: 'Occurrences', width: 90, values: occurrences },
  { id: 'trait', kind: 'custom', header: 'Trait', width: 40, values: traits, renderer: heat },
];

// ---------------------------------------------------------------- a control of our own

/** 'N of M tips in view' in a corner, from the viewchange event (rectangular layout: rows are tips). */
class TipsInView extends BaseControl {
  constructor() {
    super('in-view', { position: 'top-right' });
    this.element.setAttribute('aria-live', 'polite');
  }
  protected attach(v: TreeViewer): void {
    const total = v.getTree().tipCount;
    const update = () => {
      const { y0, y1 } = v.getViewport();
      const n = v.options.layout === 'rectangular' ? Math.max(0, Math.min(total, Math.ceil(y1)) - Math.max(0, Math.floor(y0))) : total;
      this.element.textContent = `${n.toLocaleString('en')} of ${total.toLocaleString('en')} tips in view`;
    };
    this.listen(v.on('viewchange', update));
    this.listen(v.on('optionschange', update));
    update();
  }
}

// ---------------------------------------------------------------- the viewer

const target = document.getElementById('tree')!;
const cladeLegend = new Legend();
const cornerControls: Control[] = [new Zoom(), new Fit(), new Search({ highlight: true }), cladeLegend, new OverviewControl(), new TipsInView()];
const viewer = new TreeViewer({
  target,
  tree,
  columns,
  controls: [...cornerControls, new LayoutToggle({ target: document.getElementById('layout-slot') })],
  options: { softwareCanvas: new URLSearchParams(location.search).get('cpu') === '1' },
});
viewer.addControl(new Tooltip());

// a popup of our own for tips: an Overlay above the tip, following it while the view moves; it replaces nothing built in, so the
// click's default actions (the node menu) still run for clades
const card = new Overlay({ positioning: 'bottom-center', offset: [0, -14], className: 'tip-card' });
viewer.addControl(card);
function showCard(e: TreeEvent): void {
  const m = meta.get(e.tipId!);
  const h = document.createElement('h3');
  h.textContent = viewer.options.formatLabel(e.tipId!);
  const dl = document.createElement('dl');
  for (const [k, v] of [
    ['Occurrences', m ? m.occurrences.toLocaleString('en') : 'no data'],
    ['Country', String(sidecar.get(e.node, 'country_code') ?? 'no data')],
    ['Trait', m ? m.trait.toFixed(2) : 'no data'],
  ]) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.onclick = () => card.setPosition(null);
  card.element.replaceChildren(h, dl, close);
  card.element.dataset.tipId = e.tipId!;
  card.setPosition({ node: e.node });
}
viewer.on('click', (e) => {
  if (!e.isTip) return;
  e.preventDefault(); // tips get our card, not the menu
  showCard(e);
});

// the built-in node menu for clades, with actions of ours
const palette = viewer.getTheme().categorical;
const COUNTRY_PALETTE = ['#684393', '#5b7ac8', '#c0399c', '#e8845b', '#4aa8d8', '#3e9b6f', '#c9a227', '#8c6d5a']; // eight values, then 'Other'
viewer.addControl(
  new NodeMenu({
    items: (e) =>
      e.isTip
        ? null
        : [
            { id: 'zoom', label: 'Zoom to this clade', onSelect: () => viewer.zoomToNode(e.node, true) },
            {
              id: 'colour',
              label: 'Colour this clade',
              hint: `${e.tipCount.toLocaleString('en')} tips`,
              onSelect: () => {
                const cl = viewer.getClades();
                viewer.setClades([...cl, { node: e.node, colour: palette[cl.length % palette.length], label: `Clade ${e.node}` }]);
              },
            },
            { id: 'clear', label: 'Clear colours', disabled: viewer.getClades().length === 0, onSelect: () => viewer.setClades([]) },
          ],
  }),
);

// colour by a sidecar column: tip colours (setClades), a swatch column and a legend of the values; 'none' puts everything back.
// The legend is not the viewer's control: `by.items` is plain data, drawn here as a list in the page's side panel and styled by the page
const legendSlot = document.getElementById('legend-slot')!;
function showLegend(title: string, items: LegendItem[]): void {
  legendSlot.hidden = items.length === 0;
  legendSlot.querySelector('h2')!.textContent = title;
  legendSlot.querySelector('ul')!.replaceChildren(
    ...items.map((it) => {
      const li = document.createElement('li');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = it.colour;
      li.append(sw, `${it.label} (${it.detail})`);
      return li;
    }),
  );
}
document.getElementById('colour-by')!.addEventListener('change', (ev) => {
  const key = (ev.target as HTMLSelectElement).value;
  if (!key) {
    showLegend('', []);
    viewer.setClades([]);
    viewer.setColumns(columns);
    if (cornerControls.includes(cladeLegend) && document.querySelector<HTMLInputElement>('#show-controls')!.checked) viewer.addControl(cladeLegend);
    return;
  }
  const by = colourBy(tree, sidecar.categories(key), viewer.getTheme(), { palette: COUNTRY_PALETTE, header: 'Country' });
  viewer.removeControl(cladeLegend); // one entry per tip would be a legend of a thousand lines
  showLegend('Country', by.items);
  viewer.setClades(by.clades);
  viewer.setColumns([...columns, by.column]);
});

// ---------------------------------------------------------------- page controls and the event log

document.getElementById('show-controls')!.addEventListener('change', (ev) => {
  const on = (ev.target as HTMLInputElement).checked;
  for (const c of cornerControls) {
    if (on) viewer.addControl(c);
    else viewer.removeControl(c);
  }
});
document.getElementById('dark')!.addEventListener('change', (ev) => {
  document.documentElement.classList.toggle('dark', (ev.target as HTMLInputElement).checked);
  viewer.refreshTheme(); // the viewer re-reads its --phylo-* properties
});

const log = document.getElementById('log')!;
const write = (text: string) => {
  const li = document.createElement('li');
  li.textContent = text;
  log.prepend(li);
  while (log.children.length > 30) log.lastElementChild!.remove();
};
viewer.on('click', (e) => write(`click ${e.isTip ? 'tip ' + e.tipId : `${e.kind} ${e.node} (${e.tipCount} tips)`}`));
viewer.on('optionschange', (e) => write(`options: ${e.changed.join(', ')}`));
viewer.on('cladeschange', (c) => write(`clades: ${c.length}`));
// labels and node ids (the Search highlights the tip it found by node id: labels need not be unique)
viewer.on('highlightchange', (ids) =>
  write(`highlighted: ${ids.map((id) => (typeof id === 'number' ? `${viewer.getTree().labels[id]} (node ${id})` : id)).join(', ') || 'none'}`),
);
viewer.on('themechange', (t) => write(`theme: ${t.dark ? 'dark' : 'light'}`));
let lastView = 0;
viewer.on('viewchange', () => {
  const now = performance.now();
  if (now - lastView > 500) write('view moved');
  lastView = now;
});
viewer.once('ready', (r) => write(`ready: ${r.tips} tips, layout ${r.layoutMs.toFixed(1)} ms`));

// for the browser check (tests/browser/scripts/check-vanilla-example.mjs)
Object.assign(window, { __example: { viewer, card, cornerControls } });
