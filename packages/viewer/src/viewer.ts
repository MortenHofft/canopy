// TreeViewer: the facade of the viewer. It owns the DOM skeleton (canvas, transient canvas, the pieces below), the canvas contexts,
// the render loop (requestAnimationFrame on demand: a frame is drawn only when something changed), the frame itself (cut, draw, stats),
// the source sync, hit-testing and hover, the corner notice, the events and the public API. No framework in here: the React component
// only forwards props.
//
// Everything else lives in a module with one job, wired together here:
//   view-state.ts     the viewport: area, fit, limits, zoom, target windows, animation (pure arithmetic, no DOM)
//   input.ts          wheel / pointer / pinch / click / key events -> calls on this class (keyboard.ts: where the cursor moves)
//   overlay.ts        label anchors over the canvas, the hidden list of tips in view, the live region
//   overview.ts       the strip / disc with the window box
//   detail-loader.ts  opening the stubs of a partial TreeSource
//   node-event.ts     the NodeEvent handed to the host app
// What stays here on purpose: the interaction-LOD state (noteInput / settle / reduced frames), because it is tied to the frame loop, and
// the focus-ring styling, because it needs the theme.

import { cladeName } from './clade-name.ts';
import type { Control, ControlPosition } from './control.ts';
import { cellRect, columnsWidth, drawColumns, layoutColumns, updateColumns, type CompiledColumn } from './columns.ts';
import { DetailLoader } from './detail-loader.ts';
import { mk } from './dom.ts';
import { Emitter, type Listener, type ListenOptions, type ViewerEventType } from './events.ts';
import { drawAxis, drawBody, drawHighlights, drawLabels, drawMarkers, drawRing, drawScaleBar, LabelList, TextMeasurer, type Scene } from './draw.ts';
import { makeTransform, sectorBBox, viewportEquals, type Transform } from './geom.ts';
import { HitIndex } from './hit.ts';
import { InputController, type InputHost } from './input.ts';
import { computeLayout, ensureTrig, type Layout } from './layout.ts';
import { live } from './live.ts';
import { DrawList, Seen, searchCut, type CutResult } from './lod.ts';
import { makeNodeEvent, toTreeEvent } from './node-event.ts';
import { LabelOverlay } from './overlay.ts';
import type { OverviewHost } from './overview.ts';
import { projectionFor, type LayoutProjection } from './projection.ts';
import { InMemorySource, isTreeSource, type TreeSource } from './source.ts';
import {
  DEFAULT_OPTIONS,
  FALLBACK_THEME,
  stripUndefined,
  themeEquals,
  type CladeColour,
  type Column,
  type FrameStats,
  type Hit,
  type NodeEvent,
  type ViewerOptions,
  type TreeData,
  type TreeSnapshot,
  type TreeTheme,
  type Viewport,
} from './types.ts';
import { THEME_CSS_VARS, themeFromCss } from './theme.ts';
import { ViewState, type ViewEnv, type ViewEvents } from './view-state.ts';

const THIN_PRIMS = 700; // radial: from this many primitives on, branches are one device pixel wide
const REDUCED_MINPX = 1.6; // collapse threshold factor while interacting (only when the last full frame was heavy)
const HEAVY_PRIMS = 1000;

/** What `new TreeViewer(...)` takes. One of `tree` and `source` is needed; `source` wins. */
export interface TreeViewerInit {
  /** The element the viewer fills: it appends its root there and follows its size (ResizeObserver). Give it a size. */
  target: HTMLElement;
  /** A tree in memory (wrapped in an `InMemorySource`) ... */
  tree?: TreeData;
  /** ... or a source that loads parts of a tree on demand. */
  source?: TreeSource;
  /** Over `DEFAULT_OPTIONS`; all but `softwareCanvas` can be changed later with `setOptions`. */
  options?: Partial<ViewerOptions>;
  /** Over the CSS custom properties and `FALLBACK_THEME`; see `setTheme`. */
  theme?: Partial<TreeTheme>;
  columns?: Column[];
  /** Controls to add, in this order (none by default; `defaultControls()` gives the usual set). */
  controls?: Control[];
}

/** For built-in controls that draw from the viewer's own state (the overview): not a stable API, may change in any release. */
export interface ViewerInternals {
  /** What the overview reads (live getters) and asks for. */
  readonly overviewHost: OverviewHost;
  /** Bumped whenever the tree, colours, highlights, theme, size or layout changed: a picture drawn from them is stale. */
  sceneVersion(): number;
  /** Reserve (or free) the overview strip right of the rectangular plot; refits while the view is still fitted. */
  reserveOverview(on: boolean): void;
}

const INTERNALS = new WeakMap<TreeViewer, ViewerInternals>();
/** The viewer a control is on (a control has one at a time). */
const OWNER = new WeakMap<Control, TreeViewer>();

/** @internal See `ViewerInternals`. */
export function viewerInternals(v: TreeViewer): ViewerInternals {
  const i = INTERNALS.get(v);
  if (!i) throw new Error('not a live TreeViewer');
  return i;
}

const CORNERS: Exclude<ControlPosition, 'custom'>[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export class TreeViewer {
  // ------------------------------------------------------------- DOM
  /** The tree element: role="tree", focusable, the canvases, labels and screen-reader list; the input controller listens on it. */
  readonly root: HTMLDivElement;
  /** What the viewer appended to its target (class phylo-viewer): the tree element and, beside it (not inside the tree role), the
   *  control layer. */
  readonly container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private top: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** The main canvas has an alpha channel: only while the background is not opaque (an opaque canvas composites faster). */
  private canvasAlpha = false;
  private topCtx: CanvasRenderingContext2D;
  private notice: HTMLDivElement;
  private ro: ResizeObserver | null = null;
  private overlay: LabelOverlay;
  private input: InputController;
  /** The control layer over the canvas (data-phylo-ui: the input controller ignores events from inside it) and its corner boxes. */
  private uiLayer: HTMLDivElement;
  private corners = new Map<ControlPosition, HTMLDivElement>();
  private controls: Control[] = [];
  private sceneVersion = 0;
  private overviewReserved = false;

  // ------------------------------------------------------------- state
  private opts: ViewerOptions;
  private theme: TreeTheme;
  private themeOverrides: Partial<TreeTheme> = {};
  private cssTheme: Partial<TreeTheme> = {};
  private schemeQuery: MediaQueryList | null = null;
  private events = new Emitter();
  private readyEmitted = false;
  private layouts = new Map<boolean, Layout>();
  private L: Layout;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private vs: ViewState; // the viewport (view, fitted, area, animation)
  private T!: Transform;
  private proj!: LayoutProjection; // the layout projection of T and L (node positions, clade extents), rebuilt with T
  private columns: CompiledColumn[] = [];
  private classOf: Uint8Array | null = null;
  private colours: string[] = [''];
  private cladeKey = '';
  private clades: CladeColour[] = [];
  private detail: DetailLoader;
  private hl: Uint8Array | null = null;
  private hlRanks = new Int32Array(0);
  private hlIds: string[] = []; // the ids of the last setHighlighted, to skip an identical call
  private collapsedNodes: number[] = []; // node ids of the last setCollapsed
  private collapsedRank: Uint8Array | null = null; // by tip rank: 1 = the tip stands for a collapsed clade
  private list = new DrawList();
  private seen = new Seen();
  private hit: HitIndex;
  private measurer = new TextMeasurer(); // label widths of this renderer's fonts only
  private labels = new LabelList();
  private hoverNode = -1;
  private hoverKind: Hit['kind'] | '' = '';
  private hoverRun = -1; // first member of the hovered run of small siblings, -1 for none (hoverNode is then their parent)
  private activeNode = -1;
  private raf = 0;
  private dirty = true;
  private topDirty = true;
  private pendingHover: { x: number; y: number } | null = null;
  private destroyed = false;
  readonly stats: FrameStats = {
    frameMs: 0,
    cutMs: 0,
    drawMs: 0,
    visited: 0,
    drawn: 0,
    summaries: 0,
    tips: 0,
    labels: 0,
    minPxUsed: 0,
    budgetRetries: 0,
    budgetHit: false,
    truncated: false,
    frames: 0,
    budget: 0,
    forced: 0,
    summaryTips: 0,
    mergedTips: 0,
    reduced: false,
    scale: 1,
  };
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
  private lastEmitted: Viewport | null = null;

  /** The tree as of the last source version we looked at. Re-read through source.snapshot() when the version changes (syncSource),
   *  so a frame always works on one consistent set of arrays. For an in-memory source the version never changes. */
  private tree: TreeSnapshot;
  private source: TreeSource;
  private srcVersion: number;
  private unsubscribe: () => void;

  private host: HTMLElement;

  constructor(init: TreeViewerInit) {
    const tree = init.source ?? init.tree;
    if (!tree) throw new TypeError('TreeViewer: `tree` or `source` is required');
    if (!init.target) throw new TypeError('TreeViewer: `target` is required');
    this.host = init.target;
    this.source = isTreeSource(tree) ? tree : new InMemorySource(tree);
    this.srcVersion = this.source.version;
    this.tree = this.source.snapshot();
    this.unsubscribe = this.source.subscribe(() => {
      this.syncSource();
      this.invalidate();
    });
    this.opts = { ...DEFAULT_OPTIONS, ...stripUndefined(init.options ?? {}) };
    this.themeOverrides = { ...stripUndefined(init.theme ?? {}) };
    this.theme = { ...FALLBACK_THEME, ...this.themeOverrides };
    this.L = this.layoutFor(this.opts.branchLengths);
    this.hit = new HitIndex();
    this.detail = new DetailLoader(this.source, () => this.invalidate());
    this.vs = new ViewState(this.viewEnv(), this.viewEvents());

    const fill = 'position:absolute;left:0;top:0;width:100%;height:100%;';
    this.container = mk('div', 'position:relative;width:100%;height:100%;overflow:hidden');
    this.container.className = 'phylo-viewer';
    this.root = mk(
      'div',
      'position:relative;width:100%;height:100%;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none;outline:none;cursor:grab',
    );
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'tree');
    this.root.setAttribute('aria-label', this.opts.ariaLabel);
    this.root.setAttribute('aria-roledescription', 'phylogenetic tree viewer');
    this.root.dataset.treeview = '';
    this.root.className = 'phylo-tree';
    this.canvas = mk('canvas', fill);
    this.canvas.setAttribute('aria-hidden', 'true');
    this.top = mk('canvas', fill + 'pointer-events:none');
    this.top.setAttribute('aria-hidden', 'true');
    this.overlay = new LabelOverlay(() => {
      if (this.destroyed) return;
      this.renderNow();
      this.overlay.updateList(this.list, this.tree, this.opts.formatLabel);
    });
    this.notice = mk(
      'div',
      'position:absolute;left:8px;top:6px;pointer-events:none;display:none;white-space:nowrap;max-width:calc(100% - 16px);overflow:hidden;text-overflow:ellipsis',
    );
    this.notice.className = 'phylo-notice';
    this.notice.setAttribute('role', 'status');
    this.uiLayer = mk('div', 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none');
    this.uiLayer.className = 'phylo-ui';
    this.uiLayer.dataset.phyloUi = '';
    this.root.append(this.canvas, this.top, this.overlay.layer, this.notice, this.overlay.srList, this.overlay.live);
    // the control layer is the tree element's sibling: a tree may only own tree items, so menus, buttons and the search field stay out
    this.container.append(this.root, this.uiLayer);
    // the theme from CSS custom properties of the target (and its ancestors); re-read when the colour scheme preference changes
    this.cssTheme = themeFromCss(this.host);
    this.theme = { ...FALLBACK_THEME, ...this.cssTheme, ...this.themeOverrides };
    this.syncCssVars();
    if (typeof matchMedia === 'function') {
      this.schemeQuery = matchMedia('(prefers-color-scheme: dark)');
      this.schemeQuery.addEventListener?.('change', this.onScheme);
    }
    this.host.appendChild(this.container);
    this.canvasAlpha = !isOpaque(this.theme.background);
    this.ctx = this.mainContext();
    this.topCtx = this.top.getContext('2d', { willReadFrequently: this.opts.softwareCanvas })!;

    this.input = new InputController(this.root, this.inputHost());
    // the wheel over controls and the overview zooms the tree as it does over the tree, except inside parts that scroll themselves
    this.uiLayer.addEventListener('wheel', this.onUiWheel, { passive: false });
    this.root.addEventListener('focusin', this.onFocusIn);
    this.root.addEventListener('focusout', this.onFocusOut);
    this.ro = new ResizeObserver(() => {
      if (!this.destroyed) this.measure();
    });
    this.ro.observe(this.host);
    this.measure();
    if (init.columns?.length) this.columns = updateColumns(this.tree, [], init.columns).columns;
    INTERNALS.set(this, {
      overviewHost: this.overviewHost(),
      sceneVersion: () => this.sceneVersion,
      reserveOverview: (on) => {
        if (on === this.overviewReserved) return;
        this.overviewReserved = on;
        if (this.vs.fitted) this.fit(false);
        this.invalidate();
      },
    });
    this.fit(false);
    for (const c of init.controls ?? []) this.addControl(c);
    this.invalidate();
    // web fonts arrive after the first frame
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts) {
      void fonts.ready.then(() => this.invalidate(true));
      fonts.addEventListener?.('loadingdone', this.onFonts);
    }
  }

  private onFonts = () => this.invalidate(true);

  private onUiWheel = (e: WheelEvent) => {
    if ((e.target as Element | null)?.closest?.('[data-phylo-scroll]')) return; // a list that scrolls: let it
    this.input.wheel(e);
  };

  // ------------------------------------------------------------- wiring of the modules
  // The modules read the renderer's current fields through live() objects (getters, never copies) and report back through callbacks.

  private viewEnv(): ViewEnv {
    return live<ViewEnv>(
      {
        layout: () => this.opts.layout,
        overview: () => this.overviewReserved,
        axis: () => this.opts.axis,
        rowHeight: () => this.opts.rowHeight,
        W: () => this.W,
        H: () => this.H,
        tree: () => this.tree,
        L: () => this.L,
        columnsWidth: () => columnsWidth(this.columns),
        hasColumns: () => this.columns.length > 0,
      },
      { placeColumns: (left) => layoutColumns(this.columns, left) },
    );
  }

  private viewEvents(): ViewEvents {
    return {
      changed: (step) => {
        if (!step) this.afterViewChange();
        else {
          this.hit.invalidate();
          this.dirty = true;
          this.emitViewport();
          this.overlay.scheduleList();
        }
      },
      needFrame: () => this.schedule(),
      moving: () => this.noteInput(),
    };
  }

  private overviewHost(): OverviewHost {
    return live<OverviewHost>(
      {
        layout: () => this.opts.layout,
        enabled: () => this.overviewReserved,
        W: () => this.W,
        H: () => this.H,
        dpr: () => this.dpr,
        view: () => this.vs.view,
        area: () => this.vs.area,
        tree: () => this.tree,
        L: () => this.L,
        theme: () => this.theme,
        classOf: () => this.classOf,
        colours: () => this.colours,
        hlRanks: () => this.hlRanks,
        measure: () => this.measurer,
        seen: () => this.seen,
      },
      {
        formatLabel: (id) => this.opts.formatLabel(id),
        noteInput: () => this.noteInput(),
        cancelAnim: () => this.vs.cancelAnim(),
        setViewport: (v) => this.vs.setViewport(v),
        zoomAtWorld: (fx, fy, wx, wy) => this.vs.zoomAtWorld(fx, fy, wx, wy),
      },
    );
  }

  private inputHost(): InputHost {
    return live<InputHost>(
      {
        layout: () => this.opts.layout,
        area: () => this.vs.area,
        view: () => this.vs.view,
        tree: () => this.tree,
        activeNode: () => this.activeNode,
        hovering: () => this.hoverNode >= 0,
      },
      {
        noteInput: () => this.noteInput(),
        cancelAnim: () => this.vs.cancelAnim(),
        setViewport: (v) => this.vs.setViewport(v),
        zoomBy: (fx, fy, px, py) => this.vs.zoomBy(fx, fy, px, py),
        fit: (animate) => this.fit(animate),
        zoomToRow: (row, animate) => this.zoomToRow(row, animate),
        setCursor: (c) => {
          this.root.style.cursor = c;
        },
        pick: (x, y) => {
          this.renderNow();
          this.ensureHit();
          return this.queryHit(x, y);
        },
        click: (h, clientX, clientY) => {
          this.activeNode = -1;
          this.topDirty = true;
          this.schedule();
          this.emitNode('click', makeNodeEvent(this.tree, h.node, h.kind, 'pointer', clientX, clientY, h.run));
        },
        hover: (p) => {
          this.pendingHover = p;
          if (p) this.schedule();
          else this.dropHover();
        },
        dropHover: () => this.dropHover(),
        setActive: (node) => this.setActive(node),
        activate: (node) => {
          if (this.activeNode < 0) this.activeNode = node;
          const p = { x: 0, y: 0 };
          this.renderNow();
          const tree = this.tree; // after renderNow: it may have picked up a new snapshot
          this.proj.nodeXY(node, p);
          const r = this.root.getBoundingClientRect();
          this.emitNode('click', makeNodeEvent(tree, node, tree.childCount[node] === 0 ? 'tip' : 'node', 'keyboard', r.left + p.x, r.top + p.y));
        },
      },
    );
  }

  /** The projection reads the tree and layout arrays of the moment it was built: rebuild it whenever either is replaced, so position
   *  queries between that and the next render (locateNode, nodeBounds, focus) do not read the old arrays. */
  private rebuildProj(): void {
    if (this.T) this.proj = projectionFor(this.tree, this.L, this.T);
  }

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
    this.rebuildProj();
    this.hit = new HitIndex();
    this.applyClades();
    this.applyCollapsed();
    this.activeNode = -1;
    this.clearHover();
    this.vs.resetLabelReserve();
    this.sceneVersion++;
    this.minPxHint = 0;
    this.events.emit('sourcechange', { version: v });
  }

  /** Row of the snapshot for a node id of the public API (preorder id of the full tree), -1 when that node is not loaded. */
  private rowOf(node: number): number {
    return this.tree.globalId === null ? (node >= 0 && node < this.tree.nodeCount ? node : -1) : this.tree.toLocal(node);
  }

  // ================================================================= public API

  // ---- events

  /** Listen to an event; returns the function that removes the listener. See `ViewerEventMap` for the events and `ListenOptions`
   *  for default actions. */
  on<K extends ViewerEventType>(type: K, listener: Listener<K>, opts?: ListenOptions): () => void {
    return this.events.on(type, listener, opts);
  }
  once<K extends ViewerEventType>(type: K, listener: Listener<K>, opts?: ListenOptions): () => void {
    return this.events.on(type, listener, { ...opts, once: true });
  }
  off<K extends ViewerEventType>(type: K, listener: Listener<K>): void {
    this.events.off(type, listener);
  }

  private emitNode(type: 'click' | 'hover', e: NodeEvent | null): void {
    if (!this.events.has(type)) return;
    this.events.emit(type, e ? toTreeEvent(e, this.source) : (null as never));
  }

  // ---- controls

  /** Add a control: its element goes to its corner of the control layer (or to its `target`), then `setViewer(this)` is called.
   *  Adding a control twice does nothing; a control that another viewer holds is first removed from it (a control has one viewer). */
  addControl(control: Control): void {
    if (this.destroyed || this.controls.includes(control)) return;
    const owner = OWNER.get(control);
    if (owner && owner !== this) owner.removeControl(control);
    OWNER.set(control, this);
    const box = control.target ?? this.cornerBox(control.position ?? 'top-left');
    if (control.target) control.element.dataset.phyloUi = '';
    // the layer itself lets events through to the tree, so a control catches its own unless it set pointer-events itself (a layer
    // over the whole tree sets 'none' to let clicks through)
    else if (!control.element.style.pointerEvents) control.element.style.pointerEvents = 'auto';
    box.appendChild(control.element);
    this.controls.push(control);
    control.setViewer(this);
  }

  /** Remove a control: `setViewer(null)`, then its element is taken out of the page. */
  removeControl(control: Control): void {
    const k = this.controls.indexOf(control);
    if (k < 0) return;
    this.controls.splice(k, 1);
    if (OWNER.get(control) !== this) return; // moved to another viewer meanwhile: leave it there
    OWNER.delete(control);
    control.setViewer(null);
    control.element.remove();
  }

  getControls(): readonly Control[] {
    return this.controls.slice();
  }

  private cornerBox(pos: ControlPosition): HTMLElement {
    if (pos === 'custom') return this.uiLayer;
    let box = this.corners.get(pos);
    if (!box) {
      const [v, h] = pos.split('-');
      // flex column, pointer events only on the controls themselves; the stylesheet adds the gaps
      // the right corners keep clear of a strip along the right edge (the overview sets --phylo-inset-right while it shows one)
      const side = h === 'right' ? 'right:var(--phylo-inset-right,0px)' : 'left:0';
      box = mk('div', `position:absolute;${v}:0;${side};display:flex;flex-direction:column;align-items:${h === 'left' ? 'flex-start' : 'flex-end'}`);
      box.className = `phylo-controls phylo-controls--${pos}`;
      // keep the boxes in a fixed DOM order (reading order: top left, top right, bottom left, bottom right)
      const after = CORNERS.slice(CORNERS.indexOf(pos as (typeof CORNERS)[number]) + 1)
        .map((c) => this.corners.get(c))
        .find((b) => b);
      this.uiLayer.insertBefore(box, after ?? null);
      this.corners.set(pos, box);
    }
    return box;
  }

  // ---- state

  /** The element the viewer appended to its target (class phylo-viewer): the tree element and the control layer. */
  get element(): HTMLDivElement {
    return this.container;
  }
  /** The tree element (role="tree", focusable; the canvases and labels). */
  get treeElement(): HTMLDivElement {
    return this.root;
  }
  /** Give keyboard focus to the tree. */
  focus(): void {
    this.root.focus({ preventScroll: true });
  }
  /** The tree source the viewer reads (an `InMemorySource` around a `tree` passed in). */
  getSource(): TreeSource {
    return this.source;
  }
  /** The rows currently loaded (for an in-memory tree: the whole tree). Replaced, not mutated, when a partial source loads more. */
  getTree(): TreeSnapshot {
    return this.tree;
  }
  /** Node id (preorder id of the full tree) of the tip with this label, or -1 when there is none or it is not loaded. */
  tipNode(tipId: string): number {
    const row = this.tree.tipIndex(tipId);
    if (row < 0) return -1;
    return this.tree.globalId === null ? row : this.tree.globalId[row];
  }
  /** The theme in force: `FALLBACK_THEME`, then the CSS custom properties (see theme.ts), then the overrides of `setTheme`. */
  getTheme(): Readonly<TreeTheme> {
    return this.theme;
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }

  get layout(): Layout {
    return this.L;
  }
  get options(): Readonly<ViewerOptions> {
    return this.opts;
  }
  get size(): { width: number; height: number } {
    return { width: this.W, height: this.H };
  }

  /** Apply options. Keys that are undefined or `Object.is`-equal to the current value (functions by identity) are ignored, and a call
   *  that changes nothing returns without invalidating, so a caller may pass its whole option set on every render. */
  setOptions(patch: Partial<ViewerOptions>): void {
    const o = this.opts;
    const p: Partial<ViewerOptions> = {};
    let any = false;
    for (const k of Object.keys(patch) as (keyof ViewerOptions)[]) {
      const v = patch[k];
      if (v === undefined || Object.is(v, o[k])) continue;
      (p as Record<string, unknown>)[k] = v;
      any = true;
    }
    if (!any) return;
    const changed = Object.keys(p) as (keyof ViewerOptions)[];
    const lengthsChanged = p.branchLengths !== undefined && p.branchLengths !== o.branchLengths;
    const layoutChanged = p.layout !== undefined && p.layout !== o.layout;
    const refit =
      lengthsChanged || layoutChanged || (p.axis !== undefined && p.axis !== o.axis) || (p.rowHeight !== undefined && p.rowHeight !== o.rowHeight);
    // the pooled label elements take their text (formatLabel) and link (tipHref) when they are created, so a change of either rebuilds them
    const labelsChanged = (p.tipHref !== undefined && p.tipHref !== o.tipHref) || (p.formatLabel !== undefined && p.formatLabel !== o.formatLabel);
    this.opts = { ...o, ...p };
    if (layoutChanged || lengthsChanged) this.minPxHint = 0;
    if (p.dprCap !== undefined && p.dprCap !== o.dprCap) this.setSize(this.W, this.H);
    if (p.radialMaxNodes !== undefined || p.summaryNotice !== undefined || p.interactionLOD !== undefined) this.minPxHint = 0;
    if (p.ariaLabel) this.root.setAttribute('aria-label', p.ariaLabel);
    if (lengthsChanged) {
      this.L = this.layoutFor(this.opts.branchLengths);
      this.rebuildProj();
      this.hit.invalidate();
    }
    if (labelsChanged) this.overlay.clear();
    if (refit) {
      this.activeNode = -1;
      if (this.vs.fitted || layoutChanged || lengthsChanged || p.rowHeight !== undefined) this.fit(false);
    }
    this.sceneVersion++;
    this.invalidate();
    this.events.emit('optionschange', { options: this.opts, changed });
  }

  /** Set the theme overrides: these fields over the theme read from CSS custom properties, over `FALLBACK_THEME` (a field left out,
   *  or undefined, is the CSS or fallback value; the overrides of an earlier call are replaced, not merged). No-op when the resulting theme equals the current one (`categorical` element-wise),
   *  so a theme rebuilt per render costs nothing. */
  setTheme(t: Partial<TreeTheme>): void {
    this.themeOverrides = { ...stripUndefined(t) };
    this.applyTheme({ ...FALLBACK_THEME, ...this.cssTheme, ...this.themeOverrides });
  }

  /** Read the theme's CSS custom properties again (after a stylesheet or class change that the viewer cannot see). The viewer does
   *  this itself when it is created and when the colour scheme preference changes. */
  refreshTheme(): void {
    if (this.destroyed) return;
    this.cssTheme = themeFromCss(this.host);
    this.applyTheme({ ...FALLBACK_THEME, ...this.cssTheme, ...this.themeOverrides });
  }

  private onScheme = () => this.refreshTheme();

  /** Put the theme in force on the root as custom properties, so the DOM inside it (controls, popups) matches the canvas also when the
   *  theme came from `setTheme` rather than CSS. The viewer reads CSS from its target, never from its root, so this cannot feed back. */
  private syncCssVars(): void {
    const s = this.container.style;
    const t = this.theme;
    for (const k of ['background', 'foreground', 'muted', 'branch', 'highlight', 'summary', 'fontFamily'] as const)
      s.setProperty(THEME_CSS_VARS[k], t[k]);
  }

  private mainContext(): CanvasRenderingContext2D {
    const cc = { alpha: this.canvasAlpha, willReadFrequently: this.opts.softwareCanvas } as CanvasRenderingContext2DSettings;
    return this.canvas.getContext('2d', cc)!;
  }

  private applyTheme(next: TreeTheme): void {
    if (themeEquals(next, this.theme)) return;
    this.theme = next;
    // an opaque canvas cannot show the page through a transparent background (it clears to black): change canvas when that changes
    const alpha = !isOpaque(next.background);
    if (alpha !== this.canvasAlpha) {
      this.canvasAlpha = alpha;
      const old = this.canvas;
      this.canvas = old.cloneNode(false) as HTMLCanvasElement; // same style, attributes and size
      this.canvas.width = old.width;
      this.canvas.height = old.height;
      old.replaceWith(this.canvas);
      old.width = old.height = 0; // release its backing store
      this.ctx = this.mainContext();
    }
    this.syncCssVars();
    this.sceneVersion++;
    this.overlay.clear();
    this.invalidate(true);
    this.events.emit('themechange', this.theme);
  }

  /** Colour clades: each entry colours the branches, summaries, markers and tip labels of the clade below `node`. Where clades nest
   *  the innermost wins, whatever the order; for the same node the later entry wins. No-op for the same entries in the same order. */
  setClades(clades: CladeColour[]): void {
    const key = clades.map((c) => c.node + ':' + c.colour + ':' + (c.label ?? '')).join('|');
    if (key === this.cladeKey) return;
    this.cladeKey = key;
    this.clades = clades.map((c) => ({ ...c }));
    this.applyClades();
    this.sceneVersion++;
    this.invalidate();
    this.events.emit('cladeschange', this.getClades());
  }

  getClades(): CladeColour[] {
    return this.clades.map((c) => ({ ...c }));
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
    // filled in preorder (an ancestor's row comes before its descendants'), so an inner clade paints over the one around it; the
    // sort is stable, so for the same node the later entry wins
    const placed = clades
      .map((c) => ({ c, r: this.rowOf(c.node) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r);
    for (const { c, r } of placed) {
      let k = colours.indexOf(c.colour);
      if (k < 0) {
        k = Math.min(255, colours.push(c.colour) - 1);
      }
      cls.fill(k, r, this.tree.subtreeEnd[r]);
    }
    this.classOf = cls;
    this.colours = colours;
  }

  /** Tips (node ids) that stand for collapsed clades, drawn as a triangle instead of a dot with the label moved past it. Collapsing
   *  itself happens in the data (the page replaces the clade by one tip, e.g. with tree-ops' collapseClades); this only marks such
   *  tips. Ids that are not tips are ignored. No-op for the same ids in the same order. */
  setCollapsed(nodes: number[]): void {
    const last = this.collapsedNodes;
    if (nodes.length === last.length && nodes.every((n, i) => n === last[i])) return;
    this.collapsedNodes = nodes.slice();
    this.applyCollapsed();
    this.sceneVersion++;
    this.invalidate();
  }

  private applyCollapsed(): void {
    const t = this.tree;
    let marks: Uint8Array | null = null;
    for (const n of this.collapsedNodes) {
      const r = this.rowOf(n);
      if (r < 0 || t.childCount[r] !== 0) continue;
      marks ??= new Uint8Array(t.tipCount);
      marks[t.tipRank[r]] = 1;
    }
    this.collapsedRank = marks;
  }

  /** No-op when the ids equal (element-wise, in order) the last ones passed; the array is copied, so mutating it later cannot hide a change. */
  setHighlighted(tipIds: string[]): void {
    const last = this.hlIds;
    if (tipIds.length === last.length && tipIds.every((id, i) => id === last[i])) return;
    this.hlIds = tipIds.slice();
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
    this.sceneVersion++;
    this.invalidate();
    this.events.emit('highlightchange', this.hlIds.slice());
  }

  /** The tip labels last passed to `setHighlighted` (unknown ones included). */
  getHighlighted(): string[] {
    return this.hlIds.slice();
  }

  /** Only the columns whose spec changed are compiled again (see `updateColumns`); `values` is compared by reference. No-op when nothing changed. */
  setColumns(cols: Column[]): void {
    const hadW = columnsWidth(this.columns);
    const next = updateColumns(this.tree, this.columns, cols);
    if (next.same) return;
    this.columns = next.columns;
    const changed = columnsWidth(this.columns) !== hadW || this.columns.length > 0 !== hadW > 0;
    if (changed && this.vs.fitted) this.fit(false);
    this.hit.invalidate();
    this.invalidate();
  }

  getViewport(): Viewport {
    return { ...this.vs.view };
  }

  setViewport(v: Viewport, animate = false): void {
    this.vs.setViewport(v, animate);
  }

  /** Fit the whole tree (and the columns) into the container. */
  fit(animate = true): void {
    this.vs.fit(animate);
  }

  /** Zoom by factors fx, fy (>1 zooms in) keeping the layout point under (px, py) fixed. */
  zoomBy(fx: number, fy: number, px: number, py: number): void {
    this.vs.zoomBy(fx, fy, px, py);
  }

  focusTip(rank: number, animate = false): void {
    if (rank < 0 || rank >= this.tree.tipCount) return;
    const node = this.tree.tipNode[rank];
    if (node < 0) return; // the tip's row is not loaded
    this.activeNode = -1;
    this.vs.setViewport(this.vs.focusViewport(node), animate);
  }

  zoomToNode(id: number, animate = false): void {
    const row = this.rowOf(id);
    if (row >= 0) this.zoomToRow(row, animate);
  }

  /** zoomToNode for a row of the snapshot (a hit's node), which with a partial source is not the node id of the public API. */
  private zoomToRow(row: number, animate: boolean): void {
    this.vs.setViewport(this.vs.cladeViewport(row), animate);
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
    this.proj.nodeXY(i, p);
    const m = isTip ? 0 : 1; // a tip row at the very edge of the fit view still counts as in view
    if (p.x < this.T.clipL + m || p.y < this.T.clipT + m || p.x > this.T.clipR - m || p.y > this.T.clipB - m) return null;
    const r = this.root.getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }

  /** Where node `id` is under the current view, in px relative to the viewer element, without drawing a frame (so it is cheap enough
   *  for a `frame` or `viewchange` listener); null when the node is not loaded, there is no frame yet, or it lies outside the plot area.
   *  Unlike `locateNode`, an internal node hidden inside a collapsed summary still gets its position. */
  nodePosition(id: number): { x: number; y: number } | null {
    const i = this.rowOf(id);
    if (i < 0 || !this.T || !this.proj) return null;
    const p = { x: 0, y: 0 };
    this.proj.nodeXY(i, p);
    const T = this.T;
    if (p.x < T.clipL - 0.5 || p.y < T.clipT - 0.5 || p.x > T.clipR + 0.5 || p.y > T.clipB + 0.5) return null;
    return p;
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
      this.proj.nodeXY(i, p);
      x0 = p.x - 5;
      x1 = p.x + 5;
      y0 = p.y - 5;
      y1 = p.y + 5;
    } else if (T.kind === 'rectangular') {
      x0 = T.ox + this.L.X[i] * T.kx;
      x1 = T.ox + this.L.XMAX[i] * T.kx;
      y0 = T.oy + this.tree.leafStart[i] * T.ky;
      y1 = T.oy + this.tree.leafEnd[i] * T.ky;
    } else {
      const bb = new Float64Array(4);
      sectorBBox(T.cx, T.cy, this.L.X[i] * T.k, this.L.XMAX[i] * T.k, this.tree.leafStart[i] * T.da, this.tree.leafEnd[i] * T.da, bb);
      x0 = bb[0];
      y0 = bb[1];
      x1 = bb[2];
      y1 = bb[3];
    }
    x0 = Math.max(T.clipL, x0);
    y0 = Math.max(T.clipT, y0);
    x1 = Math.min(T.clipR, x1);
    y1 = Math.min(T.clipB, y1);
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

  getStats(): FrameStats & {
    layoutMs: number;
    hitBuildMs: number;
    avgFrameMs: number;
    maxFrameMs: number;
    listLength: number;
    hitItems: number;
    hitEntries: number;
    kx: number;
    ky: number;
  } {
    return {
      ...this.stats,
      layoutMs: this.L.layoutMs,
      hitBuildMs: this.hit.builtMs,
      avgFrameMs: this.msN ? this.msSum / this.msN : 0,
      maxFrameMs: this.msMax,
      listLength: this.list.count,
      hitItems: this.hit.items,
      hitEntries: this.hit.entries,
      kx: this.T?.kx ?? 0,
      ky: this.T?.ky ?? 0,
    };
  }
  resetFrameTimes(): void {
    this.msSum = 0;
    this.msN = 0;
    this.msMax = 0;
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
    if (this.refineTimer) {
      clearTimeout(this.refineTimer);
      this.refineTimer = 0;
    }
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
    let sum = 0,
      min = Infinity,
      max = 0,
      cut = 0,
      draw = 0;
    for (let k = 0; k < n; k++) {
      this.dirty = true;
      this.render();
      sum += this.stats.frameMs;
      cut += this.stats.cutMs;
      draw += this.stats.drawMs;
      min = Math.min(min, this.stats.frameMs);
      max = Math.max(max, this.stats.frameMs);
    }
    return { meanMs: sum / n, minMs: min, maxMs: max, cutMs: cut / n, drawMs: draw / n };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.events.emit('destroy', undefined);
    this.destroyed = true; // from here on isDestroyed() is true, so controls do not act on the viewer while they are removed
    for (const c of this.controls.slice().reverse()) this.removeControl(c);
    this.events.clear();
    INTERNALS.delete(this);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.overlay.destroy();
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.ro?.disconnect();
    this.ro = null;
    (document as Document & { fonts?: FontFaceSet }).fonts?.removeEventListener?.('loadingdone', this.onFonts);
    this.schemeQuery?.removeEventListener?.('change', this.onScheme);
    this.input.destroy();
    this.uiLayer.removeEventListener('wheel', this.onUiWheel);
    this.container.remove();
    // release the backing stores
    for (const c of [this.canvas, this.top]) {
      c.width = 0;
      c.height = 0;
    }
    this.columns = [];
    this.layouts.clear();
    this.unsubscribe();
    this.detail.destroy();
  }

  // ================================================================= layout, size

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
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    this.setSize(w, h);
  }

  private setSize(w: number, h: number): void {
    if (w === this.W && h === this.H && this.effScale() === this.dpr) return;
    const keep = this.vs.beforeResize();
    const resized = w !== this.W || h !== this.H;
    this.W = w;
    this.H = h;
    this.dpr = this.effScale();
    for (const c of [this.canvas, this.top]) {
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    }
    this.vs.afterResize(keep);
    this.sceneVersion++;
    this.hit.invalidate();
    this.invalidate();
    if (resized) this.events.emit('resize', { width: w, height: h });
  }

  // ================================================================= view changes

  private afterViewChange(): void {
    this.hit.invalidate();
    this.invalidate();
    this.overlay.scheduleList();
    this.emitViewport();
  }

  private emitViewport(): void {
    const view = this.vs.view;
    if (this.lastEmitted && viewportEquals(this.lastEmitted, view, 1e-12)) return;
    this.lastEmitted = { ...view };
    if (this.events.has('viewchange')) this.events.emit('viewchange', { ...view });
  }

  // ================================================================= frame loop

  invalidate(fonts = false): void {
    if (this.destroyed) return;
    this.dirty = true;
    this.topDirty = true;
    if (fonts) this.overlay.clear();
    this.schedule();
  }

  private schedule(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame((now) => {
      this.raf = 0;
      if (this.destroyed) return;
      if (this.vs.animating) this.vs.stepAnim(now);
      if (this.dirty) this.render();
      if (this.pendingHover && !this.interacting) this.doHover();
      if (this.topDirty) this.drawTop();
      if (this.vs.animating) this.schedule();
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

  private fitCut(base: number, budget: number, summaries: boolean, useHint: boolean): { res: CutResult; minPx: number; retries: number } {
    const r = searchCut(this.proj, this.classOf, this.list, this.seen, {
      lod: this.opts.lod,
      base,
      budget,
      summaries,
      hint: useHint ? this.minPxHint : 0,
    });
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
    const vs = this.vs;
    vs.computeArea();
    this.T = makeTransform(opts.layout, W, H, vs.view, vs.area, tree.tipCount);
    this.proj = projectionFor(tree, L, this.T);
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
    const cutRes = this.fitCut(base, budget, opts.showSummaries, !reduced);
    const { minPx, retries } = cutRes;
    const res = cutRes.res;
    const cutMs = performance.now() - tc;
    this.hit.invalidate();
    if (!reduced) this.lastFullDrawn = this.list.count;

    // ---- draw
    const td = performance.now();
    // a background that is not opaque (transparent, rgba) would otherwise show the frames before this one
    if (this.canvasAlpha) ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, W, H);
    const S: Scene = {
      proj: this.proj,
      list: this.list,
      theme: this.theme,
      colours: this.colours,
      classOf: this.classOf,
      highlight: this.hl,
      hlRanks: this.hlRanks,
      collapsed: this.collapsedRank,
      hoverNode: this.hoverNode,
      activeNode: this.activeNode,
      density: opts.labelDensity,
      format: opts.formatLabel,
      scale: dpr,
      thin: !rect && this.list.count >= THIN_PRIMS,
      measure: this.measurer,
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, rect ? T.clipT - 6 : 0, rect ? T.clipR : W, rect ? T.clipB - T.clipT + 12 : H);
    ctx.clip();
    drawHighlights(ctx, S, rect ? T.clipR + (columnsWidth(this.columns) || 0) : W);
    drawBody(ctx, S, this.theme.branchWidth);
    drawMarkers(ctx, S);
    drawLabels(ctx, S, this.labels);
    ctx.restore();
    if (rect) {
      const barC = this.theme.categorical[1] ?? this.theme.highlight;
      drawColumns(ctx, this.columns, tree, T, this.theme, T.area.ay - 8, barC, { alignStyle: opts.alignStyle, alignRowGap: opts.alignRowGap });
      if (opts.axis) drawAxis(ctx, S, vs.view.x0, vs.view.x1);
    } else if (opts.axis) drawScaleBar(ctx, S);

    const drawMs = performance.now() - td;
    // the DOM overlay (label anchors) and the notice follow full-quality frames only; a reduced frame is replaced within refineMs
    if (!reduced) {
      this.overlay.update(this.labels, tree, opts, this.theme, T.kind);
      this.updateNotice(!rect && opts.summaryNotice && opts.lod && res.forced > 0, res.forced);
    }
    this.reducedFrame = reduced;
    if (!reduced && tree.stub !== null) this.detail.request(tree, this.list, T, L, rect, vs.fitted, this.srcVersion);
    if (this.hoverNode >= 0 || this.activeNode >= 0 || this.topHad) this.topDirty = true;

    const frameMs = performance.now() - t0;
    const st = this.stats;
    st.frameMs = frameMs;
    st.cutMs = cutMs;
    st.drawMs = drawMs;
    st.visited = res.visited;
    st.drawn = this.list.count;
    st.summaries = res.summaries;
    st.tips = res.tips;
    st.labels = this.labels.count;
    st.minPxUsed = minPx;
    st.budgetRetries = retries;
    st.budgetHit = minPx > base || res.overflow;
    st.truncated = res.overflow;
    st.frames++;
    st.budget = budget;
    st.forced = res.forced;
    st.summaryTips = res.summaryTips;
    st.mergedTips = res.mergedTips;
    st.reduced = reduced;
    st.scale = dpr;
    this.msSum += frameMs;
    this.msN++;
    if (frameMs > this.msMax) this.msMax = frameMs;
    this.events.emit('frame', st);
    if (!this.readyEmitted) {
      this.readyEmitted = true;
      this.events.emit('ready', { layoutMs: this.L.layoutMs, tips: this.source.tipCount });
    }
  }

  private updateNotice(show: boolean, n: number): void {
    const el = this.notice;
    if (!show) {
      if (this.noticeShown) {
        el.style.display = 'none';
        this.noticeShown = false;
        this.noticeText = '';
      }
      return;
    }
    const text = `${n.toLocaleString('en')} clade${n === 1 ? '' : 's'} summarised, raise the limit in Library options`;
    if (text !== this.noticeText) {
      el.textContent = text;
      this.noticeText = text;
    }
    if (!this.noticeShown) {
      el.style.display = 'block';
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
    const proj = this.proj;
    if (this.hoverNode >= 0 && this.hoverRun < 0 && this.hoverNode !== this.activeNode)
      drawRing(c, proj, this.hoverNode, this.hoverKind === 'summary' ? 9 : 6, this.theme.highlight, 2);
    if (this.activeNode >= 0) {
      drawRing(c, proj, this.activeNode, 10, this.theme.highlight, 2.5);
      const p = { x: 0, y: 0 };
      proj.nodeXY(this.activeNode, p);
      if (this.T.kind === 'rectangular') {
        c.strokeStyle = this.theme.highlight;
        c.globalAlpha = 0.5;
        c.lineWidth = 1;
        const ky = this.T.ky;
        const y0 = this.T.oy + this.tree.leafStart[this.activeNode] * ky,
          y1 = this.T.oy + this.tree.leafEnd[this.activeNode] * ky;
        if (y1 - y0 > 3 && this.tree.childCount[this.activeNode] > 0)
          c.strokeRect(p.x, Math.max(this.T.clipT, y0), Math.max(4, this.T.clipR - p.x - 4), Math.min(this.T.clipB, y1) - Math.max(this.T.clipT, y0));
        c.globalAlpha = 1;
      }
    }
  }

  // ================================================================= hit-testing, hover

  private ensureHit(): void {
    if (!this.hit.valid) this.hit.build(this.list, this.proj);
  }

  private queryHit(x: number, y: number): Hit | null {
    // a label under the pointer is a tip hit (rectangular text; radial labels are matched by their box centre line)
    const L = this.labels;
    if (this.T.kind === 'rectangular') {
      for (let k = 0; k < L.count; k++) {
        // from 2 px before the text, or from the tip when a collapsed-clade triangle sits between them
        const from = L.gap[k] > 8 ? L.x[k] - L.gap[k] : L.x[k] - 2;
        if (x >= from && x <= L.x[k] + L.w[k] + 2 && Math.abs(y - L.y[k]) <= L.h[k] / 2) return { node: this.tree.tipNode[L.rank[k]], kind: 'tip' };
      }
    }
    return this.hit.query(x, y, this.proj);
  }

  private findInList(node: number): number {
    const a = this.list.node;
    let lo = 0,
      hi = this.list.count - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (a[m] < node) lo = m + 1;
      else if (a[m] > node) hi = m - 1;
      else return m;
    }
    return -1;
  }

  private doHover(): void {
    const p = this.pendingHover;
    this.pendingHover = null;
    if (!p || this.input.gesturing) return;
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
    this.emitNode('hover', h ? makeNodeEvent(this.tree, h.node, h.kind, 'pointer', r.left + p.x, r.top + p.y, h.run) : null);
  }

  /** Clear the hover (the pointer left, or a drag started). */
  private clearHover(): void {
    this.hoverNode = -1;
    this.hoverKind = '';
    this.hoverRun = -1;
  }

  private dropHover(): void {
    if (this.hoverNode >= 0) {
      this.clearHover();
      this.topDirty = true;
      this.emitNode('hover', null);
      this.schedule();
    }
  }

  // ================================================================= keyboard cursor, focus

  private setActive(node: number, announce = true): void {
    this.activeNode = node;
    const target = this.vs.visibleViewport(node);
    if (target) this.vs.setViewport(target);
    this.topDirty = true;
    this.renderNow();
    if (announce && node >= 0) {
      const tip = this.tree.childCount[node] === 0;
      const name = cladeName(this.tree, node, this.opts);
      const tips = `${(this.tree.leafEnd[node] - this.tree.leafStart[node]).toLocaleString('en')} tips`;
      this.overlay.announce(tip ? (name ?? 'Unnamed tip') : name ? `${name}, ${tips}` : `Clade of ${tips}`);
      // move DOM focus with the cursor when it sits on a label anchor
      if (tip && this.root.contains(document.activeElement) && document.activeElement !== this.root)
        this.overlay.focusAnchor(this.tree.tipRank[node]);
    }
    this.schedule();
  }

  private onFocusIn = (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    if (t !== this.root && t.closest('[data-phylo-ui]')) return; // controls and popups style their own focus
    if (t !== this.root) t.style.outline = `2px solid ${this.theme.highlight}`;
    else this.root.style.boxShadow = `inset 0 0 0 2px ${this.theme.highlight}`;
    this.topDirty = true;
    this.schedule();
  };
  private onFocusOut = (e: FocusEvent) => {
    const t = e.target as HTMLElement;
    if (t !== this.root && t.closest('[data-phylo-ui]')) return;
    if (t !== this.root) t.style.outline = '';
    else this.root.style.boxShadow = '';
    this.topDirty = true;
    this.schedule();
  };
}

/** Whether a CSS colour is fully opaque: drawn on a 1×1 canvas and read back (exact for any syntax the browser knows: transparent,
 *  rgba, #rgba, hsl(… / a), color-mix). Without a 2D canvas (tests, workers) only 'transparent' counts as not opaque. */
let probe: CanvasRenderingContext2D | null | undefined;
function isOpaque(colour: string): boolean {
  if (colour.trim().toLowerCase() === 'transparent') return false;
  if (probe === undefined) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      probe = c.getContext('2d', { willReadFrequently: true }) ?? null;
      if (probe && typeof probe.getImageData !== 'function') probe = null;
    } catch {
      probe = null;
    }
  }
  if (!probe) return true;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = colour;
  probe.fillRect(0, 0, 1, 1);
  return probe.getImageData(0, 0, 1, 1).data[3] === 255;
}
