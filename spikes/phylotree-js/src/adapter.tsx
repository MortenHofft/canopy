// phylotree.js candidate: our own React wrapper around phylotree 2.6.0 (veg/phylotree.js, MIT, d3 v7).
//
// How a gbif.org developer would use it, and what the wrapper has to do because the library is imperative:
//  * `new phylotree(newick)` parses (iterative parser) and builds a d3.hierarchy; `tree.render({...})` builds a DETACHED
//    <svg> (d3.create) that we append to our host <div> ourselves (`display.show()`).
//  * options: zoom (d3.zoom on the svg, uniform transform, scaleExtent hard-coded to [0.1, 10] but reachable through
//    `display.zoomBehavior`), fit-to-size spacing, responsive viewBox, align-tips, show-scale, node-styler, edge-styler.
//  * events come from `display.on('nodeClick' | 'nodeHover' | 'branchClick', cb)`; the payload is the d3 hierarchy node.
//  * our styling state (coloured clades, highlighted tips, tip links, column cells) lives in refs and is applied by the
//    node-styler / edge-styler callbacks, which the library calls on every update() and which we also call ourselves on
//    the existing DOM when only styling changed (no re-layout).
//  * teardown: upstream has no destroy(); we remove listeners, interrupt transitions, drop the svg and every reference.
//  * reroot() (library, via the context menu) REPLACES the TreeRender object (`tree.display`) and drops our listeners;
//    the wrapper re-binds on the DOM 'reroot' event that the library dispatches on the container.

import React, { useLayoutEffect, useEffect, useRef } from 'react';
import { select, zoomIdentity, scaleLinear, axisTop, format } from 'd3';
import { phylotree } from 'phylotree';
import type { CandidateAdapter, CapabilityReport, ColumnSpec, EmitEvent, FeatureValues, Point, Rect, ThemeSpec, ViewHandle, ViewProps } from '../../shared/types.ts';
import { gbifTheme, gbifDarkTheme } from '../../shared/gbif-theme.ts';
import type { TreeModel } from '../../shared/tree.ts';
import { version as LIB_VERSION } from 'phylotree/package.json';

/* eslint-disable @typescript-eslint/no-explicit-any */
type HNode = any; // d3.hierarchy node as used by phylotree (has .data.name, .children, .screen_x, .screen_y, ...)

const COL_GAP = 6;
const HEADER_H = 22; // user units added above the tree when columns are on (column headers)
let hostCounter = 0;
// build-time switch for the measurements: VITE_PT_LOD=0 npm run build gives the library's behaviour without the wrapper's label LOD
const LOD_DEFAULT = (import.meta as any).env?.VITE_PT_LOD !== '0';

// ------------------------------------------------------------------------------------------------ CSS (tokens only)

const CSS = `
.pt-root{position:relative;width:100%;height:100%;overflow:hidden;background:var(--pt-bg);color:var(--pt-fg);font-family:var(--pt-font);user-select:none}
.pt-root svg{display:block;width:100%!important;height:100%!important;max-width:none!important;touch-action:none;cursor:grab}
.pt-root svg:active{cursor:grabbing}
.pt-root .branch{fill:none;stroke:var(--pt-branch);stroke-width:1.3px;vector-effect:non-scaling-stroke;stroke-linejoin:round;stroke-linecap:round}
.pt-root .branch.pt-coloured{stroke-width:2.4px}
.pt-root .branch:hover{stroke:var(--pt-hl);stroke-width:3px}
.pt-root .branch-selected{stroke:var(--pt-hl)!important;stroke-width:3px}
.pt-root .branch-tagged{stroke:var(--pt-hl);stroke-dasharray:6 4}
.pt-root .internal-node circle{fill:var(--pt-bg);stroke:var(--pt-branch);stroke-width:1px;vector-effect:non-scaling-stroke;cursor:pointer}
.pt-root .internal-node circle:hover{fill:var(--pt-hl);stroke:var(--pt-hl)}
.pt-root .internal-node.pt-coloured circle{fill:var(--pt-node-colour)}
.pt-root .node-collapsed circle{fill:var(--pt-branch)}
.pt-root .node-selected circle,.pt-root .internal-node.node-selected circle{fill:var(--pt-hl);stroke:var(--pt-hl)}
.pt-root .node-selected text{fill:var(--pt-hl);font-weight:600}
.pt-root .clade{fill:var(--pt-clade);stroke:var(--pt-branch);stroke-width:1px;vector-effect:non-scaling-stroke;opacity:.55}
.pt-root .phylotree-node-text{font-family:var(--pt-font);font-style:italic;fill:var(--pt-fg);cursor:pointer;paint-order:stroke;stroke:none}
.pt-root .internal-node .phylotree-node-text{font-style:normal;fill:var(--pt-fg2);cursor:default}
.pt-root.pt-lod-hide .phylotree-node-text,.pt-root.pt-lod-hide .pt-cell-text{display:none}
.pt-root text{text-rendering:geometricPrecision}
.pt-root .pt-link .phylotree-node-text{text-decoration:underline;text-underline-offset:.12em}
.pt-root a.pt-link:focus-visible{outline:none}
.pt-root text:focus{outline:none}
.pt-root text:focus-visible{fill:var(--pt-hl);text-decoration:underline;text-decoration-thickness:2px}
.pt-root a.pt-link:focus-visible text{fill:var(--pt-hl);text-decoration-thickness:2px}
.pt-root .pt-tip{fill:var(--pt-branch);stroke:none;pointer-events:none}
.pt-root .node.pt-hl text{fill:var(--pt-hl);font-weight:600}
.pt-root .node.pt-hl .pt-tip{fill:var(--pt-hl)}
.pt-root .pt-ring{fill:var(--pt-hl);fill-opacity:.22;stroke:var(--pt-hl);stroke-width:1.5px;vector-effect:non-scaling-stroke;pointer-events:none}
.pt-root .pt-band{fill:var(--pt-hl);fill-opacity:.16;pointer-events:none}
.pt-root .branch-tracer{stroke:var(--pt-tracer);stroke-dasharray:2 3;stroke-width:1px;vector-effect:non-scaling-stroke}
.pt-root .pt-cell-bar{fill:var(--pt-bar)}
.pt-root .pt-cell-text{fill:var(--pt-fg);font-family:var(--pt-font);font-style:normal}
.pt-root .pt-colhead text{fill:var(--pt-fg);font-family:var(--pt-font);font-weight:600;font-size:11px;font-style:normal}
.pt-root .tree-scale-bar text{fill:var(--pt-fg2);font-family:var(--pt-font);font-size:11px}
.pt-root .tree-scale-bar line,.pt-root .tree-scale-bar path{fill:none;stroke:var(--pt-fg2);shape-rendering:crispEdges;vector-effect:non-scaling-stroke}
.pt-root .phylotree-context-menu{background:var(--pt-bg);color:var(--pt-fg);border:1px solid var(--pt-border);border-radius:var(--radius-md,6px);box-shadow:var(--shadow-md,0 4px 12px rgba(0,0,0,.15));padding:4px 0;min-width:190px;z-index:5;font-family:var(--pt-font);font-size:13px}
.pt-root .phylotree-menu-item{display:block;padding:5px 12px;cursor:pointer;color:var(--pt-fg);text-decoration:none}
.pt-root .phylotree-menu-item:hover{background:var(--pt-hl);color:var(--pt-bg)}
.pt-root .phylotree-menu-header{margin:4px 12px 2px;font-size:11px;font-weight:600;color:var(--pt-fg2);text-transform:uppercase;letter-spacing:.04em}
.pt-root .phylotree-menu-divider{height:1px;margin:4px 0;background:var(--pt-border)}
.pt-root .tree-selection-brush .extent{fill:var(--pt-hl);fill-opacity:.1;stroke:var(--pt-hl)}
`;

// residue colours for alignment cells: conventional Clustal/protein palette (domain colours, not GBIF tokens)
const AA: Record<string, string> = {};
for (const c of 'AILMFWVC') AA[c] = '#80a0f0';
for (const c of 'KR') AA[c] = '#f01505';
for (const c of 'ED') AA[c] = '#c048c0';
for (const c of 'NQST') AA[c] = '#15c015';
AA.G = '#f09048';
AA.P = '#c0c000';
for (const c of 'HY') AA[c] = '#15a4a4';
AA.U = '#15c015';
const residueColour = (ch: string) => AA[ch.toUpperCase()] ?? '#e2e2e2';

function themeVars(t: ThemeSpec): React.CSSProperties {
  const g = t.dark ? gbifDarkTheme() : gbifTheme();
  const k = t.tokens ?? {};
  return {
    '--pt-bg': k.background ?? g.bg1,
    '--pt-fg': k.foreground ?? g.fg1,
    '--pt-fg2': k.foreground ?? g.fg2,
    '--pt-branch': k.branch ?? (t.dark ? g.fg3 : g.fg2),
    '--pt-hl': k.highlight ?? g.primary,
    '--pt-tracer': t.dark ? g.fg3 : g.fg4,
    '--pt-bar': g.categorical[1],
    '--pt-node-colour': g.categorical[0],
    '--pt-clade': g.surface,
    '--pt-border': g.border,
    '--pt-font': k.fontFamily ?? g.fontBody,
  } as React.CSSProperties;
}

// ------------------------------------------------------------------------------------------------ instance state

interface Applied {
  layoutKey: string;
  clades: unknown;
  highlight: unknown;
  links: unknown;
  columns: unknown;
  focusSeq: number;
  menu: string;
}

interface Inst {
  host: HTMLDivElement;
  hostId: string;
  pt: any; // phylotree instance
  display: any; // TreeRender (replaced by library on reroot)
  tree: TreeModel;
  libOf: (HNode | null)[]; // shared preorder index -> library node
  idxOf: Map<HNode, number>; // library node -> shared preorder index
  tipNode: Map<string, HNode>; // tip label -> library node
  rangeKey: Map<string, number>; // `${minRank}:${count}` -> shared index (topmost), for tip-set matching
  unmapped: number;
  colourOf: Map<HNode, string>;
  hl: Set<HNode>;
  gMap: Map<HNode, SVGGElement> | null;
  eMap: Map<HNode, SVGPathElement> | null;
  labelW1: number; // widest tip label at font-size 1 (user units), only measured when columns are on
  labelWKey: string;
  colsVersion: number;
  applied: Applied;
  latest: React.MutableRefObject<ViewProps>;
  emit: (e: EmitEvent) => void;
  offs: (() => void)[];
  stats: { updates: number; lastUpdateMs: number; restyles: number; lastRestyleMs: number; unmappedEvents: number; rerooted: number };
  destroyed: boolean;
  firstLayoutMs: number;
  parseMs: number;
  commentsRemoved: number;
  stylers: { nodeStyler: (sel: any, node: HNode) => void; edgeStyler: (sel: any, edge: any) => void };
  ladder: string;
}

// ------------------------------------------------------------------------------------------------ input

/**
 * phylotree's Newick parser has no square-bracket comment handling: "'Ursus arctos'[&note=x]:0.5" becomes the tip name
 * "Ursus arctos[&note=x]". Strip [...] comments (quote-aware, nesting-aware, iterative) before handing text to the library.
 */
function stripNewickComments(s: string): { text: string; removed: number } {
  if (s.indexOf('[') < 0) return { text: s, removed: 0 };
  const out: string[] = [];
  let q = '';
  let depth = 0;
  let removed = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (depth > 0) {
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) start = i + 1;
      }
      continue;
    }
    if (q) {
      if (c === q) q = '';
      continue;
    }
    if (c === "'" || c === '"') q = c;
    else if (c === '[') {
      out.push(s.slice(start, i));
      depth = 1;
      removed++;
    }
  }
  out.push(s.slice(start));
  return { text: out.join(''), removed };
}

// ------------------------------------------------------------------------------------------------ id mapping

/**
 * library node <-> shared preorder id. Fast path: the library's d3.hierarchy has the same preorder as the shared
 * TreeModel (same child order, same tip names). Otherwise (children reordered, names altered, tree rerooted) match
 * clades by their tip sets: a clade is the contiguous range of shared tip ranks [min, min+count).
 */
function buildMaps(I: Inst): void {
  const { pt, tree } = I;
  const n = tree.nodeCount;
  I.libOf = new Array(n).fill(null);
  I.idxOf = new Map();
  I.tipNode = new Map();
  const pre: HNode[] = [];
  pt.nodes.eachBefore((x: HNode) => pre.push(x));
  let fast = pre.length === n;
  if (fast) {
    for (let i = 0; i < n; i++) {
      const x = pre[i];
      const cc = x.children ? x.children.length : 0;
      if (cc !== tree.childCount[i] || (cc === 0 && x.data.name !== tree.labels[i])) {
        fast = false;
        break;
      }
    }
  }
  if (fast) {
    for (let i = 0; i < n; i++) {
      I.libOf[i] = pre[i];
      I.idxOf.set(pre[i], i);
      if (!pre[i].children) I.tipNode.set(pre[i].data.name, pre[i]);
    }
    I.unmapped = 0;
    return;
  }
  // slow path: tip-set matching
  const lo = new Map<HNode, number>();
  const hi = new Map<HNode, number>();
  const cnt = new Map<HNode, number>();
  pt.nodes.eachAfter((x: HNode) => {
    if (!x.children) {
      const ti = tree.tipIndex(x.data.name);
      const r = ti >= 0 ? tree.tipRank[ti] : -1;
      lo.set(x, r < 0 ? Infinity : r);
      hi.set(x, r < 0 ? -Infinity : r);
      cnt.set(x, 1);
      if (r >= 0) I.tipNode.set(x.data.name, x);
    } else {
      let a = Infinity, b = -Infinity, c = 0;
      for (const ch of x.children) {
        a = Math.min(a, lo.get(ch)!);
        b = Math.max(b, hi.get(ch)!);
        c += cnt.get(ch)!;
      }
      lo.set(x, a);
      hi.set(x, b);
      cnt.set(x, c);
    }
  });
  const lists = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = `${tree.leafStart[i]}:${tree.leafEnd[i] - tree.leafStart[i]}`;
    const l = lists.get(key);
    if (l) l.push(i);
    else lists.set(key, [i]);
  }
  const ptr = new Map<string, number>();
  let unmapped = 0;
  for (const x of pre) {
    const a = lo.get(x)!, b = hi.get(x)!, c = cnt.get(x)!;
    const key = `${a}:${c}`;
    const l = lists.get(key);
    if (!l || b - a + 1 !== c) {
      unmapped++;
      continue;
    }
    const p = ptr.get(key) ?? 0;
    if (p >= l.length) {
      unmapped++;
      continue;
    }
    ptr.set(key, p + 1);
    I.libOf[l[p]] = x;
    I.idxOf.set(x, l[p]);
  }
  I.unmapped = unmapped;
}

function nodeIdOf(I: Inst, x: HNode): string | null {
  const i = I.idxOf.get(x);
  return i === undefined ? null : I.tree.nodeId(i);
}

function tipNamesOf(x: HNode): string[] {
  return x.children ? x.leaves().map((l: HNode) => l.data.name as string) : [x.data.name as string];
}

// ------------------------------------------------------------------------------------------------ stylers

function barWidth(v: number, max: number, w: number): number {
  if (!(max > 0) || !(v > 0)) return 1;
  return Math.max(1, (Math.log10(1 + v) / Math.log10(1 + max)) * (w - 4));
}

function measureLabels(I: Inst, key: string) {
  if (I.labelWKey === key) return;
  I.labelWKey = key;
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d')!;
  const fam = getComputedStyle(I.host).getPropertyValue('--pt-font') || 'sans-serif';
  ctx.font = `italic 100px ${fam}`;
  let w = 0;
  for (const t of I.tree.tipLabels) w = Math.max(w, ctx.measureText(t).width);
  I.labelW1 = w / 100;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function makeStylers(I: Inst) {
  // `function` (not arrow): during the constructor's first update() I.display is not assigned yet; the library calls the
  // styler as a method (this.node_styler(...)), so `this` is the TreeRender
  const nodeStyler = function (this: any, sel: any, node: HNode) {
    const g = sel?.node?.() as SVGGElement | null;
    if (!g || !(g instanceof SVGElement)) return;
    const P = I.latest.current;
    const d = I.display ?? this;
    const col = I.colourOf.get(node);
    const leaf = !node.children;
    if (leaf) {
      const fs: number = d.shown_font_size;
      // --- tip marker (the library draws no marker at tips) and highlight
      const showMarker = P.features.tipMarkers !== false;
      let dot = g.querySelector(':scope > circle.pt-tip') as SVGCircleElement | null;
      const hl = I.hl.has(node);
      g.classList.toggle('pt-hl', hl);
      if (showMarker || hl) {
        if (!dot) {
          dot = svgEl('circle');
          dot.setAttribute('class', 'pt-tip');
          g.insertBefore(dot, g.firstChild);
        }
        dot.setAttribute('r', String(Math.max(0.2, Math.min(2, fs * 0.2)) * (hl ? 1.5 : 1)));
        if (col) dot.style.fill = col;
        else dot.style.removeProperty('fill');
        dot.style.display = showMarker || hl ? '' : 'none';
      } else if (dot) dot.remove();
      // highlight ring + row band (rectangular only)
      let ring = g.querySelector(':scope > circle.pt-ring') as SVGCircleElement | null;
      let band = g.querySelector(':scope > rect.pt-band') as SVGRectElement | null;
      if (hl) {
        if (!ring) {
          ring = svgEl('circle');
          ring.setAttribute('class', 'pt-ring');
          g.insertBefore(ring, g.firstChild);
        }
        ring.setAttribute('r', String(Math.max(1.5, fs * 0.65)));
        if (!d.radial() && !d.unrooted()) {
          if (!band) {
            band = svgEl('rect');
            band.setAttribute('class', 'pt-band');
            g.insertBefore(band, g.firstChild);
          }
          const rowH: number = Math.max(d.scales[0], 0.5);
          const shift = d.alignTips() ? d.shiftTip(node)[0] : 0;
          const rtl = d.options.layout === 'right-to-left';
          const w = shift + (d.label_width || 60) + 6;
          band.setAttribute('x', rtl ? String(-w) : '-3');
          band.setAttribute('y', String(-rowH / 2));
          band.setAttribute('width', String(w));
          band.setAttribute('height', String(rowH));
        }
      } else {
        ring?.remove();
        band?.remove();
      }
      // --- label colour of a coloured clade
      const text = g.querySelector('text') as SVGTextElement | null;
      if (text) {
        if (!text.hasAttribute('tabindex')) {
          // keyboard access (wrapper-added): focusable label, Enter re-dispatches a click so the library's own handler fires
          text.setAttribute('tabindex', '0');
          text.setAttribute('role', 'button');
          text.setAttribute('aria-label', 'tip ' + node.data.name);
          text.addEventListener('keydown', (e) => {
            if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
              e.preventDefault();
              text.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
          });
        }
        if (col && !hl) text.style.fill = col;
        else text.style.removeProperty('fill');
        // --- tip link: wrap the library's <text> in an SVG <a href data-tip-id>
        const a = g.querySelector(':scope > a.pt-link') as SVGAElement | null;
        if (P.tipLinks) {
          const name: string = node.data.name;
          if (!a) {
            const na = svgEl('a');
            na.setAttribute('class', 'pt-link');
            g.insertBefore(na, text);
            na.appendChild(text);
            fillLink(na, name, P.tipLinks);
          } else fillLink(a, name, P.tipLinks);
        } else if (a) {
          g.insertBefore(text, a);
          a.remove();
        }
      }
      // --- custom columns (cells appended at the tip-aligned position)
      drawCells(I, d, g, node, P.columns);
    } else {
      // internal node
      const c = g.querySelector('circle') as SVGCircleElement | null;
      g.classList.toggle('pt-coloured', !!col);
      if (c) {
        if (col) c.style.setProperty('--pt-node-colour', col);
        else c.style.removeProperty('--pt-node-colour');
        if (col) c.style.fill = col;
        else c.style.removeProperty('fill');
        if (!node.parent && node.children.length === 1) c.style.display = 'none';
      }
      const txt = g.querySelector('text') as SVGTextElement | null;
      if (txt) {
        if (col) txt.style.fill = col;
        else txt.style.removeProperty('fill');
      }
    }
  };

  const edgeStyler = (sel: any, edge: any) => {
    // NOTE: display.refresh() calls this with d3.select(<TreeRender>) (an arrow-function `this` bug in the library),
    // so guard: only act on a real SVG element.
    const el = sel?.node?.() as SVGElement | null;
    if (!el || !(el instanceof SVGElement)) return;
    const col = I.colourOf.get(edge.target);
    if (col) {
      el.style.stroke = col;
      el.classList.add('pt-coloured');
    } else {
      el.style.removeProperty('stroke');
      el.classList.remove('pt-coloured');
    }
  };
  return { nodeStyler, edgeStyler };
}

function fillLink(a: Element, name: string, href: (id: string) => string) {
  a.setAttribute('href', href(name));
  a.setAttribute('data-tip-id', name);
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer');
  a.setAttribute('tabindex', '0');
  a.setAttribute('aria-label', name);
}

function drawCells(I: Inst, d: any, g: SVGGElement, node: HNode, cols: ColumnSpec[]) {
  const existing = g.querySelector(':scope > g.pt-cells') as SVGGElement | null;
  if (!cols.length || d.radial() || d.unrooted()) {
    existing?.remove();
    return;
  }
  const fs: number = d.shown_font_size;
  const rowH: number = d.scales[0];
  const rtl = d.options.layout === 'right-to-left';
  const shift: number = d.shiftTip(node)[0];
  const x0 = rtl ? 0 : shift + fs * 0.33 + I.labelW1 * fs + 8;
  const sig = `${I.colsVersion}|${x0.toFixed(2)}|${rowH.toFixed(4)}|${fs.toFixed(3)}`;
  if (existing && existing.getAttribute('data-sig') === sig) return;
  existing?.remove();
  const name: string = node.data.name;
  const grp = svgEl('g');
  grp.setAttribute('class', 'pt-cells');
  grp.setAttribute('data-sig', sig);
  let off = x0;
  for (const c of cols) {
    const val = c.values[name];
    if (val !== undefined) {
      if (c.kind === 'bar') {
        const r = svgEl('rect');
        r.setAttribute('class', 'pt-cell-bar');
        r.setAttribute('data-col', c.id);
        r.setAttribute('x', String(off + 1));
        r.setAttribute('y', String(-rowH * 0.4));
        r.setAttribute('width', String(barWidth(Number(val), colMax(c), c.width)));
        r.setAttribute('height', String(Math.max(rowH * 0.8, 0.2)));
        grp.appendChild(r);
      } else if (c.kind === 'text') {
        if (rowH >= 0) {
          const t = svgEl('text');
          t.setAttribute('class', 'pt-cell-text');
          t.setAttribute('data-col', c.id);
          t.setAttribute('x', String(off + 2));
          t.setAttribute('dy', String(fs * 0.33));
          t.style.fontSize = fs + 'px';
          t.textContent = String(val);
          grp.appendChild(t);
        }
      } else {
        const seq = String(val);
        const cw = c.width / Math.max(1, seq.length);
        const wrap = svgEl('g');
        wrap.setAttribute('data-col', c.id);
        const byColour = new Map<string, string>();
        let run = 0;
        for (let j = 1; j <= seq.length; j++) {
          if (j === seq.length || residueColour(seq[j]) !== residueColour(seq[run])) {
            const colr = residueColour(seq[run]);
            const hh = Math.max(rowH * 0.92, 0.2);
            const seg = `M${(off + run * cw).toFixed(2)} ${(-hh / 2).toFixed(3)}h${((j - run) * cw + 0.2).toFixed(2)}v${hh.toFixed(3)}h${(-((j - run) * cw + 0.2)).toFixed(2)}z`;
            byColour.set(colr, (byColour.get(colr) ?? '') + seg);
            run = j;
          }
        }
        for (const [colr, dd] of byColour) {
          const p = svgEl('path');
          p.setAttribute('d', dd);
          p.setAttribute('fill', colr);
          wrap.appendChild(p);
        }
        grp.appendChild(wrap);
      }
    }
    off += c.width + COL_GAP;
  }
  g.appendChild(grp);
}

const maxCache = new WeakMap<ColumnSpec, number>();
function colMax(c: ColumnSpec): number {
  let m = maxCache.get(c);
  if (m === undefined) {
    m = 0;
    for (const k in c.values) m = Math.max(m, Number(c.values[k]));
    maxCache.set(c, m);
  }
  return m;
}

// ------------------------------------------------------------------------------------------------ instance lifecycle

function colsWidth(cols: ColumnSpec[]): number {
  return cols.length ? cols.reduce((s, c) => s + c.width + COL_GAP, 0) + 12 : 0;
}

function layoutKeyOf(P: ViewProps): string {
  const f = P.features;
  return [P.layout, P.branchLengths, P.size.width, P.size.height, f.variant, f.alignTips, f.scaleBar, f.internalLabels, f.ladderize, f.tipMarkers, P.columns.length ? P.columns.map((c) => c.id + c.width).join(',') : '-'].join('|');
}

/** the options that depend on props; called before every update() we trigger */
function applyOptions(I: Inst, P: ViewProps) {
  const d = I.display;
  const f = P.features as FeatureValues;
  const variant = String(f.variant ?? 'standard');
  const unrooted = variant === 'unrooted';
  const radial = !unrooted && P.layout === 'radial';
  const cw = P.columns.length && !radial && !unrooted ? colsWidth(P.columns) : 0;
  d.options.scaling = P.branchLengths;
  d.options['show-scale'] = f.scaleBar === false ? false : 'top';
  d.options.layout = variant === 'mirror' && !radial && !unrooted ? 'right-to-left' : 'left-to-right';
  d.radial(radial);
  d.unrooted(unrooted);
  d.alignTips(cw > 0 || f.alignTips === true);
  d.internalNames(f.internalLabels === true);
  d.options['show-menu'] = f.contextMenu === true;
  d.options.selectable = f.contextMenu === true;
  d.options.reroot = f.contextMenu === true;
  d.options.hide = f.contextMenu === true;
  d.width = Math.max(50, P.size.width - cw);
  d.height = Math.max(50, P.size.height);
  d.set_size([d.height, d.width]);
}

/** wrapper-level level of detail: hide label text while it would be smaller than ~3.5 px (text layout dominates the cost of every zoom step) */
function lod(I: Inst) {
  const d = I.display;
  if (!d || I.destroyed) return;
  const P = I.latest.current;
  let hide = false;
  if (P.features.labelLod !== false) {
    const vb = (d.svg.node() as SVGSVGElement).viewBox.baseVal;
    const s = vb.width > 0 && vb.height > 0 ? Math.min(P.size.width / vb.width, P.size.height / vb.height) : 1;
    const k: number = d.currentZoomTransform?.k ?? 1;
    hide = d.shown_font_size * k * s < 3.5;
  }
  if (I.host.classList.contains('pt-lod-hide') !== hide) I.host.classList.toggle('pt-lod-hide', hide);
}

function tune(I: Inst) {
  const d = I.display;
  d.zoomBehavior?.on('zoom.lod', () => lod(I)); // named listener: keeps the library's own 'zoom' handler
  // the library hard-codes scaleExtent [0.1, 10]; the property is reachable, so widen it (large trees need k in the thousands)
  d.zoomBehavior?.scaleExtent([0.3, 8000]);
  const svg = d.svg.node() as SVGSVGElement;
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Phylogenetic tree, ${I.tree.tipCount} tips (phylotree.js, SVG)`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
}

function bindEvents(I: Inst) {
  const d = I.display;
  const click = (node: HNode, event: MouseEvent, type: 'click' | 'hover') => {
    const isTip = !node.children;
    const nodeId = nodeIdOf(I, node);
    if (nodeId === null) {
      I.stats.unmappedEvents++;
      return;
    }
    const names = tipNamesOf(node);
    const t: EmitEvent['type'] = type === 'click' ? (isTip ? 'tipClick' : 'nodeClick') : isTip ? 'tipHover' : 'nodeHover';
    I.emit({
      type: t,
      nodeId,
      isTip,
      tipIds: names,
      // tip: the name is in the payload (node.data.name). internal node: the payload has only the d3 node; the tip set is
      // obtained by the adapter calling d3's node.leaves() on it, which the library does not do itself.
      source: isTip ? 'library' : 'adapter-derived',
      libraryPayload: { event: type === 'click' ? 'nodeClick' : 'nodeHover', name: node.data.name, depth: node.depth, children: node.children ? node.children.length : 0, x: event?.clientX, y: event?.clientY },
    });
    if (type === 'click' && !isTip && I.latest.current.features.collapseOnClick === true) {
      I.display.toggleCollapse(node).update();
    }
  };
  const onNodeClick = (node: HNode, event: MouseEvent) => click(node, event, 'click');
  const onNodeHover = (node: HNode, event: MouseEvent) => click(node, event, 'hover');
  const onBranchClick = (edge: any, event: MouseEvent) => {
    const node = edge.target as HNode;
    const nodeId = nodeIdOf(I, node);
    if (nodeId === null) {
      I.stats.unmappedEvents++;
      return;
    }
    I.emit({
      type: 'branchClick',
      nodeId,
      isTip: !node.children,
      tipIds: tipNamesOf(node),
      source: 'adapter-derived',
      libraryPayload: { event: 'branchClick', target: node.data.name, depth: node.depth, x: event?.clientX, y: event?.clientY },
    });
  };
  const onRendered = () => {
    I.gMap = null;
    I.eMap = null;
    fixScaleBar(I);
    patchViewBox(I);
    drawHeaders(I);
    lod(I);
  };
  d.on('nodeClick', onNodeClick).on('nodeHover', onNodeHover).on('branchClick', onBranchClick).on('rendered', onRendered);
  const off = () => {
    d.off('nodeClick', onNodeClick).off('nodeHover', onNodeHover).off('branchClick', onBranchClick).off('rendered', onRendered);
  };
  I.offs.push(off);
}

/**
 * The built-in scale bar is wrong in rectangular layouts: draw.js places nodes at `y * scales[1] * .8` but draws the axis
 * over `size[1] - offsets - font` px for the full extent, so ticks are ~20% too long (measured: ultrametric tree of depth 100
 * ends at the "78" tick). The wrapper redraws the axis from the numbers the layout really used.
 */
function fixScaleBar(I: Inst) {
  const d = I.display;
  if (!d.draw_scale_bar || d.radial() || d.unrooted() || !d.options.scaling || d.options.layout === 'right-to-left') return;
  const g = d.svg.select('.' + d.css_classes['tree-scale-bar']);
  if (g.empty()) return;
  const D: number = d._extents?.[1]?.[1];
  const ppu: number = d.scales[1] * 0.8;
  if (!(D > 0) || !(ppu > 0)) return;
  g.selectAll('*').remove();
  const w = D * ppu;
  g.call(axisTop(scaleLinear().domain([0, D]).range([0, w])).ticks(Math.max(2, Math.min(10, Math.floor(w / 70)))).tickFormat(format('~g')) as any);
}

function patchViewBox(I: Inst) {
  const P = I.latest.current;
  const d = I.display;
  const svg = d.svg.node() as SVGSVGElement;
  if (!P.columns.length || d.radial() || d.unrooted()) return;
  const vb = (svg.getAttribute('viewBox') ?? '').split(/[ ,]+/).map(Number);
  if (vb.length !== 4 || vb.some((x) => !Number.isFinite(x))) return;
  const cw = colsWidth(P.columns);
  svg.setAttribute('viewBox', `${vb[0]} ${vb[1] - HEADER_H} ${vb[2] + cw} ${vb[3] + HEADER_H}`);
}

function drawHeaders(I: Inst) {
  const P = I.latest.current;
  const d = I.display;
  const root = d.svg.select('.' + d.css_classes['tree-container']);
  root.selectAll('g.pt-colhead').remove();
  if (!P.columns.length || d.radial() || d.unrooted()) return;
  measureLabels(I, 'cols');
  const fs: number = d.shown_font_size;
  const rtl = d.options.layout === 'right-to-left';
  const x0 = rtl ? 0 : d.right_most_leaf + fs * 0.33 + I.labelW1 * fs + 8;
  const grp = root.append('g').attr('class', 'pt-colhead');
  let off = x0;
  for (const c of P.columns) {
    grp.append('text').attr('x', off + 2).attr('y', -6).attr('data-col-header', c.id).text(c.header);
    off += c.width + COL_GAP;
  }
}

/** call the stylers on the existing DOM (no layout) */
function restyle(I: Inst, edges: boolean, nodes: boolean) {
  const d = I.display;
  const t0 = performance.now();
  const { nodeStyler, edgeStyler } = I.stylers;
  const root = d.svg.node() as SVGSVGElement;
  if (edges) {
    const list = root.querySelectorAll('path.branch, path.branch-selected, path.branch-tagged');
    for (let i = 0; i < list.length; i++) {
      const el = list[i] as any;
      const datum = el.__data__;
      if (datum) edgeStyler(select(el), datum);
    }
  }
  if (nodes) {
    if (I.latest.current.columns.length) measureLabels(I, 'cols');
    const list = root.querySelectorAll('g.node, g.internal-node');
    for (let i = 0; i < list.length; i++) {
      const el = list[i] as any;
      const datum = el.__data__;
      if (datum) nodeStyler(select(el), datum);
    }
  }
  I.stats.restyles++;
  I.stats.lastRestyleMs = performance.now() - t0;
}

/** same, but only for the given library nodes (their own <g> and their incoming branch) */
function restyleSet(I: Inst, edgeNodes: Set<HNode> | null, nodeNodes: Set<HNode> | null) {
  const t0 = performance.now();
  const { nodeStyler, edgeStyler } = I.stylers;
  if (edgeNodes && edgeNodes.size) {
    const em = eMapOf(I);
    for (const n of edgeNodes) {
      const el = em.get(n);
      if (el) edgeStyler(select(el), (el as any).__data__);
    }
  }
  if (nodeNodes && nodeNodes.size) {
    const gm = gMapOf(I);
    for (const n of nodeNodes) {
      const el = gm.get(n);
      if (el) nodeStyler(select(el), n);
    }
  }
  I.stats.restyles++;
  I.stats.lastRestyleMs = performance.now() - t0;
}

function relayout(I: Inst, P: ViewProps, resetZoom: boolean) {
  const d = I.display;
  const t0 = performance.now();
  applyOptions(I, P);
  if (P.columns.length) measureLabels(I, 'cols');
  // ladderize through d3 (the library's own resortChildren sorts by an empty `value` field, so it does nothing useful)
  const lad = String(P.features.ladderize ?? 'none');
  if (lad !== I.ladder) {
    I.ladder = lad;
    I.pt.nodes.count();
    if (lad === 'none') I.pt.nodes.sort((a: HNode, b: HNode) => (a.data.original_child_order ?? 0) - (b.data.original_child_order ?? 0));
    else I.pt.nodes.sort((a: HNode, b: HNode) => (lad === 'asc' ? a.value - b.value : b.value - a.value));
  }
  d.update();
  if (resetZoom && d.zoomBehavior) {
    d.currentZoomTransform = null;
    d.svg.call(d.zoomBehavior.transform, zoomIdentity);
  }
  I.stats.updates++;
  I.stats.lastUpdateMs = performance.now() - t0;
}

function createInstance(host: HTMLDivElement, latest: React.MutableRefObject<ViewProps>): Inst {
  const P = latest.current;
  const hostId = `pt-host-${++hostCounter}`;
  host.id = hostId;
  const t0 = performance.now();
  const cleaned = stripNewickComments(P.newick);
  const pt = new (phylotree as any)(cleaned.text);
  const parseMs = performance.now() - t0; // includes the comment-stripping pass
  if (!pt.nodes || !pt.nodes.children) throw new Error('phylotree could not parse the Newick text (no tree built)');
  const I: Inst = {
    host,
    hostId,
    pt,
    display: null,
    tree: P.tree,
    libOf: [],
    idxOf: new Map(),
    tipNode: new Map(),
    rangeKey: new Map(),
    unmapped: 0,
    colourOf: new Map(),
    hl: new Set(),
    gMap: null,
    eMap: null,
    labelW1: 0,
    labelWKey: '',
    colsVersion: 0,
    applied: { layoutKey: '', clades: null, highlight: null, links: null, columns: null, focusSeq: 0, menu: '' },
    latest,
    emit: P.emit,
    offs: [],
    stats: { updates: 0, lastUpdateMs: 0, restyles: 0, lastRestyleMs: 0, unmappedEvents: 0, rerooted: 0 },
    destroyed: false,
    firstLayoutMs: 0,
    parseMs,
    commentsRemoved: cleaned.removed,
    stylers: null as any,
    ladder: 'none',
  } as Inst;
  I.stylers = makeStylers(I);
  (host as any).__phylotree = I; // debugging aid for tests (read-only use): the instance with pt and display
  buildMaps(I);
  const f = P.features;
  const variant = String(f.variant ?? 'standard');
  const radial = variant !== 'unrooted' && P.layout === 'radial';
  const cw = P.columns.length && !radial && variant !== 'unrooted' ? colsWidth(P.columns) : 0;
  const t1 = performance.now();
  try {
    I.display = pt.render({
      container: '#' + hostId,
      width: Math.max(50, P.size.width - cw),
      height: Math.max(50, P.size.height),
      layout: variant === 'mirror' && !radial ? 'right-to-left' : 'left-to-right',
      'is-radial': radial,
      'is-unrooted': variant === 'unrooted',
      scaling: P.branchLengths,
      zoom: true,
      brush: false,
      responsive: true,
      'left-right-spacing': 'fit-to-size',
      'top-bottom-spacing': 'fit-to-size',
      'show-menu': f.contextMenu === true,
      selectable: f.contextMenu === true,
      reroot: f.contextMenu === true,
      hide: f.contextMenu === true,
      collapsible: true,
      'align-tips': cw > 0 || f.alignTips === true,
      'internal-names': f.internalLabels === true,
      'show-scale': f.scaleBar === false ? false : 'top',
      transitions: false,
      'font-size': 13,
      'node-styler': I.stylers.nodeStyler,
      'edge-styler': I.stylers.edgeStyler,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    throw new Error(`phylotree.render() failed: ${m} (tree: ${P.tree.tipCount} tips, depth ${P.tree.maxDepth}; the library's layout is recursive)`);
  }
  I.firstLayoutMs = performance.now() - t1;
  host.appendChild(I.display.show());
  tune(I);
  bindEvents(I);
  lod(I);
  fixScaleBar(I); // the first update() ran inside the constructor, before our 'rendered' listener existed
  patchViewBox(I);
  drawHeaders(I);
  // library reroot() replaces tree.display; re-bind
  const onReroot = () => {
    if (I.destroyed) return;
    I.offs.forEach((o) => o());
    I.offs.length = 0;
    I.display = I.pt.display;
    I.stats.rerooted++;
    buildMaps(I);
    I.gMap = null;
    I.eMap = null;
    tune(I);
    bindEvents(I);
    I.display.update();
  };
  host.addEventListener('reroot', onReroot);
  I.offs.push(() => host.removeEventListener('reroot', onReroot));
  return I;
}

function destroyInstance(I: Inst) {
  I.destroyed = true;
  I.offs.forEach((o) => o());
  I.offs.length = 0;
  try {
    const svg = I.display?.svg;
    svg?.interrupt?.();
    svg?.on('.zoom', null);
    select(I.host).on('click', null); // capturing click handler added by TreeRender.initialize_svg
    select(I.host).selectAll('*').remove();
  } catch {
    /* ignore */
  }
  I.colourOf.clear();
  I.hl.clear();
  I.idxOf.clear();
  I.tipNode.clear();
  I.libOf = [];
  I.gMap = null;
  I.eMap = null;
  I.display = null;
  I.pt = null;
}

// ------------------------------------------------------------------------------------------------ props -> library

/** returns the library nodes whose clade colour changed */
function setColours(I: Inst, P: ViewProps): Set<HNode> {
  const old = I.colourOf;
  const next = new Map<HNode, string>();
  for (const c of P.colouredClades) {
    const i = I.tree.nodeIndex(c.nodeId);
    const x = I.libOf[i];
    if (!x) continue;
    x.eachBefore((n: HNode) => next.set(n, c.colour));
  }
  const changed = new Set<HNode>();
  for (const [n, c] of old) if (next.get(n) !== c) changed.add(n);
  for (const [n, c] of next) if (old.get(n) !== c) changed.add(n);
  I.colourOf = next;
  return changed;
}

/** returns the tips whose highlight state changed */
function setHighlight(I: Inst, P: ViewProps): Set<HNode> {
  const next = new Set<HNode>();
  for (const id of P.highlightedTips) {
    const x = I.tipNode.get(id);
    if (x) next.add(x);
  }
  const changed = new Set<HNode>();
  for (const n of I.hl) if (!next.has(n)) changed.add(n);
  for (const n of next) if (!I.hl.has(n)) changed.add(n);
  I.hl = next;
  return changed;
}

function focusTip(I: Inst, tipId: string) {
  const d = I.display;
  const x = I.tipNode.get(tipId);
  if (!x || x.screen_x === undefined) return;
  const svg = d.svg.node() as SVGSVGElement;
  const ctm = svg.getScreenCTM();
  const s = ctm ? ctm.a : 1; // client px per user unit
  const vb = svg.viewBox.baseVal;
  const base = d.baseTransform;
  const zt = d.currentZoomTransform ?? { x: 0, y: 0, k: 1 };
  const rowUser = Math.max(d.scales?.[0] ?? 1, 1e-6);
  let k: number;
  if (d.radial() || d.unrooted()) {
    k = Math.min(8000, Math.max(zt.k, 14 / Math.max(1e-6, Math.min(d.shown_font_size, 14) * s) * 1.2));
  } else {
    k = Math.min(8000, Math.max(zt.k, 16 / (rowUser * s)));
  }
  // want: zt'.x + (base.x + screen_x) * k = viewBox centre (user units); same for y. Slight left bias so sibling context shows.
  // with columns on, leave room to the right of the label for them (uniform zoom pushes them far away)
  const cx = vb.x + vb.width * (I.latest.current.columns.length && !d.radial() && !d.unrooted() ? 0.22 : 0.5);
  const cy = vb.y + vb.height * 0.5;
  const tx = cx - (base.x + x.screen_x) * k;
  const ty = cy - (base.y + x.screen_y) * k;
  d.svg.call(d.zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(k));
}

// ------------------------------------------------------------------------------------------------ the View

function PhylotreeView(props: ViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const inst = useRef<Inst | null>(null);
  const latest = useRef(props);
  latest.current = props;

  // create (once per mount; the shell remounts the View for every mount())
  useLayoutEffect(() => {
    const host = hostRef.current!;
    const I = createInstance(host, latest);
    inst.current = I;
    const P = latest.current;
    setColours(I, P);
    setHighlight(I, P);
    I.applied = { layoutKey: layoutKeyOf(P), clades: P.colouredClades, highlight: P.highlightedTips, links: P.tipLinks, columns: P.columns, focusSeq: P.focusRequest?.seq ?? 0, menu: '' };
    I.colsVersion = P.columns.length ? 1 : 0;
    if (P.columns.length || P.colouredClades.length || P.highlightedTips.length || P.tipLinks) {
      // initial state that needs the stylers beyond the first draw
      relayout(I, P, true);
    } else {
      I.ladder = 'none';
      const lad = String(P.features.ladderize ?? 'none');
      if (lad !== 'none') relayout(I, P, true);
    }
    props.handleRef.current = makeHandle(I, latest);
    return () => {
      props.handleRef.current = null;
      destroyInstance(I);
      inst.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // apply changed props (every commit; cheap comparisons)
  useLayoutEffect(() => {
    const I = inst.current;
    if (!I || I.destroyed) return;
    const P = props;
    const A = I.applied;
    const lk = layoutKeyOf(P);
    const colsChanged = A.columns !== P.columns;
    if (colsChanged) I.colsVersion++;
    lod(I);
    // options the library reads at click time: no redraw needed
    {
      const menu = P.features.contextMenu === true;
      const o = I.display.options;
      o['show-menu'] = menu;
      o.selectable = menu;
      o.reroot = menu;
      o.hide = menu;
    }
    const cladeDelta = A.clades !== P.colouredClades ? setColours(I, P) : null;
    const hlDelta = A.highlight !== P.highlightedTips ? setHighlight(I, P) : null;
    if (lk !== A.layoutKey || (colsChanged && (P.columns.length === 0 || A.columns === null))) {
      A.layoutKey = lk;
      relayout(I, P, true);
    } else {
      if (A.links !== P.tipLinks || colsChanged) {
        restyle(I, !!cladeDelta, true);
      } else if (cladeDelta || hlDelta) {
        const nodeSet = new Set<HNode>(cladeDelta ?? []);
        for (const n of hlDelta ?? []) nodeSet.add(n);
        restyleSet(I, cladeDelta, nodeSet);
      }
      if (colsChanged) {
        patchViewBox(I);
        drawHeaders(I);
      }
    }
    A.clades = P.colouredClades;
    A.highlight = P.highlightedTips;
    A.links = P.tipLinks;
    A.columns = P.columns;
    // context menu toggled: library reads options at click time, nothing to redraw
    const seq = P.focusRequest?.seq ?? 0;
    if (seq !== A.focusSeq) {
      A.focusSeq = seq;
      if (P.focusRequest) focusTip(I, P.focusRequest.tipId);
    }
  });

  // ready (the library has parsed and drawn synchronously inside the first layout effect)
  useEffect(() => {
    const I = inst.current!;
    props.onReady({
      parseMs: I.parseMs,
      tips: I.pt.getTips().length,
      notes: `phylotree ${LIB_VERSION}: parseMs = new phylotree(newick) incl. d3.hierarchy; first draw (render + styler pass) ${I.firstLayoutMs.toFixed(0)} ms is inside firstRenderMs; tree built by the shell separately (sharedParseMs=${props.sharedParseMs.toFixed(1)}); id mapping ${I.unmapped ? I.unmapped + ' library nodes unmapped' : 'complete'}${I.commentsRemoved ? `; ${I.commentsRemoved} [..] comments stripped by the wrapper (library keeps them in names)` : ''}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={hostRef} className="pt-root" style={themeVars(props.theme)} data-testid="phylotree-host">
      <style>{CSS}</style>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ introspection

function eMapOf(I: Inst): Map<HNode, SVGPathElement> {
  if (I.eMap) return I.eMap;
  const m = new Map<HNode, SVGPathElement>();
  const list = (I.display.svg.node() as SVGSVGElement).querySelectorAll('path.branch, path.branch-selected, path.branch-tagged');
  for (let i = 0; i < list.length; i++) {
    const el = list[i] as any;
    if (el.__data__) m.set(el.__data__.target, el as SVGPathElement);
  }
  I.eMap = m;
  return m;
}

function gMapOf(I: Inst): Map<HNode, SVGGElement> {
  if (I.gMap) return I.gMap;
  const m = new Map<HNode, SVGGElement>();
  const list = (I.display.svg.node() as SVGSVGElement).querySelectorAll('g.node, g.internal-node, g.node-collapsed, g.node-tagged, g.node-selected');
  for (let i = 0; i < list.length; i++) {
    const el = list[i] as any;
    if (el.__data__) m.set(el.__data__, el as SVGGElement);
  }
  I.gMap = m;
  return m;
}

function inside(r: DOMRect, c: DOMRect): boolean {
  return r.right > c.left && r.left < c.right && r.bottom > c.top && r.top < c.bottom;
}

/** client position of a node's own point (tip anchor), from the layout coordinates and the group's CTM */
function anchorOf(I: Inst, x: HNode): Point | null {
  if (x.screen_x === undefined) return null;
  const svg = I.display.svg.node() as SVGSVGElement;
  const grp = svg.querySelector('.' + I.display.css_classes['tree-container']) as SVGGElement | null;
  const m = grp?.getScreenCTM();
  if (!m) return null;
  return { x: x.screen_x * m.a + x.screen_y * m.c + m.e, y: x.screen_x * m.b + x.screen_y * m.d + m.f };
}

function makeHandle(I: Inst, latest: React.MutableRefObject<ViewProps>): ViewHandle {
  const nodeOf = (t: { kind: 'tip' | 'node'; id: string }): HNode | null => {
    if (I.destroyed) return null;
    if (t.kind === 'tip') return I.tipNode.get(t.id) ?? null;
    if (!I.tree.isNodeId(t.id)) return null;
    return I.libOf[I.tree.nodeIndex(t.id)] ?? null;
  };
  return {
    locate(t): Point | null {
      const x = nodeOf(t);
      if (!x) return null;
      const g = gMapOf(I).get(x);
      if (!g) return null;
      const el = t.kind === 'tip' ? g.querySelector('text') : (g.querySelector('circle:not(.pt-tip):not(.pt-ring)') as Element | null);
      if (!el || (el as SVGElement).style.display === 'none') return null;
      const r = el.getBoundingClientRect();
      const c = I.host.getBoundingClientRect();
      let p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      if (r.width === 0 && r.height === 0) {
        // label hidden by the wrapper LOD: report the tip's anchor point (not clickable until the label is shown)
        const a = anchorOf(I, x);
        if (!a) return null;
        p = a;
      }
      if (p.x < c.left + 1 || p.x > c.right - 1 || p.y < c.top + 1 || p.y > c.bottom - 1) return null;
      return p;
    },
    bounds(t): Rect | null {
      const x = nodeOf(t);
      if (!x) return null;
      const c = I.host.getBoundingClientRect();
      const svg = I.display.svg.node() as SVGSVGElement;
      const grp = svg.querySelector('.' + I.display.css_classes['tree-container']) as SVGGElement | null;
      if (!grp) return null;
      const m = grp.getScreenCTM();
      if (!m) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const pad = Math.max(1, (I.display.scales?.[0] ?? 1) * m.a * 0.5);
      x.each((n: HNode) => {
        if (n.screen_x === undefined || n.hidden || n.notshown) return;
        const px = n.screen_x * m.a + n.screen_y * m.c + m.e;
        const py = n.screen_x * m.b + n.screen_y * m.d + m.f;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      });
      if (!Number.isFinite(x0)) return null;
      if (t.kind === 'tip') {
        const g = gMapOf(I).get(x);
        const tx = g?.querySelector('text')?.getBoundingClientRect();
        if (tx && (tx.width > 0 || tx.height > 0)) return inside(tx, c) ? { x: tx.left, y: tx.top, width: tx.width, height: tx.height } : null;
      }
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      x0 = Math.max(c.left, x0); y0 = Math.max(c.top, y0); x1 = Math.min(c.right, x1); y1 = Math.min(c.bottom, y1);
      if (x1 - x0 < 1 || y1 - y0 < 1) return null;
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    },
    locateCell(colId, tipId): Rect | null {
      const x = I.tipNode.get(tipId);
      if (!x || I.destroyed) return null;
      const g = gMapOf(I).get(x);
      if (!g) return null;
      const cell = g.querySelector(`[data-col="${CSS_ESC(colId)}"]`);
      if (!cell) return null;
      const r = cell.getBoundingClientRect();
      const c = I.host.getBoundingClientRect();
      // a row counts when its centre is inside the container
      const cy = r.top + r.height / 2;
      if (cy < c.top || cy > c.bottom || r.right < c.left || r.left > c.right) return null;
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    },
    custom() {
      const svg = I.display?.svg?.node() as SVGSVGElement | undefined;
      const d = I.display;
      return {
        tips: I.tree.tipCount,
        updates: I.stats.updates,
        lastUpdateMs: Math.round(I.stats.lastUpdateMs),
        lastRestyleMs: Math.round(I.stats.lastRestyleMs),
        drawnNodes: svg ? svg.querySelectorAll('g.node, g.internal-node').length : 0,
        drawnBranches: svg ? svg.querySelectorAll('path.branch').length : 0,
        unmappedLibraryNodes: I.unmapped,
        unmappedEvents: I.stats.unmappedEvents,
        zoomK: d?.currentZoomTransform?.k ?? 1,
        rerooted: I.stats.rerooted,
        firstLayoutMs: Math.round(I.firstLayoutMs),
      };
    },
  };
}

function CSS_ESC(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

// ------------------------------------------------------------------------------------------------ capabilities

const capabilities: CapabilityReport = {
  tipClick: { level: 'yes', how: "display.on('nodeClick') fires for the tip <text>; tips have no marker, so the label is the click target (the wrapper adds a non-interactive dot for display only). Only reachable at a readable zoom." },
  internalNodeClick: { level: 'yes', how: "display.on('nodeClick') fires for the internal-node <circle> (r<=3 user units, shrinks with the row height at the fit view)" },
  branchClick: { level: 'yes', how: "display.on('branchClick', edge) on the branch <path>; the library also toggles its own selection and runs a full update() on every branch click" },
  hover: { level: 'partial', how: "display.on('nodeHover') is mouseenter only (no leave event, no tip circle, so only tip labels and internal-node circles); tooltip is drawn by the shell" },
  descendantTipsInPayload: { level: 'partial', how: "payload is the d3.hierarchy node: tips carry node.data.name; for internal nodes the tip set is not delivered, the wrapper calls d3's node.leaves() on the payload node (events marked adapter-derived)" },
  cladeColouring: { level: 'partial', how: "edge-styler (stroke on every branch below the clade root, incl. its own) + node-styler (internal circles, tip dots, labels) driven from React state; applied by calling the stylers on the existing DOM (no layout). display.refresh() cannot be used: it passes the wrong `this` to the edge-styler" },
  highlightTip: { level: 'partial', how: "node-styler adds ring, row band, bold primary label from React state, no re-layout. The library's own selectNodes() runs a full update() and styles via fixed .node-selected CSS, so it is not used" },
  focusTip: { level: 'partial', how: "no zoom-to-node API: the wrapper computes d3.zoomIdentity from node.screen_x/y and calls display.zoomBehavior.transform. Zoom is uniform (x and y together), so a readable row (16 px) needs k = 16/(row height); at 10k tips k is about 250 and the tree is magnified 250x horizontally too" },
  tipAsLink: { level: 'partial', how: "node-styler wraps the library's <text> in an SVG <a href data-tip-id target=_blank tabindex=0>; real anchors, but only for tips currently in the DOM (all tips are in the DOM unless collapsed or hidden)" },
  customColumns: { level: 'partial', how: "node-styler appends SVG cells (rect / text / path) to each tip <g> at shiftTip() + measured label width, with align-tips on; header row appended from the 'rendered' event; viewBox widened by the wrapper. Rectangular layouts only (not radial/unrooted); no column abstraction in the library; cells are re-created on every update()" },
  alignmentColumn: { level: 'partial', how: "same mechanism: per-tip SVG paths grouped by residue colour (one path per colour per tip), so about 20 elements per tip; fine for a few hundred tips" },
  radialLayout: { level: 'yes', how: "option is-radial (display.radial(true) + update()); also is-unrooted (equal-angle) as a separate feature; columns are not drawn in radial layout" },
  branchLengthToggle: { level: 'partial', how: "option scaling (false = cladogram, tips aligned). If any branch has no length the library silently sets ALL lengths to 1 (Phylotree constructor); negative lengths are clamped to 0" },
  scaleBar: { level: 'partial', how: "built-in d3 axis on top for phylograms (option show-scale), styled by CSS. In rectangular layouts the library draws it ~20% too long (nodes are placed at scales[1]*.8 but the axis spans the full range: a depth-100 ultrametric tree ends at the 78 tick), so the wrapper redraws the axis from the numbers the layout used (not for mirrored layout). Radial axis is a single tick. No dated (time) axis, no tick unit" },
  darkTheme: { level: 'yes', how: "colours come from CSS custom properties on the host element (--pt-*) set from gbifDarkTheme(); the library's own CSS is not imported, all rules are ours, nothing is redrawn on theme switch" },
  cssTokens: { level: 'yes', how: "background, foreground, branch, highlight, fontFamily map to --pt-* custom properties used by our CSS rules over the library's fixed class names (.branch, .node, .internal-node, .phylotree-node-text, .tree-scale-bar ...)" },
  multipleInstances: { level: 'yes', how: "no singleton: one phylotree + one TreeRender + one svg per host; ids are scoped by the host; the only global is a single document listener ('phylotree.event') registered once with a module-level function" },
  cleanUnmount: { level: 'partial', how: "no destroy() upstream: the wrapper removes our listeners, interrupts transitions, removes d3.zoom and the capturing click handler from the host and drops the svg; the shared document listener of the library stays (one, deduplicated)" },
  controlledState: { level: 'partial', how: "colour, highlight, links, columns, layout, lengths, theme, focus are props of our View applied through the stylers/options; the library keeps zoom, collapse, selection and reroot state inside the instance and offers no controlled viewport" },
  zoomToFit: { level: 'partial', how: "fit-to-size spacing plus responsive viewBox fits on mount and on every layout change (the wrapper resets the zoom); the library has no fit() method, the zoom extent is [0.1,10] unless widened through display.zoomBehavior" },
  overviewOrMinimap: { level: 'no', how: "none: every visible node and branch is a DOM element at all zoom levels; only manual collapse/hide reduces it (issue #63 describes a hand-built guide tree)" },
};

export const adapter: CandidateAdapter = {
  candidate: {
    name: 'phylotree.js',
    version: LIB_VERSION,
    license: 'MIT (LICENSE file; package.json has no license field)',
    notes: 'phylotree 2.6.0 + d3 7.9.0 in our own React wrapper (useRef/useLayoutEffect); SVG; no GBIF-specific code in the library.',
  },
  capabilities,
  View: PhylotreeView,
  features: [
    { id: 'variant', label: 'Layout variant', kind: 'select', default: 'standard', options: [{ value: 'standard', label: 'Standard (tabs above)' }, { value: 'mirror', label: 'Mirrored (right-to-left)' }, { value: 'unrooted', label: 'Unrooted (equal-angle)' }], description: "Library layouts: option layout 'right-to-left' and is-unrooted. Mirrored applies to rectangular only; unrooted replaces both tabs.", level: 'yes', how: 'library options layout and is-unrooted' },
    { id: 'alignTips', label: 'Align tip labels (tracer lines)', kind: 'toggle', default: false, description: 'Option align-tips: labels at the right edge with dotted tracers. Forced on while columns are shown.', level: 'yes', how: 'library option align-tips' },
    { id: 'scaleBar', label: 'Scale bar (phylogram)', kind: 'toggle', default: true, description: 'Built-in axis on top, only for phylograms.', level: 'yes', how: 'library option show-scale' },
    { id: 'internalLabels', label: 'Internal node labels', kind: 'toggle', default: false, description: "Option internal-names: shows node names / support values. Caution: internal nodes then take their own row, so the layout changes.", level: 'yes', how: 'library option internal-names (changes row spacing)' },
    { id: 'ladderize', label: 'Ladderize', kind: 'select', default: 'none', options: [{ value: 'none', label: 'File order' }, { value: 'asc', label: 'Smaller clades first' }, { value: 'desc', label: 'Larger clades first' }], description: 'Re-sorts children by clade size.', level: 'partial', how: "library's resortChildren() sorts by an empty `value` field (no effect); the wrapper sorts the d3.hierarchy with count()/sort() and re-lays out. Ids stay valid because nodes are mapped by object" },
    { id: 'collapseOnClick', label: 'Collapse clade on internal-node click', kind: 'toggle', default: false, description: "Calls display.toggleCollapse(node).update() (library collapse: spline blob, compression 0.2). Collapsed tips leave the DOM, so they can't be located.", level: 'yes', how: 'library toggleCollapse' },
    { id: 'contextMenu', label: "Library context menu (collapse, hide, reroot, select)", kind: 'toggle', default: false, description: 'Node click opens the built-in menu (styled with GBIF tokens by us). Reroot replaces the library display object; ids of rerooted clades that no longer match the shared tree are not reported.', level: 'partial', how: 'library show-menu; reroot() rebuilds the TreeRender so the wrapper re-binds on the DOM reroot event' },
    { id: 'labelLod', label: 'Hide unreadable labels (wrapper LOD)', kind: 'toggle', default: LOD_DEFAULT, description: 'Hides label text while it would be under 3.5 px. Text layout dominates the cost of each zoom step; switching this off shows the library as shipped (every label always in the DOM and laid out).', level: 'partial', how: 'wrapper adds a class on the host from a named d3 zoom listener; the library itself has no level of detail' },
    { id: 'tipMarkers', label: 'Tip dots (wrapper-added)', kind: 'toggle', default: true, description: 'The library draws no marker at tips; the wrapper appends a small non-interactive dot in the node-styler.', level: 'partial', how: 'node-styler appends an SVG circle per tip' },
  ],
};
