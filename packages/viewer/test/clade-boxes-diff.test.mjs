// Differential test of drawCladeBoxes (#43): on random trees, random nested clade sets, random views and both layouts, with and without
// collapsed clades, the boxes it fills are exactly those of a naive loop that draws every box (written below), in the same order. Boxes are
// at least a pixel across the tips here, so nothing is merged and the two must agree fill for fill. The same box list is drawn on a layout
// without collapsed clades, then on one with, then again without, as the viewer does when `setCollapsed` swaps the layout. Seeded, so it is
// the same on every run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const core = path.join(root, 'packages/viewer/src');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { computeLayout, radialFan, setLayoutFan } = await import(path.join(core, 'layout.ts'));
const { makeTransform } = await import(path.join(core, 'geom.ts'));
const { projectionFor } = await import(path.join(core, 'projection.ts'));
const { drawCladeBoxes, ringSector } = await import(path.join(core, 'draw.ts'));
const { FALLBACK_THEME } = await import(path.join(core, 'types.ts'));
const { CLAMP_Y_PAD_PX } = await import(path.join(core, 'constants.ts'));
const { recordingContext } = await import('./viewer-harness.mjs');

const W = 400,
  H = 400;
const REACH = 50;
const COLOURS = ['', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff'];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random tree of `n` tips with polytomies and branch lengths, as Newick (built with a stack, no recursion). */
function randomTree(n, r) {
  let items = [...Array(n).keys()].map((i) => `t${i}:${(0.1 + r()).toFixed(3)}`);
  while (items.length > 1) {
    const k = Math.min(items.length, 2 + Math.floor(r() * (r() < 0.2 ? 4 : 1)));
    const at = Math.floor(r() * (items.length - k + 1));
    const group = `(${items.slice(at, at + k).join(',')}):${(0.1 + r()).toFixed(3)}`;
    items = [...items.slice(0, at), group, ...items.slice(at + k)];
  }
  return parseNewick(items[0].replace(/:[\d.]+$/, '') + ';');
}

const clampY = (y) => (y < -CLAMP_Y_PAD_PX ? -CLAMP_Y_PAD_PX : y > H + CLAMP_Y_PAD_PX ? H + CLAMP_Y_PAD_PX : y);

/** Every box, culled as a box on its own, filled in list order. */
function naive(ctx, S) {
  const { proj, theme } = S;
  const pad = theme.cladeBackgroundPadding;
  const B = S.cladeBoxes;
  for (let k = 0; k < B.rows.length; k++) {
    proj.summaryExtent(B.rows[k], -1, 0);
    const { t0, t1 } = proj;
    if (proj.kind === 'rectangular') {
      const { T } = proj;
      const x0 = Math.max(proj.d0 - pad, -CLAMP_Y_PAD_PX),
        x1 = Math.min(T.clipR, proj.d1 + REACH);
      if (!(x1 > x0) || x1 <= T.clipL || x0 >= T.clipR || t1 <= T.clipT || t0 >= T.clipB) continue;
      ctx.fillStyle = COLOURS[B.cls[k]];
      ctx.fillRect(x0, clampY(t0), x1 - x0, clampY(t1) - clampY(t0));
    } else {
      const x0 = Math.max(0, proj.d0 - pad),
        x1 = proj.d1 + REACH;
      if (x1 <= proj.rMin || x0 >= proj.rMax) continue;
      if (!proj.all && (proj.wrap ? t1 <= proj.lo && t0 >= proj.hi : t1 <= proj.lo || t0 >= proj.hi)) continue;
      ctx.fillStyle = COLOURS[B.cls[k]];
      ctx.beginPath();
      ringSector(ctx, proj, x0, x1, t0, t1);
      ctx.fill();
    }
  }
}

/** The fills of a recorded log: colour and shape (the fillRect, or the path since the last beginPath). */
function fills(ctx) {
  let fill = '',
    pathOps = [];
  const out = [];
  const round = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
  for (const e of ctx.log) {
    if (e[0] === 'fillStyle=') fill = e[1];
    else if (e[0] === 'beginPath') pathOps = [];
    else if (['moveTo', 'lineTo', 'arc', 'closePath'].includes(e[0])) pathOps.push(e.map(round));
    else if (e[0] === 'fillRect') out.push([fill, e.slice(1).map(round)]);
    else if (e[0] === 'fill') out.push([fill, pathOps]);
  }
  return out;
}

function compare(tree, L, boxes, kind, view) {
  const T = makeTransform(
    kind,
    W,
    H,
    view,
    { ax: 10, ay: 0, aw: kind === 'radial' ? W : 300, ah: H, clipL: 0, clipT: 0, clipR: kind === 'radial' ? W : 360, clipB: H },
    L.rows,
    L.fan,
  );
  const proj = projectionFor(tree, L, T);
  const S = { proj, theme: FALLBACK_THEME, colours: COLOURS, cladeBoxes: boxes, labelReach: REACH, hlPrefix: null, alignLabels: false, labelRoom: 0 };
  const a = recordingContext({}),
    b = recordingContext({});
  drawCladeBoxes(a, S);
  naive(b, S);
  return { got: fills(a), want: fills(b), proj };
}

test('drawCladeBoxes fills exactly the boxes a naive loop over every box fills (random trees, clades, views, collapsed layouts)', () => {
  const r = rng(4343);
  let runs = 0,
    wrapped = 0,
    drawn = 0;
  for (let t = 0; t < 120; t++) {
    const n = 8 + Math.floor(r() * 100);
    const tree = randomTree(n, r);
    // a random clade set (tips and internal nodes), in preorder, and a random set of collapsed clades
    const nodes = [];
    for (let i = 0; i < tree.nodeCount; i++) if (r() < 0.3) nodes.push(i);
    if (!nodes.length) nodes.push(0);
    const boxes = {
      rows: Int32Array.from(nodes),
      cls: Uint8Array.from(nodes.map(() => 1 + Math.floor(r() * 5))),
      up: new Int32Array(nodes.length),
      upFor: null,
    };
    const mask = new Uint8Array(tree.nodeCount);
    for (let i = 1; i < tree.nodeCount; i++) if (tree.firstChild[i] >= 0 && r() < 0.15) mask[i] = 1;
    const plain = computeLayout(tree, true, null),
      collapsed = computeLayout(tree, true, mask);
    const fan = radialFan(r() < 0.5 ? 0 : r() * 0.5, Math.floor(r() * 360));
    setLayoutFan(plain, fan);
    setLayoutFan(collapsed, fan);
    for (const L of [plain, collapsed, plain]) {
      for (let v = 0; v < 6; v++) {
        const kind = v % 2 ? 'radial' : 'rectangular';
        let view;
        if (kind === 'rectangular') {
          const h = 2 + r() * (L.rows + 4),
            y0 = -3 + r() * (L.rows + 3);
          const x0 = -0.3 + r() * 0.8;
          view = { x0, x1: x0 + 0.2 + r() * 1.2, y0, y1: y0 + h };
        } else {
          // the outer radius between 100 and 100,000 px (far off past RADIAL_FAR_ARC_R); the window anywhere around the tree
          const k = (100 * Math.pow(1000, r())) / L.XMAX[0];
          const cx = (-1.3 + 2.6 * r()) * L.XMAX[0],
            cy = (-1.3 + 2.6 * r()) * L.XMAX[0];
          view = { x0: cx - W / 2 / k, x1: cx + W / 2 / k, y0: cy - H / 2 / k, y1: cy + H / 2 / k };
        }
        const { got, want, proj } = compare(tree, L, boxes, kind, view);
        runs++;
        if (kind === 'radial' && proj.wrap) wrapped++;
        drawn += want.length;
        assert.deepEqual(got, want, `tree ${t}, ${kind}, view ${JSON.stringify(view)}, ${L === collapsed ? 'collapsed' : 'plain'} layout`);
      }
    }
  }
  assert.ok(wrapped >= 20, `${wrapped} radial windows across the opening of the fan`);
  assert.ok(drawn > runs, `${drawn} boxes drawn in ${runs} runs`);
});
