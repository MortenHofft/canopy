// Unit tests of the overlays (src/overlays/) against the fake DOM and a fake viewer: Overlay placement (positioning, offset, keeping
// inside, hiding off view, following frames), the tooltip as a default action of hover, and the node menu (opens as a default
// action of click, items, keyboard, closes on a choice, Escape, a view change or a press outside).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNewick } from '@gbif-phylo/io';
import { installFakeDom, FakeElement } from './fake-dom.mjs';

installFakeDom();
const winListeners = {};
globalThis.addEventListener = (t, f) => (winListeners[t] ??= []).push(f);
globalThis.removeEventListener = (t, f) => (winListeners[t] = (winListeners[t] ?? []).filter((x) => x !== f));
globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
document.createDocumentFragment = () => new FakeElement('#fragment');

const { Overlay, Tooltip, NodeMenu, defaultTooltip } = await import('../src/overlays/index.ts');
const { Emitter } = await import('../src/events.ts');
const { InMemorySource } = await import('../src/source.ts');
const { makeNodeEvent, toTreeEvent } = await import('../src/node-event.ts');
const { DEFAULT_OPTIONS } = await import('../src/types.ts');

function fakeViewer(newick = '((A:1,B:1)AB:1,C:2)root;') {
  const em = new Emitter();
  const source = new InMemorySource(parseNewick(newick));
  const tree = source.snapshot();
  const element = new FakeElement('div');
  element.w = 400;
  element.h = 300;
  document.body.appendChild(element);
  const positions = new Map([[1, { x: 100, y: 50 }]]);
  const v = {
    element,
    options: { ...DEFAULT_OPTIONS },
    size: { width: 400, height: 300 },
    positions,
    on: (t, f, o) => em.on(t, f, o),
    emit: (t, e) => em.emit(t, e),
    nodePosition: (id) => positions.get(id) ?? null,
    tipNode: (label) => tree.tipIndex(label),
    getTree: () => tree,
    focus: () => element.focus(),
    event: (node, via = 'pointer', x = 120, y = 60) =>
      toTreeEvent(makeNodeEvent(tree, node, tree.childCount[node] ? 'node' : 'tip', via, x, y), source),
  };
  return v;
}

const box = (el) => {
  const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(el.style.transform ?? '');
  return m ? [Number(m[1]), Number(m[2])] : null;
};

test('Overlay: pinned to a node, positioning and offset, kept inside, hidden off view, follows frames', () => {
  const v = fakeViewer();
  const el = new FakeElement('div');
  el.w = 40;
  el.h = 20;
  const o = new Overlay({ element: el, positioning: 'bottom-center', offset: [0, -6] });
  o.setViewer(v);
  assert.equal(el.style.visibility, 'hidden', 'no anchor yet');
  o.setPosition({ node: 1 });
  assert.deepEqual(box(el), [80, 24]);
  assert.equal(el.style.visibility, 'visible');
  v.positions.set(1, { x: 395, y: 2 }); // moved to the corner by a pan: shown inside
  v.emit('frame', {});
  assert.deepEqual(box(el), [356, 4]);
  v.positions.delete(1); // out of view
  v.emit('frame', {});
  assert.equal(el.style.visibility, 'hidden');
  o.setPosition({ x: 10, y: 10 });
  o.setPositioning('top-left', [0, 0]);
  assert.deepEqual(box(el), [10, 10]);
  v.positions.set(tree(v).tipIndex('C'), { x: 200, y: 200 });
  o.setPosition({ tipId: 'C' });
  assert.deepEqual(box(el), [200, 200]);
  o.setPosition(null);
  assert.equal(el.style.visibility, 'hidden');
  o.setViewer(null);
  v.positions.set(1, { x: 1, y: 1 });
  v.emit('frame', {}); // no longer listening
});

const tree = (v) => v.getTree();

test('Tooltip: shown on hover as a default action, hidden by preventDefault, null hover and clicks; custom content', () => {
  const v = fakeViewer();
  const t = new Tooltip();
  t.setViewer(v);
  v.emit('hover', v.event(1));
  assert.equal(t.element.hidden, false);
  assert.match(t.element.textContent, /Clade, 2 tips/);
  assert.match(t.element.textContent, /AB/, 'the node name under the title');
  v.emit('hover', null);
  assert.equal(t.element.hidden, true);
  const off = v.on('hover', (e) => e?.preventDefault());
  v.emit('hover', v.event(1));
  assert.equal(t.element.hidden, true, 'prevented');
  off();
  v.emit('hover', v.event(tree(v).tipIndex('C')));
  assert.equal(t.element.textContent, 'C');
  v.emit('click', v.event(1));
  assert.equal(t.element.hidden, true, 'a click hides it');
  const c = new Tooltip({ render: (e) => (e.isTip ? `tip ${e.tipId}` : null) });
  const v2 = fakeViewer();
  c.setViewer(v2);
  v2.emit('hover', v2.event(tree(v2).tipIndex('A')));
  assert.equal(c.element.textContent, 'tip A');
  v2.emit('hover', v2.event(1));
  assert.equal(c.element.hidden, true, 'render returned null: nothing shown');
});

test('NodeMenu: opens with the items as a default action of click, with a role only while open; a choice runs onSelect and closes', () => {
  const v = fakeViewer();
  const picked = [];
  const m = new NodeMenu({
    items: (e) =>
      e.isTip
        ? null
        : [
            { id: 'zoom', label: 'Zoom to clade', onSelect: (ev) => picked.push(['zoom', ev.nodeId]) },
            { id: 'off', label: 'Not now', disabled: true, onSelect: () => picked.push(['off']) },
            { id: 'rot', label: 'Rotate', hint: 'swap children', onSelect: () => picked.push(['rot']) },
          ],
  });
  m.setViewer(v);
  assert.equal(m.element.getAttribute('role'), null);
  v.emit('click', v.event(tree(v).tipIndex('C')));
  assert.equal(m.isOpen(), false, 'no items for a tip: no menu');
  v.emit('click', v.event(1));
  assert.equal(m.isOpen(), true);
  assert.equal(m.element.getAttribute('role'), 'menu');
  assert.equal(m.element.getAttribute('aria-label'), 'Actions for clade of 2 tips');
  const items = m.element.querySelectorAll('button');
  assert.deepEqual(
    items.map((b) => b.dataset.action),
    ['zoom', 'off', 'rot'],
  );
  assert.equal(items[1].disabled, true);
  assert.equal(items[2].title, 'swap children');
  // a hover while it is open is prevented (the tooltip stays hidden)
  const h = v.event(1);
  v.emit('hover', h);
  assert.equal(h.defaultPrevented, true);
  items[1].click();
  assert.equal(m.isOpen(), true, 'a disabled item does nothing');
  items[0].click();
  assert.deepEqual(picked, [['zoom', 'n1']]);
  assert.equal(m.isOpen(), false);
  assert.equal(m.element.getAttribute('role'), null);
  assert.equal(document.activeElement, v.element, 'focus goes back to the tree');
});

test('NodeMenu title and default tooltip name a clade without its support value, through formatLabel', () => {
  const v = fakeViewer("((A:1,B:1)'95:Chelodina_ott1':1,(C:1,D:1)97:1)root;");
  const m = new NodeMenu({ items: () => [{ id: 'a', label: 'A', onSelect() {} }] });
  m.setViewer(v);
  const title = () => m.element.querySelector('.phylo-node-menu__title').textContent;
  v.emit('click', v.event(1));
  assert.equal(title(), 'Chelodina ott1');
  m.close?.(false);
  v.emit('click', v.event(4));
  assert.equal(title(), 'Clade, 2 tips', 'a support-only label is no name');
  const detail = (e) => defaultTooltip(e, v).querySelector('.phylo-tooltip__detail')?.textContent;
  assert.equal(detail(v.event(1)), 'Chelodina ott1');
  assert.equal(detail(v.event(4)) ?? null, null);
});

test('NodeMenu: a click listener that prevents the default keeps it closed; view change, Escape and a press outside close it', () => {
  const v = fakeViewer();
  const m = new NodeMenu({ items: () => [{ id: 'a', label: 'A', onSelect() {} }] });
  m.setViewer(v);
  const off = v.on('click', (e) => e.preventDefault());
  v.emit('click', v.event(1));
  assert.equal(m.isOpen(), false);
  off();
  v.emit('click', v.event(1));
  assert.equal(m.isOpen(), true);
  v.emit('viewchange', { x0: 0, x1: 1, y0: 0, y1: 1 });
  assert.equal(m.isOpen(), false);
  v.emit('click', v.event(1));
  for (const f of winListeners.keydown ?? []) f({ key: 'Escape' });
  assert.equal(m.isOpen(), false);
  v.emit('click', v.event(1));
  for (const f of winListeners.pointerdown ?? []) f({ target: document.body });
  assert.equal(m.isOpen(), false);
  assert.equal((winListeners.pointerdown ?? []).length, 0, 'window listeners removed when closed');
});

test('NodeMenu from the keyboard: focus on the first enabled item, arrows wrap, Escape closes and refocuses the tree', () => {
  const v = fakeViewer();
  const m = new NodeMenu({
    items: () => [
      { id: 'a', label: 'A', disabled: true, onSelect() {} },
      { id: 'b', label: 'B', onSelect() {} },
      { id: 'c', label: 'C', onSelect() {} },
    ],
  });
  m.setViewer(v);
  v.emit('click', v.event(1, 'keyboard'));
  const [, b, c] = m.element.querySelectorAll('button');
  assert.equal(document.activeElement, b);
  m.element.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(document.activeElement, c);
  m.element.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(document.activeElement, b, 'wraps, skipping the disabled item');
  m.element.dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(document.activeElement, c);
  m.element.dispatch('keydown', { key: 'Escape' });
  assert.equal(m.isOpen(), false);
  assert.equal(document.activeElement, v.element);
});
