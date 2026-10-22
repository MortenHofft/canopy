// A look-alike of Reactree (reactreejs 1.0.3: two toolbar rows over a dotted tree pane, an inspector, a floating search, a colour
// palette, an export menu), built only from the public API of @gbif-phylo: <TreeView> and its handle for the drawing, its props for
// clades / highlights / collapsed clades / columns / theme, its callbacks for clicks and hovers, tree-ops for every edit and a
// control of our own (NodeLabels) for the node labels. What could not be matched is listed in ../README.md.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TreeModel, toNewick, toNexus, splitInternalLabel } from '@gbif-phylo/io';
import * as ops from '@gbif-phylo/tree-ops';
import { TreeView, type CladeProp, type TreeNodeEvent, type TreeViewHandle } from '@gbif-phylo/react';
import type { Column, Control, Viewport } from '@gbif-phylo/viewer';
import { NodeLabels, type NodeLabelMode } from './node-labels.ts';
import * as I from './icons.tsx';

type Mode = 'none' | 'reroot' | 'flip' | 'swap' | 'color';
type Layout = 'rectangular' | 'radial';

/** Reactree's 12 swatches; the colours themselves are CSS custom properties (--rt-palette-<name>) in reactree.css. */
const PALETTE = ['Red', 'Orange', 'Amber', 'Lime', 'Emerald', 'Teal', 'Sky', 'Indigo', 'Violet', 'Pink', 'Slate', 'Brown'];
const ERASE = 'reset';
const TRUNCATE_AT = 30; // Reactree: names longer than 30 characters become 28 plus an ellipsis

/** The residue colours the viewer's alignment column uses (a constant table in packages/viewer/src/columns.ts, not exported), for
 *  the legend under the alignment. */
const AA_LEGEND = [
  { colour: '#80a0f0', label: 'Hydrophobic' },
  { colour: '#f01505', label: 'Positive' },
  { colour: '#c048c0', label: 'Negative' },
  { colour: '#15c015', label: 'Polar' },
  { colour: '#15a4a4', label: 'Aromatic' },
  { colour: '#f09048', label: 'Glycine' },
  { colour: '#c0c000', label: 'Proline' },
];
const NT_LEGEND = [
  { colour: '#80a0f0', label: 'A / C' },
  { colour: '#f09048', label: 'G' },
  { colour: '#15c015', label: 'T / U' },
];

interface Step {
  tree: TreeModel;
  clades: CladeProp[];
  collapsed: number[];
}

/** Where a clade (or a collapsed clade) goes after an operation: to the clade its surviving tips form, or nowhere when the operation
 *  split them (rerooting inside it) or removed them all. */
function moveNode(tree: TreeModel, next: TreeModel, map: Int32Array, k: number): number {
  const tips: number[] = [];
  for (let rk = tree.leafStart[k]; rk < tree.leafEnd[k]; rk++) {
    const v = map[tree.tipNode[rk]];
    if (v >= 0) tips.push(v);
  }
  if (!tips.length) return -1;
  const m = next.mrcaOf(tips);
  return next.tipCountOf(m) === tips.length ? m : -1;
}

const pct = (v: number, lo: number, hi: number) => `${((v - lo) / (hi - lo)) * 100}%`;
const fmt = (x: number) => x.toFixed(6).replace(/\.?0+$/, '');
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function Slider(p: {
  icon: React.ReactNode;
  label?: string;
  title: string;
  value: number;
  min: number;
  max: number;
  step: number;
  reset: number;
  width?: number;
  digits?: string;
  onChange(v: number): void;
}) {
  return (
    <div className="rt-slider-group" title={p.title}>
      <span className="rt-slider-icon">{p.icon}</span>
      {p.label && <span className="rt-slider-label">{p.label}</span>}
      <input
        className="rt-slider"
        type="range"
        aria-label={p.title}
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        style={{ width: p.width, ['--rt-fill' as string]: pct(p.value, p.min, p.max) }}
        onChange={(e) => p.onChange(Number(e.target.value))}
        onDoubleClick={() => p.onChange(p.reset)}
      />
      <button type="button" className="rt-slider-val" onClick={() => p.onChange(p.reset)}>
        {p.value.toFixed(1)}
        {p.digits ?? '×'}
      </button>
    </div>
  );
}

export function Reactree({
  published,
  fasta,
  defaultHeight = 520,
}: {
  published: TreeModel;
  fasta: Record<string, string> | null;
  defaultHeight?: number;
}) {
  const ref = useRef<TreeViewHandle>(null);
  const outer = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<Step[]>([{ tree: published, clades: [], collapsed: [] }]);
  const tree = history[history.length - 1].tree;
  const [clades, setClades] = useState<CladeProp[]>([]);
  const [collapsed, setCollapsed] = useState<number[]>([]);

  const [hScale, setHScale] = useState(1);
  const [vScale, setVScale] = useState(1);
  const [fontScale, setFontScale] = useState(1);
  const [strokeWidth, setStrokeWidth] = useState(1.5);
  const [layout, setLayout] = useState<Layout>('rectangular');
  const [phylogram, setPhylogram] = useState(true);
  const [truncate, setTruncate] = useState(true);
  const [labelMode, setLabelMode] = useState<NodeLabelMode>('none');
  const [showAlignment, setShowAlignment] = useState(false);

  const [mode, setMode] = useState<Mode>('none');
  const [swapFirst, setSwapFirst] = useState<number | null>(null);
  const [activeColor, setActiveColor] = useState('Red');
  const [hoveredSwatch, setHoveredSwatch] = useState<string | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);

  const [info, setInfo] = useState<number | null>(null); // node (of `tree`) shown in the inspector
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [height, setHeight] = useState(defaultHeight);

  // ---- what is shown: the current tree with its collapsed clades replaced by one tip each (a view; edits apply to `tree`)
  const view = useMemo(() => {
    const live = collapsed.filter((v) => v > 0 && v < tree.nodeCount);
    if (!live.length) return null;
    // tree-ops' own label ('Name (8 tips)' or 'First_tip and 7 more'): unique, which matters because tip labels are the viewer's ids
    // on a dated (ultrametric) tree the triangle's tip is lengthened to the present, so the shown tree stays dated and the axis stays
    const r = ops.collapseClades(tree, live, undefined, { extend: tree.isUltrametric(1e-3) });
    const shown = new TreeModel(r.tree);
    const toTree = new Int32Array(shown.nodeCount);
    for (let i = 0; i < r.map.length; i++) if (r.map[i] >= 0) toTree[r.map[i]] = i;
    return { tree: shown, toView: r.map, toTree, collapsedIds: live.map((v) => 'n' + r.map[v]) };
  }, [tree, collapsed]);
  const shown = view?.tree ?? tree;
  const toTree = useCallback((n: number) => (view ? view.toTree[n] : n), [view]);
  // where clades nest the viewer lets the innermost colour win, as Reactree does
  const shownClades = useMemo(
    () =>
      view
        ? clades.flatMap((c) => {
            const k = view.toView[Number(c.nodeId.slice(1))];
            return k >= 0 ? [{ ...c, nodeId: 'n' + k }] : [];
          })
        : clades,
    [clades, view],
  );

  const hasSupport = useMemo(() => tree.support.some((s) => !Number.isNaN(s)), [tree]);
  const hasTruncatable = useMemo(() => published.tipLabels.some((l) => l.length > TRUNCATE_AT), [published]);
  const formatLabel = useMemo(
    () => (id: string) => {
      const n = id.replace(/_/g, ' ');
      return truncate && n.length > TRUNCATE_AT ? n.slice(0, TRUNCATE_AT - 2) + '…' : n;
    },
    [truncate],
  );

  // ---- search: case-insensitive substring of the displayed name (Reactree's rule); matches highlighted, the current one centred
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return shown.tipLabels.filter((l) => l.replace(/_/g, ' ').toLowerCase().includes(q));
  }, [query, shown]);
  const current = matches.length ? matches[((matchIdx % matches.length) + matches.length) % matches.length] : null;
  const [focusSeq, setFocusSeq] = useState(0);
  useEffect(() => setFocusSeq((s) => s + 1), [current]);

  // ---- the alignment column (one `values` object per FASTA, so the viewer compiles it once)
  const alignment = useMemo(() => {
    if (!fasta) return null;
    const values: Record<string, string> = {};
    let matched = 0;
    let sites = 0;
    let nt = 0;
    let all = 0;
    for (const l of published.tipLabels) {
      const s = fasta[l];
      if (s === undefined) continue;
      values[l] = s;
      matched++;
      sites = Math.max(sites, s.length);
      for (let i = 0; i < Math.min(s.length, 400); i++) {
        const c = s[i].toUpperCase();
        if (c === '-' || c === '.') continue;
        all++;
        if ('ACGTUN'.includes(c)) nt++;
      }
    }
    const column: Column = { id: 'alignment', kind: 'alignment', header: 'Alignment', width: 320, values };
    return { column, matched, sites, amino: nt < all * 0.9 };
  }, [fasta, published]);
  const columns = useMemo(
    () => (showAlignment && alignment && layout === 'rectangular' ? [alignment.column] : []),
    [showAlignment, alignment, layout],
  );

  // ---- controls on the viewer: our node labels
  const nodeLabels = useMemo(() => new NodeLabels(), []);
  const controls = useMemo<Control[]>(() => [nodeLabels], [nodeLabels]);
  useEffect(() => nodeLabels.setMode(labelMode), [nodeLabels, labelMode]);

  // ---- Width / Height: Reactree stretches the drawing; here they set the visible window relative to the fitted one
  const fitted = useRef<Viewport | null>(null);
  const scales = useRef({ h: 1, v: 1 });
  scales.current = { h: hScale, v: layout === 'radial' ? hScale : vScale };
  const applyScales = useCallback(() => {
    const r = ref.current?.renderer();
    const f = fitted.current;
    if (!r || !f) return;
    const cur = r.getViewport();
    const { h, v } = scales.current;
    const cx = h === 1 ? (f.x0 + f.x1) / 2 : (cur.x0 + cur.x1) / 2;
    const cy = v === 1 ? (f.y0 + f.y1) / 2 : (cur.y0 + cur.y1) / 2;
    const w = (f.x1 - f.x0) / h;
    const hh = (f.y1 - f.y0) / v;
    r.setViewport({ x0: cx - w / 2, x1: cx + w / 2, y0: cy - hh / 2, y1: cy + hh / 2 });
  }, []);
  const refit = useCallback(() => {
    const r = ref.current?.renderer();
    if (!r) return;
    r.fit(false);
    fitted.current = r.getViewport();
    applyScales();
  }, [applyScales]);
  useEffect(applyScales, [hScale, vScale, applyScales]);
  // a new layout, tree type, label size or column changes what "fitted" is
  useEffect(() => {
    const id = requestAnimationFrame(refit);
    return () => cancelAnimationFrame(id);
  }, [layout, phylogram, columns, height, refit]);

  // for the browser check (tests/browser/scripts/check-reactree.mjs): the viewer, to find where nodes are
  useEffect(() => {
    (window as unknown as { __reactree?: () => unknown }).__reactree = () => ref.current?.renderer() ?? null;
  }, []);

  // ---- dark mode: the page flips data-theme on <html>; the viewer re-reads its --phylo-* properties when told to
  useEffect(() => {
    const mo = new MutationObserver(() => ref.current?.renderer()?.refreshTheme());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  const flash = (msg: string) => setToast(msg);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- edits: each returns a new tree (tree-ops), the step before is kept for Undo
  const apply = (op: (t: TreeModel) => ops.OpResult, what: string) => {
    let r: ops.OpResult;
    try {
      r = op(tree);
    } catch (err) {
      return flash(`${what}: ${(err as Error).message}`);
    }
    if (!r.changed) return flash(`${what}: nothing to change`);
    const next = new TreeModel(r.tree);
    const keptClades = clades.flatMap((c) => {
      const m = moveNode(tree, next, r.map, Number(c.nodeId.slice(1)));
      return m >= 0 ? [{ ...c, nodeId: 'n' + m }] : [];
    });
    const keptCollapsed = collapsed.map((k) => moveNode(tree, next, r.map, k)).filter((m) => m > 0 && next.childCount[m] > 0);
    if (keptClades.length < clades.length) flash(`${clades.length - keptClades.length} colour(s) removed: their tips are no longer one clade`);
    setHistory((h) => [...h.slice(0, -1), { tree, clades, collapsed }, { tree: next, clades: keptClades, collapsed: keptCollapsed }]);
    setClades(keptClades);
    setCollapsed(keptCollapsed);
    setInfo(null);
  };
  const undo = () => {
    const prev = history[history.length - 2];
    setHistory((h) => h.slice(0, -1));
    setClades(prev.clades);
    setCollapsed(prev.collapsed);
    setInfo(null);
  };

  const exitModes = () => {
    setMode('none');
    setSwapFirst(null);
  };
  const toggleMode = (m: Mode) => {
    setSwapFirst(null);
    setMode((cur) => (cur === m ? 'none' : m));
  };

  // ---- clicks: what a click does depends on the mode, as in Reactree
  const onClick = (e: TreeNodeEvent) => {
    if (e.run) return flash('Zoom in: this is a run of small clades drawn as one');
    const v = toTree(e.node);
    const isCollapsed = e.isTip && tree.childCount[v] > 0;
    const name = e.isTip ? shown.labels[e.node] : `${tree.tipCountOf(v)} taxa`;
    switch (mode) {
      case 'reroot':
        if (v === 0) return flash('Already the root');
        return apply((t) => ops.reroot(t, v), 'Reroot');
      case 'flip':
        if (e.isTip && !isCollapsed) return flash('Flip needs an internal node');
        return apply((t) => ops.rotate(t, v), 'Flip');
      case 'swap': {
        if (v === 0) return flash('The root has no sibling');
        if (swapFirst === null) return setSwapFirst(v);
        const a = swapFirst;
        setSwapFirst(null);
        if (a === v) return;
        const p = tree.parent[v];
        if (tree.parent[a] !== p) return flash('Swap needs two sibling branches');
        // tree-ops reverses the children of a node; for two children that is the swap. It has no general reorder (yet).
        if (tree.childCount[p] !== 2) return flash(`Swap inside a polytomy (${tree.childCount[p]} branches) needs a reorder tree-ops does not have`);
        return apply((t) => ops.rotate(t, p), 'Swap');
      }
      case 'color': {
        const nodeId = 'n' + v;
        const rest = clades.filter((c) => c.nodeId !== nodeId);
        if (activeColor === ERASE) return setClades(rest);
        return setClades([...rest, { nodeId, colour: cssVar(`--rt-palette-${activeColor.toLowerCase()}`), label: activeColor }]);
      }
      default:
        if (isCollapsed) return setCollapsed((cs) => cs.filter((c) => c !== v));
        if (e.isTip) return setInfo(v);
        if (v === 0) return setInfo(v);
        setCollapsed((cs) => [...cs, v]);
        flash(`Collapsed ${name}: click the triangle to expand`);
    }
  };

  // the hover box says what a click would do
  const tooltip = (e: TreeNodeEvent) => {
    if (e.run) return null;
    const v = toTree(e.node);
    const isCollapsed = e.isTip && tree.childCount[v] > 0;
    const name = e.isTip && !isCollapsed ? formatLabel(shown.labels[e.node]) : `${tree.tipCountOf(v)} taxa`;
    const tag = (cls: string, icon: React.ReactNode, text: React.ReactNode) => (
      <span className={`rt-tip rt-tip--${cls}`}>
        {icon}
        {text}
        <span className="rt-tip-name">{name}</span>
      </span>
    );
    switch (mode) {
      case 'reroot':
        return tag('reroot', <I.IconReroot size={11} />, 'Set as root');
      case 'flip':
        return tag('flip', <I.IconFlip />, 'Flip subtree');
      case 'swap':
        return tag(
          'swap',
          <span className="rt-tip-step">{swapFirst === null ? '1/2' : '2/2'}</span>,
          swapFirst === null ? 'Select first branch' : 'Swap with…',
        );
      case 'color':
        return tag(
          'color',
          <span
            className="rt-tip-dot"
            style={{ background: activeColor === ERASE ? 'var(--rt-muted)' : `var(--rt-palette-${activeColor.toLowerCase()})` }}
          />,
          activeColor === ERASE ? 'Erase color' : `Paint ${activeColor}`,
        );
      default:
        return (
          <span className="rt-tip rt-tip--collapse">
            {isCollapsed ? `Expand · ${name}` : e.isTip ? name : v === 0 ? `Root · ${name}` : `Collapse · ${name}`}
          </span>
        );
    }
  };

  // ---- keyboard, as Reactree: Ctrl/Cmd+F search, Ctrl/Cmd+Z undo, Escape leaves a mode or closes a panel (only while focus is in here)
  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      setSearchOpen(true);
      searchInput.current?.focus(); // already open; a new panel focuses itself (autoFocus)
    } else if (mod && e.key.toLowerCase() === 'z' && history.length > 1) {
      e.preventDefault();
      undo();
    } else if (e.key === 'Escape') {
      if (mode !== 'none') exitModes();
      else if (searchOpen) closeSearch();
      else setInfo(null);
    }
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setQuery('');
    setMatchIdx(0);
  };

  // ---- export: PNG is the viewer's canvas (labels are drawn on it); Newick and NEXUS through @gbif-phylo/io
  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const exportPng = () => {
    const r = ref.current?.renderer();
    if (!r) return;
    r.renderNow();
    const src = r.treeElement.querySelector('canvas');
    if (!src) return;
    // the tree is drawn on a transparent background (the pane's dotted grid shows through): the PNG gets the pane's colour
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = cssVar('--rt-surface-10');
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    out.toBlob((b) => b && download(b, 'phylotree.png'), 'image/png');
  };
  const exportText = (text: string, name: string) => download(new Blob([text], { type: 'text/plain' }), name);

  // close the export menu on a press outside it
  const exportRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!downloadOpen) return;
    const f = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!exportRef.current?.contains(t) && !menuRef.current?.contains(t)) setDownloadOpen(false);
    };
    document.addEventListener('pointerdown', f);
    return () => document.removeEventListener('pointerdown', f);
  }, [downloadOpen]);

  // ---- resize handle: drag the bottom edge of the pane
  const onResizeDown = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = height;
    const move = (m: PointerEvent) => setHeight(Math.max(240, h0 + m.clientY - y0));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---- inspector rows for a node of `tree`
  const inspector = useMemo(() => {
    if (info === null || info >= tree.nodeCount) return null;
    let root = 0;
    let any = false;
    for (let u = info; u > 0; u = tree.parent[u])
      if (!Number.isNaN(tree.length[u])) {
        root += tree.length[u];
        any = true;
      }
    const isTip = tree.childCount[info] === 0;
    const sup = isTip ? (info > 0 ? tree.support[tree.parent[info]] : NaN) : tree.support[info];
    return {
      name: isTip ? tree.labels[info] : splitInternalLabel(tree.labels[info]).name || `Clade of ${tree.tipCountOf(info)} taxa`,
      raw: tree.labels[info],
      branch: Number.isNaN(tree.length[info]) ? null : tree.length[info],
      root: any ? root : null,
      depth: tree.depth[info],
      support: Number.isNaN(sup) ? null : sup,
    };
  }, [info, tree]);

  const labelCycle: NodeLabelMode[] = ['none', ...(hasSupport ? ['bootstrap' as const] : []), ...(tree.hasLengths ? ['branchlength' as const] : [])];
  const nextLabel = labelCycle[(labelCycle.indexOf(labelMode) + 1) % labelCycle.length];
  const theme = useMemo(
    () => ({ labelSize: 11.5 * fontScale, branchWidth: strokeWidth, cladeBranchWidth: strokeWidth + 0.7 }),
    [fontScale, strokeWidth],
  );
  const activeHex = activeColor === ERASE ? 'var(--rt-muted)' : `var(--rt-palette-${activeColor.toLowerCase()})`;
  const feedback = hoveredSwatch ?? (activeColor === ERASE ? 'Erase' : activeColor);

  return (
    <div className={`rt-outer rt-mode-${mode}`} ref={outer} onKeyDown={onKeyDown}>
      {/* ── Row 1: view settings ── */}
      <div className="rt-row" role="toolbar" aria-label="View">
        <Slider
          icon={<I.IconWidth />}
          label={layout === 'radial' ? 'Size' : 'Width'}
          title="Width"
          value={hScale}
          min={0.3}
          max={4}
          step={0.05}
          reset={1}
          onChange={setHScale}
        />
        {layout === 'rectangular' && (
          <>
            <div className="rt-divider" />
            <Slider
              icon={<I.IconHeight />}
              label="Height"
              title="Height"
              value={vScale}
              min={0.3}
              max={4}
              step={0.05}
              reset={1}
              onChange={setVScale}
            />
          </>
        )}
        <div className="rt-divider" />
        <Slider
          icon={<I.IconFont />}
          title="Font size"
          value={fontScale}
          min={0.5}
          max={2.5}
          step={0.05}
          reset={1}
          width={64}
          onChange={setFontScale}
        />
        <Slider
          icon={<I.IconBranchWidth />}
          title="Branch width"
          value={strokeWidth}
          min={0.5}
          max={4}
          step={0.1}
          reset={1.5}
          width={64}
          digits=""
          onChange={setStrokeWidth}
        />
        <div className="rt-divider" />
        <div className="rt-group">
          <button
            type="button"
            className={layout === 'rectangular' ? 'active' : ''}
            aria-pressed={layout === 'rectangular'}
            title="Rectangular"
            onClick={() => setLayout('rectangular')}
          >
            <I.IconRect />
          </button>
          <button
            type="button"
            className={layout === 'radial' ? 'active' : ''}
            aria-pressed={layout === 'radial'}
            title="Circular"
            onClick={() => setLayout('radial')}
          >
            <I.IconCirc />
          </button>
        </div>
        <div className="rt-divider" />
        <div className="rt-group">
          <button
            type="button"
            className={phylogram ? 'active' : ''}
            aria-pressed={phylogram}
            disabled={!tree.hasLengths}
            title="Phylogram — branch lengths proportional"
            onClick={() => setPhylogram(true)}
          >
            <I.IconPhylo />
          </button>
          <button
            type="button"
            className={!phylogram ? 'active' : ''}
            aria-pressed={!phylogram}
            title="Cladogram — topology only"
            onClick={() => setPhylogram(false)}
          >
            <I.IconClado />
          </button>
        </div>
        {hasTruncatable && (
          <>
            <div className="rt-divider" />
            <button
              type="button"
              className={`rt-btn rt-toggle${truncate ? ' active' : ''}`}
              title={truncate ? 'Names truncated — click to show full names' : 'Full names shown — click to truncate'}
              onClick={() => setTruncate((t) => !t)}
            >
              <I.IconTruncate />
              {truncate ? 'Truncate' : 'Full names'}
            </button>
          </>
        )}
        <div className="rt-spacer" />
        <button
          type="button"
          className={`rt-btn${searchOpen ? ' rt-search-active' : ''}`}
          aria-label="Search taxa"
          title="Search taxa (⌘F)"
          onClick={() => {
            if (searchOpen) return closeSearch();
            setSearchOpen(true);
            searchInput.current?.focus(); // already open; a new panel focuses itself (autoFocus)
          }}
        >
          <I.IconSearch />
        </button>
        <div className="rt-divider" />
        <div className="rt-export" ref={exportRef}>
          <button
            type="button"
            className={`rt-btn${downloadOpen ? ' open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={downloadOpen}
            title="Export tree"
            onClick={() => setDownloadOpen((o) => !o)}
          >
            <I.IconExport />
            Export
            <I.IconChevronDown />
          </button>
        </div>
      </div>

      {/* ── Row 2: interaction tools ── */}
      <div className="rt-row" role="toolbar" aria-label="Edit">
        {history.length > 1 && (
          <>
            <button type="button" className="rt-btn rt-fade" title="Undo last action" onClick={undo}>
              <I.IconUndo />
              Undo
            </button>
            <div className="rt-divider" />
          </>
        )}
        <button type="button" className="rt-btn" title="Fit tree" onClick={refit}>
          <I.IconFit />
          Fit
        </button>
        <div className="rt-divider" />
        <button
          type="button"
          className={`rt-btn rt-tool${mode === 'reroot' ? ' active' : ''}`}
          aria-pressed={mode === 'reroot'}
          title={mode === 'reroot' ? 'Exit reroot mode (Esc)' : 'Reroot — click any node'}
          onClick={() => toggleMode('reroot')}
        >
          <I.IconReroot />
          {mode === 'reroot' ? (
            <>
              Click… <span className="rt-dot" />
            </>
          ) : (
            'Reroot'
          )}
        </button>
        <button
          type="button"
          className="rt-btn rt-tool"
          disabled={!tree.hasLengths}
          title={tree.hasLengths ? 'Midpoint root — place root at the midpoint of the longest path' : 'Midpoint root requires branch lengths'}
          onClick={() => {
            exitModes();
            apply(ops.midpointRoot, 'Midpoint');
          }}
        >
          <I.IconMidpoint />
          Midpoint
        </button>
        <button
          type="button"
          className={`rt-btn rt-tool${mode === 'flip' ? ' active' : ''}`}
          aria-pressed={mode === 'flip'}
          title={mode === 'flip' ? 'Exit flip mode (Esc)' : 'Flip — reverse children order at a node'}
          onClick={() => toggleMode('flip')}
        >
          <I.IconFlip />
          Flip
          {mode === 'flip' && <span className="rt-dot" />}
        </button>
        <button
          type="button"
          className={`rt-btn rt-tool${mode === 'swap' ? ' active rt-swap-active' : ''}`}
          aria-pressed={mode === 'swap'}
          title={mode === 'swap' ? 'Exit swap mode (Esc)' : 'Swap — exchange two sibling branches'}
          onClick={() => toggleMode('swap')}
        >
          <I.IconSwap />
          Swap
          {mode === 'swap' && (
            <span className="rt-steps">
              <span className={swapFirst === null ? 'on' : 'done'}>1</span>→<span className={swapFirst !== null ? 'on' : ''}>2</span>
            </span>
          )}
        </button>
        <button
          type="button"
          className={`rt-btn rt-color${mode === 'color' ? ' active' : ''}`}
          aria-pressed={mode === 'color'}
          title={mode === 'color' ? 'Exit color mode (Esc)' : 'Color clades, branches & leaves'}
          style={mode === 'color' ? ({ '--rt-active': activeHex } as React.CSSProperties) : undefined}
          onClick={() => toggleMode('color')}
        >
          <I.IconPalette />
          Color
          {mode === 'color' && <span className="rt-color-dot" style={{ background: activeHex }} />}
          {mode !== 'color' && clades.length > 0 && <span className="rt-count">{clades.length}</span>}
        </button>
        <div className="rt-divider" />
        <div className="rt-group">
          <button type="button" title="Ladderize ascending — smallest clades at top" onClick={() => apply((t) => ops.ladderise(t), 'Ladderize')}>
            <I.IconLadderize asc />
          </button>
          <button
            type="button"
            title="Ladderize descending — largest clades at top"
            onClick={() => apply((t) => ops.ladderise(t, { order: 'decreasing' }), 'Ladderize')}
          >
            <I.IconLadderize asc={false} />
          </button>
        </div>
        {collapsed.length > 0 && (
          <>
            <div className="rt-divider" />
            <button
              type="button"
              className="rt-btn rt-expand"
              title={`Expand all collapsed clades (${collapsed.length})`}
              onClick={() => setCollapsed([])}
            >
              <I.IconExpandAll />
              Expand all
              <span className="rt-count rt-count--violet">{collapsed.length}</span>
            </button>
          </>
        )}
        <div className="rt-spacer" />
        {alignment && layout === 'rectangular' && (
          <button
            type="button"
            className={`rt-btn rt-toggle${showAlignment ? ' active' : ''}`}
            title={showAlignment ? 'Hide alignment track' : 'Show alignment alongside leaf nodes'}
            onClick={() => setShowAlignment((s) => !s)}
          >
            <I.IconAlnTrack />
            Alignment
          </button>
        )}
        {phylogram && tree.hasLengths && (
          <button
            type="button"
            className="rt-btn rt-toggle"
            disabled
            title="Align leaf labels: not available, the viewer has no aligned-label option"
          >
            <I.IconAlignLabels />
            Align
          </button>
        )}
        {labelCycle.length > 1 && (
          <button
            type="button"
            className={`rt-btn rt-labels rt-labels--${labelMode}`}
            title={`Node labels: ${labelMode === 'none' ? 'hidden' : labelMode === 'bootstrap' ? 'support values' : 'branch lengths'} — click to cycle`}
            onClick={() => setLabelMode(nextLabel)}
          >
            {labelMode === 'bootstrap' ? <I.IconBootstrap /> : labelMode === 'branchlength' ? <I.IconBranchLen /> : <I.IconLabelsOff />}
            {labelMode === 'bootstrap' ? 'Bootstrap' : labelMode === 'branchlength' ? 'Length' : 'No labels'}
          </button>
        )}
      </div>

      {/* ── Body: the tree ── */}
      <div className="rt-pane" style={{ height }}>
        <TreeView
          ref={ref}
          tree={shown}
          layout={layout}
          branchLengths={phylogram}
          clades={shownClades}
          highlighted={matches}
          collapsed={view?.collapsedIds}
          columns={columns}
          controls={controls}
          theme={theme}
          focus={current ? { tipId: current, seq: focusSeq } : null}
          options={{ formatLabel, italicLabels: false, labelDensity: 'dense' }}
          tooltip={tooltip}
          onNodeClick={onClick}
          onTipClick={onClick}
          onReady={refit}
        />

        {searchOpen && (
          <div className="rt-search">
            <span className="rt-search-icon">
              <I.IconSearch />
            </span>
            <input
              ref={searchInput}
              autoFocus
              type="text"
              aria-label="Search taxa"
              placeholder="Search taxa…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setMatchIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'Enter') {
                  e.preventDefault();
                  setMatchIdx((i) => i + 1);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMatchIdx((i) => i - 1);
                }
              }}
            />
            {query.trim() && (
              <span className={`rt-search-count${matches.length ? '' : ' none'}`}>
                {matches.length ? `${matches.indexOf(current!) + 1} / ${matches.length}` : 'No match'}
              </span>
            )}
            {matches.length > 1 && (
              <span className="rt-search-nav">
                <button type="button" title="Previous match (↑)" onClick={() => setMatchIdx((i) => i - 1)}>
                  <I.IconUp />
                </button>
                <button type="button" title="Next match (↓ or Enter)" onClick={() => setMatchIdx((i) => i + 1)}>
                  <I.IconDown />
                </button>
              </span>
            )}
            <button type="button" className="rt-search-close" title="Close search (Esc)" onClick={closeSearch}>
              <I.IconClose />
            </button>
          </div>
        )}

        {inspector && (
          <div className="rt-info" role="dialog" aria-label="Node information">
            <div className="rt-info-head">
              <span className="rt-info-name">{inspector.name.replace(/_/g, ' ')}</span>
              <button type="button" title="Close" onClick={() => setInfo(null)}>
                <I.IconClose />
              </button>
            </div>
            <dl className="rt-info-rows">
              {inspector.branch !== null && (
                <>
                  <dt>Branch length</dt>
                  <dd>{fmt(inspector.branch)}</dd>
                </>
              )}
              {inspector.root !== null && (
                <>
                  <dt>Root distance</dt>
                  <dd>{fmt(inspector.root)}</dd>
                </>
              )}
              <dt>Depth</dt>
              <dd>{inspector.depth}</dd>
              {inspector.support !== null && (
                <>
                  <dt>Bootstrap</dt>
                  <dd className="rt-info-boot">{inspector.support}</dd>
                </>
              )}
            </dl>
            <button
              type="button"
              className="rt-info-copy"
              title="Copy raw taxon name"
              onClick={() => void navigator.clipboard?.writeText(inspector.raw)}
            >
              <I.IconCopy />
              Copy name
            </button>
          </div>
        )}

        {toast && (
          <div className="rt-toast" role="status">
            {toast}
          </div>
        )}
        <div className={`rt-hint rt-hint--${layout}`}>Scroll to zoom · Drag to pan</div>
        <div className="rt-resize" title="Drag to resize" onPointerDown={onResizeDown}>
          <div className="rt-grip" />
        </div>
      </div>

      {columns.length > 0 && alignment && (
        <div className="rt-legend">
          <span className={`rt-legend-type${alignment.amino ? ' aa' : ''}`}>{alignment.amino ? 'AA' : 'NT'}</span>
          <span className="rt-legend-meta">
            {alignment.sites.toLocaleString('en')} sites · {alignment.matched} of {published.tipCount} tips matched
          </span>
          <span className="rt-legend-divider" />
          {(alignment.amino ? AA_LEGEND : NT_LEGEND).map((l) => (
            <span key={l.label} className="rt-legend-item">
              <span className="rt-legend-dot" style={{ background: l.colour }} />
              {l.label}
            </span>
          ))}
          <span className="rt-legend-item">
            <span className="rt-legend-dash" />
            Gap
          </span>
        </div>
      )}

      {downloadOpen && (
        <div className="rt-menu" role="menu" ref={menuRef}>
          {(
            [
              ['PNG', 'Raster', <I.IconFilePng key="i" />, exportPng],
              null,
              ['Newick', 'Tree', <I.IconFileNewick key="i" />, () => exportText(toNewick(tree), 'phylotree.nwk')],
              ['NEXUS', 'Tree', <I.IconFileNexus key="i" />, () => exportText(toNexus(tree), 'phylotree.nex')],
            ] as const
          ).map((item, k) =>
            item === null ? (
              <div key={k} className="rt-menu-divider" />
            ) : (
              <button
                key={item[0]}
                type="button"
                role="menuitem"
                onClick={() => {
                  item[3]();
                  setDownloadOpen(false);
                }}
              >
                <span className="rt-menu-icon">{item[2]}</span>
                <span className="rt-menu-label">{item[0]}</span>
                <span className="rt-menu-desc">{item[1]}</span>
              </button>
            ),
          )}
        </div>
      )}

      {/* ── Colour palette (floating, as Reactree's) ── */}
      {mode === 'color' && (
        <div className="rt-palette" role="dialog" aria-label="Paint clades">
          <div className="rt-palette-head">
            <I.IconPalette />
            <span>Paint clades, branches &amp; leaves</span>
            <span className="rt-palette-tip">Esc to exit</span>
          </div>
          <div className="rt-palette-grid">
            {PALETTE.map((name) => (
              <button
                key={name}
                type="button"
                title={name}
                aria-label={name}
                aria-pressed={activeColor === name}
                className={`rt-swatch${activeColor === name ? ' active' : ''}`}
                style={{ ['--sw' as string]: `var(--rt-palette-${name.toLowerCase()})` }}
                onClick={() => setActiveColor(name)}
                onMouseEnter={() => setHoveredSwatch(name)}
                onMouseLeave={() => setHoveredSwatch(null)}
              />
            ))}
          </div>
          <div className="rt-palette-divider" />
          <div className="rt-palette-foot">
            <button
              type="button"
              className={`rt-erase${activeColor === ERASE ? ' active' : ''}`}
              onClick={() => setActiveColor(ERASE)}
              onMouseEnter={() => setHoveredSwatch('Erase')}
              onMouseLeave={() => setHoveredSwatch(null)}
            >
              <I.IconEraser /> Erase
            </button>
            {clades.length > 0 && (
              <button type="button" className="rt-clear" onClick={() => setClades([])}>
                Clear all ({clades.length})
              </button>
            )}
            <span className="rt-palette-feedback">
              <span
                className="rt-tip-dot"
                style={{ background: feedback === 'Erase' ? 'var(--rt-muted)' : `var(--rt-palette-${feedback.toLowerCase()})` }}
              />
              {feedback}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
