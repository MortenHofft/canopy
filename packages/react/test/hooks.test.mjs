// Unit tests of the hooks (src/hooks.ts): useTreeViewer, useViewport, useTreeTheme and useTreeEvent, rendered with react-dom in
// StrictMode (so every effect runs, is cleaned up and runs again) against a stand-in for <TreeView>. The stand-in creates and destroys
// its viewer in a layout effect and exposes it through the handle's `renderer()`, as TreeView's useRenderer does; the viewer is a fake
// with the viewer's own event emitter (src/events.ts). The components render nothing, so the container is a minimal fake element.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { createRoot } from 'react-dom/client';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { useTreeViewer, useViewport, useTreeTheme, useTreeEvent } = await import(path.join(root, 'packages/react/src/hooks.ts'));
const { Emitter } = await import(path.join(root, 'packages/viewer/src/events.ts'));

// what react-dom touches of the window and the container when nothing is rendered into it
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window ??= globalThis;
globalThis.HTMLIFrameElement ??= class {};
const noop = () => {};
const fakeDoc = { nodeType: 9, addEventListener: noop, removeEventListener: noop, activeElement: null };
fakeDoc.ownerDocument = fakeDoc;
const fakeContainer = () => ({
  nodeType: 1,
  nodeName: 'DIV',
  tagName: 'DIV',
  namespaceURI: 'http://www.w3.org/1999/xhtml',
  addEventListener: noop,
  removeEventListener: noop,
  ownerDocument: fakeDoc,
});
const { act, createElement: h, StrictMode, forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } = React;

class FakeViewer {
  static made = [];
  events = new Emitter();
  destroyed = false;
  view = { x0: 0, x1: 10, y0: 0, y1: 100 };
  theme = { background: '#fff', branch: '#000' };
  constructor() {
    FakeViewer.made.push(this);
  }
  on(type, fn, opts) {
    return this.events.on(type, fn, opts);
  }
  listeners(type) {
    return this.events.map.get(type)?.length ?? 0;
  }
  getViewport() {
    return { ...this.view };
  }
  setViewport(v) {
    this.view = { ...v };
    this.events.emit('viewchange', { ...v });
  }
  getTheme() {
    return this.theme;
  }
  setTheme(t) {
    this.theme = { ...this.theme, ...t };
    this.events.emit('themechange', this.theme);
  }
  click(e) {
    this.events.emit('click', e);
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    if (this.destroyed) return;
    this.events.emit('destroy', undefined);
    this.destroyed = true;
    this.events.clear();
  }
}

/** <TreeView> as far as the hooks see it: a viewer per `gen` (the parent's prop) and `own` (its own state, set through `recreate`). */
let recreate = null;
const FakeTreeView = forwardRef(function FakeTreeView({ gen }, ref) {
  const [own, setOwn] = useState(0);
  recreate = () => setOwn((n) => n + 1);
  const r = useRef(null);
  useLayoutEffect(() => {
    const v = new FakeViewer();
    r.current = v;
    return () => {
      v.destroy();
      r.current = null;
    };
  }, [gen, own]);
  useImperativeHandle(ref, () => ({ renderer: () => r.current }), []);
  return null;
});

async function mount(App, props) {
  FakeViewer.made = [];
  const rootEl = createRoot(fakeContainer());
  const render = (p) => act(() => rootEl.render(h(StrictMode, null, h(App, p))));
  await render(props);
  return { render, unmount: () => act(() => rootEl.unmount()) };
}
const live = () => FakeViewer.made.filter((v) => !v.destroyed);

test('useTreeViewer: the live viewer as state, through strict-mode remounts, re-creation and unmount', async () => {
  let seen;
  function App({ gen = 0, show = true }) {
    const ref = useRef(null);
    seen = useTreeViewer(ref);
    return show ? h(FakeTreeView, { ref, gen }) : null;
  }
  const app = await mount(App, {});
  assert.equal(FakeViewer.made.length, 2, 'strict mode: created, destroyed, created again');
  assert.equal(live().length, 1);
  assert.equal(seen, live()[0], 'the viewer that lives, not the one strict mode destroyed');

  await app.render({ gen: 1 }); // the parent changes what re-creates the viewer (softwareCanvas)
  assert.equal(live().length, 1);
  assert.equal(seen, live()[0], 'the re-created viewer, after a render of the parent');

  const before = seen;
  await act(() => recreate()); // re-created without the parent rendering
  assert.notEqual(seen, before);
  assert.equal(seen, live()[0], "the re-created viewer, after only the view's own render");
  assert.equal(seen.listeners('destroy'), 1, 'one destroy listener on the live viewer');

  await app.render({ gen: 1, show: false });
  assert.equal(seen, null, 'null once the view is unmounted');
  assert.equal(live().length, 0);
  await app.unmount();
});

test('useViewport: follows viewchange, keeps its object between changes, one listener, re-subscribes to a new viewer', async () => {
  let vp;
  let viewer;
  function App({ gen = 0 }) {
    const ref = useRef(null);
    viewer = useTreeViewer(ref);
    vp = useViewport(viewer);
    return h(FakeTreeView, { ref, gen });
  }
  const app = await mount(App, {});
  assert.deepEqual(vp, { x0: 0, x1: 10, y0: 0, y1: 100 });
  assert.equal(viewer.listeners('viewchange'), 1, 'strict mode leaves one subscription');

  await act(() => viewer.setViewport({ x0: 2, x1: 4, y0: 10, y1: 20 }));
  assert.deepEqual(vp, { x0: 2, x1: 4, y0: 10, y1: 20 }, 'a pan or zoom on the viewer reaches React');

  const kept = vp;
  await app.render({ tick: 1 });
  assert.equal(vp, kept, 'an unrelated render returns the same object');

  const old = viewer;
  await app.render({ gen: 1 });
  assert.notEqual(viewer, old);
  assert.equal(old.listeners('viewchange'), 0, 'nothing left on the destroyed viewer');
  assert.equal(viewer.listeners('viewchange'), 1);
  assert.deepEqual(vp, { x0: 0, x1: 10, y0: 0, y1: 100 }, 'the new viewer’s window');
  await act(() => viewer.setViewport({ x0: 1, x1: 2, y0: 3, y1: 4 }));
  assert.deepEqual(vp, { x0: 1, x1: 2, y0: 3, y1: 4 });

  const last = viewer;
  await app.unmount();
  assert.equal(last.listeners('viewchange'), 0);
});

test('useViewport and useTreeTheme are null without a viewer', async () => {
  let vp = 'unset';
  let theme = 'unset';
  function App() {
    vp = useViewport(null);
    theme = useTreeTheme(null);
    return null;
  }
  const app = await mount(App, {});
  assert.equal(vp, null);
  assert.equal(theme, null);
  await app.unmount();
});

test('useTreeTheme: the theme in force, after every themechange', async () => {
  let theme;
  let viewer;
  function App() {
    const ref = useRef(null);
    viewer = useTreeViewer(ref);
    theme = useTreeTheme(viewer);
    return h(FakeTreeView, { ref, gen: 0 });
  }
  const app = await mount(App, {});
  assert.equal(theme, viewer.getTheme());
  await act(() => viewer.setTheme({ background: '#0f172a' }));
  assert.equal(theme.background, '#0f172a');
  assert.equal(viewer.listeners('themechange'), 1);
  await app.unmount();
});

test('useTreeEvent: the newest handler, one listener in strict mode, re-attached to a new viewer, asDefault honoured', async () => {
  const calls = [];
  let viewer;
  function App({ gen = 0, label = 'a', asDefault = false }) {
    const ref = useRef(null);
    viewer = useTreeViewer(ref);
    useTreeEvent(viewer, 'click', (e) => calls.push(`${label}:${e.node}`), { asDefault });
    return h(FakeTreeView, { ref, gen });
  }
  const app = await mount(App, {});
  const ev = (node) => ({
    node,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  });
  assert.equal(viewer.listeners('click'), 1);
  viewer.click(ev(1));
  assert.deepEqual(calls, ['a:1']);

  await app.render({ label: 'b' }); // a new handler: no re-subscription, the new one is called
  assert.equal(viewer.listeners('click'), 1);
  viewer.click(ev(2));
  assert.deepEqual(calls, ['a:1', 'b:2']);

  const old = viewer;
  await app.render({ label: 'b', gen: 1 });
  assert.equal(old.listeners('click'), 0);
  assert.equal(viewer.listeners('click'), 1, 'attached to the re-created viewer');
  viewer.click(ev(3));
  assert.deepEqual(calls, ['a:1', 'b:2', 'b:3']);

  await app.render({ label: 'c', gen: 1, asDefault: true }); // a default action: skipped when an ordinary listener prevents it
  viewer.on('click', (e) => e.node === 5 && e.preventDefault());
  viewer.click(ev(4));
  viewer.click(ev(5));
  assert.deepEqual(calls, ['a:1', 'b:2', 'b:3', 'c:4']);

  const last = viewer;
  await app.unmount();
  assert.equal(last.listeners('click'), 0);
});
