// The debug panel (?debug=1), under the tree pane: what the level of detail did on the last frame and the view it did it in, read from
// the viewer's public API (the `frame` event, getStats, getViewport, options, layout.rows), a few times a second. "Copy view" writes the
// view down (src/debug.ts) as JSON and as a URL with ?view=, which restores it: the page reads the tree, layout and options, and the
// panel sets the viewport once the tree is laid out.

import React, { useEffect, useRef, useState } from 'react';
import { useTreeEvent } from '@canopy/react';
import type { TreeViewer } from '@canopy/viewer';
import { BUILD, VIEW_OPTIONS, viewJson, viewUrl, type DebugInfo, type SavedView, type TreeName, type ViewOptions } from './debug.ts';

/** How often the panel reads the viewer again while frames are drawn. */
const EVERY_MS = 250;

type Sample = ReturnType<typeof sample>;

/** What the panel shows, read from the viewer now. The tip pitch: rectangular, ky (px per row); radial, the arc between neighbouring
 *  rows on the outermost tip circle (radius 1 in viewport units, so kx px): kx * 2pi * (1 - radialOpening) / layout.rows. */
function sample(v: TreeViewer) {
  const s = v.getStats();
  const o = v.options;
  const t = v.getTree();
  const rows = Math.max(1, v.layout.rows);
  const rect = o.layout === 'rectangular';
  return {
    stats: s,
    options: o,
    viewport: v.getViewport(),
    size: { ...v.size },
    dpr: window.devicePixelRatio,
    labelSize: v.getTheme().labelSize,
    tips: t.tipCount,
    nodes: t.nodeCount,
    rows,
    pitch: rect ? s.ky : (s.kx * 2 * Math.PI * (1 - o.radialOpening)) / rows,
  };
}

/** A number to `d` decimals, or to 4 significant digits below 1 (a pitch of 0.003 px); `full` for the viewport, which is restored exactly. */
const n = (x: number, d = 2) => (!Number.isFinite(x) ? String(x) : Math.abs(x) < 1 && x !== 0 ? String(+x.toPrecision(4)) : String(+x.toFixed(d)));
const full = (x: number) => String(+x.toPrecision(12));
const int = (x: number | string) => (typeof x === 'string' ? x : Number.isFinite(x) ? Math.round(x).toLocaleString('en') : String(x));
const treeText = (t: TreeName) => ('file' in t ? `file "${t.file}"` : `${t.label} (${t.id})`);

/** The view in force, written down to be restored (debug.ts SavedView). */
function saveView(p: Sample, tree: TreeName, collapsed: number[], columns: number, asLoaded: boolean): SavedView {
  const options: ViewOptions = {};
  for (const k of VIEW_OPTIONS) (options as Record<string, unknown>)[k] = p.options[k];
  return {
    commit: BUILD.commit,
    tree,
    layout: p.options.layout,
    branchLengths: p.options.branchLengths,
    canvas: { width: p.size.width, height: p.size.height, dpr: p.dpr },
    viewport: p.viewport,
    labelSize: p.labelSize,
    alignLabels: p.options.alignLabels,
    options,
    treeWidth: p.options.treeWidth,
    columns,
    collapsed,
    asLoaded,
  };
}

/** What the panel says about the view restored, and about the view in force. */
function notes(debug: DebugInfo, p: Sample, asLoaded: boolean): string[] {
  const out: string[] = [];
  const r = debug.restore;
  if (debug.error) out.push(debug.error);
  if (!asLoaded) out.push('The tree shown is edited or a part of it (Show only): a copied view restores on the tree as loaded.');
  if (!r) return out;
  if (!debug.matches) out.push(`The view restored is of ${treeText(r.tree)}: load it with the tree picker to get its viewport and collapsed clades.`);
  else {
    const c = r.canvas;
    if (c.width !== p.size.width || c.height !== p.size.height || c.dpr !== p.dpr)
      out.push(
        `The canvas is ${p.size.width}×${p.size.height} at dpr ${p.dpr}; the view was copied at ${c.width}×${c.height} at dpr ${c.dpr}. Viewport kept as given.`,
      );
  }
  if (!r.asLoaded)
    out.push('The view was copied from an edited tree or a part of it; it is restored on the tree as loaded, without its collapsed clades.');
  if (r.commit !== BUILD.commit) out.push(`The view was copied on build ${r.commit}; this is ${BUILD.commit}.`);
  return out;
}

/** Put text on the clipboard; false when there is none (an insecure page) or it is refused. */
const copy = (text: string) =>
  navigator.clipboard?.writeText(text).then(
    () => true,
    () => false,
  ) ?? Promise.resolve(false);

/** Set the viewport of the view restored once the tree is laid out (after the first frame), once per explorer. */
function useRestoreViewport(viewer: TreeViewer | null, debug: DebugInfo | undefined) {
  const done = useRef(false);
  useEffect(() => {
    const vp = debug?.matches ? debug.restore?.viewport : undefined;
    if (!viewer || !vp || done.current) return;
    let raf = 0;
    const apply = () => {
      raf = requestAnimationFrame(() => {
        done.current = true;
        viewer.setViewport(vp);
      });
    };
    let off = () => {};
    if (viewer.stats.frames > 0) apply();
    else off = viewer.once('ready', apply);
    return () => {
      off();
      cancelAnimationFrame(raf);
    };
  }, [viewer, debug]);
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="ex-debug-rows">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function rowsOf(p: Sample, tree: TreeName, collapsed: number): [string, React.ReactNode][] {
  const s = p.stats;
  const o = p.options;
  const vp = p.viewport;
  const rect = o.layout === 'rectangular';
  const budgetOpt =
    !rect && o.radialMaxNodes !== Infinity
      ? `drawBudget ${int(o.drawBudget)}, radialMaxNodes ${int(o.radialMaxNodes)}`
      : `drawBudget ${int(o.drawBudget)}`;
  return [
    ['build', `${BUILD.commit}${BUILD.branch ? ` (${BUILD.branch})` : ''}`],
    ['tree', `${treeText(tree)} · ${int(p.tips)} tips · ${int(p.nodes)} nodes · ${int(p.rows)} rows · ${collapsed} collapsed`],
    ['layout', `${o.layout} · ${o.branchLengths ? 'phylogram' : 'cladogram'} · labelSize ${n(p.labelSize)} · labelDensity ${o.labelDensity}`],
    ['canvas', `${p.size.width}×${p.size.height} CSS px · dpr ${p.dpr} · scale ${n(s.scale)}`],
    ['viewport', `x0 ${full(vp.x0)} x1 ${full(vp.x1)} y0 ${full(vp.y0)} y1 ${full(vp.y1)}`],
    [
      'scale',
      `kx ${n(s.kx, 3)} ky ${n(s.ky, 3)} · pitch ${n(p.pitch, 3)} px ${rect ? '(ky, per row)' : '(kx·2π·(1−opening)/rows, arc per row on the outer ring)'}`,
    ],
    [
      'frame',
      `#${s.frames} · ${n(s.frameMs)} ms (cut ${n(s.cutMs)}) · visited ${int(s.visited)} · list ${int(s.listLength)}${s.reduced ? ' · reduced (moving)' : ''}`,
    ],
    [
      'minPx',
      `${n(s.minPxUsed)} used / minCladePx ${o.minCladePx === 'auto' ? `auto (${n(s.minPxBase)})` : n(o.minCladePx)}${Number.isFinite(s.minPxLimit) ? ` · limit ${n(s.minPxLimit)} (${o.layout === 'radial' ? '4° wedge' : '20 px block'})${s.minPxUsed > s.minPxLimit ? ', passed: the budget wins' : ''}` : ''}`,
    ],
    ['budget', `${int(s.budget)} / ${budgetOpt} · ${s.budgetHit ? 'hit' : 'not hit'} · retries ${s.budgetRetries} · forced ${int(s.forced)}`],
    ['lod', `lod ${o.lod} · interactionLOD ${String(o.interactionLOD)} · showSummaries ${o.showSummaries}`],
  ];
}

/** The panel; nothing without `debug`. `collapsed` and `asLoaded` are the explorer's (the viewer has no getter for its collapsed set). */
export function DebugPanel({
  viewer,
  debug,
  collapsed,
  columns,
  asLoaded,
}: {
  viewer: TreeViewer | null;
  debug: DebugInfo | undefined;
  collapsed: number[];
  columns: number;
  asLoaded: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState<Sample | null>(null);
  const [copied, setCopied] = useState<{ json: string; url: string; note: string } | null>(null);
  const dirty = useRef(true);
  useRestoreViewport(viewer, debug);
  useTreeEvent(viewer, 'frame', () => {
    dirty.current = true;
  });
  useEffect(() => {
    if (!viewer || !debug || !open) return;
    const read = () => {
      if (!dirty.current || viewer.stats.frames === 0) return;
      dirty.current = false;
      setNow(sample(viewer));
    };
    dirty.current = true;
    read();
    const t = setInterval(read, EVERY_MS);
    return () => clearInterval(t);
  }, [viewer, debug, open]);
  if (!debug) return null;

  const copyView = (what: 'json' | 'url') => {
    if (!viewer) return;
    const v = saveView(sample(viewer), debug.tree, collapsed, columns, asLoaded);
    const json = viewJson(v);
    const url = viewUrl(v);
    void copy(what === 'json' ? json : url).then((ok) =>
      setCopied({ json, url, note: ok ? `Copied the ${what === 'json' ? 'JSON' : 'URL'}` : 'No clipboard here: select it below' }),
    );
  };

  return (
    <section className="ex-debug" aria-label="Debug">
      <div className="ex-debug-head">
        <button type="button" className="ex-debug-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'} Debug
        </button>
        <span className="ex-debug-build">build {BUILD.commit}</span>
        <button type="button" className="ex-debug-copy" onClick={() => copyView('json')}>
          Copy view
        </button>
        <button type="button" className="ex-debug-copy" onClick={() => copyView('url')}>
          Copy URL
        </button>
        {copied && <span className="ex-debug-status">{copied.note}</span>}
      </div>
      {open && now && <Rows rows={rowsOf(now, debug.tree, collapsed.length)} />}
      {open &&
        now &&
        notes(debug, now, asLoaded).map((t) => (
          <p key={t} className="ex-debug-note">
            {t}
          </p>
        ))}
      {open && copied && (
        <div className="ex-debug-out">
          <textarea aria-label="View JSON" readOnly rows={3} value={copied.json} onFocus={(e) => e.target.select()} />
          <input aria-label="View URL" readOnly value={copied.url} onFocus={(e) => e.target.select()} />
        </div>
      )}
    </section>
  );
}
