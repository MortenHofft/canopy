// Custom deck.gl layers added through the library's documented `tree.addLayer(id, visiblePredicate, renderLayer)`:
// aligned per-tip columns (bar, text, alignment) and a scale bar. Everything here is OUR code, not the library's.
//
// How it hooks in (verified in methods/render.js and methods/add-layer.js): render() walks `tree.layers`; for a visible layer it
// calls `layer.renderLayer(tree)` once to get a renderer and then `renderer(tree)` on EVERY render, which must return a deck.gl
// layer. We read our own data from `tree.props.gbif` (setProps merges unknown keys untouched), so React drives it with setProps.
//
// Geometry (all in the library's deck world units, y down): tip position (node.x, node.y); screen px = tree.projectPoint(world);
// sizes in px are converted with scale = tree.getScale(); row pitch in px = tree.getStepScale() * scale (rectangular).

import { LineLayer, TextLayer, BitmapLayer } from '@deck.gl/layers';
import type { ColumnSpec } from '../../shared/types.ts';

export const COL_GAP = 6;

/**
 * The library creates its own TextLayers (tip labels, internal labels, block headers) without a characterSet, so deck.gl 8.8 uses
 * its default ASCII 32..128 glyph set: "Ménétries" is drawn as "M n tries" and CJK labels vanish (observed, see docs/results). The
 * layer class is not reachable through any library prop, so this patches deck.gl's TextLayer default for the whole page
 * ('auto' = glyphs taken from the data of each layer). Switch off with ?pc.unicodeLabels=0 to reproduce the library as shipped.
 */
export function patchTextLayerCharset(): boolean {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('pc.unicodeLabels') === '0') return false;
  (TextLayer as any).defaultProps.characterSet = { type: 'object', value: 'auto' };
  return true;
}

export interface ColumnsCtx {
  columns: ColumnSpec[];
  barColour: number[];
  textColour: number[];
  headerColour: number[];
  fontFamily: string;
}

export interface GbifProps {
  columns: ColumnSpec[];
  columnsOn: boolean; // rectangular layout and custom column mode
  barColour: number[];
  textColour: number[];
  headerColour: number[];
  fontFamily: string;
  scaleBar: boolean;
  hasLengths: boolean;
  tipCount: number;
}

const AA: Record<string, string> = {};
for (const c of 'AILMFWVC') AA[c] = '#80a0f0';
for (const c of 'KR') AA[c] = '#f01505';
for (const c of 'ED') AA[c] = '#c048c0';
for (const c of 'NQST') AA[c] = '#15c015';
AA.G = '#f09048';
AA.P = '#c0c000';
for (const c of 'HY') AA[c] = '#15a4a4';
const resColour = (ch: string) => AA[ch.toUpperCase()] ?? '#e2e2e2';

/** Log-scaled bar length in px (same scale as the stub so the runner's rank-correlation check applies). */
export function barPx(v: number, max: number, w: number): number {
  if (!(max > 0) || !(v > 0)) return 1;
  return Math.max(1, (Math.log10(1 + v) / Math.log10(1 + max)) * (w - 4));
}

const maxCache = new WeakMap<ColumnSpec, number>();
export function columnMax(c: ColumnSpec): number {
  let m = maxCache.get(c);
  if (m === undefined) {
    m = 0;
    if (c.kind === 'bar') for (const k in c.values) m = Math.max(m, Number(c.values[k]));
    maxCache.set(c, m);
  }
  return m;
}

/** px offset of column k from the tip's (aligned) anchor: the library's own label/node offset + blockPadding + earlier columns. */
export function columnLeftPx(tree: any, cols: ColumnSpec[], k: number): number {
  let x = tree.getPixelOffsets().length + tree.getBlockPadding();
  for (let i = 0; i < k; i++) x += cols[i].width + COL_GAP;
  return x;
}

/** Total px the columns need, handed to the library as the width of one dummy metadata block so the drawing area leaves room. */
export function columnsTotalPx(cols: ColumnSpec[]): number {
  return cols.reduce((s, c) => s + c.width + COL_GAP, 0);
}

/** World x of a leaf's aligned anchor (library label alignment: x + branchScale * (totalSubtreeLength - distanceFromRoot)). */
export function alignedX(tree: any, graph: any, leaf: any): number {
  return leaf.x + (tree.getAlignLeafLabels() ? tree.getBranchScale() * (graph.root.totalSubtreeLength - leaf.distanceFromRoot) : 0);
}

function visibleLeaves(tree: any, graph: any): any[] {
  const H = tree.getCanvasSize().height;
  const scale = tree.getScale();
  const [, y0] = tree.unprojectPoint([0, -40]);
  const [, y1] = tree.unprojectPoint([0, H + 40]);
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  void scale;
  const out: any[] = [];
  for (const leaf of graph.leaves) if (!leaf.isHidden && leaf.y >= lo && leaf.y <= hi) out.push(leaf);
  return out;
}

const imageCache = new WeakMap<ColumnSpec, HTMLCanvasElement>();
function alignmentImage(c: ColumnSpec, leaves: any[]): HTMLCanvasElement {
  let cv = imageCache.get(c);
  if (cv) return cv;
  let len = 0;
  for (const k in c.values) len = Math.max(len, String(c.values[k]).length);
  cv = document.createElement('canvas');
  cv.width = Math.max(1, len);
  cv.height = Math.max(1, leaves.length);
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.clearRect(0, 0, cv.width, cv.height);
  for (let r = 0; r < leaves.length; r++) {
    const seq = c.values[leaves[r].id];
    if (seq === undefined) continue;
    const s = String(seq);
    let run = 0;
    for (let j = 1; j <= s.length; j++) {
      if (j === s.length || resColour(s[j]) !== resColour(s[run])) {
        ctx.fillStyle = resColour(s[run]);
        ctx.fillRect(run, r, j - run, 1);
        run = j;
      }
    }
  }
  imageCache.set(c, cv);
  return cv;
}

/** Install the custom layers once, right after construction. Visibility and data come from tree.props.gbif. */
export function installCustomLayers(tree: any): void {
  const g = (t: any): GbifProps | undefined => t.props.gbif;

  // ---- one layer per column kind, drawn for visible rows only
  const colLayer = (id: string, kind: ColumnSpec['kind']) => {
    tree.addLayer(
      id,
      (props: any) => !!props.gbif?.columnsOn && props.gbif.columns.some((c: ColumnSpec) => c.kind === kind),
      () => (t: any) => {
        const p = g(t)!;
        const graph = t.getGraphAfterLayout();
        const scale = t.getScale();
        const stepWorld = t.getStepScale();
        const stepPx = stepWorld * scale;
        const cols = p.columns;
        if (kind === 'alignment') {
          const c = cols.find((x) => x.kind === 'alignment')!;
          const k = cols.indexOf(c);
          const all = graph.leaves as any[];
          if (all.length !== p.tipCount || all.length === 0) return new LineLayer({ id, data: [] });
          const first = all[0];
          const last = all[all.length - 1];
          const img = alignmentImage(c, all);
          const wx0 = alignedX(t, graph, first) + columnLeftPx(t, cols, k) / scale;
          const wx1 = wx0 + (c.width - 4) / scale;
          return new BitmapLayer({
            id,
            image: img,
            bounds: [wx0, last.y + stepWorld / 2, wx1, first.y - stepWorld / 2],
            textureParameters: { 10241: 9728, 10240: 9728, 10242: 33071, 10243: 33071 }, // GL.TEXTURE_MIN/MAG_FILTER = NEAREST, WRAP_S/T = CLAMP_TO_EDGE (numeric: luma constants are not a direct dependency)
          } as any);
        }
        const leaves = visibleLeaves(t, graph);
        if (kind === 'bar') {
          const data: { s: number[]; e: number[] }[] = [];
          cols.forEach((c, k) => {
            if (c.kind !== 'bar') return;
            const mx = columnMax(c);
            const left = columnLeftPx(t, cols, k);
            for (const leaf of leaves) {
              const v = c.values[leaf.id];
              if (v === undefined) continue;
              const x0 = alignedX(t, graph, leaf) + left / scale;
              data.push({ s: [x0, leaf.y], e: [x0 + barPx(Number(v), mx, c.width) / scale, leaf.y] });
            }
          });
          return new LineLayer({
            id,
            data,
            getSourcePosition: (d: any) => d.s,
            getTargetPosition: (d: any) => d.e,
            getColor: p.barColour as any,
            getWidth: Math.max(1, stepPx * 0.8),
            widthUnits: 'pixels',
            updateTriggers: { getWidth: stepPx },
          } as any);
        }
        // text: values as text when rows are tall enough, otherwise a thin band so that something marks the column
        const data: { pos: number[]; text: string; off: number }[] = [];
        const bands: { s: number[]; e: number[] }[] = [];
        cols.forEach((c, k) => {
          if (c.kind !== 'text') return;
          const left = columnLeftPx(t, cols, k);
          for (const leaf of leaves) {
            const v = c.values[leaf.id];
            if (v === undefined) continue;
            const x0 = alignedX(t, graph, leaf) + left / scale;
            if (stepPx >= 8) data.push({ pos: [x0, leaf.y], text: String(v), off: 2 });
            else bands.push({ s: [x0, leaf.y], e: [x0 + (c.width - 4) / scale, leaf.y] });
          }
        });
        return new TextLayer({
          id,
          data: stepPx >= 8 ? data : [],
          getPosition: (d: any) => d.pos,
          getText: (d: any) => d.text,
          getSize: Math.min(13, stepPx * 0.7),
          getColor: p.textColour as any,
          getTextAnchor: 'start',
          getAlignmentBaseline: 'center',
          getPixelOffset: [2, 0],
          fontFamily: p.fontFamily,
          characterSet: 'auto',
          maxWidth: undefined,
          updateTriggers: { getSize: stepPx },
        } as any);
      },
    );
  };
  colLayer('gbif-col-bars', 'bar');
  colLayer('gbif-col-text', 'text');
  colLayer('gbif-col-alignment', 'alignment');

  // ---- column headers (horizontal text above the first row)
  tree.addLayer(
    'gbif-col-headers',
    (props: any) => !!props.gbif?.columnsOn && props.gbif.columns.length > 0,
    () => (t: any) => {
      const p = g(t)!;
      const graph = t.getGraphAfterLayout();
      const scale = t.getScale();
      const first = graph.leaves[0];
      const stepWorld = t.getStepScale();
      const data = p.columns.map((c, k) => ({
        pos: [alignedX(t, graph, first), first.y - stepWorld / 2],
        text: c.header,
        left: columnLeftPx(t, p.columns, k),
      }));
      void scale;
      return new TextLayer({
        id: 'gbif-col-headers',
        data,
        getPosition: (d: any) => d.pos,
        getText: (d: any) => d.text,
        getSize: 11,
        getColor: p.headerColour as any,
        getTextAnchor: 'start',
        getAlignmentBaseline: 'bottom',
        getPixelOffset: (d: any) => [d.left, -3],
        fontFamily: p.fontFamily,
        characterSet: 'auto',
        fontWeight: 600,
        updateTriggers: { getPixelOffset: JSON.stringify(data.map((d) => d.left)) },
      } as any);
    },
  );

  // ---- scale bar: pixel-sized bar with a "nice" branch length, pinned bottom-left
  const nice = (x: number) => {
    const e = Math.pow(10, Math.floor(Math.log10(x)));
    const m = x / e;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e;
  };
  const scaleBar = (t: any) => {
    const size = t.getCanvasSize();
    const pxPerUnit = t.getBranchScale() * t.getScale();
    const L = nice(110 / pxPerUnit);
    const w = L * pxPerUnit;
    const y = size.height - 18;
    const x0 = 16;
    const P = (px: number, py: number) => t.unprojectPoint([px, py]);
    return { L, w, x0, y, P };
  };
  tree.addLayer(
    'gbif-scale-line',
    (props: any) => !!props.gbif?.scaleBar && !!props.gbif.hasLengths,
    () => (t: any) => {
      const { w, x0, y, P } = scaleBar(t);
      const seg = (a: number[], b: number[]) => ({ s: P(a[0], a[1]), e: P(b[0], b[1]) });
      return new LineLayer({
        id: 'gbif-scale-line',
        data: [seg([x0, y], [x0 + w, y]), seg([x0, y - 4], [x0, y + 4]), seg([x0 + w, y - 4], [x0 + w, y + 4])],
        getSourcePosition: (d: any) => d.s,
        getTargetPosition: (d: any) => d.e,
        getColor: g(t)!.headerColour as any,
        getWidth: 1.5,
        widthUnits: 'pixels',
        updateTriggers: { getSourcePosition: `${x0}:${y}:${w}:${t.getView().target}:${t.getScale()}` },
      } as any);
    },
  );
  tree.addLayer(
    'gbif-scale-text',
    (props: any) => !!props.gbif?.scaleBar && !!props.gbif.hasLengths,
    () => (t: any) => {
      const { L, w, x0, y, P } = scaleBar(t);
      const label = Number(L.toPrecision(2)).toString();
      return new TextLayer({
        id: 'gbif-scale-text',
        data: [{ pos: P(x0 + w / 2, y), text: label }],
        getPosition: (d: any) => d.pos,
        getText: (d: any) => d.text,
        getSize: 11,
        getColor: g(t)!.headerColour as any,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'bottom',
        getPixelOffset: [0, -5],
        fontFamily: g(t)!.fontFamily,
        characterSet: 'auto',
        updateTriggers: { getPosition: `${x0}:${y}:${w}:${t.getView().target}:${t.getScale()}` },
      } as any);
    },
  );
}
