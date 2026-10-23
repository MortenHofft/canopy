// Throw-away page of the unrooted layout spike (#42): draws unrootedLayout() of one tree on a plain canvas, every branch, no level of
// detail, no interaction. Dev server only (not in the build): http://127.0.0.1:5306/unrooted.html?tree=real-ladder/trees/otl-1k-testudines.nwk.gz
//   ?tree=<path under data/>  ?lengths=0 (unit lengths)  ?labels=1|0 (default: on up to 250 tips)  ?size=<css px, default 760>
// window.__unrooted has the counts and timings and redraw(runs) for the draw timing of bench/unrooted-shots.mjs.

import { parseNewick, parseNexus, type TreeModel } from '@gbif-phylo/io';
import { unrootedLayout, type UnrootedLayout } from '../../../packages/viewer/src/unrooted.ts';

const q = new URLSearchParams(location.search);
const treePath = q.get('tree') ?? 'real-ladder/trees/otl-1k-testudines.nwk.gz';
const lengths = q.get('lengths') !== '0';
const size = Number(q.get('size') ?? 760);
const info = document.getElementById('info')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;
/** CPU canvas under automation (no GPU in headless Chromium), as on the test page. */
const ctx = canvas.getContext('2d', { willReadFrequently: navigator.webdriver === true })!;

async function load(p: string): Promise<TreeModel> {
  const r = await fetch(`/data/${p}`);
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const text =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      : new TextDecoder().decode(bytes);
  return /^\s*#NEXUS/i.test(text) ? parseNexus(text).tree : parseNewick(text);
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function draw(tree: TreeModel, L: UnrootedLayout, labels: boolean): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = canvas.style.height = `${size}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cssVar('--phylo-background');
  ctx.fillRect(0, 0, size, size);
  const font = '10px system-ui, sans-serif';
  ctx.font = font;
  const pad = 8;
  const { X, Y } = L;
  // the extent of the drawing at scale k: the nodes, and with labels each tip's label sticking out along its direction (bisection on k)
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
  const ox = pad + (avail - (x1 - x0)) / 2 - x0;
  const oy = pad + (avail - (y1 - y0)) / 2 - y0;
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
  tree: string;
  tips: number;
  nodes: number;
  usedLengths: boolean;
  parseMs: number;
  layoutMs: number;
  /** Draw `runs` times; median ms per draw, the pixels flushed by a 1-pixel read each time. */
  redraw(runs: number): number;
}

async function main(): Promise<void> {
  let t = performance.now();
  const tree = await load(treePath);
  const parseMs = performance.now() - t;
  const L = unrootedLayout(tree, lengths);
  const labels = q.has('labels') ? q.get('labels') === '1' : tree.tipCount <= 250;
  draw(tree, L, labels);
  const api: SpikeApi = {
    tree: treePath,
    tips: tree.tipCount,
    nodes: tree.nodeCount,
    usedLengths: L.usedLengths,
    parseMs,
    layoutMs: L.layoutMs,
    redraw(runs: number): number {
      const ms: number[] = [];
      for (let r = 0; r < runs; r++) {
        t = performance.now();
        draw(tree, L, labels);
        ctx.getImageData(0, 0, 1, 1);
        ms.push(performance.now() - t);
      }
      ms.sort((a, b) => a - b);
      return ms[Math.floor(ms.length / 2)];
    },
  };
  (window as unknown as { __unrooted: SpikeApi }).__unrooted = api;
  const name = treePath.split('/').pop();
  info.textContent = `${name}: ${tree.tipCount} tips, ${tree.nodeCount} nodes, ${L.usedLengths ? 'branch lengths' : 'unit lengths'}, equal-angle, layout ${L.layoutMs.toFixed(1)} ms`;
}

main().catch((e: unknown) => {
  info.textContent = String(e);
  throw e;
});
