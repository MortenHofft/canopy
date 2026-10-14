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
import { catalogue, getEntry, loadColumns, loadTree } from './data.ts';
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

interface Shared {
  adapter: CandidateAdapter;
  metrics: SpikeMetricsApi;
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
    if (clickish) {
      patch.selection = { nodeId: full.nodeId, tipIds: full.tipIds, type: full.type };
      if (full.isTip) {
        const tip = full.tipIds[0] ?? '';
        const row = this.meta?.rowByTip[tip] ?? null;
        patch.tipMeta = { tip, matched: row !== null, row, hasMeta: this.meta !== null && this.meta.columns.length > 0 };
      }
      if (this.shared.linkedView && !full.isTip) patch.colouredClades = [{ nodeId: full.nodeId, colour: LINK_COLOUR }];
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

function useInstance(ctl: InstanceController): InstanceState {
  return useSyncExternalStore(ctl.subscribe, ctl.getSnapshot);
}

function Viewer({ ctl, adapter, shared }: { ctl: InstanceController; adapter: CandidateAdapter; shared: Shared }) {
  const s = useInstance(ctl);
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

function Tabs<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { v: T; text: string }[]; onPick(v: T): void }) {
  return (
    <div className="tabs-pill" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" role="tab" className="tab-pill" aria-selected={o.v === value} onClick={() => onPick(o.v)}>
          {o.text}
        </button>
      ))}
    </div>
  );
}

function Shell({ shared, c0, c1, embed }: { shared: Shared; c0: InstanceController; c1: InstanceController; embed: boolean }) {
  const s0 = useInstance(c0);
  const s1 = useInstance(c1);
  const cand = shared.adapter.candidate;
  const quiet = (p: Promise<unknown>) => void p.catch((e) => shared.metrics.errors.push('toolbar: ' + String(e)));
  return (
    <div className={'shell' + (embed ? ' embed' : '')}>
      <header className="app-header">
        <img src={LOGO} alt="GBIF" height={32} />
        <span className="app-title">Phylogeny viewer spike</span>
        <span className="muted">{cand.name} {cand.version} · {cand.license}</span>
      </header>
      <Toolbar api={c0} api2={c1} shared={shared} />
      <div className="body">
        <section className="card tree-card">
          <div className="tree-card-head">
            <h2 className="card-title">Tree {s0.treeId && <span className="muted">{s0.treeId}</span>}</h2>
            <Tabs label="Layout" value={s0.layout} options={[{ v: 'rectangular', text: 'Rectangular' }, { v: 'radial', text: 'Radial' }]} onPick={(l) => quiet(c0.setLayout(l))} />
            <Tabs label="Branch lengths" value={s0.branchLengths ? 'phylogram' : 'cladogram'} options={[{ v: 'phylogram', text: 'Phylogram' }, { v: 'cladogram', text: 'Cladogram' }]} onPick={(v) => quiet(c0.setBranchLengths(v === 'phylogram'))} />
          </div>
          <main className="main"><Viewer ctl={c0} adapter={shared.adapter} shared={shared} /></main>
        </section>
        <aside className="side">
          <Panel ctl={c0} i={0} />
          <div className="second card" style={{ display: s1.mountId ? 'block' : 'none' }}>
            <Viewer ctl={c1} adapter={shared.adapter} shared={shared} />
          </div>
          {s1.mountId ? <Panel ctl={c1} i={1} /> : null}
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
.embed-chip{display:none}
.embed .app-header,.embed .app-footer,.embed .toolbar-band,.embed .side,.embed .tree-card-head{display:none}
.embed .body{padding:0;gap:0}
.embed .tree-card{border:none;border-radius:0;box-shadow:none}
.embed .embed-chip{display:block;position:fixed;right:var(--space-2);bottom:var(--space-2);z-index:10;padding:var(--space-1) var(--space-2);background:var(--popover-bg);border:1px solid var(--card-border-color);border-radius:var(--radius-pill);box-shadow:var(--shadow-sm);font-family:var(--font-mono);font-size:var(--text-2xs);color:var(--fg2);pointer-events:none}
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
  const shared: Shared = { adapter, metrics, linkedView: false, listeners: new Set(), linkedViewListeners: new Set() };
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
}
