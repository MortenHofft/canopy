// Unit tests of the equal-angle unrooted layout (src/unrooted.ts, #42): a small tree checked by hand, branches at their lengths, wedges
// nested and disjoint, no crossing branches on random trees, the unit-length fallback, and the same picture from another root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'packages/io/src/newick.ts'));
const { unrootedLayout } = await import(path.join(root, 'packages/viewer/src/unrooted.ts'));

const TAU = 2 * Math.PI;
const EPS = 1e-9;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < EPS, `${msg}: ${a} != ${b}`);

function node(t, label) {
  const i = t.labels.indexOf(label);
  assert.ok(i >= 0, `no node ${label}`);
  return i;
}

test('a small tree, checked by hand', () => {
  // T = 4, unit = pi/2. Root wedges: AB [0, pi), C [pi, 3pi/2), D [3pi/2, 2pi). AB's: A [0, pi/2), B [pi/2, pi).
  const t = parseNewick('((A:1,B:2)AB:1,C:1,D:3)root;');
  const L = unrootedLayout(t);
  assert.equal(L.usedLengths, true);
  close(L.unit, Math.PI / 2, 'unit');
  const p = (label) => [L.X[node(t, label)], L.Y[node(t, label)]];
  const at = (label, x, y) => {
    const [px, py] = p(label);
    close(px, x, `${label}.x`);
    close(py, y, `${label}.y`);
  };
  const s = Math.SQRT1_2;
  at('root', 0, 0);
  at('AB', 0, 1); // middle of [0, pi): pi/2
  at('A', s, 1 + s); // pi/4
  at('B', -2 * s, 1 + 2 * s); // 3pi/4
  at('C', -s, -s); // 5pi/4
  at('D', 3 * s, -3 * s); // 7pi/4
  close(L.W0[node(t, 'C')], Math.PI, 'wedge of C');
  close(L.W0[node(t, 'B')], Math.PI / 2, 'wedge of B');
  close(L.minX, -2 * s, 'minX');
  close(L.maxX, 3 * s, 'maxX');
  close(L.minY, -3 * s, 'minY');
  close(L.maxY, 1 + 2 * s, 'maxY');
});

test('a degree-2 root lies on a straight line between its children', () => {
  const t = parseNewick('((A:1,B:1,C:1)X:2,(D:1,E:1)Y:3)root;');
  const L = unrootedLayout(t);
  const x = node(t, 'X'),
    y = node(t, 'Y');
  // collinear and on opposite sides: the cross product is 0 and the dot product -|X||Y|
  close(L.X[x] * L.Y[y] - L.Y[x] * L.X[y], 0, 'cross');
  close(L.X[x] * L.X[y] + L.Y[x] * L.Y[y], -2 * 3, 'dot');
});

/** A random tree as Newick: `tips` tips, polytomies of up to `maxKids`, positive lengths; `skew` makes ladders likelier. */
function randomNewick(rand, tips, maxKids, skew) {
  const parts = [];
  for (let i = 0; i < tips; i++) parts.push(`t${i}`);
  let k = 0;
  while (parts.length > 1) {
    const m = Math.min(parts.length, 2 + Math.floor(rand() * (maxKids - 1)));
    const take = [];
    for (let j = 0; j < m; j++) {
      const at = skew ? parts.length - 1 : Math.floor(rand() * parts.length);
      take.push(parts.splice(at, 1)[0] + ':' + (0.05 + rand() * 2).toFixed(3));
    }
    parts.push(`(${take.join(',')})n${k++}`);
  }
  return parts[0] + ';';
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** Do segments p1-p2 and p3-p4 cross at a point inside both (touching at a shared end does not count)? */
function crosses(ax, ay, bx, by, cx, cy, dx, dy) {
  const o = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(cx, cy, dx, dy, ax, ay),
    d2 = o(cx, cy, dx, dy, bx, by),
    d3 = o(ax, ay, bx, by, cx, cy),
    d4 = o(ax, ay, bx, by, dx, dy);
  const tol = 1e-9;
  return ((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) && ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol));
}

for (const [name, maxKids, skew] of [
  ['binary', 2, false],
  ['polytomies', 5, false],
  ['ladders', 3, true],
]) {
  test(`random trees (${name}): branches at their lengths, wedges nested and disjoint, no crossings`, () => {
    const rand = lcg(name.length * 7919);
    let wide = 0; // non-root nodes whose wedge is wider than pi (a non-convex cone)
    for (let rep = 0; rep < 25; rep++) {
      const t = parseNewick(randomNewick(rand, 5 + Math.floor(rand() * 60), maxKids, skew));
      const L = unrootedLayout(t);
      const n = t.nodeCount;
      close(L.W0[0], 0, 'root wedge');
      for (let i = 0; i < n; i++) {
        // the children's wedges tile the parent's in order
        let a = L.W0[i];
        for (let c = t.firstChild[i]; c >= 0; c = t.nextSibling[c]) {
          close(L.W0[c], a, `wedge start of ${c}`);
          a += (t.leafEnd[c] - t.leafStart[c]) * L.unit;
        }
        if (t.firstChild[i] >= 0) close(a, L.W0[i] + (t.leafEnd[i] - t.leafStart[i]) * L.unit, `wedges of ${i}'s children fill it`);
        if (i > 0 && (t.leafEnd[i] - t.leafStart[i]) * L.unit > Math.PI) wide++;
        if (i > 0) {
          const p = t.parent[i];
          close(Math.hypot(L.X[i] - L.X[p], L.Y[i] - L.Y[p]), t.length[i], `length of branch ${i}`);
          // the branch points along the middle of the node's wedge
          const mid = L.W0[i] + ((t.leafEnd[i] - t.leafStart[i]) * L.unit) / 2;
          close(Math.cos(mid) * (L.Y[i] - L.Y[p]) - Math.sin(mid) * (L.X[i] - L.X[p]), 0, `direction of branch ${i}`);
        }
      }
      close(L.W0[0] + t.tipCount * L.unit, TAU, 'root wedge is the circle');
      for (let i = 1; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const pi = t.parent[i],
            pj = t.parent[j];
          if (pi === pj || pi === j || pj === i) continue; // share a node
          assert.ok(
            !crosses(L.X[pi], L.Y[pi], L.X[i], L.Y[i], L.X[pj], L.Y[pj], L.X[j], L.Y[j]),
            `branches to ${i} and ${j} cross (${name}, rep ${rep})`,
          );
        }
    }
    // the ladders are there for this case: no crossings although some wedges are wider than pi
    if (skew) assert.ok(wide > 0, 'some ladder has a wedge wider than pi');
  });
}

test('without lengths every branch has length 1', () => {
  for (const [newick, lengths] of [
    ['((A,B)AB,(C,(D,E)DE)CDE,F)root;', true], // no lengths in the tree
    ['((A:1,B:2)AB:1,C:1,D:3)root;', false], // lengths not asked for
    ['((A:0,B:0)AB:0,C:0)root;', true], // every length 0
  ]) {
    const t = parseNewick(newick);
    const L = unrootedLayout(t, lengths);
    assert.equal(L.usedLengths, false, newick);
    for (let i = 1; i < t.nodeCount; i++) {
      const p = t.parent[i];
      close(Math.hypot(L.X[i] - L.X[p], L.Y[i] - L.Y[p]), 1, `${newick} branch ${i}`);
    }
  }
});

test('a missing or negative length counts as 0', () => {
  const t = parseNewick('((A:1,B:-2)AB,C:1)root;');
  const L = unrootedLayout(t);
  assert.equal(L.usedLengths, true);
  const ab = node(t, 'AB'),
    b = node(t, 'B');
  close(L.X[ab], 0, 'AB has no length: on the root');
  close(L.Y[ab], 0, 'AB has no length: on the root');
  close(L.X[b], L.X[ab], 'B has a negative length: on AB');
  close(L.Y[b], L.Y[ab], 'B has a negative length: on AB');
});

test('the same unrooted tree from another root gives the same picture (tip distances)', () => {
  // One unrooted tree, written rooted at z and rooted at y, keeping the cyclic order of the neighbours at every node.
  const a = parseNewick('(A:1,B:2,(C:1,(D:3,E:0.5)w:1)y:1.5)z;');
  const b = parseNewick('(C:1,(D:3,E:0.5)w:1,(A:1,B:2)z:1.5)y;');
  const La = unrootedLayout(a),
    Lb = unrootedLayout(b);
  const tips = ['A', 'B', 'C', 'D', 'E'];
  for (const u of tips)
    for (const v of tips) {
      const da = Math.hypot(La.X[node(a, u)] - La.X[node(a, v)], La.Y[node(a, u)] - La.Y[node(a, v)]);
      const db = Math.hypot(Lb.X[node(b, u)] - Lb.X[node(b, v)], Lb.Y[node(b, u)] - Lb.Y[node(b, v)]);
      close(da, db, `${u}-${v}`);
    }
});

test('a single node and a single tip', () => {
  const L = unrootedLayout(parseNewick('A;'));
  assert.equal(L.n, 1);
  assert.equal(L.X[0], 0);
  assert.equal(L.Y[0], 0);
  close(L.unit, TAU, 'unit');
});
