// A table view of a tree, TBrowse-like, built on the public API of @canopy/viewer only: one row per tip at a fixed height, the wheel
// scrolls rows instead of zooming, and the tree is one column among data columns, each with a header and a resize handle. The overview
// strip on the right is the scrollbar.
//
// The split this page shows (issue #50): the viewer is the frame (rows, the tree, the columns it draws, the overview); the columns are
// this page's list of column specs, keyed by tip label, which a data source fills (sources.ts); which columns are shown, in which width,
// is this page's state (kept in the URL), and the viewer is only given the widths and told which columns there are.
//
// What the viewer cannot do yet and how this page works around it is listed in the README, "Gaps": the scroll-only navigation is
// scroll.ts, the header row header.ts.

import '@canopy/viewer/viewer.css';
import '../../shared/gbif-tokens.css';
import '@canopy/viewer/gbif.css';
import './style.css';
import { OverviewControl, Search, TreeViewer, type Column, type TreeEvent } from '@canopy/viewer';
import { COL_GAP, HeaderRow, type HeaderCell } from './header.ts';
import { readHeatColours, TISSUES } from './renderers.ts';
import { RowScroller } from './scroll.ts';
import { DEFAULT_TREE, GROUPS, TREES, loadTable, loadTableFile, resolveTree, type TableData } from './sources.ts';
import { treePicker } from '../../shared/picker.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const fmt = (n: number) => n.toLocaleString('en');
/** The overview strip and its margin (the viewer's OVERVIEW_STRIP_W_PX + 8, not public). */
const OVERVIEW_PX = 64;

// ---------------------------------------------------------------- state (in the URL)

/** One column's configuration: its width in px and whether it is shown. TBrowse calls these "zones". */
interface Zone {
  width?: number;
  visible?: boolean;
}

const params = new URLSearchParams(location.search);
/** The tree of the list shown; null: a file of the user's own (not in the URL). */
const firstTree = resolveTree(params.get('tree') ?? DEFAULT_TREE) ?? DEFAULT_TREE;
let treeId: string | null = firstTree;
let rowHeight = clampInt(params.get('row'), 14, 48, 24);
let fontSize = clampInt(params.get('font'), 9, 18, 12);
/** By column id: 'tree', 'f.<field>' for a field of the Labels column, else the data column's id. `?cols=tree:420,f.species:190,!msa` */
let zones = parseZones(params.get('cols') ?? '');

function clampInt(s: string | null, lo: number, hi: number, dflt: number): number {
  const n = Number(s);
  return s !== null && Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
}

function parseZones(s: string): Map<string, Zone> {
  const m = new Map<string, Zone>();
  for (const part of s.split(',').filter(Boolean)) {
    const hidden = part.startsWith('!');
    const [id, w] = (hidden ? part.slice(1) : part).split(':');
    const width = Number(w);
    m.set(id, { visible: !hidden, ...(w && Number.isFinite(width) && width > 0 ? { width: Math.round(width) } : {}) });
  }
  return m;
}

function writeUrl(): void {
  const p = new URLSearchParams();
  if (treeId !== null && treeId !== DEFAULT_TREE) p.set('tree', treeId);
  if (rowHeight !== 24) p.set('row', String(rowHeight));
  if (fontSize !== 12) p.set('font', String(fontSize));
  const cols = [...zones].map(([id, z]) => `${z.visible === false ? '!' : ''}${id}${z.width ? ':' + z.width : ''}`);
  if (cols.length) p.set('cols', cols.join(','));
  const q = p.toString();
  history.replaceState(null, '', q ? `?${q}` : location.pathname);
}

const zone = (id: string) => zones.get(id) ?? {};
const setZone = (id: string, z: Zone) => zones.set(id, { ...zone(id), ...z });

// ---------------------------------------------------------------- the page

const frame = $('#frame');
const treeEl = $('#tree');
let data: TableData | null = null;
let viewer: TreeViewer | null = null;
let scroller: RowScroller | null = null;
let header: HeaderRow | null = null;
let collapsed: number[] = [];

// a new tree starts from its own fields and columns: the tree and the zones change when it has loaded, so a failed load keeps both
const picker = treePicker($<HTMLSelectElement>('#tree-select'), $<HTMLInputElement>('#tree-file'), GROUPS, treeId, {
  onTree(id) {
    void load(loadTable(id), TREES[id].label, id);
  },
  onFile(file) {
    void load(loadTableFile(file), file.name, null);
  },
});
/** The name of the file shown (treeId null), for the picker after a failed load. */
let fileName = '';

const rowInput = $<HTMLInputElement>('#row-height');
const fontInput = $<HTMLInputElement>('#font-size');
rowInput.value = String(rowHeight);
fontInput.value = String(fontSize);
const showRange = () => {
  $('#row-height-value').textContent = `${rowHeight}px`;
  $('#font-size-value').textContent = `${fontSize}px`;
};
showRange();
rowInput.addEventListener('input', () => {
  rowHeight = Number(rowInput.value);
  showRange();
  keepTop(() => viewer?.setOptions({ rowHeight }));
  writeUrl();
});
fontInput.addEventListener('input', () => {
  fontSize = Number(fontInput.value);
  showRange();
  viewer?.updateTheme({ labelSize: fontSize });
  header?.invalidate();
  writeUrl();
});

/** Run a change that refits the view (rowHeight, treeWidth) and scroll back to the row that was at the top. */
function keepTop(change: () => void): void {
  const top = scroller?.top ?? 0;
  change();
  scroller?.scrollTo(top);
  header?.invalidate();
}

// ---------------------------------------------------------------- columns from the data source and the zones

const fieldsShown = () => (data ? data.fields.filter((f) => zone(`f.${f.id}`).visible ?? f.on) : []);
const columnsShown = () => (data ? data.columns.filter((c) => zone(c.id).visible ?? true) : []);

/** The default widths of the source are for a wide screen: on a narrower one they shrink together, so that the columns leave the tree
 *  area its default share (the viewer does not scroll columns sideways: columns wider than the room left run under the overview). A
 *  width the user set is kept as it is. */
let defaultScale = 1;
const TREE_SHARE = 0.42;
const widthOf = (id: string, dflt: number) => zone(id).width ?? Math.max(24, Math.round(dflt * defaultScale));

function updateDefaultScale(): boolean {
  if (!data) return false;
  const ids = [
    ...fieldsShown()
      .slice(1)
      .map((f) => ({ id: `f.${f.id}`, w: f.width })),
    ...columnsShown().map((c) => ({ id: c.id, w: c.width })),
  ];
  const free = ids.filter((c) => zone(c.id).width === undefined);
  const set = ids.reduce((a, c) => a + (zone(c.id).width ?? 0), 0);
  const room = (frame.clientWidth - OVERVIEW_PX) * (1 - TREE_SHARE) - ids.length * COL_GAP - set;
  const want = free.reduce((a, c) => a + c.w, 0);
  const next = want > 0 ? Math.max(0.3, Math.min(1, room / want)) : 1;
  const changed = Math.abs(next - defaultScale) > 0.01;
  if (changed) defaultScale = next;
  return changed;
}

/** The column specs the viewer gets: the extra fields of the Labels column (text columns), then the data columns, in their widths. */
function columnSpecs(): Column[] {
  const extra = fieldsShown().slice(1);
  return [
    ...extra.map((f): Column => ({ id: `f.${f.id}`, kind: 'text', header: '', width: widthOf(`f.${f.id}`, f.width), values: f.values })),
    ...columnsShown().map((c) => c.spec(widthOf(c.id, c.width))),
  ];
}

function headerCells(): HeaderCell[] {
  if (!data) return [];
  const fields = fieldsShown();
  const cells: HeaderCell[] = [
    { id: 'tree', title: 'Tree', kind: 'tree', width: 0, resizable: false },
    {
      id: 'labels',
      title: fields[0]?.name ?? 'Labels',
      note: `${fields.length}/${data.fields.length} fields`,
      kind: 'labels',
      width: 0,
      resizable: true,
    },
    ...fields
      .slice(1)
      .map((f): HeaderCell => ({ id: `f.${f.id}`, title: f.name, kind: 'field', width: widthOf(`f.${f.id}`, f.width), resizable: true })),
  ];
  for (const c of columnsShown()) {
    const spec = c.spec(0);
    // the heatmap's header names its cells: content of this page in the header slot, as TBrowse's settings button would be
    const parts = c.id === 'expression' ? TISSUES : undefined;
    cells.push({ id: c.id, title: c.name, parts, kind: 'column', bar: spec.kind === 'bar', width: widthOf(c.id, c.width), resizable: true });
  }
  return cells;
}

/** Give the viewer the columns, the label format and the tree width, and the header its cells. */
function applyColumns(): void {
  if (!viewer || !data) return;
  updateDefaultScale();
  const first = fieldsShown()[0];
  const tw = zone('tree').width;
  viewer.setColumns(columnSpecs());
  keepTop(() => viewer!.setOptions({ formatLabel: first ? (tip) => first.values[tip] || tip : undefined, treeWidth: tw ?? `${TREE_SHARE * 100}%` }));
  frame.classList.toggle('table-frame--no-columns', columnSpecs().length === 0);
  header?.setCells(headerCells());
  renderPickers();
}

function onResize(id: string, width: number, done: boolean): void {
  if (!viewer) return;
  if (id === 'labels') {
    const w = Math.max(160, Math.round(width));
    setZone('tree', { width: w });
    keepTop(() => viewer!.setOptions({ treeWidth: w }));
  } else {
    const w = Math.max(24, Math.round(width));
    setZone(id, { width: w });
    viewer.setColumns(columnSpecs());
    header?.setWidth(id, w);
  }
  if (done) writeUrl();
}

/** The field and column pickers (which of the source's fields and columns are shown). */
function renderPickers(): void {
  if (!data) return;
  const fields = fieldsShown();
  $('#fields-count').textContent = `${fields.length}/${data.fields.length}`;
  const fl = $('#fields-list');
  fl.replaceChildren(
    ...data.fields.map((f) =>
      check(`f.${f.id}`, f.name, fields.includes(f), fields.length === 1 && fields[0] === f, (on) => setZone(`f.${f.id}`, { visible: on })),
    ),
  );
  const shown = columnsShown();
  $('#columns-count').textContent = `${shown.length}/${data.columns.length}`;
  $('#columns-list').replaceChildren(
    ...data.columns.map((c) => check(c.id, c.name, shown.includes(c), false, (on) => setZone(c.id, { visible: on }))),
  );
}

function check(id: string, name: string, on: boolean, locked: boolean, set: (on: boolean) => void): HTMLElement {
  const label = document.createElement('label');
  label.className = 'picker__item';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = on;
  box.disabled = locked; // the Labels column keeps one field
  box.dataset.col = id;
  box.addEventListener('change', () => {
    set(box.checked);
    applyColumns();
    writeUrl();
  });
  label.append(box, ` ${name}`);
  return label;
}

// ---------------------------------------------------------------- readouts: hover a node, hover a row, selected

const hoverNode = $('#hover-node');
const hoverRow = $('#hover-row');
const selected = $('#selected');

function describeTip(label: string): string {
  if (!data) return label;
  return fieldsShown()
    .map((f) => f.values[label])
    .filter(Boolean)
    .join(' · ');
}

function describe(e: TreeEvent): string {
  if (e.isTip) return describeTip(e.tipId ?? '');
  const name = viewer?.getTree().labels[e.node];
  return `${e.collapsed ? 'Collapsed clade' : 'Clade'}${name ? ' ' + name.replace(/_/g, ' ') : ''} (${fmt(e.tipCount)} tips)`;
}

/** The tip of the row under a client y, from a cell of the first column in view (the viewer has no row hit test for the columns). */
function rowAt(clientY: number): { label: string } | { clade: number } | null {
  const v = viewer;
  if (!v || !data) return null;
  const L = v.layout;
  const t = v.getTree();
  const ids = columnSpecs()
    .filter((c) => c.kind !== 'bar') // a bar's box is the bar, not the row
    .map((c) => c.id);
  const { y0, y1 } = v.getViewport();
  for (let row = Math.max(0, Math.floor(y0)); row < Math.min(L.rows, Math.ceil(y1)); row++) {
    const rank = L.rankOfRow ? L.rankOfRow[row] : row;
    for (const id of ids) {
      const box = v.columnCell(id, t.tipNode[rank]);
      if (!box) continue;
      const r = row + Math.floor((clientY - box.y) / box.height);
      if (r < 0 || r >= L.rows) return null;
      const node = L.rowNode ? L.rowNode[r] : t.tipNode[r];
      if (L.collapsed?.[node]) return { clade: node };
      return { label: t.tipLabels[L.rankOfRow ? L.rankOfRow[r] : r] };
    }
  }
  return null;
}

frame.addEventListener('pointermove', (e) => {
  const head = header?.element.querySelector<HTMLElement>('.table-head__cell--field, .table-head__cell--column:not([hidden])');
  if (!head || e.clientX < head.getBoundingClientRect().left) return; // the tree reports its own hover
  const hit = rowAt(e.clientY);
  hoverRow.textContent = !hit ? 'Hover a row…' : 'label' in hit ? `Row: ${describeTip(hit.label)}` : `Row: a collapsed clade`;
});
frame.addEventListener('pointerleave', () => (hoverRow.textContent = 'Hover a row…'));

// ---------------------------------------------------------------- load a tree

let loads = 0;

/** Load a table and show it; `id` is the tree of the list (null: a file named `name`), which goes into the URL once it is shown. */
async function load(p: Promise<TableData>, name: string, id: string | null): Promise<void> {
  const ticket = ++loads;
  $('#status').textContent = `Loading ${name}…`;
  let next: TableData;
  try {
    next = await p;
  } catch (err) {
    if (ticket !== loads) return;
    $('#status').textContent = `${name}: ${(err as Error).message}`;
    picker.show(treeId, fileName); // the list names the tree still shown
    return;
  }
  if (ticket !== loads) return; // a later choice won
  if (data) zones = new Map(); // not on the first load, whose zones are the URL's
  treeId = id;
  if (id === null) fileName = name;
  data = next;
  collapsed = [];
  if (!viewer) create();
  else {
    viewer.setColumns([]);
    viewer.setTree(data.tree);
  }
  viewer!.setCollapsed(collapsed);
  applyColumns();
  scroller!.scrollTo(0);
  $('#status').textContent = `${fmt(data.tree.tipCount)} tips · ${name}`;
  writeUrl();
}

function create(): void {
  readHeatColours(frame);
  const v = new TreeViewer({
    target: treeEl,
    tree: data!.tree,
    options: { rowHeight, alignLabels: true, axis: false, treeWidth: `${TREE_SHARE * 100}%`, ariaLabel: 'Tree table' },
    theme: { labelSize: fontSize },
    controls: [new OverviewControl(), new Search({ placeholder: 'Find a tip', target: $('#search-slot') })],
  });
  viewer = v;
  scroller = new RowScroller(v, frame);
  header = new HeaderRow($('#head'), v, { onResize });
  v.on('frame', () => header!.update());
  v.on('resize', () => {
    header!.invalidate();
    if (updateDefaultScale()) applyColumns();
  });
  v.on('themechange', () => {
    header!.invalidate();
    if (readHeatColours(frame)) v.invalidate();
  });
  v.on('hover', (e) => (hoverNode.textContent = e ? `Node: ${describe(e)}` : 'Hover a node…'));
  v.on('selectionchange', ({ node }) => {
    if (node === null) return void (selected.textContent = 'Nothing selected');
    const t = v.getTree();
    const tip = t.firstChild[node] < 0;
    selected.textContent = `Selected: ${tip ? describeTip(t.labels[node]) : `clade of ${fmt(t.leafEnd[node] - t.leafStart[node])} tips`}`;
  });
  // a click on a clade collapses it to one row, a click on a collapsed clade opens it again (the selection follows as usual)
  v.on('click', (e) => {
    if (e.isTip || e.run || (e.kind !== 'node' && !e.collapsed)) return;
    collapsed = collapsed.includes(e.node) ? collapsed.filter((n) => n !== e.node) : [...collapsed, e.node];
    v.setCollapsed(collapsed);
  });
  // for the browser check (tests/browser/scripts/check-table.mjs)
  (window as unknown as { __table: () => TreeViewer | null }).__table = () => viewer;
}

void load(loadTable(firstTree), TREES[firstTree].label, firstTree);
