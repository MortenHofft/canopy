// CPU hit-testing of the graph the library has already laid out (getGraphAfterLayout), used instead of deck.gl's GPU picking.
// OURS, not the library's. Why: (1) the library only reports leaves and edges, never internal nodes, and at the fit view of a
// dense tree many edges fall inside the 2 px picking radius; (2) deck.gl runs a synchronous GPU pick on every pointerdown and on
// every frame after the pointer moved, and with a software GL (or a huge tree) that blocks input and makes the click recogniser
// drop clicks (see docs/results/phylocanvas-gl.md). The candidate geometry is exactly what edges-layer draws (layers/edges/edges-layer).
//
// Iterative, no recursion; one linear scan over the visible subtree (about 5 ms for 380k nodes).

export interface Hit {
  node: any;
  layer: 'shapes' | 'labels' | 'edges' | 'piecharts';
}

const TWO_PI = Math.PI * 2;

function d2seg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/**
 * @param lib   Phylocanvas instance
 * @param px,py pointer position in canvas CSS px
 * @param measure width in px of a label (for label hits in rectangular/diagonal layouts), or null to skip labels
 */
export function hitTest(lib: any, px: number, py: number, measure: ((label: string) => number) | null, edgeTolPx = 4): Hit | null {
  const graph = lib.getGraphAfterLayout();
  const pre = graph.preorderTraversal as any[];
  const root = graph.root;
  const type: string = lib.getTreeType();
  const scale: number = lib.getScale();
  const [wx, wy] = lib.unprojectPoint([px, py]);
  const nodeSize: number = lib.getNodeSize();

  // ---- 1. tips: marker disc, or the label box in rectangular/diagonal layouts
  const tipTol = Math.max(nodeSize / 2, 2) + 3;
  const tipTolW = tipTol / scale;
  const rowsAligned = type === 'rc' || type === 'dg';
  let bestTip: any = null;
  let bestTipD = Infinity;
  let bestLabel = false;
  const fs = lib.props.fontSize ?? 12;
  const labelsOn = !!(lib.props.showLabels && lib.props.showLeafLabels);
  const pitchPx = rowsAligned ? lib.getStepScale() * scale : 0;
  const rowHalfPx = Math.max(pitchPx / 2, 3);
  const align = lib.getAlignLeafLabels();
  const bScale = lib.getBranchScale();
  const leaves = graph.leaves as any[];
  const yTolW = rowsAligned && labelsOn && pitchPx >= 9 ? Math.max(rowHalfPx, fs / 2) / scale : tipTolW;
  for (let i = 0; i < leaves.length; i++) {
    const n = leaves[i];
    const dy = n.y - wy;
    if (dy > yTolW || dy < -yTolW) {
      if (rowsAligned) continue;
      if (dy > tipTolW || dy < -tipTolW) continue;
    }
    const dx = n.x - wx;
    if (!rowsAligned && (dx > tipTolW || dx < -tipTolW)) continue;
    const dpx = Math.hypot(dx, dy) * scale;
    if (dpx <= tipTol && dpx < bestTipD) {
      bestTip = n;
      bestTipD = dpx;
      bestLabel = false;
      continue;
    }
    if (rowsAligned && labelsOn && measure && pitchPx >= 9) {
      // label starts nodeSize px right of the (aligned) tip
      const startW = n.x + (align ? bScale * (root.totalSubtreeLength - n.distanceFromRoot) : 0) + nodeSize / scale;
      const w = measure(n.label ?? n.id) / scale;
      if (wx >= startW - 2 / scale && wx <= startW + w && Math.abs(dy) * scale < bestTipD + 0.0001) {
        const d = Math.abs(dy) * scale + 3; // markers win over labels at equal distance
        if (d < bestTipD) {
          bestTip = n;
          bestTipD = d;
          bestLabel = true;
        }
      }
    }
  }
  if (bestTip) return { node: bestTip, layer: bestLabel ? 'labels' : 'shapes' };

  // ---- 2. collapsed clades (pie charts) and branches
  const tol = edgeTolPx / scale;
  const tol2 = tol * tol;
  let best: any = null;
  let bestD = Infinity;
  let bestLayer: Hit['layer'] = 'edges';
  const first = root.preIndex;
  const last = root.preIndex + root.totalNodes;
  const cx = root.x;
  const cy = root.y;
  let wr = 0;
  let wa = 0;
  if (type === 'cr') {
    wr = Math.hypot(wx - cx, wy - cy);
    wa = Math.atan2(wy - cy, wx - cx);
    if (wa < 0) wa += TWO_PI;
  }
  for (let i = first; i < last; i++) {
    const n = pre[i];
    if (n.isHidden) continue;
    if (n.isCollapsed) {
      const rad = (nodeSize / 2 + (n.ratio || 0) * (nodeSize / 2) + 2) / scale;
      const dd = Math.hypot(n.x - wx, n.y - wy);
      if (dd <= rad && dd < bestD) {
        best = n;
        bestD = dd;
        bestLayer = 'piecharts';
        continue;
      }
    }
    const p = n.parent;
    if (i === first) {
      // root line (rectangular/diagonal/hierarchical draw a 10 px stub)
      if (type === 'rc' || type === 'dg') {
        const d = d2seg(wx, wy, n.x, n.y, n.x - 10, n.y);
        if (d <= tol2 && d < bestD * bestD) (best = n), (bestD = Math.sqrt(d)), (bestLayer = 'edges');
      } else if (type === 'hr') {
        const d = d2seg(wx, wy, n.x, n.y, n.x, n.y - 10);
        if (d <= tol2 && d < bestD * bestD) (best = n), (bestD = Math.sqrt(d)), (bestLayer = 'edges');
      }
      continue;
    }
    let d = Infinity;
    switch (type) {
      case 'rc': {
        if (wy < Math.min(n.y, p.y) - tol || wy > Math.max(n.y, p.y) + tol) {
          // only the horizontal piece (at n.y) can be near
          if (Math.abs(wy - n.y) > tol) break;
        }
        d = Math.min(d2seg(wx, wy, p.x, n.y, n.x, n.y), d2seg(wx, wy, p.x, p.y, p.x, n.y));
        break;
      }
      case 'hr': {
        d = Math.min(d2seg(wx, wy, n.x, p.y, n.x, n.y), d2seg(wx, wy, p.x, p.y, n.x, p.y));
        break;
      }
      case 'cr': {
        d = d2seg(wx, wy, n.x, n.y, n.cx, n.cy);
        const ch = n.children;
        if (ch && ch.length > 1) {
          const a0 = ch[0].angle;
          const a1 = ch[ch.length - 1].angle;
          if (wa >= a0 && wa <= a1) {
            const dr = wr - n.dist;
            d = Math.min(d, dr * dr);
          }
        }
        break;
      }
      default:
        d = d2seg(wx, wy, p.x, p.y, n.x, n.y);
    }
    if (d <= tol2) {
      const dd = Math.sqrt(d);
      // nearest wins; at (almost) equal distance prefer the smaller clade (the more specific branch)
      if (dd < bestD - 1e-9 || (Math.abs(dd - bestD) <= 1e-9 && best && n.totalLeaves < best.totalLeaves)) {
        best = n;
        bestD = dd;
        bestLayer = 'edges';
      }
    }
  }
  return best ? { node: best, layer: bestLayer } : null;
}
