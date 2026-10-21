// Test page for the browser checks (scripts/check-radial-ui.mjs) and the benchmarks (bench/). Not a demo: it mounts <TreeView>
// in two independent instances and exposes window.__spike / window.__spike2, the small driving API the scripts were written
// against (mount a Newick text, colour, highlight, focus, locate, read the event log and stats), plus window.__customTree (the
// first instance's handle) for direct access to the renderer.

import React, { useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { parseNewick, type TreeModel } from '@gbif-phylo/io';
import { TreeView, type CladeProp, type TreeNodeEvent, type TreeViewHandle } from '@gbif-phylo/react';
import type { LayoutKind } from '@gbif-phylo/viewer';

interface MountOptions {
  treeId: string;
  newick: string;
  layout: LayoutKind;
  branchLengths: boolean;
  size: { width: number; height: number };
}
interface TestEvent {
  type: 'tipClick' | 'tipHover' | 'nodeClick' | 'nodeHover' | 'branchClick';
  nodeId: string;
  isTip: boolean;
  tipIds: string[];
  source: 'adapter-derived';
  libraryPayload: Record<string, unknown>;
}
interface PaneState {
  tree: TreeModel | null;
  opts: MountOptions | null;
  clades: CladeProp[];
  highlighted: string[];
  focus: { tipId: string; seq: number } | undefined;
  last: TestEvent | null;
  mountId: number;
}
const EMPTY: PaneState = { tree: null, opts: null, clades: [], highlighted: [], focus: undefined, last: null, mountId: 0 };

/** CPU canvas under automation: headless Chromium has no GPU, and an accelerated canvas there runs 3 to 10 times slower. ?cpu=1|0 overrides. */
const CPU = (() => {
  const q = new URLSearchParams(location.search).get('cpu');
  return q === '1' ? true : q === '0' ? false : navigator.webdriver === true;
})();

const nextPaint = () => new Promise<number>((r) => requestAnimationFrame(() => setTimeout(() => r(performance.now()), 0)));

interface PaneApi {
  mount(o: MountOptions): Promise<{ parseMs: number; sharedParseMs: number; firstRenderMs: number; tips: number }>;
  unmount(): Promise<void>;
  setColouredClades(c: CladeProp[]): Promise<void>;
  highlightTips(ids: string[]): Promise<void>;
  focusTip(id: string): Promise<void>;
  locate(t: { kind: 'tip' | 'node'; id: string }): Promise<{ x: number; y: number } | null>;
  getEvents(): Promise<TestEvent[]>;
  clearEvents(): Promise<void>;
  getStats(): Promise<{ domNodes: number; canvases: number; custom?: Record<string, number> }>;
}

const Pane = forwardRef<PaneApi, { index: number }>(function Pane({ index }, ref) {
  const [s, setS] = useState<PaneState>(EMPTY);
  const state = useRef(s);
  state.current = s;
  const view = useRef<TreeViewHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const events = useRef<TestEvent[]>([]);
  const ready = useRef<((r: { layoutMs: number; tips: number }) => void) | null>(null);
  const seq = useRef(0);
  const set = (patch: Partial<PaneState>) => flushSync(() => setS((p) => ({ ...p, ...patch })));

  const emit = (e: TreeNodeEvent, hover: boolean) => {
    const type: TestEvent['type'] = e.isTip
      ? hover
        ? 'tipHover'
        : 'tipClick'
      : hover || e.run
        ? 'nodeHover'
        : e.kind === 'branch'
          ? 'branchClick'
          : 'nodeClick';
    const ev: TestEvent = {
      type,
      nodeId: e.nodeId,
      isTip: e.isTip,
      tipIds: e.isTip ? [e.tipId as string] : e.tipIds(),
      source: 'adapter-derived',
      libraryPayload: { kind: e.kind, via: e.via, tipRange: e.tipRange, tipCount: e.tipCount, run: e.run },
    };
    events.current.push(ev);
    setS((p) => ({ ...p, last: ev }));
  };

  useImperativeHandle(ref, () => ({
    async mount(o) {
      if (state.current.tree) await this.unmount();
      const p0 = performance.now();
      const tree = parseNewick(o.newick);
      const sharedParseMs = performance.now() - p0;
      events.current = [];
      const done = new Promise<{ layoutMs: number; tips: number }>((r) => (ready.current = r));
      const t0 = performance.now();
      set({ ...EMPTY, tree, opts: o, mountId: state.current.mountId + 1 });
      const r = await done;
      const tPaint = await nextPaint();
      return { parseMs: 0, sharedParseMs, firstRenderMs: tPaint - t0, tips: r.tips };
    },
    async unmount() {
      ready.current = null;
      set({ ...EMPTY, mountId: state.current.mountId });
      await nextPaint();
    },
    async setColouredClades(c) {
      const t = need();
      for (const x of c) if (!t.isNodeId(x.nodeId)) throw new Error(`unknown node ${x.nodeId}`);
      set({ clades: c.map((x) => ({ ...x })) });
      await nextPaint();
    },
    async highlightTips(ids) {
      need();
      set({ highlighted: ids.slice() });
      await nextPaint();
    },
    async focusTip(id) {
      if (need().tipIndex(id) < 0) throw new Error(`unknown tip ${JSON.stringify(id)}`);
      set({ focus: { tipId: id, seq: ++seq.current } });
      await nextPaint();
    },
    async locate(t) {
      const tree = state.current.tree;
      const h = view.current;
      if (!tree || !h) return null;
      const id = t.kind === 'tip' ? tree.tipNodeId(t.id) : tree.isNodeId(t.id) ? t.id : null;
      return id ? h.locateNode(id) : null;
    },
    async getEvents() {
      return events.current.slice();
    },
    async clearEvents() {
      events.current = [];
    },
    async getStats() {
      const el = box.current;
      if (!el) return { domNodes: 0, canvases: 0 };
      const st = view.current?.getStats();
      const custom: Record<string, number> = {};
      if (st) for (const [k, v] of Object.entries(st)) if (typeof v === 'number' || typeof v === 'boolean') custom[k] = Number(v);
      return { domNodes: el.querySelectorAll('*').length, canvases: el.querySelectorAll('canvas').length, custom };
    },
  }));
  const need = () => {
    if (!state.current.tree) throw new Error('nothing mounted');
    return state.current.tree;
  };

  // the first instance's handle for the scripts that drive the renderer directly, present while a tree is mounted
  const mounted = s.tree !== null;
  React.useLayoutEffect(() => {
    if (index !== 0 || !mounted) return;
    const w = window as unknown as Record<string, unknown>;
    w.__customTree = { bench: (n: number) => view.current?.benchmark(n), stats: () => view.current?.getStats(), handle: () => view.current };
    return () => {
      delete w.__customTree;
    };
  }, [index, mounted]);

  const o = s.opts;
  const e = s.last;
  const sfx = index ? `-${index}` : '';
  return (
    <section>
      <div ref={box} data-testid={`tree-container${sfx}`}>
        {s.tree && o && (
          <TreeView
            key={s.mountId}
            ref={view}
            tree={s.tree}
            layout={o.layout}
            branchLengths={o.branchLengths}
            clades={s.clades}
            highlighted={s.highlighted}
            focus={s.focus}
            width={o.size.width}
            height={o.size.height}
            options={{ softwareCanvas: CPU, ariaLabel: `Phylogenetic tree, ${s.tree.tipCount} tips` }}
            onTipClick={(ev) => emit(ev, false)}
            onNodeClick={(ev) => emit(ev, false)}
            onHover={(ev) => ev && emit(ev, true)}
            onReady={(r) => ready.current?.(r)}
          />
        )}
      </div>
      <dl>
        <dt>Last event</dt>
        <dd data-testid={`last-event${sfx}`} data-type={e?.type ?? ''} data-node-id={e?.nodeId ?? ''}>
          {e ? `${e.type} ${e.nodeId} tips=${e.tipIds.length} source=${e.source}` : 'none'}
        </dd>
      </dl>
    </section>
  );
});

function App() {
  const a = useRef<PaneApi>(null);
  const b = useRef<PaneApi>(null);
  React.useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    // plain objects forwarding to the pane's current handle (a Proxy would answer every property, `then` included, and confuse
    // Playwright's serialisation of the returned value)
    const METHODS = ['mount', 'unmount', 'setColouredClades', 'highlightTips', 'focusTip', 'locate', 'getEvents', 'clearEvents', 'getStats'] as const;
    const proxy = (r: React.RefObject<PaneApi | null>) =>
      Object.fromEntries(METHODS.map((k) => [k, (...args: never[]) => (r.current![k] as (...a: never[]) => unknown)(...args)]));
    w.__spike = proxy(a);
    w.__spike2 = proxy(b);
  }, []);
  return (
    <div className="panes">
      <Pane ref={a} index={0} />
      <Pane ref={b} index={1} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
