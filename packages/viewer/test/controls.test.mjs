// Unit tests of the controls (src/control.ts, src/controls/) against a fake DOM and a fake viewer that records what the controls ask
// of it: listener bookkeeping of BaseControl, the zoom / fit / layout buttons, search matching and keyboard choice, the legend, and
// defaultControls. Placement on a real viewer is covered by the browser check of the vanilla example.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNewick } from '@gbif-phylo/io';
import { installFakeDom } from './fake-dom.mjs';

installFakeDom();
const { BaseControl } = await import('../src/control.ts');
const { Zoom, Fit, LayoutToggle, Search, Legend, OverviewControl, defaultControls } = await import('../src/controls/index.ts');
const { Emitter } = await import('../src/events.ts');
const { InMemorySource } = await import('../src/source.ts');
const { DEFAULT_OPTIONS } = await import('../src/types.ts');

function fakeViewer(newick = '((Apis_mellifera:1,Apis_cerana:1)Apis:1,(Bombus_terrestris:1,Xylocopa_violacea:1):1)root;') {
  const em = new Emitter();
  const tree = new InMemorySource(parseNewick(newick)).snapshot();
  const calls = [];
  const v = {
    calls,
    options: { ...DEFAULT_OPTIONS },
    size: { width: 400, height: 300 },
    clades: [],
    on: (t, f, o) => em.on(t, f, o),
    emit: (t, e) => em.emit(t, e),
    listeners: (t) => (em.has(t) ? 1 : 0),
    zoomBy: (...a) => calls.push(['zoomBy', ...a]),
    fit: (a) => calls.push(['fit', a]),
    focusTip: (r, a) => calls.push(['focusTip', r, a]),
    zoomToNode: (n, a) => calls.push(['zoomToNode', n, a]),
    setHighlighted: (ids) => calls.push(['setHighlighted', ids]),
    setOptions(p) {
      calls.push(['setOptions', p]);
      Object.assign(this.options, p);
      em.emit('optionschange', { options: this.options, changed: Object.keys(p) });
    },
    getTree: () => tree,
    getClades() {
      return this.clades;
    },
    invalidate() {},
    isDestroyed: () => false,
  };
  return v;
}

test('BaseControl: class names, position, attach / detach and listeners removed with the control', () => {
  const seen = [];
  class Probe extends BaseControl {
    attach(v) {
      seen.push('attach');
      this.listen(v.on('resize', () => seen.push('resize')));
      this.domListen(this.element, 'click', () => seen.push('click'));
    }
    detach() {
      seen.push('detach');
    }
  }
  const c = new Probe('probe', { position: 'bottom-right', className: 'mine extra' });
  assert.ok(c.element.classList.contains('phylo-control') && c.element.classList.contains('phylo-probe'));
  assert.ok(c.element.classList.contains('mine') && c.element.classList.contains('extra'));
  assert.equal(c.position, 'bottom-right');
  const v = fakeViewer();
  c.setViewer(v);
  v.emit('resize', { width: 1, height: 1 });
  c.element.click();
  c.setViewer(null);
  v.emit('resize', { width: 1, height: 1 });
  c.element.click();
  assert.deepEqual(seen, ['attach', 'resize', 'click', 'detach']);
  assert.equal(c.element.listenerCount(), 0);
  assert.equal(v.listeners('resize'), 0);
});

test('Zoom zooms rows only in the rectangular layout, both axes in the radial one, about the centre', () => {
  const v = fakeViewer();
  const z = new Zoom({ factor: 2 });
  z.setViewer(v);
  z.zoomIn.click();
  z.zoomOut.click();
  v.options.layout = 'radial';
  z.zoomIn.click();
  assert.deepEqual(v.calls, [
    ['zoomBy', 1, 2, 200, 150],
    ['zoomBy', 1, 0.5, 200, 150],
    ['zoomBy', 2, 2, 200, 150],
  ]);
  assert.equal(z.zoomIn.getAttribute('aria-label'), 'Zoom in');
});

test('Fit fits, animated', () => {
  const v = fakeViewer();
  const f = new Fit();
  f.setViewer(v);
  f.button.click();
  assert.deepEqual(v.calls, [['fit', true]]);
});

test('LayoutToggle sets the layout and follows changes made elsewhere', () => {
  const v = fakeViewer();
  const t = new LayoutToggle();
  t.setViewer(v);
  assert.equal(t.buttons.rectangular.getAttribute('aria-pressed'), 'true');
  t.buttons.radial.click();
  assert.deepEqual(v.calls, [['setOptions', { layout: 'radial' }]]);
  assert.equal(t.buttons.radial.getAttribute('aria-pressed'), 'true');
  assert.equal(t.buttons.rectangular.getAttribute('aria-pressed'), 'false');
  v.setOptions({ layout: 'rectangular' });
  assert.equal(t.buttons.rectangular.getAttribute('aria-pressed'), 'true');
});

test('Search: prefix matches first, case-insensitive on the displayed label, capped; Enter on a suggestion focuses the tip', () => {
  const v = fakeViewer();
  const s = new Search({ maxResults: 3 });
  s.setViewer(v);
  const labels = (ranks) => ranks.map((r) => v.getTree().tipLabels[r]);
  assert.deepEqual(labels(s.find(v, 'apis')), ['Apis_mellifera', 'Apis_cerana']);
  assert.deepEqual(labels(s.find(v, 'IS M')), ['Apis_mellifera'], 'underscores show as spaces');
  assert.deepEqual(labels(s.find(v, 'a')), ['Apis_mellifera', 'Apis_cerana', 'Xylocopa_violacea'], 'prefix first, then anywhere, capped');
  assert.deepEqual(s.find(v, '   '), []);
  // type, wait for the debounce, choose with the keyboard
  s.input.value = 'cer';
  s.input.dispatch('input');
  return new Promise((done) =>
    setTimeout(() => {
      assert.equal(s.list.hidden, false);
      assert.equal(s.list.children.length, 1);
      assert.equal(s.input.getAttribute('aria-expanded'), 'true');
      s.input.dispatch('keydown', { key: 'Enter' });
      assert.deepEqual(v.calls, [['focusTip', 1, true]]);
      assert.equal(s.list.hidden, true);
      assert.equal(s.input.value, 'Apis cerana');
      s.setViewer(null);
      done();
    }, 150),
  );
});

test('Search: highlight and onSelect', () => {
  const v = fakeViewer();
  const s = new Search({ highlight: true });
  s.setViewer(v);
  s.find(v, 'bombus');
  s.list.replaceChildren(); // choose through a click on an option element
  const li = document.createElement('li');
  li.dataset.rank = '2';
  s.list.appendChild(li);
  li.click();
  assert.deepEqual(v.calls, [
    ['setHighlighted', ['Bombus_terrestris']],
    ['focusTip', 2, true],
  ]);
  const picked = [];
  const s2 = new Search({ onSelect: (id) => picked.push(id) });
  const v2 = fakeViewer();
  s2.setViewer(v2);
  const li2 = document.createElement('li');
  li2.dataset.rank = '3';
  s2.list.appendChild(li2);
  li2.click();
  assert.deepEqual(picked, ['Xylocopa_violacea']);
  assert.deepEqual(v2.calls, []);
});

test('Legend: one entry per coloured clade, named by label, node name or tip count; click zooms; hidden when empty', () => {
  const v = fakeViewer();
  const l = new Legend();
  l.setViewer(v);
  assert.equal(l.element.hidden, true);
  v.clades = [
    { node: 1, colour: '#f00' },
    { node: 4, colour: '#0f0' },
    { node: 0, colour: '#00f', label: 'Everything' },
  ];
  v.emit('cladeschange', v.clades);
  assert.equal(l.element.hidden, false);
  assert.deepEqual(
    l.items(v).map((i) => i.label),
    ['Apis', 'Clade of 2 tips', 'Everything'],
  );
  const btn = l.list.children[1].children[1];
  btn.click();
  assert.deepEqual(v.calls, [['zoomToNode', 4, true]]);
  const fixed = new Legend({ items: [{ colour: '#123', label: 'Native' }] });
  fixed.setViewer(v);
  assert.deepEqual(
    fixed.items(v).map((i) => i.label),
    ['Native'],
  );
});

test('Legend: a clade is named by its label without support, through formatLabel, with its tip count; no name falls back to the count', () => {
  const v = fakeViewer("((a:1,b:1)'95:Chelodina_ott235768':1,(c:1,d:1)95:1,(e:1,f:1):1,(g:1,h:1)mrcaott99343ott3606205:1)'98.0:c__Root';");
  const l = new Legend();
  l.setViewer(v);
  const t = v.getTree();
  const row = (name) => t.labels.indexOf(name);
  v.clades = [row('95:Chelodina_ott235768'), row('95'), t.labels.findIndex((x, i) => x === '' && t.childCount[i] > 0), 0].map((node, i) => ({
    node,
    colour: '#' + i,
  }));
  const text = () => l.items(v).map((i) => [i.label, i.detail ?? null]);
  assert.deepEqual(text(), [
    ['Chelodina ott235768', '2 tips'],
    ['Clade of 2 tips', null],
    ['Clade of 2 tips', null],
    ['c  Root', '8 tips'],
  ]);
  v.options.formatLabel = (s) => s.replace(/_ott\d+$/, '').replace(/_/g, ' ');
  assert.equal(text()[0][0], 'Chelodina');
  l.element.hidden = false;
  v.emit('cladeschange', v.clades);
  const btn = l.list.children[0].children[1];
  assert.equal(btn.textContent, 'Chelodina (2 tips)');
  // an app's cladeLabel decides what is a name: null hides it, a string replaces it (and is formatted)
  const hide = new Legend({ cladeLabel: (r, tree) => (/^mrcaott/.test(tree.labels[r]) ? null : tree.labels[r].replace(/^[^:]*:/, '')) });
  hide.setViewer(v);
  v.clades = [
    { node: row('mrcaott99343ott3606205'), colour: '#0' },
    { node: row('95:Chelodina_ott235768'), colour: '#1' },
  ];
  assert.deepEqual(
    hide.items(v).map((i) => i.label),
    ['Clade of 2 tips', 'Chelodina'],
  );
  // an explicit label of the clade wins and gets no detail
  v.clades = [{ node: 0, colour: '#0', label: 'Pink' }];
  assert.deepEqual(l.items(v), [{ colour: '#0', label: 'Pink', node: 0 }]);
});

test('defaultControls: zoom and fit by default; keys switch others on, false switches off, options pass through', () => {
  const names = (cs) => cs.map((c) => c.constructor.name);
  assert.deepEqual(names(defaultControls()), ['Zoom', 'Fit']);
  assert.deepEqual(names(defaultControls({ zoom: false, search: true, legend: true, layoutToggle: true, overview: true })), [
    'Fit',
    'LayoutToggle',
    'Search',
    'Legend',
    'OverviewControl',
  ]);
  const [z] = defaultControls({ zoom: { position: 'bottom-left' }, fit: false });
  assert.equal(z.position, 'bottom-left');
  assert.equal(new OverviewControl().position, 'custom');
});
