// Page of the unrooted layout spike (#42): draws unrootedLayout() of one tree on a plain canvas, every branch, no level of detail, no zoom
// or pan. unrootedLayout is not exported by @canopy/viewer, so it is imported from the viewer's source by relative path (see the
// README: a spike exception to "examples use the public API only").
//   ?tree=<id in src/trees.json or the catalogue, or a path under data/>  ?lengths=0 (unit lengths)  ?labels=1|0 (default: on up to
//   250 tips)  ?size=<css px, default: the window's width up to 760>  ?limit=<nodes, 0: none; default NODE_LIMIT>
// The picker has this page's trees, then the catalogue the playground uses (examples/shared) and a file of your own; a tree above
// NODE_LIMIT is not drawn.
// window.__unrooted has the counts and timings of the tree shown and redraw(runs) for the draw timing of
// tests/browser/bench/unrooted-shots.mjs.

import '../../react/src/gbif-tokens.css';
import '@canopy/viewer/gbif.css';
import './style.css';
import type { TreeModel } from '@canopy/io';
import { fetchText, loadTreeFile, parseTree, withCatalogue } from '../../shared/data.ts';
import { treePicker, type PickerItem } from '../../shared/picker.ts';
import { unrootedLayout, type UnrootedLayout } from '../../../packages/viewer/src/unrooted.ts';
import own from './trees.json';

interface Entry {
  label: string;
  path: string; // under data/
  format: 'newick' | 'nexus';
  remote?: string;
  nodes?: number;
}

/** The most nodes this page draws. It draws every branch with no level of detail, and the layout, the fit and every redraw are linear in
 *  the nodes. Measured in docs/design/unrooted.md (headless Chromium, CPU canvas): a redraw takes about 5 ms at 14,874 and 20,243 nodes
 *  (the 10k-tip Open Tree and GTDB trees) and 52 to 56 ms at 199,999 nodes. 25,000 nodes is about 7 ms by that rate, well inside a frame,
 *  and keeps every 10k-tip tree of the catalogue in; above it a redraw starts to be felt, and the 1.5M and 2.4M-tip trees would take
 *  seconds and hundreds of MB. Not the 2,000 the design note proposes for the viewer's layout: that limit is for readability. */
const NODE_LIMIT = 25_000;
const q = new URLSearchParams(location.search);
const fmt = (n: number) => n.toLocaleString('en');
/** ?limit= (0: none), for the timings of tests/browser/bench/unrooted-shots.mjs, which draws a 200k-node tree. */
const limit = limitOf(q.get('limit'));

function limitOf(v: string | null): number {
  const n = Number(v);
  if (v === null || v.trim() === '' || !Number.isFinite(n) || n < 0) return NODE_LIMIT; // ?limit= alone is not 0
  return n === 0 ? Infinity : n;
}

/** This page's trees first, then the catalogue's (the same file once); a tree known to be above the limit is listed but disabled. */
const LIST = withCatalogue<Entry>({ 'picked for the spike': own.trees as Record<string, Entry> });
const TREES = LIST.entries as Record<string, Entry>;
const overLimit = (e: Entry) => e.nodes !== undefined && e.nodes > limit;
const PICKER: Record<string, Record<string, PickerItem>> = Object.fromEntries(
  Object.entries(LIST.groups).map(([g, entries]) => [
    g,
    Object.fromEntries(
      Object.entries(entries as Record<string, Entry>).map(([id, e]) => [
        id,
        overLimit(e) ? { label: `${e.label}: ${fmt(e.nodes!)} nodes, over the limit`, disabled: true } : { label: e.label },
      ]),
    ),
  ]),
);
const DEFAULT_TREE = 'gtdb-1k';

const size = Number(q.get('size')) || Math.max(240, Math.min(760, window.innerWidth - 60));
const info = document.getElementById('info')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const select = document.getElementById('tree-select') as HTMLSelectElement;
const fileInput = document.getElementById('tree-file') as HTMLInputElement;
const lengthsBox = document.getElementById('lengths') as HTMLInputElement;
const labelsBox = document.getElementById('labels') as HTMLInputElement;
/** CPU canvas under automation (no GPU in headless Chromium), as on the test page. */
const ctx = canvas.getContext('2d', { willReadFrequently: navigator.webdriver === true })!;

/** ?tree= is an id of trees.json or the catalogue, or a path under data/ (any tree the dev server has; on the site only the listed ones are copied). */
function entryOf(tree: string): Entry {
  return TREES[tree] ?? { label: tree.split('/').pop()!, path: tree, format: /\.(tre|nex|nexus)$/i.test(tree) ? 'nexus' : 'newick' };
}

const FONT = '10px system-ui, sans-serif';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

interface Fit {
  k: number;
  ox: number;
  oy: number;
}

/** Once per drawing: size the canvas and find the scale and offset that fit the nodes and, with labels, each tip's label sticking out along
 *  its direction (bisection on the scale, measureText per tip). Not part of the timed redraw. */
function fit(tree: TreeModel, L: UnrootedLayout, labels: boolean): Fit {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = canvas.style.height = `${size}px`;
  ctx.font = FONT;
  const pad = 8;
  const { X, Y } = L;
  const T = tree.tipCount;
  const lw = new Float64Array(labels ? T : 0);
  for (let r = 0; r < lw.length; r++) lw[r] = ctx.measureText(tree.tipLabels[r]).width + 3;
  const box = (k: number): [number, number, number, number] => {
    let x0 = L.minX * k,
      x1 = L.maxX * k,
      y0 = L.minY * k,
      y1 = L.maxY * k;
    for (let r = 0; r < lw.length; r++) {
      const i = tree.tipNode[r];
      const a = L.W0[i] + L.unit / 2;
      const x = X[i] * k + Math.cos(a) * lw[r],
        y = Y[i] * k + Math.sin(a) * lw[r];
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    return [x0, x1, y0, y1];
  };
  const avail = size - 2 * pad;
  let lo = 0,
    hi = avail / Math.max(L.maxX - L.minX, L.maxY - L.minY, 1e-12);
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    const [x0, x1, y0, y1] = box(mid);
    if (x1 - x0 <= avail && y1 - y0 <= avail) lo = mid;
    else hi = mid;
  }
  const k = lo;
  const [x0, x1, y0, y1] = box(k);
  return { k, ox: pad + (avail - (x1 - x0)) / 2 - x0, oy: pad + (avail - (y1 - y0)) / 2 - y0 };
}

/** What is timed: clear, stroke every branch as one path, and the labels when on. */
function paint(tree: TreeModel, L: UnrootedLayout, labels: boolean, f: Fit): void {
  const { k, ox, oy } = f;
  const { X, Y } = L;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cssVar('--phylo-background');
  ctx.fillRect(0, 0, size, size);
  ctx.font = FONT;
  const parent = tree.parent;
  ctx.strokeStyle = cssVar('--phylo-branch');
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < L.n; i++) {
    const p = parent[i];
    ctx.moveTo(ox + X[p] * k, oy + Y[p] * k);
    ctx.lineTo(ox + X[i] * k, oy + Y[i] * k);
  }
  ctx.stroke();
  if (!labels) return;
  ctx.fillStyle = cssVar('--phylo-foreground');
  ctx.textBaseline = 'middle';
  for (let r = 0; r < tree.tipCount; r++) {
    const i = tree.tipNode[r];
    const a = L.W0[i] + L.unit / 2; // the tip's own direction
    const flip = Math.cos(a) < 0;
    ctx.save();
    ctx.translate(ox + X[i] * k, oy + Y[i] * k);
    ctx.rotate(flip ? a + Math.PI : a);
    ctx.textAlign = flip ? 'right' : 'left';
    ctx.fillText(tree.tipLabels[r], flip ? -3 : 3, 0);
    ctx.restore();
  }
}

interface SpikeApi {
  /** The tree shown: its ?tree= value (an id of the list or a path under data/), or the name of a file of one's own. */
  tree: string;
  tips: number;
  nodes: number;
  usedLengths: boolean;
  labels: boolean;
  parseMs: number;
  layoutMs: number;
  /** Paint `runs` times; median ms per paint (clear, branches, labels; not the fit or the canvas sizing), the pixels flushed by a
   *  1-pixel read each time. */
  redraw(runs: number): number;
}

// ---------------------------------------------------------------- state (in the URL)

/** The tree of the list (or path under data/) shown; null: a file of one's own (not in the URL). */
const firstTree = LIST.resolve(q.get('tree') ?? DEFAULT_TREE) ?? q.get('tree') ?? DEFAULT_TREE;
let treeId: string | null = firstTree;
/** What window.__unrooted.tree reports: treeId, or the file's name. */
let shown = treeId ?? '';
let lengths = q.get('lengths') !== '0';
/** null: the default for the tree (on up to 250 tips). Set by ?labels= or the checkbox; a new tree goes back to the default. */
let labelsChoice: boolean | null = q.has('labels') ? q.get('labels') === '1' : null;

function writeUrl(): void {
  const u = new URL(location.href);
  const p = u.searchParams;
  if (treeId === null) p.delete('tree');
  else p.set('tree', treeId);
  if (lengths) p.delete('lengths');
  else p.set('lengths', '0');
  if (labelsChoice === null) p.delete('labels');
  else p.set('labels', labelsChoice ? '1' : '0');
  history.replaceState(null, '', u);
}

if (treeId !== null && !TREES[treeId]) select.add(new Option(entryOf(treeId).label, treeId));
treePicker(select, fileInput, PICKER, treeId, {
  onTree(id) {
    pick(id, { id });
  },
  onFile(file) {
    pick(null, { file });
  },
});
lengthsBox.checked = lengths;

function pick(id: string | null, src: Source): void {
  treeId = id;
  labelsChoice = null;
  writeUrl();
  load(src).catch(fail);
}

// ---------------------------------------------------------------- loading and drawing

type Source = { id: string } | { file: File };
let tree: TreeModel | null = null;
let parseMs = 0;
let loads = 0;

async function load(src: Source): Promise<void> {
  const ticket = ++loads;
  const name = 'id' in src ? entryOf(src.id).label : src.file.name;
  const known = 'id' in src ? entryOf(src.id) : null;
  if (known && overLimit(known)) return refuse(name, known.nodes!); // known from the catalogue: not even fetched
  info.textContent = `loading ${name}`;
  const t = performance.now();
  const parsed = await read(src);
  if (ticket !== loads) return; // a later choice won
  if (parsed.nodeCount > limit) return refuse(name, parsed.nodeCount);
  tree = parsed;
  shown = 'id' in src ? src.id : src.file.name;
  parseMs = performance.now() - t;
  draw();
}

async function read(src: Source): Promise<TreeModel> {
  if ('file' in src) return (await loadTreeFile(src.file)).tree;
  const e = entryOf(src.id);
  return parseTree((await fetchText(e.path, e.remote)).text, e.format);
}

/** A tree above the limit: a message instead of the drawing. */
function refuse(name: string, nodes: number): void {
  tree = null;
  canvas.hidden = true;
  (window as unknown as { __unrooted: SpikeApi | null }).__unrooted = null;
  info.classList.add('over-limit');
  info.textContent =
    `${name}: ${fmt(nodes)} nodes, over this page's limit of ${fmt(limit)}. The page draws every branch with no level of detail, ` +
    'so it does not draw larger trees.';
}

function draw(): void {
  if (!tree) return;
  const t = tree;
  canvas.hidden = false;
  info.classList.remove('over-limit');
  const L = unrootedLayout(t, lengths);
  const labels = labelsChoice ?? t.tipCount <= 250;
  labelsBox.checked = labels;
  const f = fit(t, L, labels);
  paint(t, L, labels, f);
  const api: SpikeApi = {
    tree: shown,
    tips: t.tipCount,
    nodes: t.nodeCount,
    usedLengths: L.usedLengths,
    labels,
    parseMs,
    layoutMs: L.layoutMs,
    redraw(runs: number): number {
      const ms: number[] = [];
      for (let r = 0; r < runs; r++) {
        const s = performance.now();
        paint(t, L, labels, f);
        ctx.getImageData(0, 0, 1, 1);
        ms.push(performance.now() - s);
      }
      ms.sort((a, b) => a - b);
      return ms[Math.floor(ms.length / 2)];
    },
  };
  (window as unknown as { __unrooted: SpikeApi }).__unrooted = api;
  const lengthsNote = L.usedLengths ? 'branch lengths' : lengths ? 'unit lengths (the tree has none)' : 'unit lengths';
  info.textContent = `${fmt(t.tipCount)} tips, ${fmt(t.nodeCount)} nodes, ${lengthsNote}, layout ${L.layoutMs.toFixed(1)} ms`;
}

function fail(e: unknown): void {
  info.textContent = String(e);
  throw e;
}

lengthsBox.addEventListener('change', () => {
  lengths = lengthsBox.checked;
  writeUrl();
  draw();
});
labelsBox.addEventListener('change', () => {
  labelsChoice = labelsBox.checked;
  writeUrl();
  draw();
});

document.getElementById('limit-note')!.textContent = Number.isFinite(limit) ? `Trees above ${fmt(limit)} nodes are not drawn.` : '';
load({ id: firstTree }).catch(fail);
