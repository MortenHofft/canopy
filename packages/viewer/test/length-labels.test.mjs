// The placement rule of length labels (`nodeLabels: 'length'`, #53), read from the draw calls of the recording context: in every frame a
// length is centred on the visible part of its own horizontal branch (radial: on the branch) when the text plus the padding fits there,
// and is not drawn otherwise. It is never moved to the node, so it never meets the node marker or a tip label, however the view is zoomed.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');

afterEach(destroyAll);

// Lengths are unique, so a drawn text names its node. The harness measures 6 px per character.
const TREE = '(((a:5,b:9)n1:40.1,(c:2,d:7)n2:3.3)n3:20.7,((e:12,f:4)n4:60.2,g:30)n5:1.5)r;';
const CHAR_PX = 6;
const PAD = 3; // marker size 4 (default): max(3, 4 / 2 + 1)

async function make(options = {}, tree = TREE) {
  const m = await makeViewer(tree, {
    options: { axis: false, nodeLabels: 'length', formatNodeLabel: (v) => String(v), layout: 'rectangular', ...options },
    size: [700, 360],
  });
  m.env.flush();
  return m;
}

/** Redraw and return the length labels of that frame as { node, text, cx, cy, w } (centre of the text) and the tip labels' left edges. */
function frame(m) {
  const ctx = m.ctx();
  ctx.reset();
  m.viewer.invalidate();
  m.env.flush();
  const t = m.viewer.getTree();
  const byText = new Map();
  for (let i = 1; i < t.nodeCount; i++) if (t.firstChild[i] >= 0) byText.set(String(t.length[i]), i);
  const labels = [],
    tips = [];
  let align = 'start',
    tf = null;
  for (const e of ctx.log) {
    if (e[0] === 'textAlign=') align = e[1];
    else if (e[0] === 'setTransform') tf = e.slice(1);
    else if (e[0] === 'fillText' && e[1] !== '') {
      if (byText.has(e[1]) && align === 'center') labels.push({ node: byText.get(e[1]), text: e[1], x: e[2], y: e[3], w: e[1].length * CHAR_PX, tf });
      else if (align === 'left' || align === 'start') tips.push({ text: e[1], x: e[2], y: e[3], w: e[1].length * CHAR_PX });
    }
  }
  return { labels, tips };
}

/** Where a length label of node i should be centred (rectangular): the visible part of its horizontal branch. */
function branch(m, i) {
  const { proj } = m.viewer;
  const T = proj.T;
  const p = { x: 0, y: 0 },
    q = { x: 0, y: 0 };
  proj.nodeXY(i, p);
  proj.parentXY(i, q);
  const a = Math.max(q.x, T.clipL),
    b = Math.min(p.x, T.clipR);
  return { a, b, mid: (a + b) / 2, room: b - a, px: p.x, y: p.y };
}

function internalNodes(m) {
  const t = m.viewer.getTree();
  const out = [];
  for (let i = 1; i < t.nodeCount; i++) if (t.firstChild[i] >= 0) out.push(i);
  return out;
}

const textOf = (m, i) => String(m.viewer.getTree().length[i]);

/** Every internal node in view gets its label exactly when it fits, centred on the visible branch; a margin of 1 px around the limit is not asserted. */
function assertRule(m, where) {
  const { labels } = frame(m);
  const T = m.viewer.proj.T;
  for (const i of internalNodes(m)) {
    const b = branch(m, i);
    if (b.y < T.clipT || b.y > T.clipB || b.px < T.clipL || b.a > T.clipR) continue;
    const need = textOf(m, i).length * CHAR_PX + 2 * PAD;
    const l = labels.find((x) => x.node === i);
    if (b.room >= need + 1) {
      assert.ok(l, `${where}: node ${i} (${textOf(m, i)}) fits (${b.room.toFixed(1)} >= ${need}) but is not drawn`);
      assert.ok(Math.abs(l.x - b.mid) <= 1e-6, `${where}: node ${i} centred at ${l.x}, branch middle ${b.mid}`);
    } else if (b.room <= need - 1) {
      assert.ok(!l, `${where}: node ${i} does not fit (${b.room.toFixed(1)} < ${need}) but is drawn at ${l && l.x}`);
    }
  }
  for (const l of labels) {
    const b = branch(m, l.node);
    assert.ok(Math.abs(l.x - b.mid) <= 1e-6, `${where}: ${l.text} off the middle`);
    assert.ok(l.x + l.w / 2 <= b.b - PAD + 1e-6 && l.x - l.w / 2 >= b.a + PAD - 1e-6, `${where}: ${l.text} sticks out of its branch`);
  }
  return labels;
}

test('internal branches: centred on the branch whenever the text and the padding fit, not drawn otherwise', async () => {
  const m = await make();
  const labels = assertRule(m, 'fitted');
  assert.ok(labels.length >= 4, `labels drawn: ${labels.length}`);
});

test('1.01x steps of x zoom never move a label off the middle of its branch while it fits (and none appears at the node)', async () => {
  const m = await make();
  const T = m.viewer.proj.T;
  let seen = 0;
  for (let k = 0; k < 90; k++) {
    const vp = m.viewer.getViewport();
    const cx = vp.x0 + (vp.x1 - vp.x0) * 0.8; // zoom about a point on the right so tips and long branches cross the edge
    m.viewer.setViewport({ ...vp, x0: cx - (cx - vp.x0) / 1.01, x1: cx + (vp.x1 - cx) / 1.01 });
    seen += assertRule(m, `step ${k}`).length;
  }
  assert.ok(seen > 200, `labels checked: ${seen}`);
  assert.ok(T.kx > 0);
});

test('a label never meets the node marker or a tip label, and its whole text is left of its node', async () => {
  for (const marker of [4, 10]) {
    const m = await makeViewer(TREE, {
      options: { axis: false, nodeLabels: 'length', formatNodeLabel: (v) => String(v), layout: 'rectangular' },
      theme: { nodeMarkerSize: marker },
      size: [700, 360],
    });
    m.env.flush();
    const r = marker / 2;
    for (let k = 0; k < 40; k++) {
      const vp = m.viewer.getViewport();
      m.viewer.setViewport({ ...vp, x1: vp.x0 + (vp.x1 - vp.x0) / 1.05 });
      const { labels, tips } = frame(m);
      for (const l of labels) {
        const b = branch(m, l.node);
        assert.ok(l.x + l.w / 2 <= b.px - r, `marker ${marker}: ${l.text} reaches the node marker`);
        for (const t of tips) {
          const clear = Math.abs(t.y - l.y) > 8 || t.x >= l.x + l.w / 2 || t.x + t.w <= l.x - l.w / 2;
          assert.ok(clear, `marker ${marker}: ${l.text} overlaps the tip label ${t.text}`);
        }
      }
    }
  }
});

test('a larger marker takes more room: the padding is at least the marker radius + 1', async () => {
  // the room of node 1 is set by the viewport, as in node-labels.test.mjs; '1' is 6 px wide
  const drawnAt = async (marker, room) => {
    const m = await makeViewer('((a:30,b:30)1:1,(c:30,d:30)1:1)r;', {
      options: { axis: false, nodeLabels: 'length', formatNodeLabel: (v) => String(v), layout: 'rectangular' },
      theme: { nodeMarkerSize: marker },
      size: [700, 360],
    });
    m.env.flush();
    for (let k = 0; k < 4; k++) {
      const vp = m.viewer.getViewport();
      m.viewer.setViewport({ ...vp, x1: vp.x0 + ((vp.x1 - vp.x0) * branch(m, 1).room) / room });
      m.viewer.renderNow();
    }
    assert.ok(Math.abs(branch(m, 1).room - room) < 0.5, `room ${branch(m, 1).room}`);
    m.ctx().reset();
    m.viewer.invalidate();
    m.env.flush();
    return m.ctx().log.some((e) => e[0] === 'fillText' && e[1] === '1');
  };
  // marker 4 needs 6 + 2 * 3 = 12, marker 12 needs 6 + 2 * 7 = 20
  assert.equal(await drawnAt(4, 13.5), true);
  assert.equal(await drawnAt(12, 13.5), false);
  assert.equal(await drawnAt(12, 21.5), true);
});

test('a node pushed far past the right edge (a stub of the draw list) keeps its length on the visible part of its stem, at every distance', async () => {
  const m = await make();
  const T = m.viewer.proj.T;
  const t = m.viewer.getTree();
  let n4 = -1;
  for (let i = 1; i < t.nodeCount; i++) if (t.length[i] === 60.2) n4 = i;
  assert.ok(n4 > 0);
  const kx0 = T.kx;
  let drawn = 0;
  for (let k = 0; k < 40; k++) {
    // x zoom from the left edge: the node's x grows 1.04x per step, from inside the plot to far past it (more than the 8 px of cut padding)
    const vp = m.viewer.getViewport();
    m.viewer.setViewport({ ...vp, x0: 0, x1: Math.max(1e-3, vp.x1 / 1.04) });
    const labels = assertRule(m, `zoom ${k}`);
    if (labels.some((l) => l.node === n4)) drawn++;
  }
  const p = { x: 0, y: 0 };
  m.viewer.proj.nodeXY(n4, p);
  assert.ok(p.x > m.viewer.proj.T.clipR + 100, `n4 ended ${p.x - m.viewer.proj.T.clipR} px past the edge`);
  assert.ok(drawn >= 30, `n4 kept its label for ${drawn} of 40 steps`);
  assert.ok(m.viewer.proj.T.kx > kx0);
});

test('a collapsed clade shows its length centred on its stem, at every zoom', async () => {
  const m = await make();
  const t = m.viewer.getTree();
  let n1 = -1;
  for (let i = 1; i < t.nodeCount; i++) if (t.length[i] === 40.1) n1 = i;
  m.viewer.setCollapsed([n1]);
  m.env.flush();
  let seen = 0;
  for (let k = 0; k < 40; k++) {
    const vp = m.viewer.getViewport();
    m.viewer.setViewport({ ...vp, x1: vp.x0 + (vp.x1 - vp.x0) / 1.03 });
    const labels = assertRule(m, `collapsed ${k}`);
    seen += labels.filter((l) => l.node === n1).length;
  }
  assert.ok(seen > 5, `the collapsed clade's length was drawn in ${seen} frames`);
});

test('tips get no length label, so none can sit on a tip marker or over a tip label', async () => {
  const m = await make();
  const { labels } = frame(m);
  const t = m.viewer.getTree();
  assert.ok(labels.length > 0);
  assert.ok(labels.every((l) => t.firstChild[l.node] >= 0));
  const all = m.ctx().log.filter((e) => e[0] === 'fillText' && /^\d/.test(e[1]));
  assert.ok(all.every((e) => internalNodes(m).some((i) => textOf(m, i) === e[1])));
});

test('radial: the same rule along the branch, at 1.01x steps', async () => {
  const m = await make({ layout: 'radial' });
  m.env.flush();
  const p = { x: 0, y: 0 },
    q = { x: 0, y: 0 };
  let seen = 0;
  for (let k = 0; k < 60; k++) {
    const vp = m.viewer.getViewport();
    const c = 0.5;
    m.viewer.setViewport({ ...vp, x0: c - (c - vp.x0) / 1.01, x1: c + (vp.x1 - c) / 1.01, y0: c - (c - vp.y0) / 1.01, y1: c + (vp.y1 - c) / 1.01 });
    const { labels } = frame(m);
    const { proj } = m.viewer; // the projection is rebuilt with the view
    for (const l of labels) {
      proj.nodeXY(l.node, p);
      proj.parentXY(l.node, q);
      const len = Math.hypot(p.x - q.x, p.y - q.y);
      assert.ok(
        Math.abs(l.tf[4] - (p.x + q.x) / 2) < 1e-6 && Math.abs(l.tf[5] - (p.y + q.y) / 2) < 1e-6,
        `step ${k}: ${l.text} at the middle of its branch`,
      );
      assert.ok(l.w + 2 * PAD <= len + 1e-6, `step ${k}: ${l.text} (${l.w + 2 * PAD}) fits its branch (${len})`);
      assert.equal(l.x, 0);
      seen++;
    }
  }
  assert.ok(seen > 30, `radial labels checked: ${seen}`);
});

// A clade the level of detail cuts as a stub while its node is in view has no stem label: only a stub pushed out of view to the right
// does (see above). `minCladePx` above the clades' height cuts all three clades; their stems are long, so room is not what leaves them out.
const CUT = '((a:1,b:1)x:60,(c:1,d:1)y:40,(e:50,f:50)z:20)r;';
test('a stub cut by size, node in view: no length (with or without summaries)', async () => {
  assert.deepEqual((await make({}, CUT).then(frame)).labels.map((l) => l.text).sort(), ['20', '40', '60'], 'uncut: all three are labelled');
  for (const showSummaries of [false, true]) {
    const m = await make({ showSummaries, minCladePx: 150 }, CUT);
    const texts = frame(m).labels.map((l) => l.text);
    assert.deepEqual(texts, [], `showSummaries ${showSummaries}: cut clades have no stem label`);
  }
});

test('radial: a stub never gets the rectangular stub-path label', async () => {
  const m = await make({ layout: 'radial', showSummaries: false, minCladePx: 150 }, CUT);
  assert.deepEqual(
    frame(m).labels.map((l) => l.text),
    [],
  );
});
