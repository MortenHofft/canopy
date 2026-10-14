// The React 18 shell every candidate uses. A candidate calls mountShell(adapter) from its main.tsx.
//
// The shell owns all React state (layout, coloured clades, highlighted tips, columns, theme, tip links,
// selection, event log) and passes it as props to adapter.View. window.__spike / window.__spike2 (the
// SpikeApi from CONTRACT.md, for instance 0 and 1) change that state with flushSync and wait for the paint.
// The same API is wired to a small toolbar for manual testing.
//
// Test hooks (data-testid): tree-container, last-event, clades, highlighted, map-panel, tip-meta, event-log,
// status. Instance 1 uses the suffix "-1" (last-event-1, ...).
//
// Styling: gbif-tokens.css (GBIF design tokens) plus the small shell CSS below, which only uses var(--token) values.

import React, { Component, useEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import './gbif-tokens.css';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { parseNewick } from './newick.ts';
import type { TreeModel } from './tree.ts';
import { catalogue, getEntry, loadColumns, loadTree, DATA_BASE } from './data.ts';
import { gbifTheme } from './gbif-theme.ts';
import type { LoadedColumns } from './data.ts';
import { installMetrics, nextPaint, readHeap } from './metrics.ts';
import type { SpikeMetricsApi } from './metrics.ts';
import { CAPABILITY_KEYS } from './types.ts';
import type {
  CandidateAdapter,
  CapabilityReport,
  ColouredClade,
  ColumnSpec,
  FocusRequest,
  Layout,
  MountOptions,
  MountResult,
  Point,
  Rect,
  SpikeApi,
  SpikeEvent,
  ThemeSpec,
  ViewHandle,
  ViewProps,
  EmitEvent,
  AdapterFeature,
  FeatureValues,
  TreeEntry,
} from './types.ts';

const LINK_COLOUR = '#e00000'; // clade colour used by the linked view (S15)

// ------------------------------------------------------------------------------------------ state

interface InstanceState {
  mountId: number; // 0 = nothing mounted
  status: 'idle' | 'mounting' | 'mounted' | 'error';
  error: string | null;
  treeId: string;
  newick: string;
  tree: TreeModel | null;
  sharedParseMs: number;
  layout: Layout;
  branchLengths: boolean;
  size: { width: number; height: number } | null;
  colouredClades: ColouredClade[];
  highlightedTips: string[];
  focusRequest: FocusRequest | null;
  columns: ColumnSpec[];
  theme: ThemeSpec;
  tipLinks: ((tipId: string) => string) | null;
  lastEvent: SpikeEvent | null;
  hover: SpikeEvent | null;
  eventCount: number;
  eventLog: SpikeEvent[]; // newest last, at most 30
  selection: { nodeId: string; tipIds: string[]; type: SpikeEvent['type'] } | null;
  tipMeta: { tip: string; matched: boolean; row: Record<string, string> | null; hasMeta: boolean } | null;
}

const initialState = (): InstanceState => ({
  mountId: 0,
  status: 'idle',
  error: null,
  treeId: '',
  newick: '',
  tree: null,
  sharedParseMs: 0,
  layout: 'rectangular',
  branchLengths: true,
  size: null,
  colouredClades: [],
  highlightedTips: [],
  focusRequest: null,
  columns: [],
  theme: { dark: false },
  tipLinks: null,
  lastEvent: null,
  hover: null,
  eventCount: 0,
  eventLog: [],
  selection: null,
  tipMeta: null,
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

// ---- demo UI state (shared by all components; not part of the test API)
interface Ui {
  treeId: string;
  shape: string;
  layout: Layout;
  bl: boolean;
  cols: boolean;
  dark: boolean;
  links: boolean;
  hover: boolean;
  colourOnClick: boolean;
  highlight: boolean;
  highlightText: string;
  features: FeatureValues;
  phase: 'idle' | 'loading' | 'mounted' | 'error';
  error: string | null;
  loadingTips: number;
  result: { tips: number; expected: number; parseMs: number; firstRenderMs: number; fetchMs: number; sharedParseMs?: number; notes?: string } | null;
  caps: CapabilityReport | null;
  available: Record<string, boolean>;
  colourIdx: number;
}

class UiStore {
  state: Ui;
  private listeners = new Set<() => void>();
  constructor(init: Ui) {
    this.state = init;
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  get = () => this.state;
  set(patch: Partial<Ui>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
    syncUrl(this.state);
  }
}

/** ?tree=<id>&layout=&bl=0|1&cols=0|1&dark=0|1 (embed=1 is preserved) so a configuration can be linked to. */
function syncUrl(u: Ui) {
  try {
    const q = new URLSearchParams(window.location.search);
    if (u.treeId && u.phase !== 'idle') q.set('tree', u.treeId);
    q.set('layout', u.layout);
    q.set('bl', u.bl ? '1' : '0');
    q.set('cols', u.cols ? '1' : '0');
    q.set('dark', u.dark ? '1' : '0');
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}${window.location.hash}`);
  } catch {
    /* sandboxed iframes may forbid it */
  }
}

interface Shared {
  adapter: CandidateAdapter;
  metrics: SpikeMetricsApi;
  ui: UiStore;
  linkedView: boolean;
  listeners: Set<() => void>;
  linkedViewListeners: Set<() => void>;
}

class InstanceController implements SpikeApi {
  readonly index: number;
  private shared: Shared;
  private state: InstanceState = initialState();
  private listeners = new Set<() => void>();
  private events: SpikeEvent[] = [];
  private handleRef: { current: ViewHandle | null } = { current: null };
  private readyDeferred: Deferred<{ parseMs: number; tips: number; notes?: string }> | null = null;
  private meta: LoadedColumns | null = null;
  private focusSeq = 0;
  private mountCounter = 0;
  containerEl: HTMLElement | null = null;

  constructor(index: number, shared: Shared) {
    this.index = index;
    this.shared = shared;
  }

  get candidate(): SpikeApi['candidate'] {
    return this.shared.adapter.candidate;
  }
  get ready(): Promise<void> {
    return this.shared.adapter.ready ?? Promise.resolve();
  }

  // ---- store
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.state;
  getHandleRef() {
    return this.handleRef;
  }
  private set(patch: Partial<InstanceState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  private async commit(patch: Partial<InstanceState>): Promise<void> {
    flushSync(() => this.set(patch));
    await nextPaint();
  }

  // ---- called by the View through props
  emit = (e: EmitEvent) => {
    const full: SpikeEvent = { ...e, libraryPayload: safePayload(e.libraryPayload), t: performance.now() };
    this.events.push(full);
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    const clickish = full.type === 'tipClick' || full.type === 'nodeClick' || full.type === 'branchClick';
    const patch: Partial<InstanceState> = {
      lastEvent: full,
      eventCount: this.state.eventCount + 1,
      eventLog: [...this.state.eventLog.slice(-29), full],
    };
    if (full.type === 'tipHover' || full.type === 'nodeHover') patch.hover = full;
    if (clickish) {
      patch.selection = { nodeId: full.nodeId, tipIds: full.tipIds, type: full.type };
      if (full.isTip) {
        const tip = full.tipIds[0] ?? '';
        const row = this.meta?.rowByTip[tip] ?? null;
        patch.tipMeta = { tip, matched: row !== null, row, hasMeta: this.meta !== null && this.meta.columns.length > 0 };
      }
      if (this.shared.linkedView && !full.isTip) patch.colouredClades = [{ nodeId: full.nodeId, colour: LINK_COLOUR }];
      else if (this.index === 0 && this.shared.ui.state.colourOnClick && !full.isTip) {
        // demo behaviour: click colours the clade with the next categorical colour, click again removes it
        const cur = this.state.colouredClades;
        const ex = cur.find((c) => c.nodeId === full.nodeId);
        const pal = gbifTheme().categorical;
        patch.colouredClades = ex ? cur.filter((c) => c !== ex) : [...cur, { nodeId: full.nodeId, colour: pal[this.shared.ui.state.colourIdx++ % pal.length] }];
      }
      this.shared.metrics.input.lastEvent = full.t;
    }
    this.set(patch);
  };
  onReady = (r: { parseMs: number; tips: number; notes?: string }) => this.readyDeferred?.resolve(r);
  fail = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    this.shared.metrics.errors.push(`view error (instance ${this.index}): ${msg}`);
    this.set({ status: 'error', error: msg });
    this.readyDeferred?.reject(err instanceof Error ? err : new Error(msg));
  };

  // ---- SpikeApi: lifecycle
  async mount(o: MountOptions): Promise<MountResult> {
    await this.ready;
    if (this.state.mountId) await this.unmount();
    const p0 = performance.now();
    const tree = parseNewick(o.newick);
    const sharedParseMs = performance.now() - p0;
    const d = defer<{ parseMs: number; tips: number; notes?: string }>();
    this.readyDeferred = d;
    this.events = [];
    this.meta = null;
    const id = ++this.mountCounter;
    const metaP = loadColumns(o.treeId, tree).then(
      (m) => {
        if (this.mountCounter === id) this.meta = m;
      },
      () => undefined,
    );
    const t0 = performance.now();
    flushSync(() =>
      this.set({
        ...initialState(),
        mountId: id,
        status: 'mounting',
        treeId: o.treeId,
        newick: o.newick,
        tree,
        sharedParseMs,
        layout: o.layout,
        branchLengths: o.branchLengths,
        size: o.size,
      }),
    );
    const r = await d.promise;
    const tPaint = await nextPaint();
    this.set({ status: 'mounted' });
    await metaP;
    return { parseMs: r.parseMs, firstRenderMs: tPaint - t0, tips: r.tips, notes: r.notes, sharedParseMs };
  }

  async unmount(): Promise<void> {
    this.readyDeferred = null;
    flushSync(() => this.set({ ...initialState(), size: this.state.size }));
    this.handleRef.current = null;
    await nextPaint();
  }

  // ---- SpikeApi: state driven from React
  private requireTree(): TreeModel {
    if (!this.state.tree) throw new Error('nothing mounted');
    return this.state.tree;
  }
  async setColouredClades(c: { nodeId: string; colour: string }[]) {
    const t = this.requireTree();
    for (const x of c) t.nodeIndex(x.nodeId); // throws on a bad id
    await this.commit({ colouredClades: c.map((x) => ({ ...x })) });
  }
  async highlightTips(tipIds: string[]) {
    this.requireTree();
    await this.commit({ highlightedTips: tipIds.slice() });
  }
  async focusTip(tipId: string) {
    const t = this.requireTree();
    if (t.tipIndex(tipId) < 0) throw new Error(`unknown tip ${JSON.stringify(tipId)}`);
    await this.commit({ focusRequest: { tipId, seq: ++this.focusSeq } });
  }
  async setLayout(l: Layout) {
    await this.commit({ layout: l });
  }
  async setBranchLengths(on: boolean) {
    await this.commit({ branchLengths: on });
  }
  async setColumns(cols: ColumnSpec[]) {
    await this.commit({ columns: cols });
  }
  async setTheme(t: ThemeSpec) {
    await this.commit({ theme: { dark: t.dark, tokens: t.tokens ? { ...t.tokens } : undefined } });
  }
  async setTipLinks(href: ((tipId: string) => string) | null) {
    await this.commit({ tipLinks: href });
  }

  // ---- SpikeApi: introspection (must not change state)
  async locate(t: { kind: 'tip' | 'node'; id: string }): Promise<Point | null> {
    return this.handleRef.current?.locate(t) ?? null;
  }
  async bounds(t: { kind: 'tip' | 'node'; id: string }): Promise<Rect | null> {
    return this.handleRef.current?.bounds(t) ?? null;
  }
  async locateCell(colId: string, tipId: string): Promise<Rect | null> {
    return this.handleRef.current?.locateCell(colId, tipId) ?? null;
  }
  async getEvents(): Promise<SpikeEvent[]> {
    return this.events.slice();
  }
  async clearEvents(): Promise<void> {
    this.events = [];
  }
  async getCapabilities(): Promise<CapabilityReport> {
    const c = this.shared.adapter.capabilities;
    const rep = typeof c === 'function' ? await c() : c;
    const out: CapabilityReport = { ...rep };
    for (const k of CAPABILITY_KEYS) if (!out[k]) out[k] = { level: 'no', how: 'MISSING: adapter did not report this capability (counted as no)' };
    return out;
  }
  async getStats() {
    const el = this.containerEl;
    const h = this.handleRef.current;
    if (!el) return { domNodes: 0, svgElements: 0, canvases: 0 };
    return {
      domNodes: el.querySelectorAll('*').length,
      svgElements: el.querySelectorAll('svg, svg *').length,
      canvases: el.querySelectorAll('canvas').length,
      custom: h?.custom?.(),
    };
  }
}

function safePayload(p: unknown): unknown {
  if (p === undefined) return undefined;
  try {
    const s = JSON.stringify(p, (_k, v) => (typeof v === 'object' && v !== null && 'nodeType' in (v as object) ? '[DOM node]' : typeof v === 'function' ? '[function]' : v));
    if (s === undefined) return undefined;
    return s.length > 2000 ? s.slice(0, 2000) + '...[trimmed]' : JSON.parse(s);
  } catch {
    return '[unserialisable payload]';
  }
}

// ------------------------------------------------------------------------------------------ components

class Boundary extends Component<{ ctl: InstanceController; children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    this.props.ctl.fail(e);
  }
  render() {
    return this.state.err ? <div className="error" data-testid="view-error">The viewer threw: {this.state.err}</div> : this.props.children;
  }
}

function useUi(u: UiStore): Ui {
  return useSyncExternalStore(u.subscribe, u.get);
}

function useInstance(ctl: InstanceController): InstanceState {
  return useSyncExternalStore(ctl.subscribe, ctl.getSnapshot);
}

function Viewer({ ctl, adapter, shared }: { ctl: InstanceController; adapter: CandidateAdapter; shared: Shared }) {
  const s = useInstance(ctl);
  const ui = useUi(shared.ui);
  const ref = useRef<HTMLDivElement>(null);
  ctl.containerEl = ref.current;
  useEffect(() => {
    ctl.containerEl = ref.current;
  });
  // input-to-effect marks: this effect runs after the commit that carries the new colours/selection
  useEffect(() => {
    if (!s.eventCount) return;
    const m = shared.metrics.input;
    m.lastEventCommit = performance.now();
    void nextPaint().then((t) => (m.lastEventPaint = t));
  }, [s.eventCount, shared.metrics.input]);
  const View = adapter.View;
  const props: ViewProps | null =
    s.tree && s.mountId
      ? {
          instanceId: ctl.index,
          treeId: s.treeId,
          newick: s.newick,
          tree: s.tree,
          sharedParseMs: s.sharedParseMs,
          layout: s.layout,
          branchLengths: s.branchLengths,
          size: s.size ?? { width: 0, height: 0 },
          colouredClades: s.colouredClades,
          highlightedTips: s.highlightedTips,
          focusRequest: s.focusRequest,
          columns: s.columns,
          theme: s.theme,
          tipLinks: s.tipLinks,
          emit: ctl.emit,
          onReady: ctl.onReady,
          handleRef: ctl.getHandleRef() as ViewProps['handleRef'],
          features: ui.features,
        }
      : null;
  const style: React.CSSProperties = s.size ? { width: s.size.width, height: s.size.height } : { width: '100%', height: '100%' };
  return (
    <div className="viewer-wrap">
      <div className="tree-container" ref={ref} data-testid={tid('tree-container', ctl.index)} data-instance={ctl.index} data-state={s.status} style={style}>
        {props && (
          <Boundary key={s.mountId} ctl={ctl}>
            <View key={s.mountId} {...props} />
          </Boundary>
        )}
      </div>
    </div>
  );
}

const tid = (base: string, i: number) => (i === 0 ? base : `${base}-${i}`);

function Panel({ ctl, i }: { ctl: InstanceController; i: number }) {
  const s = useInstance(ctl);
  const e = s.lastEvent;
  const sel = s.selection;
  const unknown = s.tree ? s.highlightedTips.filter((t) => s.tree!.tipIndex(t) < 0).length : 0;
  return (
    <section className="card panel">
      <h4>Instance {i} {s.treeId && <span className="muted">· {s.treeId}</span>}</h4>
      <dl>
        <dt>Status</dt>
        <dd data-testid={tid('status', i)} data-state={s.status}>
          {s.status}
          {s.error ? `: ${s.error}` : ''}
        </dd>
        <dt>Last event</dt>
        <dd
          data-testid={tid('last-event', i)}
          data-type={e?.type ?? ''}
          data-node-id={e?.nodeId ?? ''}
          data-tip-count={e ? e.tipIds.length : ''}
          data-source={e?.source ?? ''}
          data-seq={s.eventCount}
        >
          {e ? `${e.type} ${e.nodeId} tips=${e.tipIds.length} source=${e.source}` : 'none'}
        </dd>
        <dt>Coloured clades</dt>
        <dd data-testid={tid('clades', i)} data-count={s.colouredClades.length}>
          {s.colouredClades.length === 0 ? 'none' : s.colouredClades.map((c) => (
            <span key={c.nodeId} className="chip" data-node-id={c.nodeId} data-colour={c.colour}>
              <i style={{ background: c.colour }} />
              {c.nodeId}
            </span>
          ))}
        </dd>
        <dt>Highlighted tips</dt>
        <dd data-testid={tid('highlighted', i)} data-count={s.highlightedTips.length} data-unknown={unknown}>
          {s.highlightedTips.length === 0 ? 'none' : s.highlightedTips.slice(0, 6).join(', ') + (s.highlightedTips.length > 6 ? ` ... (${s.highlightedTips.length})` : '')}
        </dd>
        <dt>Tip metadata</dt>
        <dd data-testid={tid('tip-meta', i)} data-tip={s.tipMeta?.tip ?? ''} data-matched={s.tipMeta ? String(s.tipMeta.matched) : ''}>
          {!s.tipMeta ? 'click a tip' : !s.tipMeta.hasMeta ? `${s.tipMeta.tip}: no metadata for this tree` : !s.tipMeta.matched ? `${s.tipMeta.tip}: UNMATCHED (no metadata row)` : `${s.tipMeta.tip}: ` + Object.entries(s.tipMeta.row!).filter(([k]) => k !== 'tip_label' && k !== 'protein_id').map(([k, v]) => `${k}=${v}`).join(' ')}
        </dd>
      </dl>
      <div className="map" data-testid={tid('map-panel', i)} data-count={sel ? sel.tipIds.length : 0} data-node-id={sel?.nodeId ?? ''}>
        <strong>Occurrence map (stub)</strong>
        <div>{sel ? `${sel.tipIds.length} tips selected from ${sel.nodeId}` : 'nothing selected'}</div>
        <div className="muted">{sel ? sel.tipIds.slice(0, 5).join(', ') + (sel.tipIds.length > 5 ? ', ...' : '') : ''}</div>
      </div>
      <details>
        <summary>Event log ({s.eventCount})</summary>
        <ol data-testid={tid('event-log', i)} className="log" start={Math.max(1, s.eventCount - s.eventLog.length + 1)}>
          {s.eventLog.slice().reverse().map((x, k) => (
            <li key={k}>{x.type} {x.nodeId} ({x.tipIds.length}) {x.source}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}

function Toolbar({ api, api2, shared }: { api: InstanceController; api2: InstanceController; shared: Shared }) {
  const s = useInstance(api);
  const lv = useSyncExternalStore((l) => { shared.linkedViewListeners.add(l); return () => shared.linkedViewListeners.delete(l); }, () => shared.linkedView);
  const [treeId, setTreeId] = React.useState('syn-yule-1000');
  const [tip, setTip] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const run = (label: string, f: () => Promise<unknown>) => async () => {
    setMsg(`${label} ...`);
    try {
      const r = await f();
      setMsg(`${label}: ${r === undefined ? 'ok' : JSON.stringify(r)}`);
    } catch (e) {
      setMsg(`${label} FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const size = () => {
    const el = api.containerEl?.parentElement as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return { width: Math.max(200, Math.floor(r?.width ?? 800)), height: Math.max(200, Math.floor(r?.height ?? 600)) };
  };
  const doMount = (ctl: InstanceController, id: string, sz: { width: number; height: number }) => async () => {
    const lt = await loadTree(id);
    const r = await ctl.mount({ treeId: id, newick: lt.newick, layout: api.getSnapshot().layout, branchLengths: api.getSnapshot().branchLengths && lt.entry.hasLengths, size: sz });
    return { ...r, fetchMs: Math.round(lt.fetchMs), expected: lt.entry.tips };
  };
  const firstTip = () => tip || s.tree?.tipLabels[Math.floor((s.tree?.tipCount ?? 0) / 2)] || '';
  const lastNode = s.selection?.nodeId;
  const mkCols = async () => {
    const tree = api.getSnapshot().tree;
    if (!tree) throw new Error('mount first');
    const lc = await loadColumns(treeId, tree);
    await api.setColumns(lc.columns);
    return { columns: lc.columns.map((c) => c.id), unmatchedTips: lc.tsvStats?.tipsWithoutRow.length, rowsWithoutTip: lc.tsvStats?.rowsWithoutTip.length };
  };
  return (
    <header className="toolbar-band">
      <select value={treeId} onChange={(e) => setTreeId(e.target.value)} data-testid="tree-select" aria-label="Tree">
        {catalogue.map((t) => <option key={t.id} value={t.id}>{t.id} ({t.tips})</option>)}
      </select>
      <button className="btn btn-primary" onClick={run('mount', doMount(api, treeId, size()))}>Mount</button>
      <button className="btn btn-secondary" onClick={run('unmount', () => api.unmount())}>Unmount</button>
      <input placeholder="tip id" value={tip} onChange={(e) => setTip(e.target.value)} size={14} aria-label="Tip id" />
      <button className="btn btn-secondary" onClick={run('highlight', () => api.highlightTips([firstTip()]))}>Highlight</button>
      <button className="btn btn-secondary" onClick={run('clear highlight', () => api.highlightTips([]))}>Clear</button>
      <button className="btn btn-secondary" onClick={run('focus', () => api.focusTip(firstTip()))}>Focus</button>
      <button className="btn btn-secondary" disabled={!lastNode} onClick={run('colour', () => api.setColouredClades([{ nodeId: lastNode!, colour: LINK_COLOUR }]))}>Colour selected clade</button>
      <button className="btn btn-secondary" onClick={run('clear colours', () => api.setColouredClades([]))}>Clear colours</button>
      <button className="btn btn-secondary" onClick={run('columns', mkCols)}>Columns on</button>
      <button className="btn btn-secondary" onClick={run('columns off', () => api.setColumns([]))}>Off</button>
      <button className="btn btn-secondary" onClick={run('tip links', () => api.setTipLinks((id) => `#tip/${encodeURIComponent(id)}`))}>Tip links</button>
      <button className="btn btn-secondary" onClick={run('tip links off', () => api.setTipLinks(null))}>Off</button>
      <button className="btn btn-secondary" onClick={run('dark', () => api.setTheme({ dark: !s.theme.dark }))}>Dark</button>
      <button className="btn btn-secondary" onClick={run('tokens', () => api.setTheme({ dark: false, tokens: { background: '#fdf0d5', foreground: '#241f20', branch: '#0b6e4f', highlight: '#684393' } }))}>Tokens</button>
      <label className="field-option"><input type="checkbox" checked={lv} onChange={(e) => { shared.linkedView = e.target.checked; shared.linkedViewListeners.forEach((l) => l()); }} /> linked view</label>
      <button className="btn btn-outline" onClick={run('2nd instance', doMount(api2, 'syn-yule-200', { width: 340, height: 240 }))}>Mount 2nd</button>
      <button className="btn btn-outline" onClick={run('unmount 2nd', () => api2.unmount())}>Unmount 2nd</button>
      <button className="btn btn-outline" onClick={run('stats', async () => ({ ...(await api.getStats()), heap: readHeap(false)?.usedMB.toFixed(1) }))}>Stats</button>
      <button className="btn btn-outline" onClick={run('capabilities', async () => Object.fromEntries(Object.entries(await api.getCapabilities()).map(([k, v]) => [k, v.level])))}>Capabilities</button>
      <span className="msg" data-testid="toolbar-message">{msg}</span>
    </header>
  );
}

const LOGO = 'https://www.gbif.org/img/public/logo-web-gbif-nav-white-bg.svg';
const MOUNT_TIMEOUT_MS = 30000;

// ------------------------------------------------------------------------------------------ demo: logic

async function checkAvailability(ui: UiStore) {
  const available: Record<string, boolean> = {};
  await Promise.all(
    catalogue.map(async (e) => {
      try {
        const r = await fetch(DATA_BASE + e.path.split('/').map(encodeURIComponent).join('/'), { method: 'HEAD' });
        available[e.id] = r.ok;
      } catch {
        available[e.id] = false;
      }
    }),
  );
  ui.set({ available });
}

const GBIF_SEARCH = (id: string) => `https://www.gbif.org/species/search?q=${encodeURIComponent(id.replace(/_/g, ' '))}`;

/** Mount a catalogue tree in instance 0 from the demo UI, then re-apply the toggles that survive a mount. */
async function uiMount(shared: Shared, c0: InstanceController, id: string): Promise<void> {
  const ui = shared.ui;
  const entry = getEntry(id);
  ui.set({ treeId: id, phase: 'loading', loadingTips: entry.tips, error: null, result: null, colourIdx: 0 });
  await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0))); // let "Loading N tips" paint first
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error(`The viewer did not finish within ${MOUNT_TIMEOUT_MS / 1000} s (${entry.tips.toLocaleString()} tips).`)), MOUNT_TIMEOUT_MS)));
    const work = (async () => {
      const lt = await loadTree(id);
      const el = document.querySelector('.main') as HTMLElement;
      const size = { width: Math.max(200, el.clientWidth), height: Math.max(200, el.clientHeight) };
      const u = ui.state;
      const r = await c0.mount({ treeId: id, newick: lt.newick, layout: u.layout, branchLengths: u.bl && entry.hasLengths, size });
      return { r, fetchMs: lt.fetchMs };
    })();
    const { r, fetchMs } = await Promise.race([work, timeout]).finally(() => clearTimeout(timer));
    ui.set({ phase: 'mounted', result: { tips: r.tips, expected: entry.tips, parseMs: r.parseMs, firstRenderMs: r.firstRenderMs, fetchMs, sharedParseMs: r.sharedParseMs, notes: r.notes } });
    await reapply(shared, c0);
  } catch (e) {
    shared.metrics.errors.push('demo mount: ' + (e instanceof Error ? e.message : String(e)));
    ui.set({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

function level(caps: CapabilityReport | null, ...keys: string[]): { level: 'yes' | 'partial' | 'no' | 'unknown'; how: string } {
  if (!caps) return { level: 'unknown', how: 'capabilities not read yet' };
  const bad = keys.map((k) => ({ k, c: caps[k] })).find((x) => x.c?.level === 'no');
  if (bad) return { level: 'no', how: `${bad.k}: ${bad.c.how}` };
  const part = keys.map((k) => ({ k, c: caps[k] })).find((x) => x.c?.level === 'partial');
  if (part) return { level: 'partial', how: `${part.k}: ${part.c.how}` };
  return { level: 'yes', how: keys.map((k) => caps[k]?.how).filter(Boolean).join('; ') };
}

async function applyColumns(shared: Shared, c0: InstanceController, on: boolean) {
  const tree = c0.getSnapshot().tree;
  if (!tree) return;
  if (!on) return c0.setColumns([]);
  const lc = await loadColumns(shared.ui.state.treeId, tree);
  const noAln = shared.ui.state.caps?.alignmentColumn?.level === 'no';
  await c0.setColumns(lc.columns.filter((c) => !(noAln && c.kind === 'alignment')));
}

async function applyHighlight(shared: Shared, c0: InstanceController) {
  const tree = c0.getSnapshot().tree;
  const u = shared.ui.state;
  if (!tree) return;
  const t = u.highlightText.trim().toLowerCase();
  const ids = u.highlight && t ? tree.tipLabels.filter((l) => l.toLowerCase().includes(t)).slice(0, 200) : [];
  await c0.highlightTips(ids);
}

async function reapply(shared: Shared, c0: InstanceController) {
  const u = shared.ui.state;
  const caps = u.caps;
  const ok = (...k: string[]) => level(caps, ...k).level !== 'no';
  if (u.dark && ok('darkTheme')) await c0.setTheme({ dark: true });
  if (u.cols && ok('customColumns')) await applyColumns(shared, c0, true);
  if (u.links && ok('tipAsLink')) await c0.setTipLinks(GBIF_SEARCH);
  if (u.highlight && ok('highlightTip')) await applyHighlight(shared, c0);
}

// ------------------------------------------------------------------------------------------ demo: components

const BUCKETS: { max: number; label: string }[] = [
  { max: 500, label: 'About 200 tips' },
  { max: 5000, label: 'About 1,000 tips' },
  { max: 50000, label: 'About 10,000 tips' },
  { max: 500000, label: 'About 100,000 tips' },
  { max: Infinity, label: 'About 1,000,000 tips' },
];
const SHAPES: { v: string; text: string }[] = [
  { v: 'all', text: 'All' },
  { v: 'random', text: 'Random' },
  { v: 'balanced', text: 'Balanced' },
  { v: 'caterpillar', text: 'Caterpillar' },
  { v: 'real', text: 'Real' },
  { v: 'other', text: 'Other' },
];
function shapeOf(e: TreeEntry): string {
  if (e.id.includes('balanced')) return 'balanced';
  if (e.id.includes('caterpillar')) return 'caterpillar';
  if (e.groups.includes('real')) return 'real';
  if (e.id.includes('yule')) return 'random';
  return 'other';
}

function Tabs<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { v: T; text: string; disabled?: string }[]; onPick(v: T): void }) {
  return (
    <div className="tabs-pill" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" role="tab" className="tab-pill" aria-selected={o.v === value} disabled={!!o.disabled} title={o.disabled} onClick={() => onPick(o.v)}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** A GBIF .toggle with capability awareness: `no` disables it (reason in the tooltip), `partial` adds a badge. */
function Switch({ label, checked, onChange, lv, off }: { label: string; checked: boolean; onChange(v: boolean): void; lv: { level: string; how: string }; off?: string }) {
  const disabled = lv.level === 'no' || !!off;
  const why = off ?? (lv.level === 'no' ? `Not supported: ${lv.how}` : lv.level === 'partial' ? `Partial: ${lv.how}` : '');
  return (
    <label className={'ctl' + (disabled ? ' ctl-off' : '')} title={why}>
      <span className="toggle">
        <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track" />
        <span className="toggle-thumb" />
      </span>
      <span className="ctl-label">{label}</span>
      {lv.level === 'partial' && !off && <span className="badge" title={lv.how}>partial</span>}
      {disabled && <span className="ctl-why">{why.length > 90 ? why.slice(0, 88) + '...' : why}</span>}
    </label>
  );
}

function TreeCard({ shared, c0 }: { shared: Shared; c0: InstanceController }) {
  const u = useUi(shared.ui);
  const entries = catalogue.filter((e) => u.shape === 'all' || shapeOf(e) === u.shape);
  const cur = getEntry(u.treeId);
  return (
    <section className="card panel">
      <h4>Tree</h4>
      <Tabs label="Shape" value={u.shape} options={SHAPES} onPick={(v) => shared.ui.set({ shape: v })} />
      <select className="picker" aria-label="Tree" data-testid="demo-tree-select" value={u.treeId} onChange={(e) => void uiMount(shared, c0, e.target.value)}>
        {BUCKETS.map((b, i) => {
          const lo = i === 0 ? 0 : BUCKETS[i - 1].max;
          const g = entries.filter((e) => e.tips > lo && e.tips <= b.max);
          if (!g.length) return null;
          return (
            <optgroup key={b.label} label={b.label}>
              {g.map((e) => {
                const missing = u.available[e.id] === false;
                return (
                  <option key={e.id} value={e.id} disabled={missing}>
                    {e.id} · {e.tips.toLocaleString()} tips · {e.hasLengths ? 'branch lengths' : 'no lengths'}
                    {missing ? ' · not bundled, see data/README.md' : ''}
                  </option>
                );
              })}
            </optgroup>
          );
        })}
      </select>
      <p className="muted small">{cur.label}. {cur.hasLengths ? (cur.ultrametric ? 'Dated or ultrametric branch lengths.' : 'Branch lengths, not ultrametric.') : 'No branch lengths.'}</p>
      <MountStatus shared={shared} />
    </section>
  );
}

function MountStatus({ shared }: { shared: Shared }) {
  const u = useUi(shared.ui);
  if (u.phase === 'loading')
    return (
      <div className="status loading" role="status" data-testid="demo-status" data-phase="loading">
        <span className="spinner" aria-hidden="true" /> Loading {u.loadingTips.toLocaleString()} tips{u.loadingTips > 20000 ? '. Large trees can take a while; the page stays responsive until the viewer starts.' : '...'}
      </div>
    );
  if (u.phase === 'error')
    return (
      <div className="card status error" role="alert" data-testid="demo-status" data-phase="error">
        <strong>The tree could not be shown.</strong>
        <div>{u.error}</div>
      </div>
    );
  if (u.phase === 'mounted' && u.result) {
    const r = u.result;
    return (
      <div className="status" data-testid="demo-status" data-phase="mounted">
        <strong>{r.tips.toLocaleString()} tips</strong>
        {r.tips !== r.expected && <span className="badge bad"> expected {r.expected.toLocaleString()}</span>}
        <div className="muted">
          parse {r.parseMs.toFixed(0)} ms · first render {r.firstRenderMs.toFixed(0)} ms · fetch {r.fetchMs.toFixed(0)} ms{r.sharedParseMs !== undefined ? ` · shared parse ${r.sharedParseMs.toFixed(0)} ms` : ''}
        </div>
        {r.notes && <div className="muted small" title={r.notes}>{r.notes.length > 140 ? r.notes.slice(0, 138) + '...' : r.notes}</div>}
      </div>
    );
  }
  return <div className="status muted" data-testid="demo-status" data-phase="idle">Pick a tree to mount it.</div>;
}

function Controls({ shared, c0 }: { shared: Shared; c0: InstanceController }) {
  const u = useUi(shared.ui);
  const s = useInstance(c0);
  const caps = u.caps;
  const mounted = u.phase === 'mounted' && !!s.tree;
  const entry = getEntry(u.treeId);
  const hasCols = !!entry.columns?.length;
  const noTree = mounted ? undefined : 'Mount a tree first';
  const run = (p: Promise<unknown>) => void p.catch((e) => shared.metrics.errors.push('control: ' + String(e)));
  return (
    <section className="card panel">
      <h4>Controls</h4>
      <Switch label="Colour clade on click" checked={u.colourOnClick} lv={level(caps, 'internalNodeClick', 'cladeColouring')} off={noTree} onChange={(v) => shared.ui.set({ colourOnClick: v })} />
      <div className="ctl-row">
        <button className="btn btn-secondary" disabled={!mounted || s.colouredClades.length === 0} onClick={() => run(c0.setColouredClades([]))}>Clear colours</button>
        <span className="muted small">{s.colouredClades.length} coloured, {s.selection ? `${s.selection.tipIds.length} tips sent to the map panel` : 'nothing selected'}</span>
      </div>
      <Switch label="Highlight tips matching" checked={u.highlight} lv={level(caps, 'highlightTip')} off={noTree} onChange={(v) => { shared.ui.set({ highlight: v }); run(applyHighlight(shared, c0)); }} />
      <input className="picker" placeholder="part of a tip name, e.g. Aba" aria-label="Highlight text" value={u.highlightText} disabled={!mounted} onChange={(e) => { shared.ui.set({ highlightText: e.target.value }); if (shared.ui.state.highlight) run(applyHighlight(shared, c0)); }} />
      <Switch label="Show custom columns" checked={u.cols} lv={level(caps, 'customColumns')} off={noTree ?? (hasCols ? undefined : 'This tree has no metadata or alignment bundled')} onChange={(v) => { shared.ui.set({ cols: v }); run(applyColumns(shared, c0, v)); }} />
      {hasCols && <p className="muted small">Columns: {entry.columns!.map((c) => c.header).join(', ')}{caps?.alignmentColumn?.level === 'no' && entry.columns!.some((c) => c.kind === 'alignment') ? ' (alignment skipped: not supported)' : ''}</p>}
      <Switch label="Tip labels as links (GBIF species search)" checked={u.links} lv={level(caps, 'tipAsLink')} off={noTree} onChange={(v) => { shared.ui.set({ links: v }); run(c0.setTipLinks(v ? GBIF_SEARCH : null)); }} />
      <Switch label="Dark theme" checked={u.dark} lv={level(caps, 'darkTheme')} off={noTree} onChange={(v) => { shared.ui.set({ dark: v }); run(c0.setTheme({ dark: v })); }} />
      <Switch label="Hover tooltip" checked={u.hover} lv={level(caps, 'hover')} onChange={(v) => shared.ui.set({ hover: v })} />
    </section>
  );
}

function LibraryOptions({ shared }: { shared: Shared }) {
  const u = useUi(shared.ui);
  const fs: AdapterFeature[] = shared.adapter.features ?? [];
  if (!fs.length) return null;
  const set = (id: string, v: boolean | string) => shared.ui.set({ features: { ...shared.ui.state.features, [id]: v } });
  return (
    <section className="card panel" data-testid="library-options">
      <h4>Library options</h4>
      {fs.map((f) => {
        const lv = { level: f.level ?? 'yes', how: f.how ?? '' };
        if (f.kind === 'toggle') return <Switch key={f.id} label={f.label} checked={!!u.features[f.id]} lv={lv} onChange={(v) => set(f.id, v)} />;
        return (
          <label key={f.id} className="ctl" title={f.description}>
            <span className="ctl-label">{f.label}</span>
            <select className="picker" value={String(u.features[f.id])} disabled={lv.level === 'no'} onChange={(e) => set(f.id, e.target.value)}>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        );
      })}
    </section>
  );
}

function FactsCard({ shared }: { shared: Shared }) {
  const u = useUi(shared.ui);
  const c = shared.adapter.candidate;
  const sp = shared.adapter.spike;
  return (
    <section className="card panel" data-testid="library-facts">
      <h4>Library facts</h4>
      <dl>
        <dt>Library</dt><dd>{sp?.library ?? c.name}</dd>
        <dt>Version</dt><dd>{c.version}</dd>
        <dt>Licence</dt><dd>{c.license}</dd>
        <dt>Rendering</dt><dd>{sp?.rendering ?? 'unknown'}</dd>
        {sp?.repo && <><dt>Repository</dt><dd><a href={sp.repo}>{sp.repo.replace('https://', '')}</a></dd></>}
        {sp?.demo && <><dt>Own demo</dt><dd><a href={sp.demo}>{sp.demo.replace('https://', '')}</a></dd></>}
        <dt>Compare</dt><dd><a href="../">Back to the hub</a></dd>
      </dl>
      {(sp?.description ?? c.notes) && <p className="muted small">{sp?.description ?? c.notes}</p>}
      <details>
        <summary>Capabilities ({u.caps ? Object.values(u.caps).filter((x) => x.level === 'yes').length : '?'} yes)</summary>
        <ul className="caps">
          {u.caps && Object.entries(u.caps).map(([k, v]) => (
            <li key={k} title={v.how}><span className={'badge ' + v.level}>{v.level}</span> {k}</li>
          ))}
        </ul>
      </details>
      {sp?.styling && (
        <details>
          <summary>Styling with the GBIF tokens</summary>
          <p className="small"><strong>Applied</strong></p>
          <ul className="caps">{sp.styling.applied?.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="small"><strong>Not possible</strong></p>
          <ul className="caps">{sp.styling.not_possible?.length ? sp.styling.not_possible.map((x) => <li key={x}>{x}</li>) : <li>nothing recorded</li>}</ul>
          {sp.styling.notes && <p className="muted small">{sp.styling.notes}</p>}
        </details>
      )}
    </section>
  );
}

function HoverTip({ shared, c0 }: { shared: Shared; c0: InstanceController }) {
  const u = useUi(shared.ui);
  const s = useInstance(c0);
  if (!u.hover || !s.hover || !s.tree) return null;
  const h = s.hover;
  return (
    <div className="hover-tip" data-testid="hover-tip" role="status">
      {h.isTip ? <em>{h.tipIds[0]}</em> : <span>clade {h.nodeId}</span>}
      {!h.isTip && <span className="muted"> · {h.tipIds.length.toLocaleString()} tips</span>}
    </div>
  );
}

function Shell({ shared, c0, c1, embed }: { shared: Shared; c0: InstanceController; c1: InstanceController; embed: boolean }) {
  const s0 = useInstance(c0);
  const s1 = useInstance(c1);
  const u = useUi(shared.ui);
  const cand = shared.adapter.candidate;
  const entry = getEntry(u.treeId);
  const caps = u.caps;
  const quiet = (p: Promise<unknown>) => void p.catch((e) => shared.metrics.errors.push('toolbar: ' + String(e)));
  const rad = level(caps, 'radialLayout');
  const bl = level(caps, 'branchLengthToggle');
  const mountedHere = u.phase === 'mounted';
  return (
    <div className={'shell' + (embed ? ' embed' : '')}>
      <header className="app-header">
        <img src={LOGO} alt="GBIF" height={32} />
        <span className="app-title">Phylogeny viewer spike</span>
        <span className="muted">{cand.name} {cand.version} · {cand.license}</span>
      </header>
      <div className="body">
        <section className="card tree-card">
          <div className="tree-card-head">
            <h2 className="card-title">Tree {s0.treeId && <span className="muted">{s0.treeId}</span>}</h2>
            <Tabs
              label="Layout"
              value={s0.layout}
              options={[{ v: 'rectangular', text: 'Rectangular' }, { v: 'radial', text: 'Radial', disabled: rad.level === 'no' ? `Not supported: ${rad.how}` : undefined }]}
              onPick={(l) => { shared.ui.set({ layout: l }); quiet(c0.setLayout(l)); }}
            />
            <Tabs
              label="Branch lengths"
              value={s0.branchLengths ? 'phylogram' : 'cladogram'}
              options={[
                { v: 'phylogram', text: 'Phylogram', disabled: bl.level === 'no' ? `Not supported: ${bl.how}` : mountedHere && !entry.hasLengths ? 'This tree has no branch lengths' : undefined },
                { v: 'cladogram', text: 'Cladogram', disabled: bl.level === 'no' ? `Not supported: ${bl.how}` : undefined },
              ]}
              onPick={(v) => { shared.ui.set({ bl: v === 'phylogram' }); quiet(c0.setBranchLengths(v === 'phylogram')); }}
            />
          </div>
          <main className="main">
            <Viewer ctl={c0} adapter={shared.adapter} shared={shared} />
            <HoverTip shared={shared} c0={c0} />
            {u.phase === 'idle' && <div className="empty-state">Choose a tree in the Tree panel to load it.</div>}
            {u.phase === 'loading' && <div className="overlay-loading" aria-hidden="true">Loading {u.loadingTips.toLocaleString()} tips...</div>}
            {u.phase === 'error' && <div className="overlay-loading error">{u.error}</div>}
          </main>
        </section>
        <aside className="side">
          <div className="second card" style={{ display: s1.mountId ? 'block' : 'none' }}>
            <Viewer ctl={c1} adapter={shared.adapter} shared={shared} />
          </div>
          <TreeCard shared={shared} c0={c0} />
          <Controls shared={shared} c0={c0} />
          <LibraryOptions shared={shared} />
          <FactsCard shared={shared} />
          <Panel ctl={c0} i={0} />
          {s1.mountId ? <Panel ctl={c1} i={1} /> : null}
          <details className="card panel">
            <summary>Test toolbar (drives every API method by hand)</summary>
            <Toolbar api={c0} api2={c1} shared={shared} />
          </details>
        </aside>
      </div>
      {embed && (
        <div className="embed-chip" data-testid="embed-status" aria-live="polite">
          {s0.lastEvent ? `${s0.lastEvent.type} ${s0.lastEvent.nodeId} (${s0.lastEvent.tipIds.length})` : 'no event yet'}
        </div>
      )}
      <footer className="app-footer">
        <div className="app-footer-inner">
          <p className="app-footer-lead">A prototype. Under development. Frame rates measured here are without a GPU.</p>
          <p>
            Test trees come from the repository's data folder and carry their own licences. Data mediated by GBIF must be cited:{' '}
            <a href="https://www.gbif.org/citation-guidelines">GBIF citation guidelines</a>.
          </p>
        </div>
      </footer>
    </div>
  );
}

const CSS = `
html,body{margin:0;height:100%}
#root{height:100%}
.shell{display:flex;flex-direction:column;height:100vh;background:var(--bg-surface)}
.app-header{display:flex;align-items:center;gap:var(--space-4);padding:var(--space-2) var(--space-4);background:var(--bg1);border-bottom:1px solid var(--card-border-color);flex:none}
.app-header img{display:block;height:2rem;min-width:6rem}
.app-title{font-family:var(--font-display);font-size:var(--text-lg);font-weight:var(--fw-semibold);color:var(--fg1)}
.toolbar-band{flex:none;border-top:none;font-size:var(--text-xs)}
.toolbar-band select,.toolbar-band input:not([type]){font:inherit;font-size:var(--text-xs);padding:var(--space-1);border:1px solid var(--card-border-color);border-radius:var(--radius-md);background:var(--bg1);color:var(--fg1)}
.toolbar-band .btn{padding:var(--space-1) var(--space-2);font-size:var(--text-xs)}
.msg{color:var(--text-subtle);font-family:var(--font-mono);font-size:var(--text-2xs);max-width:40ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.body{display:flex;flex:1;min-height:0;gap:var(--space-4);padding:var(--space-4)}
.tree-card{flex:1;min-width:0;display:flex;flex-direction:column;margin:0;box-shadow:var(--card-shadow);overflow:hidden}
.tree-card-head{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap;padding:var(--space-2) var(--space-4);border-bottom:1px solid var(--card-border-color);flex:none}
.tree-card-head .card-title{font-size:var(--text-lg);margin-right:auto;line-height:var(--leading-snug)}
.main{flex:1;min-height:0;overflow:auto;background:var(--bg1)}
.viewer-wrap{width:100%;height:100%}
.tree-container{position:relative;overflow:hidden;background:var(--bg1)}
.empty-state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:var(--space-6);text-align:center;color:var(--text-subtle);font-size:var(--text-md);pointer-events:none}
.side{width:22.5rem;flex:none;overflow:auto}
.second{margin-bottom:var(--space-4);overflow:hidden}
.second .viewer-wrap{height:auto}
.panel{margin-bottom:var(--space-4);padding:var(--space-3) var(--space-4)}
.panel h4{margin:0 0 var(--space-2);font-size:var(--text-md)}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:var(--space-1) var(--space-3)}
dt{font-size:var(--text-2xs);text-transform:uppercase;letter-spacing:var(--tracking-wider);color:var(--text-subtle);font-weight:var(--fw-semibold);padding-top:var(--space-1)}
dd{margin:0;font-size:var(--text-xs);font-family:var(--font-mono);word-break:break-all;color:var(--fg2)}
.chip{display:inline-flex;align-items:center;gap:var(--space-1);margin-right:var(--space-2)}
.chip i{width:var(--space-3);height:var(--space-3);border-radius:var(--radius-pill);display:inline-block}
.map{margin-top:var(--space-3);padding:var(--space-2);background:var(--bg2);border-radius:var(--radius-md);font-size:var(--text-xs)}
.muted{color:var(--text-subtle);font-weight:var(--fw-regular)}
.log{font-size:var(--text-2xs);font-family:var(--font-mono);padding-left:var(--space-4);max-height:9rem;overflow:auto}
.error{padding:var(--space-4);color:var(--color-danger)}
.app-footer{flex:none;background:var(--bg-dark);color:var(--fg-on-dark);font-size:var(--text-base)}
.app-footer-inner{padding:var(--space-3) var(--space-6);display:grid;row-gap:var(--space-1)}
.app-footer p{margin:0;color:var(--grey-900);max-inline-size:72ch;font-size:var(--text-base)}
.app-footer .app-footer-lead{color:var(--fg-on-dark);font-weight:var(--fw-medium)}
.app-footer a{color:var(--fg-on-dark);text-decoration:underline}
.side{width:26rem}
.main{position:relative}
.picker{width:100%;box-sizing:border-box;margin-top:var(--space-2);font:inherit;font-size:var(--text-sm);padding:var(--space-1) var(--space-2);border:1px solid var(--card-border-color);border-radius:var(--radius-md);background:var(--bg1);color:var(--fg1)}
.panel .tabs-pill{flex-wrap:wrap}
.status{margin-top:var(--space-2);font-size:var(--text-sm)}
.status.error{padding:var(--space-2) var(--space-3);border-color:var(--color-danger);margin-bottom:0}
.spinner{display:inline-block;width:var(--space-3);height:var(--space-3);border:2px solid var(--slate-200);border-top-color:var(--color-primary);border-radius:var(--radius-pill);animation:spin 1s linear infinite;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
.small{font-size:var(--text-xs);margin:var(--space-1) 0}
.ctl{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-1) 0;font-size:var(--text-sm);flex-wrap:wrap}
.ctl-off{color:var(--fg4)}
.ctl-label{flex:1 1 auto}
.ctl-why{flex-basis:100%;font-size:var(--text-xs);color:var(--text-subtle);padding-left:calc(2.25rem + var(--space-2))}
.ctl-row{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-1) 0}
.badge{display:inline-block;padding:0 var(--space-2);border-radius:var(--radius-pill);font-size:var(--text-2xs);font-weight:var(--fw-semibold);background:var(--color-warning);color:var(--fg1)}
.badge.yes{background:var(--color-primary-light);color:var(--fg1)}
.badge.no{background:var(--slate-200);color:var(--text-subtle)}
.badge.bad{background:var(--color-danger)}
.caps{list-style:none;padding:0;margin:var(--space-1) 0;font-size:var(--text-xs);color:var(--fg2)}
.caps li{margin:0;padding:var(--space-1) 0}
.hover-tip{position:absolute;left:var(--space-2);bottom:var(--space-2);padding:var(--space-1) var(--space-3);background:var(--popover-bg);border:1px solid var(--card-border-color);border-radius:var(--radius-md);box-shadow:var(--shadow-md);font-size:var(--text-sm);pointer-events:none;z-index:5}
.overlay-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--overlay-bg);color:var(--fg1);font-size:var(--text-md);pointer-events:none}
.overlay-loading.error{color:var(--color-danger);padding:var(--space-6);text-align:center}
.panel summary{cursor:pointer;font-weight:var(--fw-semibold);font-size:var(--text-sm)}
.embed-chip{display:none}
.embed .app-header,.embed .app-footer,.embed .toolbar-band,.embed .side,.embed .tree-card-head{display:none}
.embed .body{padding:0;gap:0}
.embed .tree-card{border:none;border-radius:0;box-shadow:none}
.embed .embed-chip{display:block;position:fixed;right:var(--space-2);bottom:var(--space-2);z-index:10;padding:var(--space-1) var(--space-2);background:var(--popover-bg);border:1px solid var(--card-border-color);border-radius:var(--radius-pill);box-shadow:var(--shadow-sm);font-family:var(--font-mono);font-size:var(--text-2xs);color:var(--fg2);pointer-events:none}

/* Small screens: single column. The tree card comes first at a fixed share of the screen height, the controls below it.
   (The desktop layout is a row with a 22.5rem side panel, which squeezed the tree card to zero width on a phone.) */
@media (max-width: 900px){
.shell{height:auto;min-height:100vh;min-height:100dvh;overflow-x:hidden}
.app-header{flex-wrap:wrap;gap:var(--space-2);padding:var(--space-2) var(--space-3)}
.app-header img{height:1.75rem;min-width:0}
.app-title{font-size:var(--text-md)}
.msg{max-width:100%;white-space:normal}
.body{flex-direction:column;flex:none;min-height:0;overflow:visible;padding:var(--space-3);gap:var(--space-3)}
.tree-card{flex:none;width:100%;height:72vh;height:72dvh;min-height:26rem}
.side{width:100%;flex:none;overflow:visible}
.tree-card-head{gap:var(--space-2);padding:var(--space-2) var(--space-3)}
.tree-card-head .card-title{width:100%}
.app-footer-inner{padding:var(--space-4) var(--space-3)}
.embed .shell{height:100vh;min-height:0;overflow:hidden}
.embed .body{flex:1;min-height:0;padding:0;overflow:hidden}
.embed .tree-card{flex:1;height:auto;min-height:0}
}
`;

// ------------------------------------------------------------------------------------------ install

declare global {
  interface Window {
    __spike: SpikeApi;
    __spike2: SpikeApi;
    __spikeData: { catalogue: typeof catalogue; loadTree: typeof loadTree; getEntry: typeof getEntry };
    __spikeShell: { setLinkedView(on: boolean): void; linkedColour: string; version: number };
  }
}

/** Entry point for a candidate: installs window.__spike (+ __spike2, __spikeData, __spikeMetrics) and renders the shell. */
export function mountShell(adapter: CandidateAdapter, rootEl: HTMLElement = document.getElementById('root') as HTMLElement): void {
  const metrics = installMetrics();
  const q = new URLSearchParams(window.location.search);
  const qTree = q.get('tree');
  const features: FeatureValues = {};
  for (const f of adapter.features ?? []) features[f.id] = f.default;
  const ui = new UiStore({
    treeId: qTree && catalogue.some((t) => t.id === qTree) ? qTree : 'syn-yule-1000',
    shape: 'all',
    layout: q.get('layout') === 'radial' ? 'radial' : 'rectangular',
    bl: q.get('bl') !== '0',
    cols: q.get('cols') === '1',
    dark: q.get('dark') === '1',
    links: false,
    hover: true,
    colourOnClick: true,
    highlight: false,
    highlightText: '',
    features,
    phase: 'idle',
    error: null,
    loadingTips: 0,
    result: null,
    caps: null,
    available: {},
    colourIdx: 0,
  });
  const shared: Shared = { adapter, metrics, ui, linkedView: false, listeners: new Set(), linkedViewListeners: new Set() };
  const c0 = new InstanceController(0, shared);
  const c1 = new InstanceController(1, shared);
  window.__spike = c0;
  window.__spike2 = c1;
  window.__spikeData = { catalogue, loadTree, getEntry };
  window.__spikeShell = {
    setLinkedView(on: boolean) {
      shared.linkedView = on;
      shared.linkedViewListeners.forEach((l) => l());
    },
    linkedColour: LINK_COLOUR,
    version: 1,
  };
  const origError = console.error;
  console.error = (...a: unknown[]) => {
    metrics.errors.push('console.error: ' + a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ').slice(0, 300));
    origError.apply(console, a as []);
  };
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const embed = new URLSearchParams(window.location.search).get('embed') === '1'; // ?embed=1: no chrome, tree fills the viewport, API unchanged
  createRoot(rootEl).render(<Shell shared={shared} c0={c0} c1={c1} embed={embed} />);
  // capabilities once, availability of the catalogue files, and an automatic mount when the URL names a tree
  void c0.getCapabilities().then((caps) => ui.set({ caps }));
  void checkAvailability(ui);
  if (qTree && catalogue.some((t) => t.id === qTree)) setTimeout(() => void uiMount(shared, c0, qTree), 0);
  // A person opening a demo without ?tree= should see a tree, not an empty card: load the default. Automated runs
  // (navigator.webdriver) and the compare page's frames (embed) mount through window.__spike themselves.
  else if (!embed && !navigator.webdriver) setTimeout(() => void uiMount(shared, c0, ui.state.treeId), 0);
}
