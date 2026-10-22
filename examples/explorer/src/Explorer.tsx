// The explorer: a styled example of the full API, its look started from Reactree (reactreejs 1.0.3: two toolbar rows over a dotted tree pane, an inspector, a floating search, a colour
// palette, an export menu), built only from the public API of @gbif-phylo: <TreeView> and its handle for the drawing, its props for
// clades / highlights / collapsed clades / columns / theme, its callbacks for clicks and hovers, tree-ops for every edit and a
// `nodeLabels` option for the support values and branch lengths. What could not be matched is listed in ../README.md.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TreeModel, toNewick, toNexus, splitInternalLabel } from '@gbif-phylo/io';
import * as ops from '@gbif-phylo/tree-ops';
import { TreeView, type CladeProp, type TreeNodeEvent, type TreeViewHandle } from '@gbif-phylo/react';
import { detectAlphabet, residueColours, residueGroups, type Column, type Control, type Viewport } from '@gbif-phylo/viewer';
import * as I from './icons.tsx';

type Mode = 'none' | 'reroot' | 'flip' | 'swap' | 'color';
type Layout = 'rectangular' | 'radial';
type NodeLabelMode = 'none' | 'bootstrap' | 'branchlength';
const NO_CONTROLS: Control[] = []; // the explorer has its own toolbar: none of the viewer's buttons

/** Reactree's 12 swatches; the colours themselves are CSS custom properties (--ex-palette-<name>) in explorer.css. */
const PALETTE = ['Red', 'Orange', 'Amber', 'Lime', 'Emerald', 'Teal', 'Sky', 'Indigo', 'Violet', 'Pink', 'Slate', 'Brown'];
const ERASE = 'reset';
const TRUNCATE_AT = 30; // Reactree: names longer than 30 characters become 28 plus an ellipsis

interface Step {
  tree: TreeModel;
  clades: CladeProp[];
  collapsed: number[];
  /** The node map of the edit that made this step from the one before it (old tree -> this tree); none for the first. */
  map?: Int32Array;
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
    <div className="ex-slider-group" title={p.title}>
      <span className="ex-slider-icon">{p.icon}</span>
      {p.label && <span className="ex-slider-label">{p.label}</span>}
      <input
        className="ex-slider"
        type="range"
        aria-label={p.title}
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        style={{ width: p.width, ['--ex-fill' as string]: pct(p.value, p.min, p.max) }}
        onChange={(e) => p.onChange(Number(e.target.value))}
        onDoubleClick={() => p.onChange(p.reset)}
      />
      <button type="button" className="ex-slider-val" onClick={() => p.onChange(p.reset)}>
        {p.value.toFixed(1)}
        {p.digits ?? '×'}
      </button>
    </div>
  );
}

export function Explorer({
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
  // the last change of `tree` and the map it came with (edit: the op's map; undo: its inverse), to keep the view across it
  const [move, setMove] = useState<{ from: TreeModel; to: TreeModel; map: Int32Array } | null>(null);
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
  const [alignLabels, setAlignLabels] = useState(false);
  // striped summaries (#59): on in this preview branch; the library's default is solid
  const [stripes, setStripes] = useState(true);
  const [themeTick, setThemeTick] = useState(0); // bumped when the page flips light/dark: the legend reads the theme in force

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

  // ---- what is shown: the current tree, as it is. Collapsing is the viewer's (`collapsed` below, ids of `tree`), so a click, a tooltip
  // and a colour all speak the ids of `tree`, and collapsing does not touch the zoom.
  const collapsedIds = useMemo(() => collapsed.filter((v) => v > 0 && v < tree.nodeCount).map((v) => 'n' + v), [collapsed, tree]);

  // What the viewer is told when `tree` changes, so it keeps the view: the node map of the edit (Undo: its inverse). The `tree` of the
  // last commit is kept in a ref written after the commit.
  const lastTree = useRef(tree);
  const treeMap = useMemo(() => {
    const prev = lastTree.current;
    if (prev === tree) return undefined;
    return move && move.from === prev && move.to === tree ? move.map : undefined; // not an edit we know the map of: fit
  }, [tree, move]);
  useLayoutEffect(() => {
    lastTree.current = tree;
  }, [tree]);

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
    return tree.tipLabels.filter((l) => l.replace(/_/g, ' ').toLowerCase().includes(q));
  }, [query, tree]);
  const current = matches.length ? matches[((matchIdx % matches.length) + matches.length) % matches.length] : null;
  const [focusSeq, setFocusSeq] = useState(0);
  useEffect(() => setFocusSeq((s) => s + 1), [current]);

  // ---- the alignment column (one `values` object per FASTA, so the viewer compiles it once)
  const alignment = useMemo(() => {
    if (!fasta) return null;
    const values: Record<string, string> = {};
    let matched = 0;
    let sites = 0;
    for (const l of published.tipLabels) {
      const sq = fasta[l];
      if (sq === undefined) continue;
      values[l] = sq;
      matched++;
      sites = Math.max(sites, sq.length);
    }
    const alphabet = detectAlphabet(Object.values(values)); // the column would pick the same; it is passed so the legend cannot disagree
    const column: Column = { id: 'alignment', kind: 'alignment', header: 'Alignment', width: 320, values, alphabet };
    return { column, matched, sites, alphabet };
  }, [fasta, published]);
  // the legend reads the residue colours of the theme in force, so it follows every theme change, whoever made it
  useEffect(() => {
    if (!showAlignment) return;
    return ref.current?.renderer()?.on('themechange', () => setThemeTick((t) => t + 1));
  }, [showAlignment, alignment]);
  // the legend: the viewer's own table (default for dark or light, --phylo-residue-* overrides), one swatch per group
  const legend = useMemo(() => {
    if (!alignment) return [];
    const colours = residueColours(ref.current?.renderer()?.getTheme() ?? {}, alignment.alphabet);
    return residueGroups(alignment.alphabet).map((g) => ({ label: g.label, colour: colours[g.residues[0]] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- themeTick: the theme changed
  }, [alignment, themeTick, showAlignment]);
  const columns = useMemo(
    () => (showAlignment && alignment && layout === 'rectangular' ? [alignment.column] : []),
    [showAlignment, alignment, layout],
  );

  // ---- node labels: the viewer draws them (`nodeLabels`). 'support' reads `support` of the tree, which is the same for a support in
  // the labels (0.95, 100) and for one that load() copied there from an annotation (BEAST posterior). A collapsed clade shows its own
  // support or length on its stem.
  const nodeLabels = labelMode === 'bootstrap' ? 'support' : labelMode === 'branchlength' ? 'length' : 'none';

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
    fitted.current = r.fitViewport();
    applyScales();
  }, [applyScales]);
  // A new tree keeps the view (the viewer's setTree, through `treeMap`), but what "fitted" is has changed with it: read it back
  // (fitViewport does not move the window), so the sliders go on working relative to the new fit.
  useLayoutEffect(() => {
    const r = ref.current?.renderer();
    if (r && fitted.current) fitted.current = r.fitViewport();
  }, [tree, collapsedIds]);
  useEffect(applyScales, [hScale, vScale, applyScales]);
  // a new layout, tree type, label size or column changes what "fitted" is
  useEffect(() => {
    const id = requestAnimationFrame(refit);
    return () => cancelAnimationFrame(id);
  }, [layout, phylogram, columns, height, refit]);

  // for the browser check (tests/browser/scripts/check-explorer.mjs): the viewer, to find where nodes are
  useEffect(() => {
    (window as unknown as { __explorer?: () => unknown }).__explorer = () => ref.current?.renderer() ?? null;
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
    setSwapFirst(null);
    const next = new TreeModel(r.tree);
    const followedClades = ops.followClades(
      tree,
      next,
      r.map,
      clades.map((c) => Number(c.nodeId.slice(1))),
    );
    const keptClades = clades.flatMap((c, i) => {
      const m = followedClades[i].node;
      return m >= 0 ? [{ ...c, nodeId: 'n' + m }] : [];
    });
    const keptCollapsed = ops
      .followClades(tree, next, r.map, collapsed)
      .map((f) => f.node)
      .filter((m) => m > 0 && next.childCount[m] > 0);
    if (keptClades.length < clades.length) flash(`${clades.length - keptClades.length} colour(s) removed: their tips are no longer one clade`);
    setHistory((h) => [
      ...h.slice(0, -1),
      { ...h[h.length - 1], clades, collapsed },
      { tree: next, clades: keptClades, collapsed: keptCollapsed, map: r.map },
    ]);
    setMove({ from: tree, to: next, map: r.map });
    setClades(keptClades);
    setCollapsed(keptCollapsed);
    setInfo(null);
  };
  const undo = () => {
    const prev = history[history.length - 2];
    const undone = history[history.length - 1];
    // the way back is the inverse of the edit's map (a tip stays the tip it was; an edit that added nodes has none to send back)
    if (undone.map) setMove({ from: tree, to: prev.tree, map: ops.invertMap(undone.map, undone.tree.nodeCount) });
    setHistory((h) => h.slice(0, -1));
    setSwapFirst(null);
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
    const v = e.node;
    const isCollapsed = e.collapsed;
    const name = e.isTip ? tree.labels[v] : `${tree.tipCountOf(v)} taxa`;
    switch (mode) {
      case 'reroot':
        if (v === 0) return flash('Already the root');
        return apply((t) => ops.reroot(t, v), 'Reroot');
      case 'flip':
        if (e.isTip) return flash('Flip needs an internal node');
        return apply((t) => ops.rotate(t, v), 'Flip');
      case 'swap': {
        if (v === 0) return flash('The root has no sibling');
        if (swapFirst === null) return setSwapFirst(v);
        const a = swapFirst;
        setSwapFirst(null);
        if (a === v) return;
        if (tree.parent[a] !== tree.parent[v]) return flash('Swap needs two sibling branches');
        return apply((t) => ops.swap(t, a, v), 'Swap');
      }
      case 'color': {
        const nodeId = 'n' + v;
        const rest = clades.filter((c) => c.nodeId !== nodeId);
        if (activeColor === ERASE) return setClades(rest);
        return setClades([...rest, { nodeId, colour: cssVar(`--ex-palette-${activeColor.toLowerCase()}`), label: activeColor }]);
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
    const v = e.node;
    const isCollapsed = e.collapsed;
    const name = e.isTip ? formatLabel(tree.labels[v]) : `${tree.tipCountOf(v)} taxa`;
    const tag = (cls: string, icon: React.ReactNode, text: React.ReactNode) => (
      <span className={`ex-tip ex-tip--${cls}`}>
        {icon}
        {text}
        <span className="ex-tip-name">{name}</span>
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
          <span className="ex-tip-step">{swapFirst === null ? '1/2' : '2/2'}</span>,
          swapFirst === null ? 'Select first branch' : 'Swap with…',
        );
      case 'color':
        return tag(
          'color',
          <span
            className="ex-tip-dot"
            style={{ background: activeColor === ERASE ? 'var(--ex-muted)' : `var(--ex-palette-${activeColor.toLowerCase()})` }}
          />,
          activeColor === ERASE ? 'Erase color' : `Paint ${activeColor}`,
        );
      default:
        return (
          <span className="ex-tip ex-tip--collapse">
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

  // ---- export: PNG is the viewer's toBlob; Newick and NEXUS through @gbif-phylo/io
  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const exportPng = () => {
    // the tree is drawn on a transparent background (the pane's dotted grid shows through): the PNG gets the pane's colour
    ref.current
      ?.renderer()
      ?.toBlob({ background: cssVar('--ex-surface-10') })
      .then((b) => download(b, 'phylotree.png'))
      .catch((err) => flash(`PNG export: ${(err as Error).message}`));
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
  const activeHex = activeColor === ERASE ? 'var(--ex-muted)' : `var(--ex-palette-${activeColor.toLowerCase()})`;
  const feedback = hoveredSwatch ?? (activeColor === ERASE ? 'Erase' : activeColor);

  return (
    <div className={`ex-outer ex-mode-${mode}`} ref={outer} onKeyDown={onKeyDown}>
      {/* ── Row 1: view settings ── */}
      <div className="ex-row" role="toolbar" aria-label="View">
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
            <div className="ex-divider" />
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
        <div className="ex-divider" />
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
        <div className="ex-divider" />
        <div className="ex-group">
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
        <div className="ex-divider" />
        <div className="ex-group">
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
            <div className="ex-divider" />
            <button
              type="button"
              className={`ex-btn ex-toggle${truncate ? ' active' : ''}`}
              title={truncate ? 'Names truncated — click to show full names' : 'Full names shown — click to truncate'}
              onClick={() => setTruncate((t) => !t)}
            >
              <I.IconTruncate />
              {truncate ? 'Truncate' : 'Full names'}
            </button>
          </>
        )}
        <div className="ex-spacer" />
        <button
          type="button"
          className={`ex-btn${searchOpen ? ' ex-search-active' : ''}`}
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
        <div className="ex-divider" />
        <div className="ex-export" ref={exportRef}>
          <button
            type="button"
            className={`ex-btn${downloadOpen ? ' open' : ''}`}
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
      <div className="ex-row" role="toolbar" aria-label="Edit">
        {history.length > 1 && (
          <>
            <button type="button" className="ex-btn ex-fade" title="Undo last action" onClick={undo}>
              <I.IconUndo />
              Undo
            </button>
            <div className="ex-divider" />
          </>
        )}
        <button type="button" className="ex-btn" title="Fit tree" onClick={refit}>
          <I.IconFit />
          Fit
        </button>
        <div className="ex-divider" />
        <button
          type="button"
          className={`ex-btn ex-tool${mode === 'reroot' ? ' active' : ''}`}
          aria-pressed={mode === 'reroot'}
          title={mode === 'reroot' ? 'Exit reroot mode (Esc)' : 'Reroot — click any node'}
          onClick={() => toggleMode('reroot')}
        >
          <I.IconReroot />
          {mode === 'reroot' ? (
            <>
              Click… <span className="ex-dot" />
            </>
          ) : (
            'Reroot'
          )}
        </button>
        <button
          type="button"
          className="ex-btn ex-tool"
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
          className={`ex-btn ex-tool${mode === 'flip' ? ' active' : ''}`}
          aria-pressed={mode === 'flip'}
          title={mode === 'flip' ? 'Exit flip mode (Esc)' : 'Flip — reverse children order at a node'}
          onClick={() => toggleMode('flip')}
        >
          <I.IconFlip />
          Flip
          {mode === 'flip' && <span className="ex-dot" />}
        </button>
        <button
          type="button"
          className={`ex-btn ex-tool${mode === 'swap' ? ' active ex-swap-active' : ''}`}
          aria-pressed={mode === 'swap'}
          title={mode === 'swap' ? 'Exit swap mode (Esc)' : 'Swap — exchange two sibling branches'}
          onClick={() => toggleMode('swap')}
        >
          <I.IconSwap />
          Swap
          {mode === 'swap' && (
            <span className="ex-steps">
              <span className={swapFirst === null ? 'on' : 'done'}>1</span>→<span className={swapFirst !== null ? 'on' : ''}>2</span>
            </span>
          )}
        </button>
        <button
          type="button"
          className={`ex-btn ex-color${mode === 'color' ? ' active' : ''}`}
          aria-pressed={mode === 'color'}
          title={mode === 'color' ? 'Exit color mode (Esc)' : 'Color clades, branches & leaves'}
          style={mode === 'color' ? ({ '--ex-active': activeHex } as React.CSSProperties) : undefined}
          onClick={() => toggleMode('color')}
        >
          <I.IconPalette />
          Color
          {mode === 'color' && <span className="ex-color-dot" style={{ background: activeHex }} />}
          {mode !== 'color' && clades.length > 0 && <span className="ex-count">{clades.length}</span>}
        </button>
        <div className="ex-divider" />
        <div className="ex-group">
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
            <div className="ex-divider" />
            <button
              type="button"
              className="ex-btn ex-expand"
              title={`Expand all collapsed clades (${collapsed.length})`}
              onClick={() => setCollapsed([])}
            >
              <I.IconExpandAll />
              Expand all
              <span className="ex-count ex-count--violet">{collapsed.length}</span>
            </button>
          </>
        )}
        <div className="ex-spacer" />
        {alignment && layout === 'rectangular' && (
          <button
            type="button"
            className={`ex-btn ex-toggle${showAlignment ? ' active' : ''}`}
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
            className={`ex-btn ex-toggle${alignLabels ? ' active' : ''}`}
            aria-pressed={alignLabels}
            title={alignLabels ? 'Labels follow their tips' : 'Align leaf labels in one column, with leader lines'}
            onClick={() => setAlignLabels((a) => !a)}
          >
            <I.IconAlignLabels />
            Align
          </button>
        )}
        <button
          type="button"
          className={`ex-btn ex-toggle${stripes ? ' active' : ''}`}
          aria-pressed={stripes}
          title={
            stripes
              ? 'Collapsed clades are filled solid: click to turn the stripes off'
              : 'Fill collapsed clades with stripes along their hidden branches'
          }
          onClick={() => setStripes((x) => !x)}
        >
          <I.IconStripes />
          Stripes
        </button>
        {labelCycle.length > 1 && (
          <button
            type="button"
            className={`ex-btn ex-labels ex-labels--${labelMode}`}
            title={`Node labels: ${labelMode === 'none' ? 'hidden' : labelMode === 'bootstrap' ? 'support values' : 'branch lengths'} — click to cycle`}
            onClick={() => setLabelMode(nextLabel)}
          >
            {labelMode === 'bootstrap' ? <I.IconBootstrap /> : labelMode === 'branchlength' ? <I.IconBranchLen /> : <I.IconLabelsOff />}
            {labelMode === 'bootstrap' ? 'Bootstrap' : labelMode === 'branchlength' ? 'Length' : 'No labels'}
          </button>
        )}
      </div>

      {/* ── Body: the tree ── */}
      <div className="ex-pane" style={{ height }}>
        <TreeView
          ref={ref}
          tree={tree}
          treeMap={treeMap}
          layout={layout}
          branchLengths={phylogram}
          clades={clades}
          highlighted={matches}
          collapsed={collapsedIds}
          columns={columns}
          controls={NO_CONTROLS}
          theme={theme}
          focus={current ? { tipId: current, seq: focusSeq } : null}
          options={{
            formatLabel,
            labelDensity: 'dense',
            highlightStyle: 'dim',
            summaryStyle: stripes ? 'striped' : 'solid',
            alignLabels,
            nodeLabels,
            themeObserver: 'document',
          }}
          tooltip={tooltip}
          tooltipBare
          onNodeClick={onClick}
          onTipClick={onClick}
        />

        {searchOpen && (
          <div className="ex-search">
            <span className="ex-search-icon">
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
              <span className={`ex-search-count${matches.length ? '' : ' none'}`}>
                {matches.length ? `${matches.indexOf(current!) + 1} / ${matches.length}` : 'No match'}
              </span>
            )}
            {matches.length > 1 && (
              <span className="ex-search-nav">
                <button type="button" title="Previous match (↑)" onClick={() => setMatchIdx((i) => i - 1)}>
                  <I.IconUp />
                </button>
                <button type="button" title="Next match (↓ or Enter)" onClick={() => setMatchIdx((i) => i + 1)}>
                  <I.IconDown />
                </button>
              </span>
            )}
            <button type="button" className="ex-search-close" title="Close search (Esc)" onClick={closeSearch}>
              <I.IconClose />
            </button>
          </div>
        )}

        {inspector && (
          <div className="ex-info" role="dialog" aria-label="Node information">
            <div className="ex-info-head">
              <span className="ex-info-name">{inspector.name.replace(/_/g, ' ')}</span>
              <button type="button" title="Close" onClick={() => setInfo(null)}>
                <I.IconClose />
              </button>
            </div>
            <dl className="ex-info-rows">
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
                  <dd className="ex-info-boot">{inspector.support}</dd>
                </>
              )}
            </dl>
            <button
              type="button"
              className="ex-info-copy"
              title="Copy raw taxon name"
              onClick={() => void navigator.clipboard?.writeText(inspector.raw)}
            >
              <I.IconCopy />
              Copy name
            </button>
          </div>
        )}

        {toast && (
          <div className="ex-toast" role="status">
            {toast}
          </div>
        )}
        <div className={`ex-hint ex-hint--${layout}`}>Scroll to zoom · Drag to pan</div>
        <div className="ex-resize" title="Drag to resize" onPointerDown={onResizeDown}>
          <div className="ex-grip" />
        </div>
      </div>

      {columns.length > 0 && alignment && (
        <div className="ex-legend">
          <span className={`ex-legend-type${alignment.alphabet === 'protein' ? ' aa' : ''}`}>{alignment.alphabet === 'protein' ? 'AA' : 'NT'}</span>
          <span className="ex-legend-meta">
            {alignment.sites.toLocaleString('en')} sites · {alignment.matched} of {published.tipCount} tips matched
          </span>
          <span className="ex-legend-divider" />
          {legend.map((l) => (
            <span key={l.label} className="ex-legend-item">
              <span className="ex-legend-dot" style={{ background: l.colour }} />
              {l.label}
            </span>
          ))}
          <span className="ex-legend-item">
            <span className="ex-legend-dash" />
            Gap
          </span>
        </div>
      )}

      {downloadOpen && (
        <div className="ex-menu" role="menu" ref={menuRef}>
          {(
            [
              ['PNG', 'Raster', <I.IconFilePng key="i" />, exportPng],
              null,
              ['Newick', 'Tree', <I.IconFileNewick key="i" />, () => exportText(toNewick(tree), 'phylotree.nwk')],
              ['NEXUS', 'Tree', <I.IconFileNexus key="i" />, () => exportText(toNexus(tree), 'phylotree.nex')],
            ] as const
          ).map((item, k) =>
            item === null ? (
              <div key={k} className="ex-menu-divider" />
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
                <span className="ex-menu-icon">{item[2]}</span>
                <span className="ex-menu-label">{item[0]}</span>
                <span className="ex-menu-desc">{item[1]}</span>
              </button>
            ),
          )}
        </div>
      )}

      {/* ── Colour palette (floating, as Reactree's) ── */}
      {mode === 'color' && (
        <div className="ex-palette" role="dialog" aria-label="Paint clades">
          <div className="ex-palette-head">
            <I.IconPalette />
            <span>Paint clades, branches &amp; leaves</span>
            <span className="ex-palette-tip">Esc to exit</span>
          </div>
          <div className="ex-palette-grid">
            {PALETTE.map((name) => (
              <button
                key={name}
                type="button"
                title={name}
                aria-label={name}
                aria-pressed={activeColor === name}
                className={`ex-swatch${activeColor === name ? ' active' : ''}`}
                style={{ ['--sw' as string]: `var(--ex-palette-${name.toLowerCase()})` }}
                onClick={() => setActiveColor(name)}
                onMouseEnter={() => setHoveredSwatch(name)}
                onMouseLeave={() => setHoveredSwatch(null)}
              />
            ))}
          </div>
          <div className="ex-palette-divider" />
          <div className="ex-palette-foot">
            <button
              type="button"
              className={`ex-erase${activeColor === ERASE ? ' active' : ''}`}
              onClick={() => setActiveColor(ERASE)}
              onMouseEnter={() => setHoveredSwatch('Erase')}
              onMouseLeave={() => setHoveredSwatch(null)}
            >
              <I.IconEraser /> Erase
            </button>
            {clades.length > 0 && (
              <button type="button" className="ex-clear" onClick={() => setClades([])}>
                Clear all ({clades.length})
              </button>
            )}
            <span className="ex-palette-feedback">
              <span
                className="ex-tip-dot"
                style={{ background: feedback === 'Erase' ? 'var(--ex-muted)' : `var(--ex-palette-${feedback.toLowerCase()})` }}
              />
              {feedback}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
