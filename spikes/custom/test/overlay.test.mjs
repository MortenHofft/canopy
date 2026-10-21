// Unit tests of the label overlay (src/core/overlay.ts) with a minimal fake document: elements record their attributes, style, children and
// focus. It checks the element pool (reuse by tip rank, removal, focus kept alive), the transforms of both layouts, link mode, the screen
// reader list with its cap, and the delayed list refresh. No DOM package.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { parseNewick } = await import(path.join(root, 'spikes/shared/newick.ts'));
const core = path.join(root, 'spikes/custom/src/core');
const { InMemorySource } = await import(path.join(core, 'source.ts'));
const { FALLBACK_THEME } = await import(path.join(core, 'types.ts'));
const { LabelList } = await import(path.join(core, 'draw.ts'));
const { DrawList, K_TIP, K_NODE } = await import(path.join(core, 'lod.ts'));
const { SR_LIST_CAP } = await import(path.join(core, 'constants.ts'));
const { LabelOverlay } = await import(path.join(core, 'overlay.ts'));

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.style = { cssText: '' };
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this.textContent = '';
    this.tabIndex = -1;
    this.focused = 0;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k];
  }
  appendChild(c) {
    c.remove();
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  replaceChildren(...cs) {
    for (const c of this.children) c.parent = null;
    this.children = [];
    for (const c of cs) this.appendChild(c);
  }
  focus(opts) {
    this.focused++;
    this.focusOpts = opts;
    globalThis.document.activeElement = this;
  }
}
globalThis.document = { activeElement: null, createElement: (tag) => new FakeElement(tag) };
globalThis.window = { setTimeout: (...a) => globalThis.setTimeout(...a) }; // looked up at call time, so the mocked timer is used

const tree = new InMemorySource(parseNewick('((A:1,B:2)AB:1,(C:1,(D:2,E:3)DE:1)CDE:2,F:4)root;')).snapshot();
const theme = { ...FALLBACK_THEME };
const opts = (o = {}) => ({ tipHref: null, italicLabels: true, formatLabel: (s) => s.toUpperCase() + '!', ...o });

function labels(rows, { ang = 0, flip = 0 } = {}) {
  const l = new LabelList();
  rows.forEach(([rank, x, y, h], k) => l.add(rank, x, y, 40, h ?? 12, ang, k === 0 ? flip : 0));
  return l;
}
const liveDoc = () => globalThis.document;

test('construction: a labelled group for the labels, a hidden list, a polite status region', () => {
  const o = new LabelOverlay(() => {});
  assert.equal(o.layer.getAttribute('role'), 'group');
  assert.equal(o.layer.getAttribute('aria-label'), 'Tip labels in view');
  assert.match(o.layer.style.cssText, /pointer-events:none/);
  assert.equal(o.srList.tag, 'ul');
  assert.equal(o.srList.getAttribute('aria-label'), 'Visible tips');
  assert.equal(o.live.getAttribute('aria-live'), 'polite');
  assert.equal(o.live.getAttribute('role'), 'status');
  o.destroy();
});

test('update creates one transparent focusable treeitem per label, named by formatLabel, positioned by transform', () => {
  const o = new LabelOverlay(() => {});
  o.update(
    labels([
      [0, 100, 40, 14],
      [2, 100, 60, 14],
    ]),
    tree,
    opts(),
    theme,
    'rectangular',
  );
  assert.equal(o.layer.children.length, 2);
  const [a, c] = o.layer.children;
  assert.equal(a.tag, 'span', 'no tipHref: not a link');
  assert.equal(a.getAttribute('role'), 'treeitem');
  assert.equal(a.dataset.tipId, 'A');
  assert.equal(a.textContent, 'A!');
  assert.equal(c.dataset.tipId, 'C');
  assert.equal(a.tabIndex, 0);
  assert.match(a.style.cssText, /color:transparent/);
  assert.match(a.style.cssText, /font-style:italic/);
  assert.match(a.style.cssText, new RegExp('font-family:' + theme.fontFamily.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(a.style.transform, 'translate(100px,33px)', 'y minus half the height');
  assert.equal(a.style.fontSize, '12px', 'height - 2, at least 8');
  assert.equal(a.style.height, '14px');
  assert.equal(a.style.lineHeight, '14px');
  assert.equal(a.style.display, '');
  o.update(labels([[0, 100, 40, 9]]), tree, opts({ italicLabels: false }), theme, 'rectangular');
  assert.equal(o.layer.children.length, 1, 'a rebuilt pool after the italic flag changed');
  assert.equal(o.layer.children[0].style.fontSize, '8px', 'never below 8 px');
  assert.doesNotMatch(o.layer.children[0].style.cssText, /italic/);
  o.destroy();
});

test('an element is reused while its tip stays in view and moves with it; one that left is removed', () => {
  const o = new LabelOverlay(() => {});
  o.update(
    labels([
      [0, 100, 40],
      [1, 100, 52],
      [2, 100, 64],
    ]),
    tree,
    opts(),
    theme,
    'rectangular',
  );
  const [a, b, c] = [...o.layer.children];
  o.update(
    labels([
      [1, 90, 30],
      [2, 90, 42],
      [3, 90, 54],
    ]),
    tree,
    opts(),
    theme,
    'rectangular',
  );
  assert.equal(o.layer.children.length, 3);
  assert.ok(!o.layer.children.includes(a), 'A left the view');
  assert.equal(a.parent, null);
  assert.ok(o.layer.children.includes(b) && o.layer.children.includes(c), 'B and C are the same elements');
  assert.equal(b.style.transform, 'translate(90px,24px)');
  assert.equal(o.layer.children.find((e) => e.dataset.tipId === 'D').textContent, 'D!');
  o.destroy();
});

test('the focused label that left the view is parked off screen, not removed, until focus moves', () => {
  const o = new LabelOverlay(() => {});
  o.update(
    labels([
      [0, 100, 40],
      [1, 100, 52],
    ]),
    tree,
    opts(),
    theme,
    'rectangular',
  );
  const a = o.layer.children[0];
  o.focusAnchor(0);
  assert.equal(liveDoc().activeElement, a);
  assert.deepEqual(a.focusOpts, { preventScroll: true });
  o.update(labels([[1, 100, 52]]), tree, opts(), theme, 'rectangular');
  assert.ok(o.layer.children.includes(a), 'kept so that the focus is not lost');
  assert.equal(a.style.transform, 'translate(-9999px,0)');
  liveDoc().activeElement = null;
  o.update(labels([[1, 100, 52]]), tree, opts(), theme, 'rectangular');
  assert.ok(!o.layer.children.includes(a), 'gone once it is not focused');
  o.focusAnchor(5);
  o.focusAnchor(0);
  assert.equal(liveDoc().activeElement, null, 'focusAnchor of a tip with no label does nothing');
  o.destroy();
});

test('radial labels are rotated to the tip angle; flipped ones read towards the root', () => {
  const o = new LabelOverlay(() => {});
  o.update(labels([[0, 200, 100, 14]], { ang: 0.5 }), tree, opts(), theme, 'radial');
  const a = o.layer.children[0];
  assert.equal(a.style.transform, `translate(200px,93px) rotate(${(0.5 * 180) / Math.PI}deg) translateX(8px)`);
  o.update(labels([[0, 200, 100, 14]], { ang: 1, flip: 1 }), tree, opts(), theme, 'radial');
  assert.equal(o.layer.children[0], a, 'same element');
  assert.equal(a.style.transform, `translate(200px,93px) rotate(${(1 * 180) / Math.PI}deg) translateX(-100%) translateX(-8px)`);
  o.destroy();
});

test('link mode: real anchors that open the tip page safely; switching modes or theme font rebuilds the labels', () => {
  const o = new LabelOverlay(() => {});
  const href = (id) => `https://example.org/${id}`;
  o.update(labels([[0, 100, 40]]), tree, opts({ tipHref: href }), theme, 'rectangular');
  const a = o.layer.children[0];
  assert.equal(a.tag, 'a');
  assert.equal(a.href, 'https://example.org/A');
  assert.equal(a.target, '_blank');
  assert.equal(a.rel, 'noopener noreferrer');
  assert.equal(a.getAttribute('role'), undefined, 'a link needs no treeitem role');
  o.update(labels([[0, 100, 40]]), tree, opts({ tipHref: href }), theme, 'rectangular');
  assert.equal(o.layer.children[0], a, 'same mode: reused');
  o.update(labels([[0, 100, 40]]), tree, opts(), theme, 'rectangular');
  assert.equal(o.layer.children.length, 1);
  assert.notEqual(o.layer.children[0], a, 'the mode changed: a new element');
  assert.equal(o.layer.children[0].tag, 'span');
  const span = o.layer.children[0];
  o.update(labels([[0, 100, 40]]), tree, opts(), { ...theme, fontFamily: 'serif' }, 'rectangular');
  assert.notEqual(o.layer.children[0], span, 'the font changed: the old text size no longer fits');
  assert.match(o.layer.children[0].style.cssText, /font-family:serif/);
  o.clear();
  assert.equal(o.layer.children.length, 0, 'clear drops them all');
  o.destroy();
});

/** A draw list with `n` tips (the rows of a big tree are not needed: tipRank only has to map nodes to labels) and one internal node. */
function tipList(nodes) {
  const l = new DrawList();
  l.push(0, K_NODE, 0);
  for (const n of nodes) l.push(n, K_TIP, 0);
  return l;
}

test('updateList: a heading with the count, then the tips in tree order; internal nodes are not listed', () => {
  const o = new LabelOverlay(() => {});
  o.updateList(tipList([tree.tipIndex('A'), tree.tipIndex('B'), tree.tipIndex('F')]), tree, (s) => s.toLowerCase());
  const items = o.srList.children;
  assert.equal(items.length, 4);
  assert.equal(items[0].textContent, '3 tips drawn in view');
  assert.deepEqual(
    items.slice(1).map((li) => li.textContent),
    ['a', 'b', 'f'],
  );
  assert.ok(items.every((li) => li.tag === 'li'));
  o.updateList(tipList([]), tree, (s) => s);
  assert.equal(o.srList.children.length, 1);
  assert.match(o.srList.children[0].textContent, /No individual tips are drawn at this zoom level/);
  o.destroy();
});

test(`updateList lists at most ${SR_LIST_CAP} tips and says how many are drawn`, () => {
  const big = new InMemorySource(parseNewick(`(${Array.from({ length: 100 }, (_, i) => `t${i}:1`).join(',')})r;`)).snapshot();
  const o = new LabelOverlay(() => {});
  const nodes = Array.from({ length: 100 }, (_, i) => big.tipNode[i]);
  o.updateList(tipList(nodes), big, (s) => s);
  assert.equal(o.srList.children.length, SR_LIST_CAP + 1);
  assert.equal(o.srList.children[0].textContent, `100 tips drawn in view, first ${SR_LIST_CAP} listed`);
  assert.equal(o.srList.children[SR_LIST_CAP].textContent, `t${SR_LIST_CAP - 1}`);
  o.destroy();
});

test('announce writes the live region', () => {
  const o = new LabelOverlay(() => {});
  o.announce('Clade of 3 tips');
  assert.equal(o.live.textContent, 'Clade of 3 tips');
  o.destroy();
});

test('scheduleList refreshes once, 160 ms after the last request; destroy cancels it', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let n = 0;
    const o = new LabelOverlay(() => n++);
    o.scheduleList();
    mock.timers.tick(100);
    o.scheduleList(); // restarts the delay
    mock.timers.tick(100);
    assert.equal(n, 0, '200 ms after the first request but only 100 after the last');
    mock.timers.tick(60);
    assert.equal(n, 1);
    mock.timers.tick(1000);
    assert.equal(n, 1, 'one refresh per burst');
    o.scheduleList();
    o.destroy();
    mock.timers.tick(1000);
    assert.equal(n, 1, 'destroyed before it was due');
    const p = new LabelOverlay(() => n++);
    p.scheduleList();
    mock.timers.tick(160);
    assert.equal(n, 2);
  } finally {
    mock.timers.reset();
  }
});
