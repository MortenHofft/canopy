// Parse depth limit of archaeopteryx.parseTree in Node (recursive addParents).
// Paths assume the repository at /home/user/gbif-phylo.
const { archaeopteryx } = require('/home/user/gbif-phylo/spikes/archaeopteryx-js/node_modules/archaeopteryx');
function cat(n) { let s = 't0:1'; for (let i = 1; i < n; i++) s = '(' + s + ',t' + i + ':1):1'; return s + ';'; }
for (const n of [1000, 3000, 5000, 7000, 9000, 12000, 20000]) {
  try { const t = archaeopteryx.parseTree('c.nwk', cat(n)); console.log(n, 'parse ok'); } catch (e) { console.log(n, 'parse FAIL', String(e).slice(0, 80)); }
}
