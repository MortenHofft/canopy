// Labels of a frame, drawn after the tree: tip labels and the labels of collapsed clades (into the frame's `LabelList`, which hit-testing and
// the DOM overlay read), the leader lines of aligned labels, and node labels (support, length, or a function's text). One call each per frame
// from `TreeViewer.paint`; nothing allocates per node. The `Scene` they read, `alignedX` / `alignedR` (where the aligned column or circle is),
// and the dim and highlight tests they share with the branches and markers are in draw.ts.

import { K_NODE, K_STUB, K_SUMMARY, K_TIP } from './lod.ts';
import type { Pt, RadialProjection } from './projection.ts';
import { labelMinPx } from './sizes.ts';
import { internalSupport } from './node-label.ts';
import { alignedR, alignedX, dashOf, dimmed, holdsHighlight, STROKE_CHUNK, type LabelList, type Scene } from './draw.ts';

export const RADIAL_LABEL_CAP = 300;
const MAX_RECT_LABELS = 600;

const LABEL_GAP_PX = 8; // tip (or aligned column) to the start of the text
const LEADER_END_GAP_PX = 3; // a leader stops this far before its label

/** Distance (px) between neighbouring labels, for the density rule: the tip pitch, or with radial aligned labels (`ar`, see alignedR) the
 *  arc between neighbouring tips on their circle (smaller than the tip pitch when the circle is pinned). */
function labelPitch(S: Scene, ar: number): number {
  return Number.isNaN(ar) ? S.proj.tipPitch : S.proj.T.da * ar;
}

/** Draw-list entry `e` is a clade the app collapsed (a summary of its own, not a run and not a clade the level of detail summarised). */
function isCollapsedEntry(S: Scene, e: number): boolean {
  const c = S.proj.L.collapsed;
  return c !== null && S.list.kind[e] === K_SUMMARY && S.list.last[e] < 0 && c[S.list.node[e]] === 1;
}

/** Where draw-list entry `e` is labelled from, into `p`: a tip's dot, or the outer edge of a collapsed clade's triangle on its row. */
function labelAnchor(S: Scene, e: number, collapsed: boolean, p: Pt): void {
  const { proj } = S;
  const i = S.list.node[e];
  if (!collapsed) return proj.nodeXY(i, p);
  proj.summaryExtent(i, -1, 0);
  const d = Math.max(proj.d0 + 2, proj.d1);
  if (proj.kind === 'rectangular') {
    p.x = d;
    p.y = proj.tip(i);
  } else {
    p.x = proj.T.cx + d * proj.L.COS![i];
    p.y = proj.T.cy + d * proj.L.SIN![i];
  }
}

/** The rectangular label of the tip at (x, y) is not drawn: its row is out of view, or (aligned) the column is. */
function labelCulled(T: Scene['proj']['T'], x: number, y: number, ax: number): boolean {
  return y < T.clipT - 4 || y > T.clipB + 4 || (Number.isNaN(ax) ? x > T.clipR : ax + LABEL_GAP_PX > T.clipR);
}

/** Radial: the label of row `i` anchored at `p` (its tip, or the end of a collapsed clade's triangle) is not drawn, as where its text
 *  starts is far out of view. Aligned (`ar` not NaN, see alignedR), `p` is first moved along the ray onto the labels' circle. */
function radialLabelCulled(S: Scene, i: number, ar: number, p: Pt): boolean {
  const { L, T } = S.proj;
  if (!Number.isNaN(ar)) {
    p.x = T.cx + ar * L.COS![i];
    p.y = T.cy + ar * L.SIN![i];
  }
  return p.x < -50 || p.y < -50 || p.x > T.W + 50 || p.y > T.H + 50;
}

/** The leader of draw-list entry `e` (`col`: a collapsed clade): from `a`, just before the label (rectangular: in the column `ax`; radial:
 *  on the circle `ar`, along the ray), to `b`, the tip or the end of the clade's triangle. 0: the label is culled, so no leader; 1: the
 *  label is drawn but there is nothing to lead over (the tip is at or past the label, which is pinned); 2: a leader from a to b. */
function leaderOf(S: Scene, e: number, col: boolean, ax: number, ar: number, a: Pt, b: Pt): number {
  const { proj } = S;
  labelAnchor(S, e, col, b);
  if (proj.kind === 'rectangular') {
    if (labelCulled(proj.T, b.x, b.y, ax)) return 0;
    a.x = ax + LABEL_GAP_PX - LEADER_END_GAP_PX;
    a.y = b.y;
    return b.x < a.x ? 2 : 1;
  }
  const { L, T } = proj;
  const i = S.list.node[e];
  a.x = b.x;
  a.y = b.y;
  if (radialLabelCulled(S, i, ar, a)) return 0;
  const r = ar + LABEL_GAP_PX - LEADER_END_GAP_PX;
  if (Math.hypot(b.x - T.cx, b.y - T.cy) >= r) return 1;
  a.x = T.cx + r * L.COS![i];
  a.y = T.cy + r * L.SIN![i];
  return 2;
}

/** Aligned labels are drawn this frame (in the rectangular column `ax` or on the radial circle `ar`): labels are aligned and their rows
 *  (arcs) are far enough apart for the label density. */
function alignedLabelsShown(S: Scene, ax: number, ar: number): boolean {
  if (Number.isNaN(ax) && Number.isNaN(ar)) return false;
  return labelPitch(S, ar) >= labelMinPx(S.density, S.theme.labelSize);
}

/** Leader lines of aligned labels: a dotted line from each tip (from the end of the triangle of a collapsed clade) to just before its label,
 *  rectangular along the row, radial along the ray. Drawn for the tips that get a label (same density rule, cap and culling as drawLabels),
 *  below the dots. Dimmed tips' leaders are drawn at dimOpacity. Batched into one path per chunk, as the branches are. */
export function drawLeaders(ctx: CanvasRenderingContext2D, S: Scene): void {
  const ax = alignedX(S),
    ar = alignedR(S);
  if (!alignedLabelsShown(S, ax, ar)) return;
  const { proj, list, theme } = S;
  const hasCollapsed = S.cladeText !== null && proj.L.collapsed !== null; // collapsed clades are labelled
  const maxL = proj.kind === 'rectangular' ? MAX_RECT_LABELS : RADIAL_LABEL_CAP;
  const a: Pt = { x: 0, y: 0 },
    b: Pt = { x: 0, y: 0 };
  ctx.strokeStyle = theme.leaderColour || theme.muted;
  ctx.lineWidth = theme.leaderWidth;
  ctx.setLineDash(dashOf(theme.leaderDash));
  const passes = S.hlPrefix ? 2 : 1; // second pass: the dimmed entries
  for (let pass = 0; pass < passes; pass++) {
    ctx.globalAlpha = pass ? theme.leaderOpacity * theme.dimOpacity : theme.leaderOpacity;
    ctx.beginPath();
    let n = 0,
      labelled = 0;
    for (let e = 0; e < list.count && labelled < maxL; e++) {
      const col = list.kind[e] !== K_TIP;
      if (col && !(hasCollapsed && isCollapsedEntry(S, e))) continue;
      const got = leaderOf(S, e, col, ax, ar, a, b);
      if (got === 0) continue;
      labelled++;
      if (got === 1 || (passes > 1 && dimmed(S, e) !== pass)) continue;
      ctx.moveTo(a.x, a.y); // from the label back to the tip, so the dash pattern lines up at the labels
      ctx.lineTo(b.x, b.y);
      if (++n >= STROKE_CHUNK) {
        ctx.stroke();
        ctx.beginPath();
        n = 0;
      }
    }
    if (n) ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

/** The font size (px) of a label with `pitch` px between neighbouring labels: the theme's, less where the pitch is tight (never under 8). */
function labelFontSize(labelSize: number, pitch: number): number {
  return Math.max(8, Math.min(labelSize, Math.round(pitch * 0.78)));
}

/** Radial, labels at their tips: the font size of the label of tip `i` (`col`: of the clade whose triangle ends at `i`'s radius, XMAX), from
 *  the arc to the next tip at that radius; 0 when the arc is under `need`, so no label. */
function tipLabelSize(S: Scene, i: number, col: boolean, need: number): number {
  const { proj } = S;
  const room = proj.T.da * (col ? proj.L.XMAX[i] * proj.T.k : proj.depth(i));
  return room < need ? 0 : labelFontSize(S.theme.labelSize, room);
}

/** The label fonts (normal and highlighted) for the current size; `use` rebuilds the strings only when the size changes. */
class LabelFonts {
  size = 0;
  normal = '';
  bold = '';
  constructor(
    private readonly style: string,
    private readonly family: string,
  ) {}
  use(size: number): void {
    if (size === this.size) return;
    this.size = size;
    this.normal = `${this.style}${size}px ${this.family}`;
    this.bold = `${this.style}600 ${size}px ${this.family}`;
  }
}

/** Tip labels for drawn tips when rows (or arcs) are tall enough. Fills `labels` for hit-testing and the overlay.
 *  Aligned (`alignLabels`, a phylogram): rectangular, the text starts in one column (alignedX); radial, on one circle (alignedR), still
 *  along the tip's ray. Radial: only when the angular pitch per tip is at least the font size, at most RADIAL_LABEL_CAP labels, and one
 *  setTransform per label instead of save/translate/rotate/restore (cos/sin come from the layout cache). */
export function drawLabels(ctx: CanvasRenderingContext2D, S: Scene, labels: LabelList): void {
  const { proj, list, theme, classOf, colours, highlight } = S;
  const { tree, L, T } = proj;
  labels.clear();
  const rect = proj.kind === 'rectangular';
  const ax = alignedX(S); // NaN: labels follow their tips
  const ar = alignedR(S);
  const pitch = labelPitch(S, ar);
  const need = labelMinPx(S.density, S.theme.labelSize);
  // radial, labels at their tips: the room is the arc at the tip's own radius, tested per tip (#110); the view's radii say when none has any
  const perTip = !rect && Number.isNaN(ar);
  if (perTip ? proj.minTipDepth(need) === Infinity : pitch < need) return;
  const hasCollapsed = S.cladeText !== null && L.collapsed !== null; // collapsed clades are labelled
  const fonts = new LabelFonts(theme.labelFontStyle === 'italic' ? 'italic ' : '', theme.fontFamily);
  fonts.use(labelFontSize(theme.labelSize, pitch));
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const p: Pt = { x: 0, y: 0 };
  const MAXL = rect ? MAX_RECT_LABELS : RADIAL_LABEL_CAP;
  const sc = S.scale;
  let lastFont = '';
  let lastFill = '';
  let lastAlign = 'left';
  let lastAlpha = 1;
  for (let e = 0; e < list.count && labels.count < MAXL; e++) {
    const col = list.kind[e] !== K_TIP; // a collapsed clade is labelled like a tip, at the end of its triangle
    if (col && !(hasCollapsed && isCollapsedEntry(S, e))) continue;
    const i = list.node[e];
    const r = col ? -1 : tree.tipRank[i];
    labelAnchor(S, e, col, p);
    if (rect ? labelCulled(T, p.x, p.y, ax) : radialLabelCulled(S, i, ar, p)) continue; // radial aligned: p is now on the circle
    if (perTip) {
      const sz = tipLabelSize(S, i, col, need);
      if (sz === 0) continue;
      fonts.use(sz);
    }
    const size = fonts.size;
    const hl = col ? highlight !== null && holdsHighlight(S, i) : highlight ? highlight[r] === 1 : false;
    const f = hl ? fonts.bold : fonts.normal;
    if (f !== lastFont) {
      ctx.font = f;
      lastFont = f;
    }
    const text = col ? S.cladeText!(i) : S.format(tree.tipLabels[r] ?? '');
    const w = S.measure.width(ctx, text, f);
    if (f !== lastFont) {
      ctx.font = f;
      lastFont = f;
    } // measure.width may have set the font
    const cl = classOf ? classOf[i] : 0;
    const fill = hl ? theme.highlight : cl ? colours[cl] : theme.foreground;
    if (fill !== lastFill) {
      ctx.fillStyle = fill;
      lastFill = fill;
    }
    const alpha = S.hlPrefix && (col ? dimmed(S, e) === 1 : S.hlPrefix[r + 1] === S.hlPrefix[r]) ? theme.dimOpacity : 1;
    if (alpha !== lastAlpha) {
      ctx.globalAlpha = alpha;
      lastAlpha = alpha;
    }
    // aligned: the text starts at the column (the circle), which is right of (outside) every tip and every triangle, unless pinned
    const gap = LABEL_GAP_PX;
    const key = col ? -(i + 1) : r;
    if (rect) {
      const x = Number.isNaN(ax) ? p.x + gap : ax + gap;
      ctx.fillText(text, x, p.y + 0.5);
      labels.add(key, x, p.y, w, size + 2, 0, 0, gap);
    } else {
      const left = L.COS![i] < 0;
      const c = left ? -L.COS![i] : L.COS![i],
        sn = left ? -L.SIN![i] : L.SIN![i];
      ctx.setTransform(sc * c, sc * sn, -sc * sn, sc * c, sc * p.x, sc * p.y);
      const al = left ? 'right' : 'left';
      if (al !== lastAlign) {
        ctx.textAlign = al;
        lastAlign = al;
      }
      ctx.fillText(text, left ? -gap : gap, 0.5);
      const a = proj.tip(i);
      labels.add(key, p.x, p.y, w, size + 2, left ? a + Math.PI : a, left ? 1 : 0, gap);
    }
  }
  if (!rect) ctx.setTransform(sc, 0, 0, sc, 0, 0);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------------------------------ node labels

const NODE_LABEL_GAP_PX = 3; // a support value ends this far left of its node
const NODE_LABEL_PAD_PX = 3; // free space the text keeps on each side within its branch (at least the node marker's radius + 1, see `pad`)
const NODE_LABEL_LIFT_PX = 2; // from the branch line up to the text's baseline
const NODE_LABEL_MIN_SEG_PX = 10; // a branch shorter than this is not looked at (no digit fits)

/** The text of the internal node at snapshot row `row`, or null for none. 'support' reads the snapshot's `support` array when it has one
 *  (else the numeric prefix of the label), 'length' its `length`; a function gets the node's full-tree id. A value that is not finite
 *  gives none. */
function nodeText(S: Scene, row: number): string | null {
  const t = S.proj.tree;
  const mode = S.nodeLabels;
  if (mode === 'support' || mode === 'length') {
    const v = mode === 'length' ? t.length[row] : t.support ? t.support[row] : internalSupport(t.labels[row] ?? '');
    return Number.isFinite(v) ? S.formatNode(v, mode) : null;
  }
  if (mode === 'none') return null;
  const r = mode(t.globalId === null ? row : t.globalId[row], t);
  if (typeof r === 'number') return Number.isFinite(r) ? S.formatNode(r, 'support') : null;
  return r ? r : null;
}

/** Draw-list entry `e` can get a node label: in the tip pass a tip, else an expanded internal node (not a run), a clade the app collapsed,
 *  or, when `stubs` (a length, rectangular), a stub: it is drawn as its branch only, and when its node is right of the plot (checked by the
 *  caller) the visible part of a long stem still holds a length, the same as it did while the node was a pixel nearer. */
function nodeLabelled(S: Scene, e: number, tips: boolean, stubs: boolean): boolean {
  const kind = S.list.kind[e];
  if (tips) return kind === K_TIP;
  if (kind === K_NODE) return S.list.last[e] < 0;
  return isCollapsedEntry(S, e) || (stubs && kind === K_STUB);
}

/** Radial: the room across the branch of draw-list entry `i` of kind `kind` (`r1` its radius, `room` its length; px). An expanded node:
 *  its arc at its radius. A tip: one row's angle at the middle of its branch, where its label sits (the frame's tipPitch is the angle at
 *  the outer radius, too wide for a tip near the centre). A collapsed clade or a stub: not limited. */
function acrossPx(proj: RadialProjection, kind: number, i: number, r1: number, room: number): number {
  if (kind === K_TIP) return proj.T.da * (r1 - room / 2);
  if (kind !== K_NODE) return Infinity;
  return proj.tipSpan(proj.tree.firstChild[i], proj.L.LAST[i]) * r1;
}

/** Node labels (`nodeLabels`) for the nodes of the draw list, which are expanded nodes, collapsed clades (on their own stem) and tips, so
 *  never a node inside a summary, a run or a collapsed clade. Shown only with room, by the label-density rule of tip labels: rectangular, tip rows at least `labelMinPx` (scaled with the theme's `labelSize`) apart
 *  and the text fits the visible part of the node's horizontal segment; radial, the node's arc at least that long and the text fits the
 *  branch. Support sits left of the node above its branch; a length is centred on the branch (radial: rotated along it, upright on the
 *  left half like tip labels). A length is placed by one rule at every zoom: centred on the visible part of its branch (rectangular; the
 *  whole branch, radial) if the text plus `pad` on both sides fits there, else not drawn (there is no placement at the node). Tips get a
 *  length by the same rule (their tip label is right of the tip, so the branch is free) once tip rows are far enough apart for tip labels;
 *  support and a function's text stay on internal nodes. The root has no branch and no label. At most MAX_RECT_LABELS (RADIAL_LABEL_CAP)
 *  labels, found by one pass over the draw list for the internal nodes and then one for the tips, so tips never use up the cap before the
 *  internal branches are labelled; the text is made only after the cheap geometry tests. */
export function drawNodeLabels(ctx: CanvasRenderingContext2D, S: Scene): void {
  const mode = S.nodeLabels;
  if (mode === 'none') return;
  const { proj, list, theme } = S;
  const { tree, L, T } = proj;
  const rect = proj.kind === 'rectangular';
  const need = labelMinPx(S.density, theme.labelSize);
  if (rect && proj.tipPitch < need) return;
  const size = Math.max(8, Math.min(theme.nodeLabelSize, rect ? Math.round(proj.tipPitch * 0.78) : Infinity));
  const font = `${size}px ${theme.fontFamily}`;
  ctx.font = font;
  ctx.textBaseline = 'bottom';
  const maxN = rect ? MAX_RECT_LABELS : RADIAL_LABEL_CAP;
  const sc = S.scale;
  const centred = mode === 'length'; // a function's text is placed and coloured like support
  const { namedNode } = S;
  const plainMarker = namedNode ? theme.unnamedNodeMarkerSize : theme.nodeMarkerSize; // the marker a node has unless it is named (namedNodeMarkers)
  const plainGap = Math.max(NODE_LABEL_GAP_PX, plainMarker / 2 + 1); // a support value clears the node's marker
  const plainPad = Math.max(NODE_LABEL_PAD_PX, plainMarker / 2 + 1); // a length keeps clear of the node marker at one end and the connector at the other
  const namedGap = namedNode ? Math.max(NODE_LABEL_GAP_PX, theme.namedNodeMarkerSize / 2 + 1) : plainGap; // a named node's larger marker
  const namedPad = namedNode ? Math.max(NODE_LABEL_PAD_PX, theme.namedNodeMarkerSize / 2 + 1) : plainPad;
  const fitTip = 2 * Math.max(plainPad, theme.tipRadius + 1); // a tip's length (the only label of a tip) keeps clear of the tip dot too
  const colSupport = theme.supportColour || theme.muted,
    colLength = theme.lengthColour || theme.muted;
  const p: Pt = { x: 0, y: 0 },
    q: Pt = { x: 0, y: 0 };
  const { parent } = tree;
  let n = 0;
  let lastFill = '';
  let lastAlpha = 1;
  let lastAlign = '';
  const passes = centred && proj.tipPitch >= need ? 2 : 1; // the second pass labels tip branches with their length
  for (let pass = 0; pass < passes; pass++)
    for (let e = 0; e < list.count && n < maxN; e++) {
      if (!nodeLabelled(S, e, pass === 1, centred && rect)) continue;
      const kind = list.kind[e];
      const i = list.node[e];
      if (i === 0) continue;
      let x0 = 0, // rectangular: the visible part of the segment; radial: the label's origin
        y0 = 0,
        room = 0,
        c = 1,
        sn = 0;
      proj.nodeXY(i, p);
      if (rect) {
        if (kind === K_STUB && p.x <= T.clipR) continue; // a clade cut by size, not one pushed out of view
        proj.parentXY(i, q);
        if (p.y < T.clipT - 4 || p.y > T.clipB + 4 || p.x < T.clipL || q.x > T.clipR) continue;
        x0 = Math.max(q.x, T.clipL);
        room = (centred ? Math.min(p.x, T.clipR) : p.x) - x0;
        if (!centred && p.x > T.clipR) continue; // the node is out of view: its support would float in the air
        y0 = p.y - NODE_LABEL_LIFT_PX;
      } else {
        const r1 = proj.depth(i);
        room = r1 - proj.depth(parent[i]);
        if (room < NODE_LABEL_MIN_SEG_PX || acrossPx(proj, kind, i, r1, room) < need) continue; // no room along the branch or across
        c = L.COS![i];
        sn = L.SIN![i];
        x0 = centred ? p.x - (c * room) / 2 : p.x;
        y0 = centred ? p.y - (sn * room) / 2 : p.y;
        if (x0 < -20 || y0 < -20 || x0 > T.W + 20 || y0 > T.H + 20) continue;
      }
      if (room < NODE_LABEL_MIN_SEG_PX) continue;
      const text = nodeText(S, i);
      if (text === null) continue;
      const w = S.measure.width(ctx, text, font);
      const big = namedNode && kind !== K_TIP && namedNode(i) === true; // this node has the larger marker
      const gap = big ? namedGap : plainGap;
      const fit = centred ? 2 * (big ? namedPad : plainPad) : gap + NODE_LABEL_PAD_PX; // the room a label needs besides its text
      if (w + (kind === K_TIP ? fitTip : fit) > room) continue; // no room: not drawn, never moved to the node
      const fill = centred ? colLength : colSupport;
      if (fill !== lastFill) {
        ctx.fillStyle = fill;
        lastFill = fill;
      }
      const alpha = S.hlPrefix !== null && dimmed(S, e) ? theme.dimOpacity : 1;
      if (alpha !== lastAlpha) {
        ctx.globalAlpha = alpha;
        lastAlpha = alpha;
      }
      if (rect) {
        const al = centred ? 'center' : 'right';
        if (al !== lastAlign) {
          ctx.textAlign = al;
          lastAlign = al;
        }
        ctx.fillText(text, centred ? (x0 + Math.min(p.x, T.clipR)) / 2 : p.x - gap, y0);
      } else {
        const left = c < 0; // the left half is read upside down otherwise: turn the text round
        const cf = left ? -c : c,
          sf = left ? -sn : sn;
        ctx.setTransform(sc * cf, sc * sf, -sc * sf, sc * cf, sc * x0, sc * y0);
        // support: its end at the node, which is the end of the branch away from the root (the start of the text when turned round)
        const al = centred ? 'center' : left ? 'left' : 'right';
        if (al !== lastAlign) {
          ctx.textAlign = al;
          lastAlign = al;
        }
        ctx.fillText(text, centred ? 0 : left ? gap : -gap, -NODE_LABEL_LIFT_PX);
      }
      n++;
    }
  if (!rect) ctx.setTransform(sc, 0, 0, sc, 0, 0);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}
