// TreeRenderer: owns the DOM (canvas, transient canvas, accessible overlay, overview strip), the view state,
// the render loop (requestAnimationFrame on demand: a frame is drawn only when something changed) and the
// pointer / wheel / keyboard controller. No React in here: a React component only forwards props to it.

import { barWidth, cellRect, columnsWidth, compileColumns, COL_GAP, drawColumns, layoutColumns, type CompiledColumn } from './columns.ts';
import { drawAxis, drawBody, drawHighlights, drawLabels, drawMarkers, drawRing, drawScaleBar, LabelList, BRANCH_W, type Scene } from './draw.ts';
import { makeTransform, nodeXY, sectorBBox, viewportEquals, type Area, type Transform } from './geom.ts';
import { HitIndex } from './hit.ts';
import { computeLayout, ensureTrig, type Layout } from './layout.ts';
import { cutRadial, cutRect, searchCut, DrawList, K_NODE, K_STUB, K_SUMMARY, K_TIP, Seen, type CutParams, type CutResult } from './lod.ts';
import { InMemorySource, isTreeSource, type TreeSource } from './source.ts';
import {
  DEFAULT_OPTIONS, FALLBACK_THEME,
  type CladeColour, type Column, type FrameStats, type Hit, type NodeEvent, type RendererCallbacks, type RendererOptions, type TreeData, type TreeSnapshot, type TreeTheme, type Viewport,
} from './types.ts';

const OV_W = 56; // overview strip width (rectangular)
const OV_R = 104; // overview size (radial)
const LABEL_W = 190; // cap of the room right of the tips for labels (rectangular)
const HEAD_H = 24;
const FOOT_H = 36;
const MIN_HEAD = 8;
const MAX_LABEL_NODES = 600;
const THIN_PRIMS = 700; // radial: from this many primitives on, branches are one device pixel wide
const REDUCED_MINPX = 1.6; // collapse threshold factor while interacting (only when the last full frame was heavy)
const HEAVY_PRIMS = 1000;
const DETAIL_PX = 40; // a stub taller than this on screen is opened (partial sources)
const BIG_CLADE_ROWS = 20000; // a stub that costs more rows than this waits until it fills DETAIL_FRAC of the view
const DETAIL_FRAC = 0.33;
const DETAIL_INFLIGHT = 4; // clade requests in flight at once, below the browser's 6 connections per host

const SR_ONLY = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';

interface Anim { from: Viewport; to: Viewport; t0: number; ms: number }

export class TreeRenderer {
  // ------------------------------------------------------------- DOM
  readonly root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private top: HTMLCanvasElement;
  private overlay: HTMLDivElement;
  private ovWrap: HTMLDivElement;
  private ovCanvas: HTMLCanvasElement;
  private ovBox: HTMLDivElement;
  private srList: HTMLUListElement;
  private live: HTMLDivElement;
  private ctx: CanvasRenderingContext2D;
  private topCtx: CanvasRenderingContext2D;
  private ovCtx: CanvasRenderingContext2D;
  private notice: HTMLDivElement;
  private ro: ResizeObserver | null = null;

  // ------------------------------------------------------------- state
  private opts: RendererOptions;
  private theme: TreeTheme;
  private cb: RendererCallbacks;
  private layouts = new Map<boolean, Layout>();
  private L: Layout;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private view: Viewport = { x0: 0, x1: 1, y0: 0, y1: 1 };
  private fitted = true;
  private T!: Transform;
  private area!: Area;
  private columns: CompiledColumn[] = [];
  private classOf: Uint8Array | null = null;
  private colours: string[] = [''];
  private cladeKey = '';
  private clades: CladeColour[] = [];
  private pending = new Map<number, AbortController>(); // clade requests in flight, by node id of the full tree
  private failedDetail = new Set<number>();
  private doneAt = new Map<number, number>(); // node id -> source version at which ensureClade resolved without effect
  private hl: Uint8Array | null = null;
  private hlRanks = new Int32Array(0);
  private list = new DrawList();
  private seen = new Seen();
  private ovList = new DrawList();
  private hit: HitIndex;
  private labels = new LabelList();
  private hoverNode = -1;
  private hoverKind: Hit['kind'] | '' = '';
  private hoverRun = -1; // first member of the hovered run of small siblings, -1 for none (hoverNode is then their parent)
  private activeNode = -1;
  private focusWithin = false;
  private anim: Anim | null = null;
  private raf = 0;
  private dirty = true;
  private ovDirty = true;
  private topDirty = true;
  private srTimer = 0;
  private pendingHover: { x: number; y: number } | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { sx: number; sy: number; v0: Viewport; moved: boolean; id: number } | null = null;
  private pinch: { v0: Viewport; mid: { x: number; y: number }; dx: number; dy: number } | null = null;
  private suppressClick = false;
  private ovDrag = false;
  private destroyed = false;
  private pool = new Map<number, HTMLElement>();
  private poolMode = '';
  private lastKey = '';
  readonly stats: FrameStats = { frameMs: 0, cutMs: 0, drawMs: 0, visited: 0, drawn: 0, summaries: 0, tips: 0, labels: 0, minPxUsed: 0, budgetRetries: 0, budgetHit: false, truncated: false, frames: 0, budget: 0, forced: 0, summaryTips: 0, mergedTips: 0, reduced: false, scale: 1 };
  // interaction-time degradation: wheel, pinch, drag and animation frames are drawn reduced; one full frame follows
  // `refineMs` after the last input. Anything that reads the draw list (click, hover, locate, bounds) settles first.
  private interacting = false;
  private reducedFrame = false;
  private refineTimer = 0;
  private minPxHint = 0;
  private lastFullDrawn = 0;
  private noticeText = '';
  private noticeShown = false;
  private msSum = 0;
  private msN = 0;
  private msMax = 0;
  private onWin: (() => void) | null = null;

  /** The tree as of the last source version we looked at. Re-read through source.snapshot() when the version changes (syncSource),
   *  so a frame always works on one consistent set of arrays. For an in-memory source the version never changes. */
  private tree: TreeSnapshot;
  private source: TreeSource;
  private srcVersion: number;
  private unsubscribe: () => void;

  constructor(private host: HTMLElement, tree: TreeData | TreeSource, cb: RendererCallbacks = {}, opts: Partial<RendererOptions> = {}, theme: TreeTheme = FALLBACK_THEME) {
    this.source = isTreeSource(tree) ? tree : new InMemorySource(tree);
    this.srcVersion = this.source.version;
    this.tree = this.source.snapshot();
    this.unsubscribe = this.source.subscribe(() => { this.syncSource(); this.invalidate(); });
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
    this.theme = theme;
    this.cb = cb;
    this.L = this.layoutFor(this.opts.branchLengths);
    this.hit = new HitIndex(this.tree, this.L);

    const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string): HTMLElementTagNameMap[K] => {
      const el = document.createElement(tag);
      el.style.cssText = css;
      return el;
    };
    const fill = 'position:absolute;left:0;top:0;width:100%;height:100%;';
    this.root = mk('div', 'position:relative;width:100%;height:100%;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none;outline:none;cursor:grab');
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'tree');
    this.root.setAttribute('aria-label', this.opts.ariaLabel);
    this.root.setAttribute('aria-roledescription', 'phylogenetic tree viewer');
    this.root.dataset.treeview = '';
    this.canvas = mk('canvas', fill);
    this.canvas.setAttribute('aria-hidden', 'true');
    this.top = mk('canvas', fill + 'pointer-events:none');
    this.top.setAttribute('aria-hidden', 'true');
    this.overlay = mk('div', fill + 'overflow:hidden;pointer-events:none');
    this.overlay.setAttribute('role', 'group');
    this.overlay.setAttribute('aria-label', 'Tip labels in view');
    this.ovWrap = mk('div', 'position:absolute;overflow:hidden;cursor:pointer;touch-action:none;border-radius:3px;display:none');
    this.ovWrap.setAttribute('aria-hidden', 'true');
    this.ovCanvas = mk('canvas', 'position:absolute;left:0;top:0;width:100%;height:100%');
    this.ovBox = mk('div', 'position:absolute;box-sizing:border-box;pointer-events:none');
    this.ovWrap.append(this.ovCanvas, this.ovBox);
    this.srList = mk('ul', SR_ONLY);
    this.srList.setAttribute('aria-label', 'Visible tips');
    this.live = mk('div', SR_ONLY);
    this.live.setAttribute('aria-live', 'polite');
    this.live.setAttribute('role', 'status');
    this.notice = mk('div', 'position:absolute;left:8px;top:6px;padding:2px 8px;border-radius:10px;font-size:11px;line-height:16px;pointer-events:none;opacity:.85;display:none;white-space:nowrap;max-width:calc(100% - 16px);overflow:hidden;text-overflow:ellipsis');
    this.notice.setAttribute('role', 'status');
    this.root.append(this.canvas, this.top, this.overlay, this.ovWrap, this.notice, this.srList, this.live);
    host.appendChild(this.root);
    const cc = { alpha: false, willReadFrequently: this.opts.softwareCanvas } as CanvasRenderingContext2DSettings;
    this.ctx = this.canvas.getContext('2d', cc)!;
    this.topCtx = this.top.getContext('2d', { willReadFrequently: this.opts.softwareCanvas })!;
    this.ovCtx = this.ovCanvas.getContext('2d', { willReadFrequently: this.opts.softwareCanvas })!;

    this.bind();
    this.measure();
    this.fit(false);
    this.invalidate();
    // web fonts arrive after the first frame
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts) {
      void fonts.ready.then(() => this.invalidate(true));
      fonts.addEventListener?.('loadingdone', this.onFonts);
    }
  }

  private onFonts = () => this.invalidate(true);

  /** Pick up a new snapshot when the source changed (rows arrived or were dropped). Everything derived from the rows is rebuilt:
   *  layouts, hit index, label reserve. Per-node state keyed by row (classOf, activeNode, hover) is reset, ranks (highlights,
   *  columns) stay valid because they are ranks of the full tree. */
  private syncSource(): void {
    const v = this.source.version;
    if (v === this.srcVersion || this.destroyed) return;
    this.srcVersion = v;
    this.tree = this.source.snapshot();
    this.layouts.clear();
    this.L = this.layoutFor(this.opts.branchLengths);
    this.hit = new HitIndex(this.tree, this.L);
    this.applyClades();
    this.activeNode = -1;
    this.hoverNode = -1;
    this.maxChars = -1;
    this.ovDirty = true;
    this.minPxHint = 0;
  }

  /** Row of the snapshot for a node id of the public API (preorder id of the full tree), -1 when that node is not loaded. */
  private rowOf(node: number): number {
    return this.tree.globalId === null ? (node >= 0 && node < this.tree.nodeCount ? node : -1) : this.tree.toLocal(node);
  }

  // ================================================================= public API

  get layout(): Layout {
    return this.L;
  }
  get options(): Readonly<RendererOptions> {
    return this.opts;
  }
  get size(): { width: number; height: number } {
    return { width: this.W, height: this.H };
  }

  setOptions(p: Partial<RendererOptions>): void {
    const o = this.opts;
    const lengthsChanged = p.branchLengths !== undefined && p.branchLengths !== o.branchLengths;
    const layoutChanged = p.layout !== undefined && p.layout !== o.layout;
    const refit = lengthsChanged || layoutChanged || (p.overview !== undefined && p.overview !== o.overview) || (p.axis !== undefined && p.axis !== o.axis) || (p.rowHeight !== undefined && p.rowHeight !== o.rowHeight);
    const tipHrefChanged = p.tipHref !== undefined && p.tipHref !== o.tipHref;
    this.opts = { ...o, ...p };
    if (layoutChanged || lengthsChanged) this.minPxHint = 0;
    if (p.dprCap !== undefined && p.dprCap !== o.dprCap) this.setSize(this.W, this.H);
    if (p.radialMaxNodes !== undefined || p.summaryNotice !== undefined || p.interactionLOD !== undefined) this.minPxHint = 0;
    if (p.ariaLabel) this.root.setAttribute('aria-label', p.ariaLabel);
    if (lengthsChanged) {
      this.L = this.layoutFor(this.opts.branchLengths);
      this.hit.setLayout(this.L);
    }
    if (tipHrefChanged) this.clearPool();
    if (refit) {
      this.activeNode = -1;
      if (this.fitted || layoutChanged || lengthsChanged || p.rowHeight !== undefined) this.fit(false);
    }
    this.ovDirty = true;
    this.invalidate();
  }

  setTheme(t: TreeTheme): void {
    this.theme = t;
    this.ovDirty = true;
    this.clearPool();
    this.invalidate(true);
  }

  setClades(clades: CladeColour[]): void {
    const key = clades.map((c) => c.node + ':' + c.colour).join('|');
    if (key === this.cladeKey) return;
    this.cladeKey = key;
    this.clades = clades;
    this.applyClades();
    this.ovDirty = true;
    this.invalidate();
  }

  /** Colour classes per row from the clade list (node ids of the full tree). Clades that are not part of the snapshot are skipped. */
  private applyClades(): void {
    const clades = this.clades;
    if (!clades.length) {
      this.classOf = null;
      this.colours = [''];
      return;
    }
    const cls = new Uint8Array(this.tree.nodeCount);
    const colours = [''];
    for (const c of clades) {
      const r = this.rowOf(c.node);
      if (r < 0) continue;
      let k = colours.indexOf(c.colour);
      if (k < 0) { k = Math.min(255, colours.push(c.colour) - 1); }
      cls.fill(k, r, this.tree.subtreeEnd[r]);
    }
    this.classOf = cls;
    this.colours = colours;
  }

  setHighlighted(tipIds: string[]): void {
    const N = this.tree.tipCount;
    const ranks: number[] = [];
    for (const id of tipIds) {
      const n = this.tree.tipIndex(id);
      if (n >= 0) ranks.push(this.tree.tipRank[n]);
    }
    ranks.sort((a, b) => a - b);
    const uniq = ranks.filter((r, k) => k === 0 || r !== ranks[k - 1]);
    this.hlRanks = Int32Array.from(uniq);
    if (uniq.length) {
      this.hl = new Uint8Array(N);
      for (const r of uniq) this.hl[r] = 1;
    } else this.hl = null;
    this.ovDirty = true;
    this.invalidate();
  }

  setColumns(cols: Column[]): void {
    const hadW = columnsWidth(this.columns);
    this.columns = compileColumns(this.tree, cols);
    const changed = columnsWidth(this.columns) !== hadW || (this.columns.length > 0) !== (hadW > 0);
    if (changed && this.fitted) this.fit(false);
    this.hit.invalidate();
    this.invalidate();
  }

  getViewport(): Viewport {
    return { ...this.view };
  }

  setViewport(v: Viewport, animate = false): void {
    if (!(v.x1 > v.x0 && v.y1 > v.y0)) return;
    if (animate) return this.animateTo(v);
    this.anim = null;
    if (viewportEquals(v, this.view)) return;
    this.view = this.clampView({ ...v });
    this.fitted = false;
    this.afterViewChange(false);
  }

  /** Fit the whole tree (and the columns) into the container. */
  fit(animate = true): void {
    this.computeArea();
    const f = this.fitViewport();
    if (animate) this.animateTo(f, true);
    else {
      this.anim = null;
      this.view = f;
      this.fitted = true;
      this.afterViewChange(false);
    }
  }

  focusTip(rank: number, animate = false): void {
    if (rank < 0 || rank >= this.tree.tipCount) return;
    const node = this.tree.tipNode[rank];
    if (node < 0) return; // the tip's row is not loaded
    this.activeNode = -1;
    this.computeArea();
    const v = this.view;
    const a = this.area;
    let nv: Viewport;
    if (this.opts.layout === 'rectangular') {
      const kyNow = a.ah / (v.y1 - v.y0);
      const ky = Math.min(400, Math.max(kyNow, 26));
      const h = a.ah / ky;
      const row = this.L.ROW[node];
      let { x0, x1 } = v;
      const w = x1 - x0;
      const xt = this.L.X[node];
      if (xt < x0 || xt > x1) { x0 = xt - w / 2; x1 = x0 + w; }
      nv = { x0, x1, y0: row - h / 2, y1: row + h / 2 };
    } else {
      const targetPitch = 24;
      const k = Math.max(a.aw / (v.x1 - v.x0), (targetPitch * this.tree.tipCount) / (2 * Math.PI));
      const ang = this.L.ROW[node] * ((2 * Math.PI) / this.tree.tipCount);
      const px = this.L.X[node] * Math.cos(ang), py = this.L.X[node] * Math.sin(ang);
      nv = { x0: px - a.aw / 2 / k, x1: px + a.aw / 2 / k, y0: py - a.ah / 2 / k, y1: py + a.ah / 2 / k };
    }
    this.setViewport(nv, animate);
  }

  zoomToNode(id: number, animate = false): void {
    const node = this.rowOf(id);
    if (node < 0) return;
    this.computeArea();
    const a = this.area;
    const ls = this.tree.leafStart[node], le = this.tree.leafEnd[node];
    let nv: Viewport;
    if (this.opts.layout === 'rectangular') {
      const rows = Math.max(le - ls, 6);
      const mid = (ls + le) / 2;
      const h = rows * 1.12 + 1;
      const x0 = Math.max(-0.02, this.L.X[node] - 0.03);
      const spanX = this.L.XMAX[node] - this.L.X[node];
      const labelFrac = Math.min(0.5, this.labelReserve() / a.aw);
      const w = Math.max(0.0005, (spanX + 0.035) / (1 - labelFrac));
      nv = { x0, x1: x0 + w, y0: mid - h / 2, y1: mid + h / 2 };
    } else {
      const bb = new Float64Array(4);
      sectorBBox(0, 0, this.L.X[node], this.L.XMAX[node], ls * ((2 * Math.PI) / this.tree.tipCount), le * ((2 * Math.PI) / this.tree.tipCount), bb);
      const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
      const half = Math.max((bb[2] - bb[0]) / 2, (bb[3] - bb[1]) / 2, 1e-4) * 1.15;
      const k = Math.min(a.aw, a.ah) / 2 / half;
      nv = { x0: cx - a.aw / 2 / k, x1: cx + a.aw / 2 / k, y0: cy - a.ah / 2 / k, y1: cy + a.ah / 2 / k };
    }
    this.setViewport(nv, animate);
  }

  /** Where a click would land on node i (client px), or null when the node is not drawn / not in view. */
  locateNode(id: number): { x: number; y: number } | null {
    this.renderNow();
    const i = this.rowOf(id);
    if (i < 0) return null;
    const e = this.findInList(i);
    const isTip = this.tree.childCount[i] === 0;
    if (e < 0 && !isTip) return null;
    const p = { x: 0, y: 0 };
    nodeXY(this.T, this.L, i, p);
    const m = isTip ? 0 : 1; // a tip row at the very edge of the fit view still counts as in view
    if (p.x < this.T.clipL + m || p.y < this.T.clipT + m || p.x > this.T.clipR - m || p.y > this.T.clipB - m) return null;
    const r = this.root.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }

  /** Drawn extent of the clade below node i (client px), clipped to the plot area; null when not visible. */
  nodeBounds(id: number): { x: number; y: number; width: number; height: number } | null {
    this.renderNow();
    const i = this.rowOf(id);
    if (i < 0) return null;
    const T = this.T;
    let x0: number, y0: number, x1: number, y1: number;
    const isTip = this.tree.childCount[i] === 0;
    if (isTip) {
      const p = { x: 0, y: 0 };
      nodeXY(T, this.L, i, p);
      x0 = p.x - 5; x1 = p.x + 5; y0 = p.y - 5; y1 = p.y + 5;
    } else if (T.kind === 'rectangular') {
      x0 = T.ox + this.L.X[i] * T.kx;
      x1 = T.ox + this.L.XMAX[i] * T.kx;
      y0 = T.oy + this.tree.leafStart[i] * T.ky;
      y1 = T.oy + this.tree.leafEnd[i] * T.ky;
    } else {
      const bb = new Float64Array(4);
      sectorBBox(T.cx, T.cy, this.L.X[i] * T.k, this.L.XMAX[i] * T.k, this.tree.leafStart[i] * T.da, this.tree.leafEnd[i] * T.da, bb);
      x0 = bb[0]; y0 = bb[1]; x1 = bb[2]; y1 = bb[3];
    }
    x0 = Math.max(T.clipL, x0); y0 = Math.max(T.clipT, y0); x1 = Math.min(T.clipR, x1); y1 = Math.min(T.clipB, y1);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    const r = this.root.getBoundingClientRect();
    return { x: r.left + x0, y: r.top + y0, width: x1 - x0, height: y1 - y0 };
  }

  columnCell(colId: string, rank: number): { x: number; y: number; width: number; height: number } | null {
    this.renderNow();
    const c = this.columns.find((k) => k.spec.id === colId);
    if (!c) return null;
    const rc = cellRect(c, rank, this.T);
    if (!rc) return null;
    const r = this.root.getBoundingClientRect();
    return { x: r.left + rc.x, y: r.top + rc.y, width: rc.width, height: rc.height };
  }

  /** Hit-test a point in container px (what a click there would target). */
  hitTest(x: number, y: number): Hit | null {
    this.renderNow();
    this.ensureHit();
    return this.queryHit(x, y);
  }

  getStats(): FrameStats & { layoutMs: number; hitBuildMs: number; avgFrameMs: number; maxFrameMs: number; listLength: number; hitItems: number; hitEntries: number; kx: number; ky: number } {
    return { ...this.stats, layoutMs: this.L.layoutMs, hitBuildMs: this.hit.builtMs, avgFrameMs: this.msN ? this.msSum / this.msN : 0, maxFrameMs: this.msMax, listLength: this.list.count, hitItems: this.hit.items, hitEntries: this.hit.entries, kx: this.T?.kx ?? 0, ky: this.T?.ky ?? 0 };
  }
  resetFrameTimes(): void {
    this.msSum = 0; this.msN = 0; this.msMax = 0;
  }

  /** Draw synchronously if something changed (used before introspection and by benchmarks). */
  renderNow(): void {
    if (this.destroyed) return;
    this.settle();
    if (this.dirty) this.render();
    if (this.topDirty) this.drawTop();
  }

  /** If the last frame was drawn in reduced (interaction) quality, redraw it at full quality now. Hit-testing, locate and
   *  bounds call this first, so a click always hits what a full-quality frame shows, never the reduced list. */
  private settle(): void {
    if (!this.reducedFrame && !this.interacting) return;
    this.interacting = false;
    if (this.refineTimer) { clearTimeout(this.refineTimer); this.refineTimer = 0; }
    if (this.reducedFrame) this.dirty = true;
  }

  /** Called by every input that moves the view (wheel, drag, pinch, overview, animation steps). */
  private noteInput(): void {
    if (!this.opts.interactionLOD) return;
    this.interacting = true;
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.refineTimer = window.setTimeout(() => {
      this.refineTimer = 0;
      if (this.destroyed) return;
      this.interacting = false;
      if (this.reducedFrame) this.dirty = true;
      this.schedule();
    }, this.opts.refineMs);
  }

  /** Force a full redraw n times and return the mean JS time per frame (benchmark helper). */
  benchmark(n: number): { meanMs: number; minMs: number; maxMs: number; cutMs: number; drawMs: number } {
    let sum = 0, min = Infinity, max = 0, cut = 0, draw = 0;
    for (let k = 0; k < n; k++) {
      this.dirty = true;
      this.render();
      sum += this.stats.frameMs; cut += this.stats.cutMs; draw += this.stats.drawMs;
      min = Math.min(min, this.stats.frameMs); max = Math.max(max, this.stats.frameMs);
    }
    return { meanMs: sum / n, minMs: min, maxMs: max, cutMs: cut / n, drawMs: draw / n };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.srTimer) clearTimeout(this.srTimer);
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.ro?.disconnect();
    this.ro = null;
    (document as Document & { fonts?: FontFaceSet }).fonts?.removeEventListener?.('loadingdone', this.onFonts);
    if (this.onWin) {
      window.removeEventListener('pointermove', this.onWinMove);
      window.removeEventListener('pointerup', this.onWinUp);
      window.removeEventListener('pointercancel', this.onWinUp);
    }
    this.root.remove();
    // release the backing stores
    for (const c of [this.canvas, this.top, this.ovCanvas]) { c.width = 0; c.height = 0; }
    this.pool.clear();
    this.columns = [];
    this.layouts.clear();
    this.unsubscribe();
    for (const ac of this.pending.values()) ac.abort();
    this.pending.clear();
  }

  // ================================================================= layout, area, fit

  private layoutFor(lengths: boolean): Layout {
    let L = this.layouts.get(lengths);
    if (!L) {
      if (this.layouts.size >= 2) this.layouts.delete([...this.layouts.keys()][0]);
      L = computeLayout(this.tree, lengths);
      this.layouts.set(lengths, L);
    }
    return L;
  }

  private measure(): void {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.setSize(w, h);
  }

  private setSize(w: number, h: number): void {
    if (w === this.W && h === this.H && this.effScale() === this.dpr) return;
    const radialK = this.opts.layout === 'radial' && this.W > 0 ? this.area.aw / (this.view.x1 - this.view.x0) : 0;
    const cx = (this.view.x0 + this.view.x1) / 2, cy = (this.view.y0 + this.view.y1) / 2;
    this.W = w;
    this.H = h;
    this.dpr = this.effScale();
    for (const c of [this.canvas, this.top]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }
    this.computeArea();
    if (this.fitted || !(this.view.x1 > this.view.x0)) this.view = this.fitViewport();
    else if (radialK) {
      const a = this.area;
      this.view = { x0: cx - a.aw / 2 / radialK, x1: cx + a.aw / 2 / radialK, y0: cy - a.ah / 2 / radialK, y1: cy + a.ah / 2 / radialK };
    }
    this.ovDirty = true;
    this.hit.invalidate();
    this.invalidate();
  }

  private computeArea(): Area {
    const W = this.W, H = this.H;
    if (this.opts.layout === 'radial') {
      this.area = { ax: 0, ay: 0, aw: W, ah: H, clipL: 0, clipT: 0, clipR: W, clipB: H };
    } else {
      const ovG = this.opts.overview ? OV_W + 8 : 0;
      const colsW = columnsWidth(this.columns);
      const clipR = Math.max(120, W - ovG - colsW);
      const head = this.columns.length ? HEAD_H : MIN_HEAD;
      const foot = this.opts.axis && this.L.usedLengths ? FOOT_H : MIN_HEAD;
      const ax = 10;
      const labelW = Math.min(this.labelReserve(), clipR * 0.4);
      const aw = Math.max(40, clipR - ax - labelW);
      this.area = { ax, ay: head, aw, ah: Math.max(40, H - head - foot), clipL: 0, clipT: head, clipR, clipB: head + Math.max(40, H - head - foot) };
      layoutColumns(this.columns, clipR + COL_GAP);
    }
    return this.area;
  }

  private maxChars = -1;
  /** Room right of the tips for labels: from the longest label, capped (rectangular layout). */
  private labelReserve(): number {
    if (this.maxChars < 0) {
      let m = 0;
      const t = this.tree.tipLabels;
      if (this.tree.stub) m = 28; // partial tree: labels are not loaded, assume a typical binomial
      else for (let i = 0; i < t.length; i++) if (t[i].length > m) m = t[i].length;
      this.maxChars = m;
    }
    return Math.max(70, Math.min(LABEL_W, this.maxChars * 6.3 + 14));
  }

  private fitViewport(): Viewport {
    const a = this.area;
    if (this.opts.layout === 'rectangular') {
      const rows = this.opts.rowHeight ? a.ah / this.opts.rowHeight : this.tree.tipCount;
      return { x0: 0, x1: 1, y0: 0, y1: Math.max(1, rows) };
    }
    const k = Math.max(20, Math.min(this.W, this.H) / 2 - 28);
    return { x0: -a.aw / 2 / k, x1: a.aw / 2 / k, y0: -a.ah / 2 / k, y1: a.ah / 2 / k };
  }

  // ================================================================= view changes

  private clampView(v: Viewport): Viewport {
    const a = this.area;
    if (this.opts.layout === 'rectangular') {
      const N = this.tree.tipCount;
      const wmax = 1.6, wmin = a.aw / 5e6;
      let w = v.x1 - v.x0;
      w = Math.min(wmax, Math.max(wmin, w));
      const hmax = Math.max(N * 1.6, a.ah / 4), hmin = a.ah / 500;
      let h = v.y1 - v.y0;
      h = Math.min(hmax, Math.max(hmin, h));
      let x0 = v.x0, y0 = v.y0;
      // zoomed out beyond the tree: keep the whole tree inside the window; zoomed in: allow 15% overscroll
      x0 = w >= 0.999 ? Math.min(0, Math.max(1 - w, x0)) : Math.min(1 - 0.85 * w, Math.max(-0.15 * w, x0));
      y0 = h >= N * 0.999 ? Math.min(0, Math.max(N - h, y0)) : Math.min(N - 0.85 * h, Math.max(-0.15 * h, y0));
      return { x0, x1: x0 + w, y0, y1: y0 + h };
    }
    const kfit = Math.max(20, Math.min(this.W, this.H) / 2 - 28);
    let k = a.aw / (v.x1 - v.x0);
    k = Math.min(kfit * 20000, Math.max(kfit * 0.4, k));
    let cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
    cx = Math.max(-1.3, Math.min(1.3, cx));
    cy = Math.max(-1.3, Math.min(1.3, cy));
    return { x0: cx - a.aw / 2 / k, x1: cx + a.aw / 2 / k, y0: cy - a.ah / 2 / k, y1: cy + a.ah / 2 / k };
  }

  private afterViewChange(emit = true): void {
    this.hit.invalidate();
    this.invalidate();
    this.scheduleSr();
    if (emit) this.emitViewport();
    else this.emitViewport();
  }

  private lastEmitted: Viewport | null = null;
  private emitViewport(): void {
    if (this.lastEmitted && viewportEquals(this.lastEmitted, this.view, 1e-12)) return;
    this.lastEmitted = { ...this.view };
    this.cb.onViewportChange?.({ ...this.view });
  }

  private animateTo(v: Viewport, isFit = false): void {
    const to = isFit ? v : this.clampView({ ...v });
    this.anim = { from: { ...this.view }, to, t0: performance.now(), ms: 220 };
    this.fitted = false;
    if (isFit) this.fitAfterAnim = true;
    this.schedule();
  }
  private fitAfterAnim = false;

  private stepAnim(now: number): void {
    const an = this.anim;
    if (!an) return;
    const t = Math.min(1, (now - an.t0) / an.ms);
    this.noteInput();
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const lerp = (p: number, q: number) => p + (q - p) * e;
    // interpolate window centre linearly and size geometrically (feels like a constant-rate zoom)
    const wf = an.from.x1 - an.from.x0, wt = an.to.x1 - an.to.x0, hf = an.from.y1 - an.from.y0, ht = an.to.y1 - an.to.y0;
    const w = wf * Math.pow(wt / wf, e), h = hf * Math.pow(ht / hf, e);
    const cx = lerp((an.from.x0 + an.from.x1) / 2, (an.to.x0 + an.to.x1) / 2), cy = lerp((an.from.y0 + an.from.y1) / 2, (an.to.y0 + an.to.y1) / 2);
    this.view = { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
    if (t >= 1) {
      this.view = { ...an.to };
      this.anim = null;
      if (this.fitAfterAnim) { this.fitted = true; this.fitAfterAnim = false; }
    }
    this.hit.invalidate();
    this.dirty = true;
    this.emitViewport();
    this.scheduleSr();
  }

  // ================================================================= frame loop

  invalidate(fonts = false): void {
    if (this.destroyed) return;
    this.dirty = true;
    this.topDirty = true;
    if (fonts) this.clearPool();
    this.schedule();
  }

  private schedule(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame((now) => {
      this.raf = 0;
      if (this.destroyed) return;
      if (this.anim) this.stepAnim(now);
      if (this.dirty) this.render();
      if (this.pendingHover && !this.interacting) this.doHover();
      if (this.topDirty) this.drawTop();
      if (this.anim) this.schedule();
    });
  }

  /** Canvas backing pixels per CSS pixel: the device pixel ratio, capped by the dprCap option. */
  private effScale(): number {
    const d = window.devicePixelRatio || 1;
    const cap = this.opts.dprCap;
    return cap > 0 && cap < d ? cap : d;
  }

  private ensureDpr(): void {
    if (this.effScale() !== this.dpr) this.setSize(this.W, this.H);
  }

  private fitCut(rect: boolean, base: number, budget: number, summaries: boolean, useHint: boolean): { res: CutResult; minPx: number; retries: number } {
    const r = searchCut(rect, this.tree, this.L, this.T, this.classOf, this.list, this.seen, { lod: this.opts.lod, base, budget, summaries, hint: useHint ? this.minPxHint : 0 });
    if (useHint) this.minPxHint = r.minPx;
    return r;
  }

  private render(): void {
    this.dirty = false;
    const t0 = performance.now();
    this.syncSource();
    this.ensureDpr();
    const { W, H, opts, tree, L } = this;
    const dpr = this.dpr;
    const rect = opts.layout === 'rectangular';
    if (!rect) ensureTrig(L);
    this.computeArea();
    this.T = makeTransform(opts.layout, W, H, this.view, this.area, tree.tipCount);
    const T = this.T;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const reduced = this.interacting && opts.interactionLOD;

    // ---- cut
    const tc = performance.now();
    const baseMinPx = Math.max(1, opts.minCladePx);
    let budget = opts.lod ? Math.max(500, opts.drawBudget) : 600000;
    if (opts.lod && !rect && Number.isFinite(opts.radialMaxNodes)) budget = Math.max(100, Math.min(budget, opts.radialMaxNodes));
    let base = baseMinPx;
    if (reduced) {
      budget = Math.max(500, Math.floor(budget / 4));
      if (this.lastFullDrawn > HEAVY_PRIMS) base = baseMinPx * REDUCED_MINPX;
    }
    const cutRes = this.fitCut(rect, base, budget, opts.showSummaries, !reduced);
    const { minPx, retries } = cutRes;
    const res = { ...cutRes.res }; // the cut functions return a shared scratch object; the overview cut below would overwrite it
    const cutMs = performance.now() - tc;
    this.hit.invalidate();
    if (!reduced) this.lastFullDrawn = this.list.count;

    // ---- draw
    const td = performance.now();
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, W, H);
    const S: Scene = {
      tree, L, T, list: this.list, theme: this.theme, colours: this.colours, classOf: this.classOf, highlight: this.hl, hlRanks: this.hlRanks,
      hoverNode: this.hoverNode, activeNode: this.activeNode, density: opts.labelDensity, italic: opts.italicLabels, format: opts.formatLabel,
      scale: dpr, thin: !rect && this.list.count >= THIN_PRIMS,
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, rect ? T.clipT - 6 : 0, rect ? T.clipR : W, rect ? T.clipB - T.clipT + 12 : H);
    ctx.clip();
    drawHighlights(ctx, S, rect ? T.clipR + (columnsWidth(this.columns) || 0) : W);
    drawBody(ctx, S, BRANCH_W);
    drawMarkers(ctx, S);
    drawLabels(ctx, S, this.labels, minPx);
    ctx.restore();
    if (rect) {
      const barC = this.theme.categorical[1] ?? this.theme.highlight;
      drawColumns(ctx, this.columns, tree, T, this.theme, T.area.ay - 8, barC, { alignStyle: opts.alignStyle, alignRowGap: opts.alignRowGap });
      if (opts.axis) drawAxis(ctx, S, this.view.x0, this.view.x1);
    } else if (opts.axis) drawScaleBar(ctx, S);

    const drawMs = performance.now() - td;
    // the DOM overlay (label anchors) and the notice follow full-quality frames only; a reduced frame is replaced within refineMs
    if (!reduced) {
      this.updateOverlay();
      this.updateNotice(!rect && opts.summaryNotice && opts.lod && res.forced > 0, res.forced);
    }
    this.reducedFrame = reduced;
    if (!reduced && this.tree.stub !== null) this.requestDetail(rect);
    this.updateOverviewBox();
    if (this.ovDirty) this.drawOverview();
    if (this.hoverNode >= 0 || this.activeNode >= 0 || this.topHad) this.topDirty = true;

    const frameMs = performance.now() - t0;
    const st = this.stats;
    st.frameMs = frameMs; st.cutMs = cutMs; st.drawMs = drawMs; st.visited = res.visited; st.drawn = this.list.count; st.summaries = res.summaries; st.tips = res.tips;
    st.labels = this.labels.count; st.minPxUsed = minPx; st.budgetRetries = retries; st.budgetHit = minPx > base || res.overflow; st.truncated = res.overflow; st.frames++;
    st.budget = budget; st.forced = res.forced; st.summaryTips = res.summaryTips; st.mergedTips = res.mergedTips; st.reduced = reduced; st.scale = dpr;
    this.msSum += frameMs; this.msN++; if (frameMs > this.msMax) this.msMax = frameMs;
    this.cb.onFrame?.(st);
  }

  /** Stubs in the draw list that are big enough on screen to be worth opening: ask the source for their rows (biggest first, a few
   *  at a time, cancelled when they leave the view). The source bumps its version when they arrive and the next frame draws them
   *  as regular rows. Only runs for a source with stubs. */
  private requestDetail(rect: boolean): void {
    if (this.fitted) return; // the first view is the overview as it is; opening starts with the first zoom or pan
    const { tree, list, T, L } = this;
    const extent = rect ? T.clipB - T.clipT : Math.min(T.clipR - T.clipL, T.clipB - T.clipT);
    const want: Array<{ id: number; px: number }> = [];
    for (let e = 0; e < list.count; e++) {
      if (list.kind[e] !== K_SUMMARY) continue;
      const i = list.node[e];
      if (tree.stub![i] !== 1) continue;
      const px = rect ? (tree.leafEnd[i] - tree.leafStart[i]) * T.ky : (tree.leafEnd[i] - tree.leafStart[i]) * T.da * L.XMAX[i] * T.k;
      const id = tree.globalId![i];
      // a clade that costs many rows must fill a good part of the view first; a small one opens as soon as it is DETAIL_PX tall
      const need = (this.source.openCost?.(id) ?? 0) > BIG_CLADE_ROWS ? Math.max(DETAIL_PX, DETAIL_FRAC * extent) : DETAIL_PX;
      if (px >= need && this.doneAt.get(id) !== this.srcVersion) want.push({ id, px });
    }
    want.sort((a, b) => b.px - a.px);
    const keep = new Set(want.map((w) => w.id));
    for (const [id, ac] of this.pending) if (!keep.has(id)) { ac.abort(); this.pending.delete(id); }
    for (const w of want) {
      if (this.pending.size >= DETAIL_INFLIGHT) break;
      if (this.pending.has(w.id) || this.failedDetail.has(w.id)) continue;
      const ac = new AbortController();
      const v0 = this.source.version;
      this.pending.set(w.id, ac);
      this.source.ensureClade(w.id, { signal: ac.signal, priority: w.px }).then(
        () => { this.pending.delete(w.id); if (this.source.version !== v0) this.invalidate(); else this.doneAt.set(w.id, v0); }, // nothing changed: do not ask again until the version moves
        (err) => { this.pending.delete(w.id); if (!ac.signal.aborted) { this.failedDetail.add(w.id); console.warn('TreeSource.ensureClade failed', w.id, err); } },
      );
    }
  }

  private updateNotice(show: boolean, n: number): void {
    const el = this.notice;
    if (!show) {
      if (this.noticeShown) { el.style.display = 'none'; this.noticeShown = false; this.noticeText = ''; }
      return;
    }
    const text = `${n.toLocaleString('en')} clade${n === 1 ? '' : 's'} summarised, raise the limit in Library options`;
    if (text !== this.noticeText) { el.textContent = text; this.noticeText = text; }
    if (!this.noticeShown) {
      el.style.display = 'block';
      el.style.background = `color-mix(in srgb, ${this.theme.background} 85%, transparent)`;
      el.style.color = this.theme.muted;
      el.style.border = `1px solid ${this.theme.muted}`;
      el.style.fontFamily = this.theme.fontFamily;
      this.noticeShown = true;
    }
  }

  /** Hover and keyboard rings live on their own canvas so they never trigger a tree redraw. */
  private topHad = false;
  private drawTop(): void {
    this.topDirty = false;
    this.topHad = this.hoverNode >= 0 || this.activeNode >= 0;
    const c = this.topCtx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    if (!this.T) return;
    const S = { T: this.T, L: this.L } as Scene;
    if (this.hoverNode >= 0 && this.hoverRun < 0 && this.hoverNode !== this.activeNode) drawRing(c, S, this.hoverNode, this.hoverKind === 'summary' ? 9 : 6, this.theme.highlight, 2);
    if (this.activeNode >= 0 && (this.focusWithin || this.activeNode >= 0)) {
      drawRing(c, S, this.activeNode, 10, this.theme.highlight, 2.5);
      const p = { x: 0, y: 0 };
      nodeXY(this.T, this.L, this.activeNode, p);
      if (this.T.kind === 'rectangular') {
        c.strokeStyle = this.theme.highlight;
        c.globalAlpha = 0.5;
        c.lineWidth = 1;
        const ky = this.T.ky;
        const y0 = this.T.oy + this.tree.leafStart[this.activeNode] * ky, y1 = this.T.oy + this.tree.leafEnd[this.activeNode] * ky;
        if (y1 - y0 > 3 && this.tree.childCount[this.activeNode] > 0) c.strokeRect(p.x, Math.max(this.T.clipT, y0), Math.max(4, this.T.clipR - p.x - 4), Math.min(this.T.clipB, y1) - Math.max(this.T.clipT, y0));
        c.globalAlpha = 1;
      }
    }
  }

  // ================================================================= overlay (accessible labels), a11y list

  private clearPool(): void {
    for (const el of this.pool.values()) el.remove();
    this.pool.clear();
  }

  private updateOverlay(): void {
    const { labels, opts, T } = this;
    const mode = opts.tipHref ? 'a' : 'span';
    if (mode !== this.poolMode) { this.clearPool(); this.poolMode = mode; }
    const key = this.theme.fontFamily + '|' + opts.italicLabels;
    if (key !== this.lastKey) { this.clearPool(); this.lastKey = key; }
    const used = new Set<number>();
    const active = document.activeElement;
    const rect = T.kind === 'rectangular';
    for (let k = 0; k < labels.count; k++) {
      const r = labels.rank[k];
      used.add(r);
      let el = this.pool.get(r);
      const id = this.tree.tipLabels[r] ?? '';
      if (!el) {
        el = document.createElement(mode);
        el.dataset.tipId = id;
        el.textContent = opts.formatLabel(id);
        el.tabIndex = 0;
        el.style.cssText = `position:absolute;left:0;top:0;pointer-events:auto;white-space:nowrap;color:transparent;text-decoration:none;cursor:pointer;outline-offset:1px;font-family:${this.theme.fontFamily};${opts.italicLabels ? 'font-style:italic;' : ''}transform-origin:0 50%`;
        if (mode === 'a') {
          const a = el as HTMLAnchorElement;
          a.href = opts.tipHref!(id);
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        } else {
          el.setAttribute('role', 'treeitem');
        }
        this.overlay.appendChild(el);
        this.pool.set(r, el);
      }
      const h = labels.h[k];
      const fs = Math.max(8, h - 2);
      el.style.fontSize = fs + 'px';
      el.style.height = h + 'px';
      el.style.lineHeight = h + 'px';
      if (rect) el.style.transform = `translate(${labels.x[k]}px,${labels.y[k] - h / 2}px)`;
      else {
        const deg = (labels.ang[k] * 180) / Math.PI;
        el.style.transform = labels.flip[k] ? `translate(${labels.x[k]}px,${labels.y[k] - h / 2}px) rotate(${deg}deg) translateX(-100%) translateX(-8px)` : `translate(${labels.x[k]}px,${labels.y[k] - h / 2}px) rotate(${deg}deg) translateX(8px)`;
      }
      el.style.display = '';
    }
    for (const [r, el] of this.pool) {
      if (used.has(r)) continue;
      if (el === active) { el.style.transform = 'translate(-9999px,0)'; continue; } // keep focus alive until it moves
      el.remove();
      this.pool.delete(r);
    }
  }

  private scheduleSr(): void {
    if (this.srTimer) clearTimeout(this.srTimer);
    this.srTimer = window.setTimeout(() => this.updateSr(), 160);
  }

  /** Visually hidden list of the tips in view (first 60 in tree order) for assistive technology. */
  private updateSr(): void {
    this.srTimer = 0;
    if (this.destroyed) return;
    this.renderNow();
    const { list, tree, opts } = this;
    const items: HTMLLIElement[] = [];
    let total = 0;
    for (let e = 0; e < list.count; e++) {
      if (list.kind[e] !== K_TIP) continue;
      total++;
      if (items.length < 60) {
        const li = document.createElement('li');
        li.textContent = opts.formatLabel(tree.tipLabels[tree.tipRank[list.node[e]]] ?? '');
        items.push(li);
      }
    }
    const head = document.createElement('li');
    head.textContent = total ? `${total} tips drawn in view${total > items.length ? `, first ${items.length} listed` : ''}` : 'No individual tips are drawn at this zoom level; zoom in to list them';
    this.srList.replaceChildren(head, ...items);
  }

  private announce(text: string): void {
    this.live.textContent = text;
  }

  // ================================================================= hit-testing

  private ensureHit(): void {
    if (!this.hit.valid) this.hit.build(this.list, this.T);
  }

  private queryHit(x: number, y: number): Hit | null {
    // a label under the pointer is a tip hit (rectangular text; radial labels are matched by their box centre line)
    const L = this.labels;
    if (this.T.kind === 'rectangular') {
      for (let k = 0; k < L.count; k++) {
        if (x >= L.x[k] - 2 && x <= L.x[k] + L.w[k] + 2 && Math.abs(y - L.y[k]) <= L.h[k] / 2) return { node: this.tree.tipNode[L.rank[k]], kind: 'tip' };
      }
    }
    return this.hit.query(x, y, this.T);
  }

  private findInList(node: number): number {
    const a = this.list.node;
    let lo = 0, hi = this.list.count - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (a[m] < node) lo = m + 1;
      else if (a[m] > node) hi = m - 1;
      else return m;
    }
    return -1;
  }

  private mkEvent(node: number, kind: Hit['kind'], via: 'pointer' | 'keyboard', cx: number, cy: number, run?: Hit['run']): NodeEvent {
    const t = this.tree;
    if (run) {
      // a run of small siblings: reported under its parent, with only ITS tips (the members are adjacent, so one range)
      let clades = 0, single = 0;
      for (let j = run.first; j <= run.last; j = t.subtreeEnd[j]) if (t.childCount[j] === 0) single++; else clades++;
      return { node: t.globalId === null ? node : t.globalId[node], isTip: false, tipId: null, kind, tipStart: t.leafStart[run.first], tipEnd: t.leafEnd[run.last], clientX: cx, clientY: cy, via, run: { clades, single } };
    }
    const isTip = t.childCount[node] === 0;
    return { node: t.globalId === null ? node : t.globalId[node], isTip, tipId: isTip ? t.labels[node] ?? null : null, kind, tipStart: t.leafStart[node], tipEnd: t.leafEnd[node], clientX: cx, clientY: cy, via };
  }

  private doHover(): void {
    const p = this.pendingHover;
    this.pendingHover = null;
    if (!p || this.drag?.moved || this.pinch) return;
    this.renderNow();
    this.ensureHit();
    const h = this.queryHit(p.x, p.y);
    const node = h ? h.node : -1;
    const r = this.root.getBoundingClientRect();
    const run = h?.run ? h.run.first : -1;
    if (node === this.hoverNode && (h?.kind ?? '') === this.hoverKind && run === this.hoverRun) return;
    this.hoverNode = node;
    this.hoverRun = run;
    this.hoverKind = h ? h.kind : '';
    this.root.style.cursor = h ? 'pointer' : 'grab';
    this.topDirty = true;
    this.cb.onHover?.(h ? this.mkEvent(h.node, h.kind, 'pointer', r.left + p.x, r.top + p.y, h.run) : null);
  }

  // ================================================================= events

  private bind(): void {
    const el = this.root;
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('click', this.onClickCapture, true);
    el.addEventListener('keydown', this.onKey);
    el.addEventListener('focusin', this.onFocusIn);
    el.addEventListener('focusout', this.onFocusOut);
    el.addEventListener('dblclick', this.onDbl);
    this.ovWrap.addEventListener('pointerdown', this.onOvDown);
    this.ovWrap.addEventListener('pointermove', this.onOvMove);
    this.ovWrap.addEventListener('pointerup', this.onOvUp);
    this.ovWrap.addEventListener('pointercancel', this.onOvUp);
    this.ro = new ResizeObserver(() => {
      if (!this.destroyed) this.measure();
    });
    this.ro.observe(this.host);
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.noteInput();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const a = this.area;
    if (this.opts.layout === 'rectangular') {
      const horizontal = e.shiftKey || e.ctrlKey;
      const d = (e.deltaY !== 0 ? e.deltaY : e.deltaX) * unit;
      if (!horizontal && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
        const w = this.view.x1 - this.view.x0;
        const dx = (e.deltaX * unit / a.aw) * w;
        this.setViewport({ ...this.view, x0: this.view.x0 + dx, x1: this.view.x1 + dx });
        return;
      }
      const f = Math.exp(-d * 0.0015);
      if (e.altKey) this.zoomBy(f, f, p.x, p.y);
      else if (horizontal) this.zoomBy(f, 1, p.x, p.y);
      else this.zoomBy(1, f, p.x, p.y);
    } else {
      const f = Math.exp(-(e.deltaY || e.deltaX) * unit * 0.0015);
      this.zoomBy(f, f, p.x, p.y);
    }
  };

  /** Zoom by factors fx, fy (>1 zooms in) keeping the layout point under (px, py) fixed. */
  zoomBy(fx: number, fy: number, px: number, py: number): void {
    const a = this.area;
    const v = this.view;
    const wx = v.x0 + ((px - a.ax) / a.aw) * (v.x1 - v.x0);
    const wy = v.y0 + ((py - a.ay) / a.ah) * (v.y1 - v.y0);
    const w2 = (v.x1 - v.x0) / fx, h2 = (v.y1 - v.y0) / fy;
    const nv = { x0: wx - ((px - a.ax) / a.aw) * w2, x1: 0, y0: wy - ((py - a.ay) / a.ah) * h2, y1: 0 };
    nv.x1 = nv.x0 + w2;
    nv.y1 = nv.y0 + h2;
    this.setViewport(this.opts.layout === 'radial' ? this.clampView(nv) : nv);
  }

  private onPointerDown = (e: PointerEvent) => {
    if ((e.target as Element).closest?.('[data-ov]')) return;
    this.pointers.set(e.pointerId, this.local(e));
    this.anim = null;
    if (this.pointers.size === 2) {
      const [p, q] = [...this.pointers.values()];
      this.pinch = { v0: { ...this.view }, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, dx: Math.abs(p.x - q.x), dy: Math.abs(p.y - q.y) };
      this.drag = null;
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = this.local(e);
    this.drag = { sx: p.x, sy: p.y, v0: { ...this.view }, moved: false, id: e.pointerId };
    this.suppressClick = false;
    if (!this.onWin) {
      this.onWin = () => {};
      window.addEventListener('pointermove', this.onWinMove);
      window.addEventListener('pointerup', this.onWinUp);
      window.addEventListener('pointercancel', this.onWinUp);
    }
  };

  private onWinMove = (e: PointerEvent) => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, this.local(e));
    if (this.pinch && this.pointers.size >= 2) {
      const [p, q] = [...this.pointers.values()];
      const dx = Math.abs(p.x - q.x), dy = Math.abs(p.y - q.y);
      const pc = this.pinch;
      const dist = Math.hypot(dx, dy), dist0 = Math.hypot(pc.dx, pc.dy);
      const fx = pc.dx >= 30 ? Math.max(0.2, Math.min(5, dx / pc.dx)) : dist0 > 0 ? dist / dist0 : 1;
      const fy = pc.dy >= 30 ? Math.max(0.2, Math.min(5, dy / pc.dy)) : dist0 > 0 ? dist / dist0 : 1;
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const a = this.area;
      const v0 = pc.v0;
      const rad = this.opts.layout === 'radial';
      const ffx = rad ? dist / Math.max(1, dist0) : fx, ffy = rad ? dist / Math.max(1, dist0) : fy;
      const w2 = (v0.x1 - v0.x0) / ffx, h2 = (v0.y1 - v0.y0) / ffy;
      const wx = v0.x0 + ((pc.mid.x - a.ax) / a.aw) * (v0.x1 - v0.x0), wy = v0.y0 + ((pc.mid.y - a.ay) / a.ah) * (v0.y1 - v0.y0);
      const x0 = wx - ((mid.x - a.ax) / a.aw) * w2, y0 = wy - ((mid.y - a.ay) / a.ah) * h2;
      this.suppressClick = true;
      this.noteInput();
      this.setViewport({ x0, x1: x0 + w2, y0, y1: y0 + h2 });
      return;
    }
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const p = this.local(e);
    const dx = p.x - d.sx, dy = p.y - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 3) {
      d.moved = true;
      this.suppressClick = true;
      this.root.style.cursor = 'grabbing';
      if (this.hoverNode >= 0) { this.hoverNode = -1; this.hoverKind = ''; this.topDirty = true; this.cb.onHover?.(null); this.schedule(); }
    }
    if (d.moved) {
      this.noteInput();
      const a = this.area;
      const w = d.v0.x1 - d.v0.x0, h = d.v0.y1 - d.v0.y0;
      const ddx = (dx / a.aw) * w, ddy = (dy / a.ah) * h;
      this.setViewport({ x0: d.v0.x0 - ddx, x1: d.v0.x1 - ddx, y0: d.v0.y0 - ddy, y1: d.v0.y1 - ddy });
    }
  };

  private onWinUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pinch && this.pointers.size < 2) this.pinch = null;
    const d = this.drag;
    if (d && e.pointerId === d.id) {
      this.drag = null;
      this.root.style.cursor = this.hoverNode >= 0 ? 'pointer' : 'grab';
      if (!d.moved && e.type === 'pointerup' && !this.suppressClick) {
        const p = this.local(e);
        this.renderNow();
        this.ensureHit();
        const h = this.queryHit(p.x, p.y);
        if (h) {
          this.activeNode = -1;
          this.topDirty = true;
          this.schedule();
          this.cb.onClick?.(this.mkEvent(h.node, h.kind, 'pointer', e.clientX, e.clientY, h.run));
        }
      }
    }
    if (!this.pointers.size && this.onWin) {
      window.removeEventListener('pointermove', this.onWinMove);
      window.removeEventListener('pointerup', this.onWinUp);
      window.removeEventListener('pointercancel', this.onWinUp);
      this.onWin = null;
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || this.drag?.moved || this.pinch) return;
    this.pendingHover = this.local(e);
    this.schedule();
  };

  private onPointerLeave = () => {
    this.pendingHover = null;
    if (this.hoverNode >= 0) {
      this.hoverNode = -1;
      this.hoverKind = '';
      this.topDirty = true;
      this.cb.onHover?.(null);
      this.schedule();
    }
  };

  /** A drag must not open a tip link; real clicks on the anchors go through. */
  private onClickCapture = (e: MouseEvent) => {
    if (this.suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      this.suppressClick = false;
    }
  };

  private onDbl = (e: MouseEvent) => {
    const p = this.local(e);
    this.renderNow();
    this.ensureHit();
    const h = this.queryHit(p.x, p.y);
    if (h && this.tree.childCount[h.node] > 0) this.zoomToNode(h.node, true);
    else if (!h) this.fit(true);
  };

  private onFocusIn = (e: FocusEvent) => {
    this.focusWithin = true;
    const t = e.target as HTMLElement;
    if (t !== this.root) t.style.outline = `2px solid ${this.theme.highlight}`;
    else this.root.style.boxShadow = `inset 0 0 0 2px ${this.theme.highlight}`;
    this.topDirty = true;
    this.schedule();
  };
  private onFocusOut = (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    if (t !== this.root) t.style.outline = '';
    else this.root.style.boxShadow = '';
    if (!this.root.contains(e.relatedTarget as Node | null)) this.focusWithin = false;
    this.topDirty = true;
    this.schedule();
  };

  // ------------------------------------------------------------- keyboard

  private defaultActive(): number {
    const v = this.view;
    const N = this.tree.tipCount;
    let rank = 0;
    if (this.opts.layout === 'rectangular') rank = Math.floor((v.y0 + v.y1) / 2);
    else {
      const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
      if (Math.hypot(cx, cy) > 0.02) rank = Math.floor(((Math.atan2(cy, cx) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * N);
    }
    return this.tree.tipNode[Math.max(0, Math.min(N - 1, rank))];
  }

  private setActive(node: number, announce = true): void {
    this.activeNode = node;
    this.ensureVisible(node);
    this.topDirty = true;
    this.renderNow();
    if (announce && node >= 0) {
      const tip = this.tree.childCount[node] === 0;
      this.announce(tip ? this.opts.formatLabel(this.tree.labels[node] ?? '') : `Clade of ${this.tree.leafEnd[node] - this.tree.leafStart[node]} tips`);
      // move DOM focus with the cursor when it sits on a label anchor
      if (tip && this.root.contains(document.activeElement) && document.activeElement !== this.root) {
        const el = this.pool.get(this.tree.tipRank[node]);
        if (el) el.focus({ preventScroll: true });
      }
    }
    this.schedule();
  }

  private ensureVisible(node: number): void {
    this.computeArea();
    const a = this.area;
    const v = this.view;
    if (this.opts.layout === 'rectangular') {
      const row = this.L.ROW[node];
      const h = v.y1 - v.y0;
      const m = Math.min(h * 0.12, 3);
      let { y0, y1, x0, x1 } = v;
      if (row < y0 + m) { y0 = row - m; y1 = y0 + h; }
      else if (row > y1 - m) { y1 = row + m; y0 = y1 - h; }
      const xt = this.L.X[node];
      const w = x1 - x0;
      if (xt < x0 || xt > x1) { x0 = xt - w / 2; x1 = x0 + w; }
      if (y0 !== v.y0 || x0 !== v.x0) this.setViewport({ x0, x1, y0, y1 });
    } else {
      const p = { x: 0, y: 0 };
      this.T = makeTransform('radial', this.W, this.H, v, a, this.tree.tipCount);
      nodeXY(this.T, this.L, node, p);
      const pad = 30;
      if (p.x < pad || p.y < pad || p.x > this.W - pad || p.y > this.H - pad) {
        const k = a.aw / (v.x1 - v.x0);
        const ang = this.L.ROW[node] * ((2 * Math.PI) / this.tree.tipCount);
        const wx = this.L.X[node] * Math.cos(ang), wy = this.L.X[node] * Math.sin(ang);
        this.setViewport({ x0: wx - a.aw / 2 / k, x1: wx + a.aw / 2 / k, y0: wy - a.ah / 2 / k, y1: wy + a.ah / 2 / k });
      }
    }
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.altKey || e.metaKey) return;
    const tree = this.tree;
    let node = this.activeNode >= 0 ? this.activeNode : this.defaultActive();
    if (node < 0) node = 0; // partial tree: the tip row at the view centre is not loaded
    const N = tree.tipCount;
    const rows = this.opts.layout === 'rectangular' ? Math.max(1, Math.floor(this.view.y1 - this.view.y0)) : 10;
    const tipOf = (r: number) => tree.tipNode[Math.max(0, Math.min(N - 1, r))];
    const startRank = tree.leafStart[node];
    let next = -1;
    switch (e.key) {
      case 'ArrowDown': next = tipOf(tree.childCount[node] === 0 ? startRank + 1 : tree.leafEnd[node]); break;
      case 'ArrowUp': next = tipOf(startRank - 1); break;
      case 'PageDown': next = tipOf(startRank + rows); break;
      case 'PageUp': next = tipOf(startRank - rows); break;
      case 'Home': next = tipOf(0); break;
      case 'End': next = tipOf(N - 1); break;
      case 'ArrowLeft': next = node > 0 ? tree.parent[node] : node; break;
      case 'ArrowRight': next = tree.firstChild[node] >= 0 ? tree.firstChild[node] : node; break; // a stub has no loaded children
      case 'Enter':
      case ' ': {
        if (this.activeNode < 0) this.activeNode = node;
        const p = { x: 0, y: 0 };
        this.renderNow();
        nodeXY(this.T, this.L, node, p);
        const r = this.root.getBoundingClientRect();
        e.preventDefault();
        this.cb.onClick?.(this.mkEvent(node, tree.childCount[node] === 0 ? 'tip' : 'node', 'keyboard', r.left + p.x, r.top + p.y));
        return;
      }
      case '+': case '=': this.zoomBy(e.shiftKey ? 1 : 1, 1.4, this.area.ax + this.area.aw / 2, this.area.ay + this.area.ah / 2); e.preventDefault(); return;
      case '-': case '_': this.zoomBy(1, 1 / 1.4, this.area.ax + this.area.aw / 2, this.area.ay + this.area.ah / 2); e.preventDefault(); return;
      case '0': this.fit(true); e.preventDefault(); return;
      default: return;
    }
    e.preventDefault();
    if (next >= 0) this.setActive(next);
  };

  // ------------------------------------------------------------- overview

  private ovGeom(): { x: number; y: number; w: number; h: number } | null {
    if (!this.opts.overview) return null;
    if (this.opts.layout === 'rectangular') return { x: this.W - OV_W - 4, y: this.area.ay, w: OV_W, h: this.area.ah };
    return { x: 10, y: this.H - OV_R - 34, w: OV_R, h: OV_R };
  }

  private ovStyleKey = '';
  private updateOverviewBox(): void {
    const g = this.ovGeom();
    if (!g) { this.ovWrap.style.display = 'none'; this.ovStyleKey = ''; return; }
    const s = this.ovWrap.style;
    const key = `${g.x}|${g.y}|${g.w}|${g.h}|${this.opts.layout}|${this.theme.background}|${this.theme.muted}|${this.theme.highlight}`;
    const v = this.view;
    const b = this.ovBox.style;
    if (key !== this.ovStyleKey) {
      this.ovStyleKey = key;
      s.display = 'block';
      s.left = g.x + 'px'; s.top = g.y + 'px'; s.width = g.w + 'px'; s.height = g.h + 'px';
      s.background = this.opts.layout === 'radial' ? this.theme.background : 'transparent';
      s.border = this.opts.layout === 'radial' ? `1px solid ${this.theme.muted}` : 'none';
      b.border = `1.5px solid ${this.theme.highlight}`;
      b.background = `color-mix(in srgb, ${this.theme.highlight} 14%, transparent)`;
    }
    if (this.opts.layout === 'rectangular') {
      const N = this.tree.tipCount;
      const y0 = Math.max(0, (v.y0 / N) * g.h), y1 = Math.min(g.h, (v.y1 / N) * g.h);
      const x0 = Math.max(2, 2 + v.x0 * (g.w - 4)), x1 = Math.min(g.w - 2, 2 + v.x1 * (g.w - 4));
      b.left = x0 + 'px'; b.top = y0 + 'px'; b.width = Math.max(4, x1 - x0) + 'px'; b.height = Math.max(3, y1 - y0) + 'px';
    } else {
      const s2 = g.w / 2.3; // world [-1.15, 1.15] -> strip
      const toX = (x: number) => g.w / 2 + x * s2, toY = (y: number) => g.h / 2 + y * s2;
      const x0 = Math.max(0, toX(v.x0)), x1 = Math.min(g.w, toX(v.x1)), y0 = Math.max(0, toY(v.y0)), y1 = Math.min(g.h, toY(v.y1));
      b.left = x0 + 'px'; b.top = y0 + 'px'; b.width = Math.max(4, x1 - x0) + 'px'; b.height = Math.max(4, y1 - y0) + 'px';
    }
  }

  private drawOverview(): void {
    this.ovDirty = false;
    const g = this.ovGeom();
    if (!g) return;
    const dpr = this.dpr;
    const c = this.ovCanvas;
    const cw = Math.round(g.w * dpr), ch = Math.round(g.h * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const ctx = this.ovCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.w, g.h);
    const rect = this.opts.layout === 'rectangular';
    const N = this.tree.tipCount;
    const area: Area = rect ? { ax: 2, ay: 0, aw: g.w - 4, ah: g.h, clipL: 0, clipT: 0, clipR: g.w, clipB: g.h } : { ax: 0, ay: 0, aw: g.w, ah: g.h, clipL: 0, clipT: 0, clipR: g.w, clipB: g.h };
    const vp: Viewport = rect ? { x0: 0, x1: 1, y0: 0, y1: N } : { x0: -1.15, x1: 1.15, y0: -1.15, y1: 1.15 };
    const T = makeTransform(this.opts.layout, g.w, g.h, vp, area, N);
    const P: CutParams = { lod: true, minPx: 2.5, budget: 6000, summaries: true };
    let minPx = 2.5;
    for (let k = 0; k < 6; k++) {
      P.minPx = minPx;
      const r = rect ? cutRect(this.tree, this.L, T, P, this.classOf, this.ovList, this.seen) : cutRadial(this.tree, this.L, T, P, this.classOf, this.ovList, this.seen);
      if (!r.overflow) break;
      minPx *= 2;
    }
    const S: Scene = { tree: this.tree, L: this.L, T, list: this.ovList, theme: this.theme, colours: this.colours, classOf: this.classOf, highlight: null, hlRanks: new Int32Array(0), hoverNode: -1, activeNode: -1, density: 'sparse', italic: false, format: this.opts.formatLabel, scale: this.dpr, thin: false };
    drawBody(ctx, S, 1);
    if (rect && this.hlRanks.length) {
      ctx.fillStyle = this.theme.highlight;
      for (let k = 0; k < this.hlRanks.length && k < 2000; k++) ctx.fillRect(0, (this.hlRanks[k] / N) * g.h - 1, g.w, 2.5);
    }
  }

  private ovMove(e: PointerEvent): void {
    const g = this.ovGeom();
    if (!g) return;
    const r = this.ovWrap.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const v = this.view;
    const w = v.x1 - v.x0, h = v.y1 - v.y0;
    let cx: number, cy: number;
    if (this.opts.layout === 'rectangular') {
      cy = (py / g.h) * this.tree.tipCount;
      cx = (px - 2) / (g.w - 4);
      // keep the x window when it already spans the whole tree
      if (w >= 0.999) cx = (v.x0 + v.x1) / 2;
    } else {
      const s2 = g.w / 2.3;
      cx = (px - g.w / 2) / s2;
      cy = (py - g.h / 2) / s2;
    }
    this.setViewport({ x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 });
  }
  private onOvDown = (e: PointerEvent) => {
    e.stopPropagation();
    this.ovDrag = true;
    this.ovWrap.setPointerCapture(e.pointerId);
    this.anim = null;
    this.noteInput();
    this.ovMove(e);
  };
  private onOvMove = (e: PointerEvent) => {
    e.stopPropagation();
    if (this.ovDrag) { this.noteInput(); this.ovMove(e); }
  };
  private onOvUp = (e: PointerEvent) => {
    e.stopPropagation();
    this.ovDrag = false;
    if (this.ovWrap.hasPointerCapture(e.pointerId)) this.ovWrap.releasePointerCapture(e.pointerId);
  };
}

export { K_NODE, K_STUB, K_SUMMARY, barWidth };
