// CPU hit-testing of the graph the library has already laid out (getGraphAfterLayout), used instead of deck.gl's GPU picking.
// OURS, not the library's. Why: (1) the library only reports leaves and edges, never internal nodes, and at the fit view of a
// dense tree many edges fall inside the 2 px picking radius; (2) deck.gl runs a synchronous GPU pick on every pointerdown and on
// every frame after the pointer moved, and with a software GL (or a huge tree) that blocks input and makes the click recogniser
// drop clicks (see docs/results/phylocanvas-gl.md). The candidate geometry is exactly what edges-layer draws (layers/edges/edges-layer).
//
// Iterative, no recursion. The library keeps coordinates on node objects (pointer chasing), so a scan costs 30 ms at 50k tips.
// The layout is therefore copied once per layout into typed arrays (cache keyed by the graph object, which the library replaces on
// every re-layout) and each query is a linear scan over flat arrays.

export interface Hit {
  node: any;
  layer: 'shapes' | 'labels' | 'edges' | 'piecharts';
}

const TWO_PI = Math.PI * 2;
const SKIP = 1; // hidden by a collapsed ancestor
const COLLAPSED = 2;
const ARC = 4; // circular layout: internal node with an arc between its first and last child

interface Index {
  graph: any;
  type: string;
  first: number; // preorder index of the root of the drawn subtree
  m: number; // nodes in that subtree
  nodes: any[]; // preorder slice start = first
  flag: Uint8Array;
  x: Float64Array;
  y: Float64Array;
  px: Float64Array; // parent position
  py: Float64Array;
  cx: Float64Array; // circular: parent-radius point on the node's own angle
  cy: Float64Array;
  dist: Float64Array; // circular: radius of the node
  a0: Float64Array; // circular: angle of the first and last child
  a1: Float64Array;
  ratio: Float64Array; // collapsed pie size
  leaves: any[];
  lx: Float64Array;
  ly: Float64Array;
}

let cache: Index | null = null;

function build(lib: any, graph: any): Index {
  const pre = graph.preorderTraversal as any[];
  const root = graph.root;
  const type: string = lib.getTreeType();
  const first = root.preIndex;
  const m = root.totalNodes;
  const f = new Uint8Array(m);
  const x = new Float64Array(m), y = new Float64Array(m), px = new Float64Array(m), py = new Float64Array(m);
  const circ = type === 'cr';
  const cx = new Float64Array(circ ? m : 0), cy = new Float64Array(circ ? m : 0), dist = new Float64Array(circ ? m : 0);
  const a0 = new Float64Array(circ ? m : 0), a1 = new Float64Array(circ ? m : 0);
  const ratio = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const n = pre[first + k];
    if (n.isHidden) f[k] |= SKIP;
    if (n.isCollapsed) f[k] |= COLLAPSED;
    x[k] = n.x;
    y[k] = n.y;
    const p = n.parent;
    if (p && k > 0) {
      px[k] = p.x;
      py[k] = p.y;
    }
    if (n.isCollapsed) ratio[k] = n.ratio || 0;
    if (circ) {
      cx[k] = n.cx;
      cy[k] = n.cy;
      dist[k] = n.dist;
      const ch = n.children;
      if (ch && ch.length > 1) {
        f[k] |= ARC;
        a0[k] = ch[0].angle;
        a1[k] = ch[ch.length - 1].angle;
      }
    }
  }
  const leaves = graph.leaves as any[];
  const lx = new Float64Array(leaves.length), ly = new Float64Array(leaves.length);
  for (let i = 0; i < leaves.length; i++) {
    lx[i] = leaves[i].x;
    ly[i] = leaves[i].y;
  }
  return { graph, type, first, m, nodes: pre, flag: f, x, y, px, py, cx, cy, dist, a0, a1, ratio, leaves, lx, ly };
}

function d2seg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/**
 * @param lib   Phylocanvas instance
 * @param px,py pointer position in canvas CSS px
 * @param measure width in px of a label (for label hits in rectangular/diagonal layouts), or null to skip labels
 */
export function hitTest(lib: any, px: number, py: number, measure: ((label: string) => number) | null, edgeTolPx = 4): Hit | null {
  const graph = lib.getGraphAfterLayout();
  if (!cache || cache.graph !== graph) cache = build(lib, graph);
  const I = cache;
  const type = I.type;
  const root = graph.root;
  const scale: number = lib.getScale();
  const [wx, wy] = lib.unprojectPoint([px, py]);
  const nodeSize: number = lib.getNodeSize();

  // ---- 1. tips: marker disc, or the label box in rectangular/diagonal layouts
  const tipTol = Math.max(nodeSize / 2, 2) + 3;
  const tipTolW = tipTol / scale;
  const rowsAligned = type === 'rc' || type === 'dg';
  const fs = lib.props.fontSize ?? 12;
  const labelsOn = !!(lib.props.showLabels && lib.props.showLeafLabels);
  const pitchPx = rowsAligned ? lib.getStepScale() * scale : 0;
  const rowHalfPx = Math.max(pitchPx / 2, 3);
  const align = lib.getAlignLeafLabels();
  const bScale = lib.getBranchScale();
  const withLabels = rowsAligned && labelsOn && !!measure && pitchPx >= 9;
  const yTolW = withLabels ? Math.max(rowHalfPx, fs / 2) / scale : tipTolW;
  const lx = I.lx, ly = I.ly;
  let bestTip = -1;
  let bestTipD = Infinity;
  let bestLabel = false;
  for (let i = 0; i < lx.length; i++) {
    const dy = ly[i] - wy;
    if (dy > yTolW || dy < -yTolW) continue;
    const dx = lx[i] - wx;
    if (!withLabels && (dx > tipTolW || dx < -tipTolW)) continue;
    const dpx = Math.hypot(dx, dy) * scale;
    if (dpx <= tipTol && dpx < bestTipD) {
      bestTip = i;
      bestTipD = dpx;
      bestLabel = false;
      continue;
    }
    if (withLabels) {
      const n = I.leaves[i];
      // label starts nodeSize px right of the (aligned) tip
      const startW = lx[i] + (align ? bScale * (root.totalSubtreeLength - n.distanceFromRoot) : 0) + nodeSize / scale;
      const w = measure!(n.label ?? n.id) / scale;
      if (wx >= startW - 2 / scale && wx <= startW + w) {
        const d = Math.abs(dy) * scale + 3; // markers win over labels at equal distance
        if (d < bestTipD) {
          bestTip = i;
          bestTipD = d;
          bestLabel = true;
        }
      }
    }
  }
  if (bestTip >= 0) return { node: I.leaves[bestTip], layer: bestLabel ? 'labels' : 'shapes' };

  // ---- 2. collapsed clades (pie charts) and branches
  const tol = edgeTolPx / scale;
  const tol2 = tol * tol;
  let best = -1;
  let bestD = Infinity;
  let bestLayer: Hit['layer'] = 'edges';
  const { m, flag, x, y, ratio } = I;
  const ppx = I.px, ppy = I.py;
  let wr = 0;
  let wa = 0;
  if (type === 'cr') {
    wr = Math.hypot(wx - root.x, wy - root.y);
    wa = Math.atan2(wy - root.y, wx - root.x);
    if (wa < 0) wa += TWO_PI;
  }
  for (let k = 0; k < m; k++) {
    const fl = flag[k];
    if (fl & SKIP) continue;
    if (fl & COLLAPSED) {
      const rad = (nodeSize / 2 + ratio[k] * (nodeSize / 2) + 2) / scale;
      const dd = Math.hypot(x[k] - wx, y[k] - wy);
      if (dd <= rad && dd < bestD) {
        best = k;
        bestD = dd;
        bestLayer = 'piecharts';
        continue;
      }
    }
    const nx = x[k], ny = y[k];
    if (k === 0) {
      // root line (rectangular/diagonal/hierarchical draw a 10 px stub)
      let d = Infinity;
      if (type === 'rc' || type === 'dg') d = d2seg(wx, wy, nx, ny, nx - 10, ny);
      else if (type === 'hr') d = d2seg(wx, wy, nx, ny, nx, ny - 10);
      if (d <= tol2 && Math.sqrt(d) < bestD) (best = k), (bestD = Math.sqrt(d)), (bestLayer = 'edges');
      continue;
    }
    const qx = ppx[k], qy = ppy[k];
    let d = Infinity;
    switch (type) {
      case 'rc': {
        // quick reject: the horizontal piece is at ny, the connector spans qy..ny at qx
        if (wy < (ny < qy ? ny : qy) - tol || wy > (ny > qy ? ny : qy) + tol) break;
        d = Math.min(d2seg(wx, wy, qx, ny, nx, ny), d2seg(wx, wy, qx, qy, qx, ny));
        break;
      }
      case 'hr':
        d = Math.min(d2seg(wx, wy, nx, qy, nx, ny), d2seg(wx, wy, qx, qy, nx, qy));
        break;
      case 'cr': {
        d = d2seg(wx, wy, nx, ny, I.cx[k], I.cy[k]);
        if (fl & ARC && wa >= I.a0[k] && wa <= I.a1[k]) {
          const dr = wr - I.dist[k];
          if (dr * dr < d) d = dr * dr;
        }
        break;
      }
      default:
        d = d2seg(wx, wy, qx, qy, nx, ny);
    }
    if (d <= tol2) {
      const dd = Math.sqrt(d);
      // nearest wins; at (almost) equal distance prefer the smaller clade (the more specific branch)
      if (dd < bestD - 1e-9 || (Math.abs(dd - bestD) <= 1e-9 && best >= 0 && I.nodes[I.first + k].totalLeaves < I.nodes[I.first + best].totalLeaves)) {
        best = k;
        bestD = dd;
        bestLayer = 'edges';
      }
    }
  }
  return best >= 0 ? { node: I.nodes[I.first + best], layer: bestLayer } : null;
}
