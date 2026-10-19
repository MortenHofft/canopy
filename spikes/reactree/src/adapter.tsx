// Reactree (npm `reactreejs`) adapter.
//
// The library has three props (newick, fasta, defaultHeight), no callbacks, no ref and no imperative API. Everything
// below that goes beyond rendering is therefore done through the DOM the library produces, and is reported as
// `partial` with the mechanism named in the capability `how`:
//   * clicks and hovers: capture-phase listeners on our wrapper; the clicked element's d3 datum (`__data__`, set by d3
//     on every node element) gives the library's node, whose leaf names we map onto the shared TreeModel
//     (source: 'adapter-derived', there is no library payload);
//   * layout, phylogram/cladogram, labels, alignment panel, search: clicks on the library's own toolbar buttons;
//   * clade colour: the library's colour mode driven through its own toolbar button, palette swatch and node clicks
//     (synthetic click events on the d3-bound hit circles); only its 12 palette colours exist;
//   * focus: synthetic wheel and mouse events fed to the library's own d3-zoom behaviour;
//   * highlight rings and tip links: our own SVG elements added to the library's DOM after every rebuild.
// Nothing here patches or forks the library. No tree recursion in our own code (shared TreeModel, explicit stacks).

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Reactree } from 'reactreejs';
import 'reactreejs/style.css';
import type { AdapterFeature, CandidateAdapter, CapabilityReport, ColumnSpec, Point, Rect, ViewHandle, ViewProps } from '../../shared/types.ts';
import type { TreeModel } from '../../shared/tree.ts';

const SVGNS = 'http://www.w3.org/2000/svg';
const VERSION = '1.0.3';
type D = any; // a d3 hierarchy node as the library builds it (d.data = parsed Newick node)

// ---------------------------------------------------------------- GBIF token mapping onto the library's CSS tokens
// The library defines its tokens on :root and [data-theme=dark] with specificity (0,1,0); these rules sit later and are
// more specific. Portaled popovers (palette, export menu, clade editor) live on <body>, so the mapping has to be global.
// The tree itself is drawn with colours hard-coded in JS as presentation attributes; CSS overrides presentation
// attributes, so attribute selectors on the exact hex values the library uses re-theme branches, nodes and labels.
const TOKEN_CSS = `
:root:root{
  --clr-primary-a0:var(--color-primary);--clr-primary-a10:var(--color-primary-hover);--clr-primary-a20:var(--green-300);--clr-primary-a30:var(--green-400);--clr-primary-a40:var(--green-500);--clr-primary-a50:var(--green-600);
  --clr-surface-a0:var(--bg1);--clr-surface-a10:var(--bg-surface);--clr-surface-a20:var(--bg2);--clr-surface-a30:var(--slate-200);--clr-surface-a40:var(--slate-300);--clr-surface-a50:var(--slate-400);
  --clr-surface-tonal-a0:var(--color-primary-light);--clr-surface-tonal-a10:var(--green-900);--clr-surface-tonal-a20:var(--green-800);
  --clr-text-primary:var(--fg1);--clr-text-secondary:var(--fg2);--clr-text-muted:var(--text-subtle);
  --clr-border:var(--slate-200);--clr-border-subtle:var(--bg2);--clr-input-bg:var(--bg1);
  --clr-dark-a0:var(--fg1);--clr-light-a0:var(--bg1);
  --clr-error:var(--color-danger);--clr-success:var(--color-success);--clr-warning:var(--color-warning);
  --font-family:var(--font-body);
  --rt-branch:var(--fg2);--rt-fg:var(--fg1);--rt-hl:var(--color-primary);--rt-font:var(--font-body);
}
:root:root[data-theme=dark]{
  --clr-primary-a0:var(--color-primary);--clr-primary-a10:var(--color-primary-hover);--clr-primary-a20:var(--green-300);
  --clr-surface-a0:var(--bg-dark);--clr-surface-a10:var(--grey-200);--clr-surface-a20:var(--grey-300);--clr-surface-a30:var(--grey-400);--clr-surface-a40:var(--grey-500);--clr-surface-a50:var(--grey-700);
  --clr-surface-tonal-a0:var(--grey-100);--clr-surface-tonal-a10:var(--grey-200);--clr-surface-tonal-a20:var(--grey-300);
  --clr-text-primary:var(--bg1);--clr-text-secondary:var(--slate-200);--clr-text-muted:var(--slate-400);
  --clr-border:var(--grey-400);--clr-border-subtle:var(--grey-300);--clr-input-bg:var(--grey-200);
  --clr-dark-a0:var(--bg1);--clr-light-a0:var(--bg-dark);
  --rt-branch:var(--slate-200);--rt-fg:var(--bg1);
}
.rt-host{position:relative;width:100%;height:100%;overflow:auto;background:var(--clr-surface-a0);color:var(--clr-text-primary);font-family:var(--font-family)}
.rt-host .Reactree_outer{border-radius:var(--radius-md);box-shadow:none}
.rt-host svg text{font-family:var(--rt-font)}
/* library colours are hex presentation attributes: attribute selectors on the two base colours (light slate-600, dark slate-300) */
.rt-host svg path[stroke="#475569"],.rt-host svg path[stroke="#cbd5e1"]{stroke:var(--rt-branch)}
.rt-host svg circle[stroke="#475569"],.rt-host svg circle[stroke="#cbd5e1"]{stroke:var(--rt-branch)}
.rt-host svg circle[fill="#475569"],.rt-host svg circle[fill="#cbd5e1"]{fill:var(--rt-branch)}
.rt-host svg circle[fill="#47556940"],.rt-host svg circle[fill="#cbd5e140"],.rt-host svg circle[fill="#47556920"],.rt-host svg circle[fill="#cbd5e120"]{fill:var(--rt-branch);fill-opacity:.2}
.rt-host svg text.leaf-label[style*="rgb(71, 85, 105)"],.rt-host svg text.leaf-label[style*="rgb(203, 213, 225)"]{fill:var(--rt-fg)!important}
.rt-host svg .rt-hl{fill:var(--rt-hl);fill-opacity:.22;stroke:var(--rt-hl);stroke-width:2.5;pointer-events:none}
.rt-host svg a[data-tip-id] text{text-decoration:underline;cursor:pointer}
.rt-host svg a[data-tip-id]:focus-visible text{outline:2px solid var(--color-accent-blue);outline-offset:2px}
.rt-host svg a[data-tip-id]:focus{outline:none}
`;

// ---------------------------------------------------------------- DOM helpers
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const container = (host: HTMLElement) => host.querySelector('.Reactree_container') as HTMLDivElement | null;
const svgOf = (host: HTMLElement) => host.querySelector('.Reactree_container > svg') as SVGSVGElement | null;
const contentG = (host: HTMLElement) => svgOf(host)?.querySelector(':scope > g') as SVGGElement | null;
const hits = (host: HTMLElement) => host.querySelectorAll<SVGCircleElement>('circle.r-hit');

/** Leaf names of a parsed-Newick node (library `d.data`), in file order, iterative. */
function leafNames(root: any): string[] {
  const out: string[] = [];
  const st: any[] = [root];
  while (st.length) {
    const n = st.pop();
    const ch = n.children;
    if (!ch || ch.length === 0) {
      out.push(String(n.name ?? '').trim());
    } else for (let i = ch.length - 1; i >= 0; i--) st.push(ch[i]);
  }
  return out;
}
const isLeafDatum = (d: D) => !d.data.children || d.data.children.length === 0;

interface Mapped {
  nodeId: string;
  isTip: boolean;
  tipIds: string[];
  exact: boolean; // the library clade is exactly a clade of the shared tree (false after the library rerooted or rearranged)
  libLeaves: number;
}
function mapDatum(tree: TreeModel, d: D): Mapped | null {
  const names = leafNames(d.data);
  if (isLeafDatum(d)) {
    const id = tree.tipNodeId(names[0]);
    return id ? { nodeId: id, isTip: true, tipIds: [names[0]], exact: true, libLeaves: 1 } : null;
  }
  const known = names.filter((n) => tree.tipIndex(n) >= 0);
  if (known.length === 0) return null;
  const m = tree.mrcaOf(known);
  const exact = known.length === names.length && tree.tipCountOf(m) === names.length;
  return { nodeId: tree.nodeId(m), isTip: false, tipIds: exact ? tree.descendantTips(m) : known, exact, libLeaves: names.length };
}

/** Reads the current d3-zoom scale k from the content group transform. */
function currentK(host: HTMLElement): number {
  const t = contentG(host)?.getAttribute('transform') ?? '';
  const m = /scale\(([-0-9.eE]+)/.exec(t);
  return m ? Number(m[1]) : 1;
}

function fireMouse(target: EventTarget, type: string, x: number, y: number) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 }));
}

/** Feeds the library's own d3-zoom behaviour with a wheel event (zoom about the pointer). */
function wheelZoom(svg: SVGSVGElement, x: number, y: number, factor: number) {
  const deltaY = -Math.log2(factor) / 0.002; // d3-zoom default wheelDelta: -deltaY * 0.002 (deltaMode 0)
  svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, deltaY, deltaMode: 0 }));
}
/** Feeds d3-zoom a drag (mousedown on the svg, mousemove/mouseup on window, as d3-zoom listens). */
function dragPan(svg: SVGSVGElement, x: number, y: number, dx: number, dy: number) {
  fireMouse(svg, 'mousedown', x, y);
  fireMouse(window, 'mousemove', x + dx / 2, y + dy / 2);
  fireMouse(window, 'mousemove', x + dx, y + dy);
  fireMouse(window, 'mouseup', x + dx, y + dy);
}

// ---------------------------------------------------------------- the View
let darkOwners = 0;
const LIB_TOOLBAR_H = 88; // two toolbar rows plus border; measured in the browser (see notes)

function alignmentFasta(cols: ColumnSpec[]): { fasta: string; used: string | null; skipped: string[] } {
  const skipped: string[] = [];
  let used: ColumnSpec | null = null;
  for (const c of cols) {
    if (c.kind === 'alignment' && !used) used = c;
    else skipped.push(`${c.id} (${c.kind})`);
  }
  if (!used) return { fasta: '', used: null, skipped };
  const parts: string[] = [];
  for (const k in used.values) parts.push('>' + k + '\n' + String(used.values[k]));
  return { fasta: parts.join('\n'), used: used.id, skipped };
}

function ReactreeView(props: ViewProps) {
  const { tree, size, theme, emit } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const applied = useRef({ layout: 'rectangular', bl: true, clades: new Map<string, string>(), alignment: false, search: false, alignLabels: false, truncate: true, labels: 'bootstrap' });
  const driving = useRef(false); // true while our own synthetic events run: they must not be reported as user events
  const gen = useRef(0); // bumped whenever the library rebuilds the SVG
  const cache = useRef<{ gen: number; nodes: { el: SVGCircleElement; d: D }[]; leaf: Map<string, SVGCircleElement> } | null>(null);
  const stats = useRef({ rebuilds: 0, unmatched: 0, inexactClicks: 0, colourSkipped: 0, lastDriveMs: 0 });
  const mountT = useRef(performance.now());
  const [fastaState, setFastaState] = useState('');
  const [defaultHeight] = useState(() => Math.max(200, size.height - LIB_TOOLBAR_H));
  const { fasta: wantedFasta, used: alnColId, skipped: skippedCols } = useMemo(() => alignmentFasta(props.columns), [props.columns]);

  // ---------------------------------------------------------------- element index (lazy, per library rebuild)
  const index = () => {
    const host = hostRef.current!;
    if (cache.current && cache.current.gen === gen.current) return cache.current;
    const nodes: { el: SVGCircleElement; d: D }[] = [];
    const leaf = new Map<string, SVGCircleElement>();
    hits(host).forEach((el) => {
      const d = (el as any).__data__ as D;
      if (!d) return;
      nodes.push({ el, d });
      if (isLeafDatum(d)) leaf.set(String(d.data.name ?? '').trim(), el);
    });
    cache.current = { gen: gen.current, nodes, leaf };
    return cache.current;
  };
  const nodeEl = (nodeId: string): SVGCircleElement | null => {
    const i = tree.nodeIndex(nodeId);
    if (tree.childCount[i] === 0) return index().leaf.get(tree.tipLabels[tree.leafStart[i]]) ?? null;
    const want = tree.leafEnd[i] - tree.leafStart[i];
    let expected: Set<string> | null = null;
    for (const { el, d } of index().nodes) {
      if (isLeafDatum(d) || d._leafCount !== want) continue;
      // same size: compare the leaf sets (robust to the library reordering or rerooting)
      expected ??= new Set(tree.descendantTips(i));
      const names = leafNames(d.data);
      if (names.length === want && names.every((n) => expected!.has(n))) return el;
    }
    return null;
  };

  // ---------------------------------------------------------------- patches applied after every library rebuild
  const applyPatches = () => {
    const host = hostRef.current;
    const svg = host && svgOf(host);
    if (!host || !svg) return;
    gen.current++;
    stats.current.rebuilds++;
    // highlight rings
    const hl = latest.current.highlightedTips;
    if (hl.length) {
      const { leaf } = index();
      for (const id of hl) {
        const el = leaf.get(id);
        if (!el || !el.parentNode) continue;
        const ring = document.createElementNS(SVGNS, 'circle');
        ring.setAttribute('class', 'rt-hl');
        ring.setAttribute('r', '13');
        el.parentNode.insertBefore(ring, el.parentNode.firstChild);
      }
    }
    // tip links: wrap each leaf label <text> in an SVG <a>
    const links = latest.current.tipLinks;
    if (links) {
      svg.querySelectorAll<SVGTextElement>('text.leaf-label').forEach((t) => {
        const d = (t as any).__data__ as D;
        const id = String(d?.data?.name ?? '').trim();
        if (!id || !t.parentNode) return;
        const a = document.createElementNS(SVGNS, 'a');
        a.setAttribute('href', links(id));
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        a.setAttribute('data-tip-id', id);
        a.setAttribute('tabindex', '0');
        a.setAttribute('aria-label', id);
        t.parentNode.insertBefore(a, t);
        a.appendChild(t);
      });
    }
  };

  // observe the svg: the library clears and rebuilds its children on every state change
  useEffect(() => {
    const host = hostRef.current!;
    let mo: MutationObserver | null = null;
    let raf = 0;
    const attach = () => {
      const svg = svgOf(host);
      if (!svg) {
        raf = requestAnimationFrame(attach);
        return;
      }
      mo = new MutationObserver(() => applyPatches());
      mo.observe(svg, { childList: true });
      applyPatches();
    };
    attach();
    return () => {
      cancelAnimationFrame(raf);
      mo?.disconnect();
    };
  }, []);

  // patches that depend on props: re-run on change (cheap relative to a library rebuild)
  useEffect(() => {
    const host = hostRef.current;
    const svg = host && svgOf(host);
    if (!host || !svg) return;
    // highlight: remove old rings, add new ones (no library state involved, so no rebuild)
    svg.querySelectorAll('.rt-hl').forEach((n) => n.remove());
    const { leaf } = index();
    for (const id of props.highlightedTips) {
      const el = leaf.get(id);
      if (el && el.parentNode) {
        const ring = document.createElementNS(SVGNS, 'circle');
        ring.setAttribute('class', 'rt-hl');
        ring.setAttribute('r', '13');
        el.parentNode.insertBefore(ring, el.parentNode.firstChild);
      }
    }
  }, [props.highlightedTips]);

  useEffect(() => {
    const host = hostRef.current;
    const svg = host && svgOf(host);
    if (!host || !svg) return;
    // tip links: unwrap old, wrap new
    svg.querySelectorAll('a[data-tip-id]').forEach((a) => {
      const t = a.firstChild;
      if (t && a.parentNode) a.parentNode.insertBefore(t, a);
      a.remove();
    });
    const links = props.tipLinks;
    if (links) {
      svg.querySelectorAll<SVGTextElement>('text.leaf-label').forEach((t) => {
        const id = String(((t as any).__data__ as D)?.data?.name ?? '').trim();
        if (!id || !t.parentNode) return;
        const a = document.createElementNS(SVGNS, 'a');
        a.setAttribute('href', links(id));
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        a.setAttribute('data-tip-id', id);
        a.setAttribute('tabindex', '0');
        a.setAttribute('aria-label', id);
        t.parentNode.insertBefore(a, t);
        a.appendChild(t);
      });
    }
  }, [props.tipLinks]);

  // ---------------------------------------------------------------- driving the library's toolbar through the DOM
  const click = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    flushSync(() => (el as HTMLElement).click());
    return true;
  };
  const button = (sel: string, text?: string): HTMLButtonElement | null => {
    const host = hostRef.current!;
    const all = host.querySelectorAll<HTMLButtonElement>(sel);
    if (text === undefined) return all[0] ?? null;
    for (const b of all) if ((b.textContent ?? '').trim().toLowerCase().startsWith(text.toLowerCase())) return b;
    return null;
  };
  const drive = (fn: () => void) => {
    // run after the React commit that carries the new props, outside React's commit phase (flushSync is not allowed inside effects)
    queueMicrotask(() => {
      if (!hostRef.current) return;
      const t0 = performance.now();
      driving.current = true;
      try {
        fn();
      } finally {
        driving.current = false;
        stats.current.lastDriveMs = performance.now() - t0;
      }
    });
  };

  // layout and phylogram/cladogram: the library's two button groups
  useEffect(() => {
    const a = applied.current;
    const want = props.layout === 'radial' ? 'circular' : 'rectangular';
    if (a.layout !== want || a.bl !== props.branchLengths) {
      drive(() => {
        if (a.layout !== want) {
          if (click(button(`button[title="${want === 'circular' ? 'Circular' : 'Rectangular'}"]`))) a.layout = want;
        }
        if (a.bl !== props.branchLengths) {
          if (click(button(props.branchLengths ? 'button[title^="Phylogram"]' : 'button[title^="Cladogram"]'))) {
            a.bl = props.branchLengths;
            if (!props.branchLengths) a.alignLabels = false;
          }
        }
      });
    }
  }, [props.layout, props.branchLengths]);

  // alignment panel from alignment columns (the library only has a FASTA panel)
  useEffect(() => {
    const a = applied.current;
    if (wantedFasta) {
      if (fastaState !== wantedFasta) setFastaState(wantedFasta);
    } else if (fastaState) {
      // turn the panel off first (its state would otherwise stay on and reopen with the next FASTA), then drop the FASTA
      drive(() => {
        if (a.alignment && click(button('button', 'Alignment'))) a.alignment = false;
        flushSync(() => setFastaState(''));
      });
    }
  }, [wantedFasta]);
  useEffect(() => {
    const a = applied.current;
    if (fastaState && wantedFasta && !a.alignment && props.layout === 'rectangular') {
      drive(() => {
        if (click(button('button', 'Alignment'))) a.alignment = true;
      });
    }
  }, [fastaState, props.layout]);
  useEffect(() => {
    // the library hides the panel in circular layout but keeps its flag; keep our flag in step
    if (props.layout !== 'rectangular') return;
  }, [props.layout]);

  // library options card
  const f = props.features;
  useEffect(() => {
    const a = applied.current;
    const want = !!f.searchPanel;
    if (want !== a.search) {
      drive(() => {
        const open = !!hostRef.current!.querySelector('.Reactree_searchPanel');
        if (open !== want) click(button('button[title^="Search taxa"]') ?? button('button[title="Close search (Esc)"]'));
        a.search = want;
      });
    }
  }, [f.searchPanel]);
  useEffect(() => {
    const a = applied.current;
    const want = !!f.alignLabels;
    if (want !== a.alignLabels) {
      drive(() => {
        if (click(button('button', 'Align'))) a.alignLabels = want;
      });
    }
  }, [f.alignLabels, props.branchLengths]);
  useEffect(() => {
    const a = applied.current;
    const want = String(f.nodeLabels ?? 'bootstrap');
    if (want !== a.labels) {
      drive(() => {
        // a single button cycles none -> bootstrap -> branch length; click until its text shows the wanted mode
        const text = { none: 'No labels', bootstrap: 'Bootstrap', branchlength: 'Length' }[want] ?? '';
        for (let i = 0; i < 3; i++) {
          const b = button('button[title^="Node labels"]');
          if (!b) return;
          if ((b.textContent ?? '').trim() === text) {
            a.labels = want;
            return;
          }
          click(b);
        }
      });
    }
  }, [f.nodeLabels]);
  useEffect(() => {
    const a = applied.current;
    const want = f.truncate !== false;
    if (want !== a.truncate) {
      drive(() => {
        if (click(button('button', want ? 'Full names' : 'Truncate'))) a.truncate = want;
      });
    }
  }, [f.truncate]);
  useEffect(() => {
    // the library calls preventDefault on Ctrl/Cmd+F for the whole window while mounted; this switch stops that for the page
    if (!f.keepBrowserFind) return;
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [f.keepBrowserFind]);

  // ---------------------------------------------------------------- clade colour through the library's colour mode
  useEffect(() => {
    const a = applied.current;
    const want = new Map<string, string>();
    for (const c of props.colouredClades) want.set(c.nodeId, c.colour);
    let same = want.size === a.clades.size;
    if (same) for (const [k, v] of want) if (a.clades.get(k) !== v) same = false;
    if (same) return;
    drive(() => {
      const toggle = () => click(button('button.Reactree_colorBtn'));
      const pop = () => document.body.querySelector(':scope > .Reactree_palettePopover') as HTMLElement | null;
      toggle(); // enter colour mode; the palette popover is portaled to <body>
      const p = pop();
      if (!p) {
        toggle();
        return;
      }
      // removed or recoloured-to-nothing clades: erase swatch (or "Clear all" when nothing is wanted), one rebuild
      const removed: string[] = [];
      for (const k of a.clades.keys()) if (!want.has(k)) removed.push(k);
      if (removed.length) {
        const clearAll = p.querySelector('.Reactree_paletteClearAll');
        if (want.size === 0 && clearAll) click(clearAll);
        else {
          click(p.querySelector('.Reactree_paletteErase')); // active tool = erase
          const els = removed.map((id) => nodeEl(id));
          flushSync(() => {
            for (const el of els) if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          });
        }
      }
      // added or changed clades, grouped by palette swatch: nearest of the library's own swatches (it has no free colour input)
      const todo = new Map<string, string>();
      for (const [k, v] of want) if (a.clades.get(k) !== v) todo.set(k, v);
      if (todo.size) {
        const swatches = Array.from(p.querySelectorAll<HTMLButtonElement>('.Reactree_paletteSwatch')).map((b) => ({ b, rgb: parseRgb(getComputedStyle(b).backgroundColor) }));
        const groups = new Map<HTMLButtonElement, string[]>();
        for (const [nodeId, colour] of todo) {
          const rgb = parseRgb(colour);
          let best = swatches[0];
          let bd = Infinity;
          for (const s of swatches) {
            const dd = (s.rgb[0] - rgb[0]) ** 2 + (s.rgb[1] - rgb[1]) ** 2 + (s.rgb[2] - rgb[2]) ** 2;
            if (dd < bd) {
              bd = dd;
              best = s;
            }
          }
          if (!groups.has(best.b)) groups.set(best.b, []);
          groups.get(best.b)!.push(nodeId);
        }
        for (const [sw, ids] of groups) {
          click(sw); // active colour; re-renders the toolbar only, no tree rebuild
          const els = ids.map((id) => nodeEl(id));
          stats.current.colourSkipped += els.filter((e) => !e).length;
          flushSync(() => {
            for (const el of els) if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          }); // one batched state update, one rebuild per colour
        }
      }
      toggle(); // leave colour mode
      a.clades = want;
    });
  }, [props.colouredClades]);

  // ---------------------------------------------------------------- focus: synthetic wheel and drag into the library's d3-zoom
  useEffect(() => {
    const fr = props.focusRequest;
    if (!fr) return;
    drive(() => {
      const host = hostRef.current!;
      const svg = svgOf(host);
      const cont = container(host);
      let el = index().leaf.get(fr.tipId);
      if (!svg || !cont || !el) return;
      const centre = (e: Element) => {
        const r = e.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      // zoom: make neighbouring tips about 24 px apart
      const i = tree.tipIndex(fr.tipId);
      const r0 = tree.tipRank[i];
      const nb = index().leaf.get(tree.tipLabels[Math.min(tree.tipCount - 1, r0 + 1)]) ?? index().leaf.get(tree.tipLabels[Math.max(0, r0 - 1)]);
      let p = centre(el);
      if (nb && nb !== el) {
        const q = centre(nb);
        const pitch = Math.hypot(p.x - q.x, p.y - q.y);
        if (pitch > 0 && pitch < 24) wheelZoom(svg, p.x, p.y, clamp(24 / pitch, 1, 14 / currentK(host)));
      }
      // pan: bring the tip to the middle of the drawing area
      const cr = cont.getBoundingClientRect();
      p = centre(el);
      dragPan(svg, p.x, p.y, cr.left + cr.width / 2 - p.x, cr.top + cr.height / 2 - p.y);
    });
  }, [props.focusRequest]);

  // ---------------------------------------------------------------- theme: library reads data-theme on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (!theme.dark) return;
    darkOwners++;
    root.setAttribute('data-theme', 'dark');
    return () => {
      darkOwners--;
      if (darkOwners === 0) root.removeAttribute('data-theme');
    };
  }, [theme.dark]);

  // ---------------------------------------------------------------- user events from the DOM (capture phase on our wrapper)
  useEffect(() => {
    const host = hostRef.current!;
    const report = (type: 'tipClick' | 'nodeClick' | 'branchClick' | 'tipHover' | 'nodeHover', d: D, via: string) => {
      const m = mapDatum(latest.current.tree, d);
      if (!m) {
        stats.current.unmatched++;
        return null;
      }
      if (!m.exact) stats.current.inexactClicks++;
      const isTip = m.isTip;
      const t = isTip ? (type === 'nodeClick' ? 'tipClick' : type === 'nodeHover' ? 'tipHover' : type) : type === 'tipClick' ? 'nodeClick' : type === 'tipHover' ? 'nodeHover' : type;
      latest.current.emit({
        type: t as any,
        nodeId: m.nodeId,
        isTip,
        tipIds: m.tipIds,
        source: 'adapter-derived',
        libraryPayload: { via, libraryLeaves: m.libLeaves, exactClade: m.exact, name: d.data.name ?? '' },
      });
      return m;
    };
    const onClick = (e: MouseEvent) => {
      if (driving.current) return;
      const t = e.target as Element | null;
      if (!t || !(t instanceof Element)) return;
      const hit = t.closest('circle.r-hit, path.b-hit, text.leaf-label');
      if (!hit) return;
      const datum = (hit as any).__data__ as D;
      if (!datum) return;
      if (hit.matches('path.b-hit')) {
        report('branchClick', datum.target, 'b-hit');
        return; // the library only reacts to branch clicks in colour mode
      }
      const leaf = isLeafDatum(datum);
      report(leaf ? 'tipClick' : 'nodeClick', datum, hit.matches('text') ? 'leaf-label' : 'r-hit');
      // the library collapses an internal node on click (and opens its clade editor); keep that behind the options switch
      if (!leaf && !latest.current.features.libraryCollapse && !hostRef.current!.querySelector('.Reactree_colorModeActive, [class*="colorModeActive"]')) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    let lastHover: Element | null = null;
    const onOver = (e: MouseEvent) => {
      if (driving.current) return;
      const t = e.target as Element | null;
      if (!t || !(t instanceof Element)) return;
      const hit = t.closest('circle.r-hit, text.leaf-label');
      if (hit === lastHover) return;
      lastHover = hit;
      if (!hit) return;
      const datum = (hit as any).__data__ as D;
      if (!datum) return;
      report(isLeafDatum(datum) ? 'tipHover' : 'nodeHover', datum, 'mouseover');
    };
    host.addEventListener('click', onClick, true);
    host.addEventListener('mouseover', onOver, true);
    return () => {
      host.removeEventListener('click', onClick, true);
      host.removeEventListener('mouseover', onOver, true);
    };
  }, []);

  // ---------------------------------------------------------------- readiness: the library builds twice on mount (RESET) and fades in
  useEffect(() => {
    const host = hostRef.current!;
    let cancelled = false;
    let last = '';
    let stable = 0;
    let buildDone = 0;
    let lastGen = -1;
    const t0 = performance.now();
    const tick = () => {
      if (cancelled) return;
      const g = contentG(host);
      const leaves = host.querySelectorAll('text.leaf-label').length;
      const op = g?.getAttribute('opacity');
      const key = g ? `${op}|${g.getAttribute('transform')}|${leaves}|${gen.current}` : '';
      stable = key && key === last && (op === null || op === '1') && leaves > 0 ? stable + 1 : 0;
      if (g && leaves > 0 && gen.current !== lastGen) {
        lastGen = gen.current;
        buildDone = performance.now() - t0; // time of the most recent library rebuild
      }
      last = key;
      if (stable >= 4 || performance.now() - t0 > 60000) {
        const settled = performance.now() - t0;
        props.onReady({
          parseMs: 0,
          tips: leaves,
          notes: `library parses and builds in its own effects (parseMs not separable, included in firstRenderMs); it builds twice on mount (RESET effect); last rebuild finished ${buildDone.toFixed(0)} ms after mount, ready after ${settled.toFixed(0)} ms including its ~350 ms fade-in and fit animation; sharedParseMs=${props.sharedParseMs.toFixed(1)}; rebuilds so far ${stats.current.rebuilds}`,
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------- introspection (read-only)
  const visibleRect = (): DOMRect | null => {
    const c = container(hostRef.current!);
    const h = hostRef.current!.getBoundingClientRect();
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const x0 = Math.max(r.left, h.left), y0 = Math.max(r.top, h.top), x1 = Math.min(r.right, h.right), y1 = Math.min(r.bottom, h.bottom);
    return x1 > x0 && y1 > y0 ? new DOMRect(x0, y0, x1 - x0, y1 - y0) : null;
  };
  const handle: ViewHandle = {
    locate(t) {
      const vr = visibleRect();
      if (!vr || !hostRef.current) return null;
      let el: SVGCircleElement | null | undefined;
      if (t.kind === 'tip') el = index().leaf.get(t.id);
      else if (tree.isNodeId(t.id)) el = nodeEl(t.id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      return x >= vr.left && x <= vr.right && y >= vr.top && y <= vr.bottom ? { x, y } : null;
    },
    bounds(t) {
      const vr = visibleRect();
      const svg = hostRef.current && svgOf(hostRef.current);
      const g = hostRef.current && contentG(hostRef.current);
      if (!vr || !svg || !g) return null;
      let el: SVGCircleElement | null | undefined;
      if (t.kind === 'tip') el = index().leaf.get(t.id);
      else if (tree.isNodeId(t.id)) el = nodeEl(t.id);
      if (!el) return null;
      const d = (el as any).__data__ as D;
      const m = g.getScreenCTM();
      if (!m) return null;
      const circular = latest.current.layout === 'radial';
      const pt = (n: D) => {
        const lx = circular ? Math.cos(n.x - Math.PI / 2) * n.y : n.y;
        const ly = circular ? Math.sin(n.x - Math.PI / 2) * n.y : n.x;
        return { x: m.a * lx + m.c * ly + m.e, y: m.b * lx + m.d * ly + m.f };
      };
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const add = (n: D) => {
        const p = pt(n);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      };
      if (t.kind === 'tip') {
        const p = pt(d);
        x0 = p.x - 4; x1 = p.x + 4; y0 = p.y - 4; y1 = p.y + 4;
      } else {
        for (const n of d.descendants()) add(n); // visible nodes below d (a collapsed node is just itself)
      }
      x0 = Math.max(x0, vr.left); y0 = Math.max(y0, vr.top); x1 = Math.min(x1, vr.right); y1 = Math.min(y1, vr.bottom);
      if (!(x1 >= x0 && y1 >= y0)) return null;
      // a clade can be a sub-pixel hairline at the fit view of a large tree: report at least the 2 px the stroke antialiases to
      const w = Math.max(2, x1 - x0), h = Math.max(2, y1 - y0);
      return { x: x0 - (w - (x1 - x0)) / 2, y: y0 - (h - (y1 - y0)) / 2, width: w, height: h };
    },
    locateCell(colId, tipId) {
      if (colId !== alnColId || latest.current.layout !== 'rectangular') return null;
      const col = latest.current.columns.find((c) => c.id === colId);
      if (!col || col.values[tipId] === undefined) return null; // no sequence row for this tip: nothing is meant to be drawn
      const host = hostRef.current;
      const cv = host?.querySelector<HTMLCanvasElement>('canvas.Reactree_alnCanvas');
      const wrap = cv?.parentElement;
      const el = index().leaf.get(tipId);
      if (!host || !cv || !wrap || !el) return null;
      const p = el.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      const k = currentK(host);
      const cellH = Math.max(3, 26 * k * 0.76); // vScale stays 1; mirrors the library's row height on the alignment canvas
      const cy = p.top + p.height / 2;
      if (cy < wr.top + 24 || cy > wr.bottom) return null; // under the sticky position axis or outside the panel
      const cr = cv.getBoundingClientRect(); // the canvas scrolls horizontally inside its wrapper: report the visible strip
      const x0 = Math.max(cr.left, wr.left), x1 = Math.min(cr.right, wr.right);
      return x1 > x0 ? { x: x0, y: cy - cellH / 2, width: x1 - x0, height: cellH } : null;
    },
    custom() {
      const host = hostRef.current;
      return { leafLabels: host ? host.querySelectorAll('text.leaf-label').length : 0, rebuilds: stats.current.rebuilds, unmatchedEvents: stats.current.unmatched, inexactClicks: stats.current.inexactClicks, colourSkipped: stats.current.colourSkipped, lastDriveMs: stats.current.lastDriveMs, k: host ? currentK(host) : 0 };
    },
  };
  useLayoutEffect(() => {
    props.handleRef.current = handle;
    return () => {
      props.handleRef.current = null;
    };
  });

  // runner tokens (background, foreground, branch, highlight, fontFamily) override the token mapping on our wrapper
  const tk = theme.tokens ?? {};
  const vars: Record<string, string> = {};
  if (tk.background) { vars['--clr-surface-a0'] = tk.background; vars['--clr-surface-a10'] = tk.background; }
  if (tk.foreground) { vars['--clr-text-primary'] = tk.foreground; vars['--rt-fg'] = tk.foreground; }
  if (tk.branch) vars['--rt-branch'] = tk.branch;
  if (tk.highlight) { vars['--rt-hl'] = tk.highlight; vars['--clr-primary-a0'] = tk.highlight; }
  if (tk.fontFamily) { vars['--rt-font'] = tk.fontFamily; vars['--font-family'] = tk.fontFamily; }

  return (
    <div ref={hostRef} className="rt-host" style={vars as React.CSSProperties}>
      <style>{TOKEN_CSS}</style>
      <Reactree newick={props.newick} defaultHeight={defaultHeight} fasta={fastaState || undefined} />
    </div>
  );
}

function parseRgb(c: string): [number, number, number] {
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = c.replace('#', '');
  if (/^[0-9a-f]{6}$/i.test(h)) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return [0, 0, 0];
}

const capabilities: CapabilityReport = {
  tipClick: { level: 'partial', how: 'no callback; capture-phase click listener on our wrapper reads the d3 datum (__data__) of the clicked circle.r-hit or text.leaf-label. The library itself only opens its own node-info panel on a tip click.' },
  internalNodeClick: { level: 'partial', how: 'same DOM listener on circle.r-hit. The library collapses the clade into a triangle on that click; the adapter stops that by default (option switch) so colouring works.' },
  branchClick: { level: 'partial', how: 'path.b-hit (12 px transparent hit stroke) listener; datum is the link, target = clade below the branch. The library reacts only in colour mode.' },
  hover: { level: 'partial', how: 'mouseover capture on circle.r-hit and tip labels; the library shows tooltips only inside its edit modes. Events are adapter-derived.' },
  descendantTipsInPayload: { level: 'partial', how: 'no payload at all: the adapter walks the datum (d.data.children) for leaf names and maps them to the shared TreeModel (mrca by name); after a library reroot/ladderize the clade may not exist in the shared tree (flagged exactClade=false).' },
  cladeColouring: { level: 'partial', how: 'drives the library colour mode through its own toolbar button, palette swatch and synthetic clicks on node hit circles (one rebuild per colour). Only the 12 palette colours exist (nearest chosen); no free colour, no API.' },
  highlightTip: { level: 'partial', how: 'own SVG ring circles inserted into the tip group after each rebuild (re-applied by a MutationObserver). Library search (Ctrl+F) highlights one substring only and is not used for this.' },
  focusTip: { level: 'partial', how: 'synthetic wheel and mouse events fed to the library d3-zoom (zoom to about 24 px row pitch, then drag the tip to the middle); instant, no API.' },
  tipAsLink: { level: 'partial', how: 'each leaf <text> is wrapped in an SVG <a href data-tip-id tabindex=0> after every rebuild; all tips are in the DOM so all are links (names over 30 chars are truncated for display only).' },
  customColumns: { level: 'partial', how: 'only the alignment kind: the library has no per-tip column API, its one per-tip panel is the FASTA alignment canvas. Bar and text columns are skipped (cannot be drawn).' },
  alignmentColumn: { level: 'partial', how: 'one alignment column becomes the fasta prop; panel is shown by clicking its toolbar button; fixed 14 px cells and 172 px label canvas (ColumnSpec.width ignored), rectangular layout only, rows scroll with the tree.' },
  radialLayout: { level: 'partial', how: 'library has a circular layout, switched by clicking its toolbar button (no prop).' },
  branchLengthToggle: { level: 'partial', how: 'library phylogram/cladogram buttons, clicked from the adapter (no prop). Cladogram uses d3.cluster so tips align.' },
  scaleBar: { level: 'yes', how: 'axis with ticks under the rectangular phylogram, a scale bar in the circular one (always labelled substitutions / site).' },
  darkTheme: { level: 'yes', how: 'documented data-theme="dark" on <html> (MutationObserver); rebuilds the SVG. Global attribute, so it also affects the host page.' },
  cssTokens: { level: 'partial', how: '--clr-* and --font-family map onto GBIF tokens for the chrome; tree colours are hard-coded hex in JS, re-themed with CSS attribute selectors on those hex values (brittle). Canvas alignment colours and fonts cannot be styled.' },
  multipleInstances: { level: 'partial', how: 'two instances render, but they share window keydown handling, the data-theme attribute and document-level portals; see S13.' },
  cleanUnmount: { level: 'yes', how: 'React unmount; effects remove their window listeners and the MutationObserver; portals unmount with the component (verified in S13/S1 teardown).' },
  controlledState: { level: 'no', how: 'three props only (newick, fasta, defaultHeight); a changed newick resets all state. Everything else is internal React state reachable only through the DOM.' },
  zoomToFit: { level: 'partial', how: 'fits on mount and on layout change; a Fit toolbar button exists but no API.' },
  overviewOrMinimap: { level: 'no', how: 'none; every node and label is always drawn, min zoom 0.05.' },
};

const features: AdapterFeature[] = [
  { id: 'libraryCollapse', label: 'Library collapse on internal-node click', kind: 'toggle', default: false, level: 'partial', description: 'The library turns an internal node click into a named triangle and opens its clade editor. Off by default so the demo’s colour-on-click works; when on, clicks pass through.', how: 'adapter stops the click in the capture phase unless this is on' },
  { id: 'searchPanel', label: 'Library search panel (Ctrl/Cmd+F)', kind: 'toggle', default: false, level: 'partial', description: 'Opens the library search box; typing dims non-matches and pans to a match. The query cannot be set from props.', how: 'toolbar button clicked from the adapter' },
  { id: 'alignLabels', label: 'Align labels with leader lines', kind: 'toggle', default: false, level: 'partial', description: 'Right-aligns tip labels (phylogram only).', how: 'toolbar button clicked from the adapter' },
  { id: 'nodeLabels', label: 'Node labels', kind: 'select', default: 'bootstrap', options: [{ value: 'none', label: 'None' }, { value: 'bootstrap', label: 'Bootstrap' }, { value: 'branchlength', label: 'Branch length' }], level: 'partial', description: 'Only offered by the library when the tree has numeric internal labels or branch lengths.', how: 'cycle button clicked until it shows the mode' },
  { id: 'truncate', label: 'Truncate long tip names', kind: 'toggle', default: true, level: 'partial', description: 'The library truncates names over 30 characters; the button only exists when such names occur.', how: 'toolbar button clicked from the adapter' },
  { id: 'keepBrowserFind', label: 'Keep browser find (Ctrl/Cmd+F)', kind: 'toggle', default: false, level: 'partial', description: 'The library hijacks Ctrl/Cmd+F for the whole window while mounted. When on, the adapter stops the event before the library sees it.', how: 'window capture listener with stopImmediatePropagation' },
];

export const adapter: CandidateAdapter = {
  candidate: {
    name: 'Reactree',
    version: VERSION,
    license: 'MIT',
    notes: 'reactreejs: React component with three props (newick, fasta, defaultHeight), D3 SVG, built-in toolbar. Everything beyond rendering is driven through its DOM (partial).',
    columnKinds: ['alignment'],
  },
  capabilities,
  View: ReactreeView,
  features,
};
