import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { makeViewer, destroyAll } = await import('./viewer-harness.mjs');
const { partialSnapshot } = await import('./partial-snapshot.mjs');
const { parseNewick } = await import(root + '/packages/io/src/newick.ts');
const { InMemorySource } = await import(root + '/packages/viewer/src/source.ts');
afterEach(destroyAll);
test('partial source: setCollapsed is ignored, no crash, through frames, clicks and setTree', async () => {
  const full = new InMemorySource(parseNewick('(((a,b)x,(c,d)y)w,(e,f)z,g)r;')).snapshot();
  const p = partialSnapshot(full, [full.parent[full.tipIndex('e')]], 0);
  const src = {
    nodeCount: full.nodeCount,
    tipCount: full.tipCount,
    hasLengths: false,
    version: 0,
    subscribe: () => () => {},
    snapshot: () => p.snap,
    ensureClade: async () => {},
    tipLabels: async () => [],
    destroy() {},
  };
  const m = await makeViewer(src, { size: [400, 300] });
  m.env.flush();
  const v = m.viewer;
  v.setCollapsed([1, 2, 0]);
  m.env.flush();
  assert.equal(v.L.collapsed, null);
  assert.equal(v.L.rows, full.tipCount);
  v.focusTip(1);
  m.env.flush();
  for (let x = 0; x < 400; x += 20) for (let y = 0; y < 300; y += 20) v.hitTest(x, y);
  v.setTree(src, { collapsed: [1] });
  m.env.flush();
  assert.equal(v.L.collapsed, null);
});
