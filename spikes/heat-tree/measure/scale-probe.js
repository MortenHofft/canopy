const api = window.__spike;
function mk(n, seed) { // random binary tree, iterative: repeatedly join two random items
  let s = seed; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  let items = []; for (let i = 0; i < n; i++) items.push(`Tip_${i}:${(1 + rnd()).toFixed(3)}`);
  while (items.length > 1) { const a = items.splice(Math.floor(rnd() * items.length), 1)[0]; const b = items.splice(Math.floor(rnd() * items.length), 1)[0]; items.push(`(${a},${b}):${(0.5 + rnd()).toFixed(3)}`); }
  return items[0] + ';';
}
const out = {};
for (const n of [5000]) {
  const t = mk(n, 7);
  const t0 = performance.now();
  const m = await api.mount({ treeId: 'x', newick: t, layout: 'rectangular', branchLengths: true, size: { width: 1000, height: 600 } });
  out[n] = [Math.round(m.parseMs), Math.round(m.firstRenderMs), m.tips];
  await api.unmount();
}
return out;
