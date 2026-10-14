// Counts document/window listeners (CDP DOMDebugger) and DOM nodes around 5 mount/unmount cycles.
// usage: node measure/leak.mjs   (served at http://127.0.0.1:5203/)
import { Browser } from '../../runner/lib/session.mjs';
import { getEntry } from '../../runner/lib/truth.mjs';
const b = new Browser('http://127.0.0.1:5203/', () => {});
await b.launch();
await b.withSession('leak', async (s) => {
  const cdp = await s.ctx.newCDPSession(s.page);
  const count = async () => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    const w = (await cdp.send('Runtime.evaluate', { expression: 'window' }));
    const wl = (await cdp.send('DOMDebugger.getEventListeners', { objectId: w.result.objectId })).listeners;
    return { doc: listeners.filter((l) => l.type === 'phylotree.event').length, docAll: listeners.length, winAll: wl.length };
  };
  console.log('before', JSON.stringify(await count()));
  const e = getEntry('syn-yule-1000');
  for (let i = 0; i < 5; i++) { await s.mount(e, {}); await s.call('unmount'); }
  console.log('after 5 mount/unmount', JSON.stringify(await count()));
  await s.mount(e, {});
  console.log('mounted', JSON.stringify(await count()));
  const docNodes = await s.page.evaluate(() => document.querySelectorAll('*').length);
  await s.call('unmount');
  console.log('doc nodes after unmount', await s.page.evaluate(() => document.querySelectorAll('*').length), 'was mounted', docNodes);
}, 200000);
await b.close();
