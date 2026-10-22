// The playground: @gbif-phylo/viewer with every option, theme token and built-in control in a side panel, on any tree of the catalogue
// or a file of your own. No framework: TreeViewer, its controls and its events directly. The settings live in src/settings.ts (one
// list drives the panel, the URL and how each value is applied); the URL holds the tree and every setting that differs from the
// library default, so a view can be shared. `npm run dev` in this folder.
//
// Tree operations (@gbif-phylo/tree-ops) are views of the loaded tree, as in examples/react: show only a clade (with Back and Up one
// level), collapse clades into triangles, collapse branches with low support. Collapsing clades is the viewer's (`setCollapsed`, ids of the
// tree it shows). Focus and low support make a new tree from the loaded one; colours, collapsed clades and the focus are kept in node
// ids of the loaded tree and mapped to the shown tree (toShown / toFull) while such a view is on.

import '@gbif-phylo/viewer/viewer.css';
import '../../react/src/gbif-tokens.css';
import './style.css';
import {
  Fit,
  LayoutToggle,
  Legend,
  NodeMenu,
  OverviewControl,
  Search,
  Tooltip,
  TreeViewer,
  Zoom,
  type Alphabet,
  type CladeColour,
  type CladeLabelFn,
  type Column,
  internalName,
  defaultFormatNodeLabel,
  type Control,
  type NodeMenuItem,
  type TreeEvent,
  type TreeTheme,
  type ViewerOptions,
} from '@gbif-phylo/viewer';
import { TreeModel } from '@gbif-phylo/io';
import * as ops from '@gbif-phylo/tree-ops';
import { ENTRIES, GROUPS as TREE_GROUPS, loadEntry, loadFile, type Loaded } from './data.ts';
import { BY_ID, GROUPS, PRESETS, SETTINGS, defaults, fromUrl, toUrl, toViewer, type Setting, type State, type Value } from './settings.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const fmt = (n: number) => n.toLocaleString('en');

// ---------------------------------------------------------------- state

const params = new URLSearchParams(location.search);
let treeId: string | null = params.get('tree') ?? 'rich-fish-carangaria-135';
if (treeId && !ENTRIES[treeId]) treeId = 'rich-fish-carangaria-135';
const state: State = fromUrl(location.search);
let loaded: Loaded | null = null;
let viewer: TreeViewer | null = null;
let clades: CladeColour[] = []; // node ids of the loaded tree
let focus: ops.Focus = ops.NO_FOCUS; // the clade shown alone, with its history (tree-ops' focus)
let collapsed: number[] = []; // clades shown as one triangle (node ids of the loaded tree)
const columnOn = new Map<string, boolean>(); // per loaded tree: which data columns are shown

// the focus stack and the collapsed clades join the settings in the URL (?focus=12,40&collapsed=7,90): node ids of the tree file
const nodeList = (k: string) =>
  (params.get(k) ?? '')
    .split(',')
    .filter((x) => /^\d+$/.test(x))
    .map(Number);
const urlFocus = nodeList('focus');
const urlCollapsed = nodeList('collapsed');
function writeUrl() {
  const q = new URLSearchParams(toUrl(treeId, state));
  if (treeId && focus.stack.length) q.set('focus', focus.stack.join(','));
  if (treeId && collapsed.length) q.set('collapsed', collapsed.join(','));
  const s = q.toString();
  history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
}

// ---------------------------------------------------------------- the view: what is shown of the loaded tree

interface View {
  tree: TreeModel; // what the viewer shows
  toShown: (full: number) => number; // node of the loaded tree -> shown node, -1 when not shown
  toFull: (shown: number) => number;
  collapsedShown: number[]; // the collapsed clades, as nodes of the shown tree
  supportCollapsed: number; // nodes removed by collapse by support
  support: { lo: number; hi: number } | null; // range of the support values of the loaded tree
}
let view: View | null = null;

function supportRange(t: TreeModel): View['support'] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of t.support)
    if (!Number.isNaN(s)) {
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
  return lo <= hi ? { lo, hi } : null;
}

/** Focus, then collapse by support. Collapsed clades are not a step: the viewer collapses them on the shown tree (a clade collapse by
 *  support would contract keeps its node: its support counts as missing for that step). */
function computeView(t: TreeModel): View {
  let shown = t;
  let toView: Int32Array | null = null; // loaded -> shown, composed over the steps
  const step = (r: ops.OpResult) => {
    if (!r.changed) return false;
    toView = toView ? ops.composeMaps(toView, r.map) : r.map;
    shown = new TreeModel(r.tree);
    return true;
  };
  step(ops.showFocus(t, focus));
  const support = supportRange(t);
  let supportCollapsed = 0;
  if (state.supportCollapse && support) {
    const before = shown.nodeCount;
    const threshold = Number(state.minSupport) * (support.hi <= 1 ? 0.01 : 1);
    const keep = collapsed.map((v) => (toView ? (toView as Int32Array)[v] : v)).filter((k) => k > 0);
    const r = ops.collapseBySupport(shown, threshold, { keep }); // a clade the viewer collapses keeps its node
    if (step(r)) supportCollapsed = before - shown.nodeCount;
  }
  const map = toView as Int32Array | null;
  // the shown root is never collapsed; a clade left out of the view (outside the focus) or contracted has no node there
  const collapsedShown = collapsed.map((v) => (map ? map[v] : v)).filter((v) => v > 0);
  if (!map) return { tree: t, toShown: (v) => v, toFull: (v) => v, collapsedShown, supportCollapsed, support };
  const back = ops.invertMap(map, shown.nodeCount);
  return { tree: shown, toShown: (v) => map[v] ?? -1, toFull: (v) => back[v], collapsedShown, supportCollapsed, support };
}

/** The view changed (focus, collapsed clades, support threshold): rebuild it and the viewer when the shown tree is a different one. */
function refreshView() {
  if (!loaded) return;
  const before = view?.tree;
  view = computeView(loaded.tree);
  renderOpsBar();
  if (view.tree !== before) create();
  else apply();
}

// ---------------------------------------------------------------- applying settings to the viewer

const SPACES = (s: string) => s.replace(/_/g, ' ');
const RAW = (s: string) => s;
// Open Tree of Life labels end in their taxon id ('Chelodina_ott235768'); this app shows the names only. The core has no such rule.
const OTL_ID = /_ott\d+$/;
const OTL_NAME = (s: string) => SPACES(s.replace(OTL_ID, ''));
const isOtl = () => loaded?.tree.tipLabels.slice(0, 5).some((l) => OTL_ID.test(l)) === true;
/** OTL's unnamed clades are labelled 'mrcaott99343ott3606205': no name, so the legend counts the tips instead. */
const OTL_SYNTHETIC = /^mrcaott\d+ott\d+$/;
const cladeLabel: CladeLabelFn = (node, t) => {
  const name = internalName(t.labels[t.toLocal(node)]);
  return OTL_SYNTHETIC.test(name) ? null : name;
};
// support as the percentages most viewers show: 0.95 is 95; values above 1 (bootstrap) and lengths are left alone
const PERCENT = (v: number, kind: 'support' | 'length') =>
  kind === 'support' && v <= 1 ? String(Math.round(v * 100)) : defaultFormatNodeLabel(v, kind);
const GBIF_HREF = (id: string) => `https://www.gbif.org/species/search?q=${encodeURIComponent(id.replace(/_/g, ' '))}`;

function viewerOptions(): Partial<ViewerOptions> {
  const o: Record<string, unknown> = {};
  for (const s of SETTINGS) if (s.to === 'option') o[s.key ?? s.id] = toViewer(s, state[s.id]);
  o.formatLabel = state.underscores ? (isOtl() ? OTL_NAME : SPACES) : RAW;
  o.cladeLabel = cladeLabel;
  o.formatNodeLabel = state.supportPercent ? PERCENT : defaultFormatNodeLabel;
  o.tipHref = state.tipLinks ? GBIF_HREF : null;
  return o as Partial<ViewerOptions>;
}

function themeOverrides(): Partial<TreeTheme> {
  const t: Record<string, unknown> = {};
  for (const s of SETTINGS) if (s.to === 'theme' && state[s.id] !== '') t[s.key ?? s.id] = state[s.id]; // '' = not set (residue colours)
  if (state.transparent) t.background = 'transparent';
  return t as Partial<TreeTheme>;
}

// controls are re-created when their switches change (a control has no options to update in place here)
let controls: Control[] = [];
let controlsKey = '';
function makeControls(): Control[] {
  const on = (id: string) => state[id] === true;
  const out: Control[] = [];
  if (on('zoom')) out.push(new Zoom());
  if (on('fit')) out.push(new Fit());
  if (on('layoutToggle')) out.push(new LayoutToggle());
  if (on('search')) out.push(new Search({ highlight: true }));
  if (on('legend')) out.push(new Legend());
  if (on('overview')) out.push(new OverviewControl());
  if (on('tooltip')) out.push(new Tooltip());
  if (state.click === 'menu') out.push(new NodeMenu({ items: menuItems }));
  return out;
}
function applyControls(v: TreeViewer) {
  const key = ['zoom', 'fit', 'layoutToggle', 'search', 'legend', 'overview', 'tooltip'].map((k) => (state[k] ? 1 : 0)).join('') + state.click;
  if (key === controlsKey) return;
  controlsKey = key;
  for (const c of controls) v.removeControl(c);
  controls = makeControls();
  for (const c of controls) v.addControl(c);
}

// columns: per-tip values of the tree's TSV and its alignment, each switchable; `values` objects are kept per tree (by reference)
function columns(): Column[] {
  if (!loaded || !state.columns) return [];
  const out: Column[] = [];
  for (const c of loaded.meta?.columns ?? []) {
    if (!columnOn.get(c.name)) continue;
    out.push(
      c.numeric
        ? { id: 'm:' + c.name, kind: 'bar', header: c.name, width: 90, values: c.values as Record<string, number> }
        : { id: 'm:' + c.name, kind: 'text', header: c.name, width: 120, values: c.values as Record<string, string> },
    );
  }
  if (loaded.fasta && columnOn.get('alignment'))
    out.push({ id: 'alignment', kind: 'alignment', header: 'Alignment', width: 260, values: loaded.fasta, alphabet: state.alphabet as Alphabet });
  return out;
}

function highlightedTips(): string[] {
  const q = String(state.find).trim().toLowerCase();
  if (!q || !loaded) return [];
  const out: string[] = [];
  for (const l of (view?.tree ?? loaded.tree).tipLabels) if (l.toLowerCase().includes(q) && out.push(l) >= 20000) break;
  return out;
}

/** Bring the viewer in line with the state. Every setter is a no-op for unchanged input, so this runs after any change. */
function apply() {
  const v = viewer;
  if (!v) return;
  v.setOptions(viewerOptions());
  v.setTheme(themeOverrides());
  applyControls(v);
  v.setColumns(columns());
  v.setHighlighted(highlightedTips());
  const vw = view;
  v.setClades(
    vw
      ? clades.flatMap((c) => {
          const k = vw.toShown(c.node);
          return k >= 0 ? [{ ...c, node: k }] : [];
        })
      : clades,
  );
  v.setCollapsed(vw?.collapsedShown ?? []);
  $('.tree-card').classList.toggle('dotted', state.transparent === true);
  writeUrl();
}

// ---------------------------------------------------------------- tree operations

const tipsOf = (full: number) => loaded!.tree.tipCountOf(full);
function showOnly(full: number) {
  focus = ops.focusOn(loaded!.tree, focus, full);
  log('show', `only a clade of ${fmt(tipsOf(full))} tips`);
  refreshView();
}
function goUp() {
  focus = ops.focusUp(loaded!.tree, focus);
  log('show', ops.canGoUp(focus) ? `up to a clade of ${fmt(tipsOf(ops.focusedNode(focus)))} tips` : 'the whole tree');
  refreshView();
}
function goBack() {
  focus = ops.focusBack(focus);
  log('show', 'back');
  refreshView();
}
function setCollapsed(full: number, on: boolean) {
  collapsed = on ? [...collapsed.filter((c) => c !== full), full] : collapsed.filter((c) => c !== full);
  log(on ? 'collapse' : 'expand', `a clade of ${fmt(tipsOf(full))} tips`);
  refreshView();
}
function expandAll() {
  collapsed = [];
  log('expand', 'all');
  refreshView();
}

/** The bar above the tree: Back, Up one level, Expand all, and what is shown. */
function renderOpsBar() {
  const t = loaded?.tree;
  const vw = view;
  if (!t || !vw) return;
  $<HTMLButtonElement>('#ops-back').disabled = !ops.canGoBack(focus);
  $<HTMLButtonElement>('#ops-up').disabled = !ops.canGoUp(focus);
  const shownCollapsed = vw.collapsedShown.length;
  const expand = $<HTMLButtonElement>('#ops-expand');
  expand.disabled = collapsed.length === 0;
  expand.textContent = collapsed.length ? `Expand all (${collapsed.length})` : 'Expand all';
  const f = ops.focusedNode(focus);
  const parts = [f < 0 ? `the whole tree, ${fmt(t.tipCount)} tips` : `a clade of ${fmt(t.tipCountOf(f))} of ${fmt(t.tipCount)} tips`];
  if (shownCollapsed) parts.push(`${shownCollapsed} collapsed`);
  if (vw.supportCollapsed) parts.push(`${fmt(vw.supportCollapsed)} branches with low support collapsed`);
  $('#ops-status').textContent = 'Showing ' + parts.join(' · ');
  // collapse by support needs support values; say what scale this tree uses (0.95 versus 95)
  const note = $('#support-note');
  inputs.get('supportCollapse')!.disabled = !vw.support;
  note.textContent = vw.support
    ? `Support in this tree: ${vw.support.lo} to ${vw.support.hi}${vw.support.hi <= 1 ? ' (compared with the value / 100)' : ''}.`
    : 'This tree has no support values.';
  writeUrl();
}

// ---------------------------------------------------------------- clicks: the node menu, or a direct action

const palette = () => viewer?.getTheme().categorical ?? ['#684393'];
/** Colour a clade or tip (a node of the loaded tree), or remove its colour. */
function toggleColour(node: number) {
  const has = clades.some((c) => c.node === node);
  // no label: the legend names the clade itself (its node name through formatLabel, or 'Clade of N tips')
  clades = has ? clades.filter((c) => c.node !== node) : [...clades, { node, colour: palette()[clades.length % palette().length] }];
  apply();
}

/** What a click hit, in node ids of the loaded tree: `full`, and whether it is a collapsed clade. */
function target(e: TreeEvent) {
  const full = view ? view.toFull(e.node) : e.node;
  return { full, isCollapsed: e.collapsed, isClade: !e.isTip, isShownRoot: e.node === 0 };
}

function menuItems(e: TreeEvent): NodeMenuItem[] {
  if (e.run)
    return [{ id: 'zoom', label: 'Zoom in here', hint: `${fmt(e.tipCount)} tips in small clades`, onSelect: () => viewer?.zoomToNode(e.node, true) }];
  const { full, isCollapsed, isClade, isShownRoot } = target(e);
  const tips = loaded!.tree.tipCountOf(full);
  const items: NodeMenuItem[] = [];
  // the root of a clade shown alone leads out of it
  if (isShownRoot && ops.canGoUp(focus)) {
    items.push({ id: 'up', label: 'Up one level', hint: 'show the clade that contains this one', onSelect: goUp });
    items.push({ id: 'back', label: 'Back', hint: 'to the view before', onSelect: goBack });
  }
  if (isCollapsed) items.push({ id: 'expand', label: 'Expand', hint: `show its ${fmt(tips)} tips again`, onSelect: () => setCollapsed(full, false) });
  if (!e.isTip)
    items.push({ id: 'zoom', label: 'Zoom to this clade', hint: `${fmt(e.tipCount)} tips`, onSelect: () => viewer?.zoomToNode(e.node, true) });
  if (isClade && !isShownRoot)
    items.push({ id: 'show', label: 'Show only this clade', hint: `${fmt(tips)} tips; Back or Up one level return`, onSelect: () => showOnly(full) });
  if (!e.isTip && !isCollapsed && !isShownRoot)
    items.push({ id: 'collapse', label: 'Collapse', hint: `show its ${fmt(tips)} tips as one triangle`, onSelect: () => setCollapsed(full, true) });
  const coloured = clades.some((c) => c.node === full);
  items.push({ id: 'colour', label: coloured ? 'Remove colour' : 'Colour this ' + (isClade ? 'clade' : 'tip'), onSelect: () => toggleColour(full) });
  items.push({
    id: 'hl',
    label: 'Highlight ' + (e.isTip ? 'this tip' : 'its tips'),
    onSelect: () => viewer?.setHighlighted(e.tipIds().slice(0, 20000)),
  });
  if (e.isTip && e.tipId)
    items.push({ id: 'gbif', label: 'Search GBIF for this name', onSelect: () => window.open(GBIF_HREF(e.tipId!), '_blank', 'noopener') });
  return items;
}

/** The direct click actions (the panel's "Click on a tip or clade"; 'menu' is the NodeMenu control). */
function clickAction(e: TreeEvent) {
  if (e.run) return;
  const { full, isCollapsed, isClade, isShownRoot } = target(e);
  if (state.click === 'colour') toggleColour(full);
  else if (state.click === 'zoom' && !e.isTip) viewer?.zoomToNode(e.node, true);
  else if (state.click === 'focus' && isClade && !isShownRoot) showOnly(full);
  else if (state.click === 'collapse') {
    if (isCollapsed) setCollapsed(full, false);
    else if (!e.isTip && !isShownRoot) setCollapsed(full, true);
  }
}

// ---------------------------------------------------------------- the viewer

function create() {
  viewer?.destroy();
  controls = [];
  controlsKey = '';
  if (!loaded) return;
  const host = $('#tree');
  const t0 = performance.now();
  const v = new TreeViewer({ target: host, tree: view?.tree ?? loaded.tree, options: viewerOptions(), theme: themeOverrides(), columns: columns() });
  viewer = v;
  // for the browser check and for poking at it from the console
  (window as unknown as { viewer: TreeViewer }).viewer = v;
  v.on('click', (e) => {
    log('click', e.isTip ? `tip ${e.tipId}` : `${e.kind} n${e.node} · ${fmt(e.tipCount)} tips`);
    clickAction(e);
  });
  v.on('hover', (e) => {
    $('#hover').textContent = e ? (e.isTip ? (e.tipId ?? '') : `${e.kind} · ${fmt(e.tipCount)} tips`) : '';
  });
  v.on('ready', (r) =>
    log('ready', `layout ${r.layoutMs.toFixed(1)} ms · ${fmt(r.tips)} tips · ${(performance.now() - t0).toFixed(0)} ms to first frame`),
  );
  v.on('optionschange', ({ changed }) => {
    // a control (the layout toggle) may change options itself: follow it in the panel
    let any = false;
    for (const k of changed) {
      const s = BY_ID.get(k);
      if (s?.to !== 'option' || s.kind === 'range') continue;
      const now = (v.options as unknown as Record<string, unknown>)[k];
      const val: Value = s.kind === 'toggle' ? Boolean(now) : now === null ? 'fit' : String(now);
      if (val !== state[k]) {
        state[k] = val;
        any = true;
      }
    }
    if (any) {
      syncInputs();
      writeUrl();
    }
    log('options', changed.join(', '));
  });
  v.on('themechange', () => log('theme', 'changed'));
  v.on('cladeschange', (c) => log('clades', `${c.length} coloured`));
  v.on('highlightchange', (h) => log('highlight', `${fmt(h.length)} tips`));
  v.on('frame', scheduleReadout);
  apply();
}

// ---------------------------------------------------------------- readout and event log

let readoutPending = false;
function scheduleReadout() {
  if (readoutPending) return;
  readoutPending = true;
  requestAnimationFrame(() => {
    readoutPending = false;
    const v = viewer;
    if (!v) return;
    const s = v.getStats();
    $('#readout').textContent =
      `frame ${s.frameMs.toFixed(1)} ms (avg ${s.avgFrameMs.toFixed(1)}, max ${s.maxFrameMs.toFixed(1)}) · ` +
      `${fmt(s.drawn)} drawn of ${fmt(s.budget)} · ${fmt(s.tips)} tips · ${fmt(s.labels)} labels · ${fmt(s.summaries)} collapsed` +
      (s.budgetHit ? ' · budget raised the threshold' : '') +
      (s.reduced ? ' · reduced (interacting)' : '');
  });
}

const events: string[] = [];
function log(type: string, text: string) {
  events.unshift(`${new Date().toLocaleTimeString('en-GB')}  ${type.padEnd(9)} ${text}`);
  events.length = Math.min(events.length, 60);
  $('#log').textContent = events.join('\n');
}

// ---------------------------------------------------------------- the panel

const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();

function control(s: Setting): HTMLElement {
  const row = document.createElement('label');
  row.className = 'setting setting--' + s.kind;
  if (s.hint) row.title = s.hint;
  const name = document.createElement('span');
  name.className = 'setting-name';
  name.textContent = s.label;
  let input: HTMLInputElement | HTMLSelectElement;
  if (s.kind === 'select') {
    input = document.createElement('select');
    for (const [v, l] of s.options) input.append(new Option(l, v));
  } else {
    input = document.createElement('input');
    input.type = s.kind === 'toggle' ? 'checkbox' : s.kind === 'colour' ? 'color' : s.kind === 'range' ? 'range' : 'search';
    if (s.kind === 'range') Object.assign(input, { min: String(s.min), max: String(s.max), step: String(s.step) });
    if (s.kind === 'text' && s.placeholder) input.placeholder = s.placeholder;
  }
  input.name = s.id;
  input.dataset.setting = s.id;
  const val = document.createElement('output');
  input.addEventListener(s.kind === 'select' || s.kind === 'toggle' ? 'change' : 'input', () => {
    const before = state[s.id];
    state[s.id] = s.kind === 'toggle' ? (input as HTMLInputElement).checked : s.kind === 'range' ? Number(input.value) : input.value;
    if (s.id === 'preset') applyPreset(String(state.preset));
    syncInputs();
    if (s.rebuild && before !== state[s.id]) create();
    else if (s.group === 'Tree operations') refreshView();
    else apply();
  });
  inputs.set(s.id, input);
  if (s.kind === 'toggle') row.append(input, name);
  else row.append(name, input);
  if (s.kind === 'range') row.append(val);
  return row;
}

function applyPreset(name: string) {
  const p = PRESETS[name] ?? {};
  for (const s of SETTINGS) if (s.group === 'Theme' && s.id !== 'preset') state[s.id] = p[s.id] ?? s.default;
}

function syncInputs() {
  for (const s of SETTINGS) {
    const input = inputs.get(s.id)!;
    const v = state[s.id];
    if (s.kind === 'toggle') (input as HTMLInputElement).checked = v === true;
    else if (input.value !== String(v)) input.value = String(v);
    const out = input.parentElement!.querySelector('output');
    if (out) out.textContent = String(v);
    input.closest('.setting')!.classList.toggle('changed', v !== s.default);
  }
  // the background colour means nothing while the background is transparent
  inputs.get('background')!.disabled = state.transparent === true;
}

function buildPanel() {
  const panel = $('#settings');
  for (const g of GROUPS) {
    const box = document.createElement('details');
    box.className = 'group';
    box.open = g !== 'Level of detail';
    const sum = document.createElement('summary');
    sum.textContent = g;
    box.append(sum);
    for (const s of SETTINGS) if (s.group === g) box.append(control(s));
    if (g === 'Tree operations') {
      const note = document.createElement('p');
      note.id = 'support-note';
      note.className = 'muted';
      const how = document.createElement('p');
      how.className = 'muted';
      how.textContent =
        'Show only a clade and collapse or expand one from the node menu (or set the click action below). Back, Up one level and Expand all are above the tree.';
      box.append(note, how);
    }
    if (g === 'Data and interaction') {
      const cols = document.createElement('div');
      cols.id = 'data-columns';
      box.append(cols);
    }
    panel.append(box);
  }
  syncInputs();
}

/** The per-tree list of data columns (TSV fields and the alignment), each with a switch. */
function buildColumnSwitches() {
  const box = $('#data-columns');
  box.replaceChildren();
  columnOn.clear();
  if (!loaded) return;
  const avail: { id: string; label: string; on: boolean }[] = [];
  const meta = loaded.meta;
  if (meta) {
    const numeric = meta.columns.filter((c) => c.numeric && !/key|id$/i.test(c.name));
    const text = meta.columns.filter((c) => !c.numeric && new Set(Object.values(c.values)).size <= 12);
    for (const c of meta.columns)
      avail.push({ id: c.name, label: `${c.name} (${c.numeric ? 'bar' : 'text'})`, on: c === numeric[0] || c === text[0] });
  }
  if (loaded.fasta) avail.push({ id: 'alignment', label: 'alignment', on: true });
  if (!avail.length) {
    box.innerHTML = '<p class="muted">This tree has no per-tip data.</p>';
    return;
  }
  const t = loaded.tree;
  const matched = (vals: Record<string, unknown>) => t.tipLabels.reduce((n, l) => n + (l in vals ? 1 : 0), 0);
  const note = document.createElement('p');
  note.className = 'muted';
  const first = meta?.columns[0]?.values ?? loaded.fasta ?? {};
  note.textContent = `${fmt(matched(first))} of ${fmt(t.tipCount)} tips have data; the others show an empty cell.`;
  box.append(note);
  for (const a of avail) {
    columnOn.set(a.id, a.on);
    const row = document.createElement('label');
    row.className = 'setting setting--toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = a.on;
    cb.dataset.column = a.id;
    cb.addEventListener('change', () => {
      columnOn.set(a.id, cb.checked);
      apply();
    });
    const name = document.createElement('span');
    name.className = 'setting-name';
    name.textContent = a.label;
    row.append(cb, name);
    box.append(row);
  }
}

// ---------------------------------------------------------------- trees

function buildTreePicker() {
  const sel = $<HTMLSelectElement>('#tree-select');
  for (const [group, entries] of Object.entries(TREE_GROUPS)) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const [id, e] of Object.entries(entries)) og.append(new Option(e.label, id));
    sel.append(og);
  }
  const own = document.createElement('optgroup');
  own.label = 'your own';
  own.append(new Option('A file from your computer…', '__file'));
  sel.append(own);
  sel.value = treeId ?? '__file';
  sel.addEventListener('change', () => {
    if (sel.value === '__file') return $<HTMLInputElement>('#tree-file').click();
    treeId = sel.value;
    void show(loadEntry(sel.value), ENTRIES[sel.value].label);
  });
  $<HTMLInputElement>('#tree-file').addEventListener('change', (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    treeId = null; // a local file cannot go in the URL
    sel.value = '__file';
    void show(loadFile(f), f.name);
  });
}

async function show(p: Promise<Loaded>, name: string) {
  const info = $('#tree-info');
  info.textContent = `loading ${name}…`;
  info.classList.remove('error');
  try {
    loaded = await p;
  } catch (err) {
    info.textContent = `${name}: ${(err as Error).message}`;
    info.classList.add('error');
    return;
  }
  clades = [];
  const t = loaded.tree;
  // the focus and collapsed clades of the URL belong to the tree it was opened with; any other tree starts whole
  const fromUrlTree = treeId !== null && treeId === firstTree && !urlUsed;
  urlUsed = true;
  const internal = (v: number) => v > 0 && v < t.nodeCount && t.childCount[v] > 0;
  focus = fromUrlTree && urlFocus.every(internal) ? { stack: urlFocus } : ops.NO_FOCUS;
  collapsed = fromUrlTree ? urlCollapsed.filter(internal) : [];
  view = computeView(t);
  renderOpsBar();
  info.textContent =
    `${fmt(t.tipCount)} tips · ${fmt(t.nodeCount)} nodes · ${t.hasLengths ? (t.isUltrametric(1e-3) ? 'dated (ultrametric)' : 'branch lengths') : 'no branch lengths'}` +
    ` · ${(loaded.bytes / 1024).toFixed(0)} KB · parsed in ${loaded.parseMs.toFixed(0)} ms`;
  buildColumnSwitches();
  create();
  log('tree', name);
}

// ---------------------------------------------------------------- page

const firstTree = treeId;
let urlUsed = false;
$('#ops-back').addEventListener('click', goBack);
$('#ops-up').addEventListener('click', goUp);
$('#ops-expand').addEventListener('click', expandAll);

buildTreePicker();
buildPanel();
$('#reset').addEventListener('click', () => {
  Object.assign(state, defaults());
  clades = [];
  focus = ops.NO_FOCUS;
  collapsed = [];
  syncInputs();
  refreshView();
});
$('#copy-link').addEventListener('click', async () => {
  writeUrl();
  await navigator.clipboard?.writeText(location.href).catch(() => {});
  $('#copy-link').textContent = 'Link copied';
  setTimeout(() => ($('#copy-link').textContent = 'Copy link'), 1500);
});
$('#bench').addEventListener('click', () => {
  const b = viewer?.benchmark(30);
  if (b)
    log('bench', `30 frames: mean ${b.meanMs.toFixed(2)} ms (cut ${b.cutMs.toFixed(2)}, draw ${b.drawMs.toFixed(2)}), max ${b.maxMs.toFixed(2)}`);
});
$('#fit-now').addEventListener('click', () => viewer?.fit(true));
if (treeId) void show(loadEntry(treeId), ENTRIES[treeId].label);
