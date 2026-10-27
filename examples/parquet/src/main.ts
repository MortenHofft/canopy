// A tree and its sidecar as Parquet files, read with HTTP range requests, shown by the viewer. What this page shows:
//  - the tree opens from the overview alone (two requests whatever its size) and clades load as you zoom (the viewer's DetailLoader asks
//    the ParquetSource for the stubs that grow big enough on screen);
//  - "Colour by" reads one column of the sidecar for all tips and colours tips, clades and summaries by it (colouring.ts), with a legend the
//    page draws itself from the viewer's data;
//  - a click on a tip reads that tip's row of the sidecar and its sequence (one row group each);
//  - the Network panel counts what all this cost.
// `npm run dev` here, `node scripts/generate.mjs` and `node scripts/serve.mjs` for the data (README.md), then
//   http://127.0.0.1:5309/?url=http://127.0.0.1:5210/<dataset>[&cpu=1][&budget=2000][&layout=radial][&gap=65536][&plan=0][&cache=default]

import '@gbif-phylo/viewer/viewer.css';
import './style.css';
import { Fit, LayoutToggle, TreeViewer, Zoom, type LegendItem, type TreeEvent } from '@gbif-phylo/viewer';
import { ParquetSource } from './ParquetSource.ts';
import { cladesFor, loadColouring, type Colouring } from './colouring.ts';

const params = new URLSearchParams(location.search);
const url = params.get('url') ?? 'http://127.0.0.1:5210/t100k';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const COLOURS = ['#684393', '#5b7ac8', '#c0399c', '#e8845b', '#4aa8d8', '#3e9b6f', '#c9a227', '#8c6d5a']; // eight values, then 'Other'
const OTHER = '#94a3b8';

const fmtBytes = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(2)} MB` : `${(b / 1e3).toFixed(0)} KB`);

let source: ParquetSource;
try {
  source = await ParquetSource.open(url, {
    gap: params.has('gap') ? +params.get('gap')! : undefined,
    plan: params.get('plan') !== '0',
    cache: (params.get('cache') as RequestCache | null) ?? undefined,
  });
} catch (e) {
  document.body.innerHTML = `<p style="padding:16px">Could not open <code>${url}</code>: ${String(e)}<br />Generate a dataset with <code>node scripts/generate.mjs --tips 100000 --out ../../data/parquet/t100k</code> and serve it with <code>node scripts/serve.mjs --root ../../data/parquet --port 5210</code> (see README.md).</p>`;
  throw e;
}
const ds = source.dataset;
const man = ds.man;
const totalBytes = Object.values(man.files).reduce((a, f) => a + f.bytes, 0);
$('dataset').textContent = `${man.tips.toLocaleString('en')} tips, ${fmtBytes(totalBytes)} in ${Object.keys(man.files).length} files`;

const viewer = new TreeViewer({
  target: $('tree'),
  source,
  controls: [new Zoom(), new Fit(), new LayoutToggle({ target: $('layout-slot') })],
  options: {
    softwareCanvas: params.get('cpu') === '1',
    layout: params.get('layout') === 'radial' ? 'radial' : 'rectangular',
    branchLengths: false,
    drawBudget: params.has('budget') ? +params.get('budget')! : 'auto',
  },
});

// ---------------------------------------------------------------- what it cost

function renderStats(): void {
  const s = source.stats;
  $('stats').textContent =
    `${ds.stats.requests} requests, ${fmtBytes(ds.stats.bytes)} · ${s.rows.toLocaleString('en')} rows in view (${s.stubs.toLocaleString('en')} stubs), ` +
    `${s.loadedClades} clades loaded, overview level ${s.overviewLevel}`;
  const log = ds.stats.log.slice(-14).reverse();
  $('log').replaceChildren(
    ...log.map(([file, a, b, got, ms]) => {
      const li = document.createElement('li');
      li.textContent = `${file} ${a}–${b} · ${fmtBytes(got)} · ${ms.toFixed(0)} ms`;
      li.title = li.textContent;
      return li;
    }),
  );
}
renderStats();
setInterval(renderStats, 500);

/** Run `fn` and report what it cost: milliseconds, requests and bytes. */
async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number; requests: number; bytes: number }> {
  const r0 = ds.stats.requests;
  const b0 = ds.stats.bytes;
  const t0 = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - t0, requests: ds.stats.requests - r0, bytes: ds.stats.bytes - b0 };
}

// ---------------------------------------------------------------- colour by a sidecar column

const select = $<HTMLSelectElement>('colour-by');
for (const c of ds.sidecarColumns.filter((c) => c.kind === 'category')) select.append(new Option(`${c.name} (${c.values!.length} values)`, c.name));
const legendSlot = $('legend-slot');
let colouring: Colouring | null = null;

function showLegend(title: string, items: LegendItem[]): void {
  legendSlot.hidden = items.length === 0;
  legendSlot.querySelector('h2')!.textContent = title;
  legendSlot.querySelector('ul')!.replaceChildren(
    ...items.map((it) => {
      const li = document.createElement('li');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = it.colour;
      li.append(sw, `${it.label} (${it.detail})`);
      return li;
    }),
  );
}

/** The clade colours of the rows that are in the snapshot now. Runs again whenever rows arrive. */
function applyColouring(): void {
  viewer.setClades(colouring ? cladesFor(source.snapshot(), colouring) : []);
}
viewer.on('sourcechange', applyColouring);

async function colourBy(key: string): Promise<{ ms: number; requests: number; bytes: number }> {
  if (!key) {
    colouring = null;
    showLegend('', []);
    applyColouring();
    return { ms: 0, requests: 0, bytes: 0 };
  }
  const m = await measure(() => loadColouring(ds, key, COLOURS, OTHER));
  colouring = m.result;
  showLegend(key, colouring.items);
  applyColouring();
  return { ms: m.ms, requests: m.requests, bytes: m.bytes };
}
select.addEventListener('change', () => void colourBy(select.value));

// ---------------------------------------------------------------- inspect a tip

async function inspect(rank: number): Promise<{ ms: number; requests: number; bytes: number }> {
  const m = await measure(async () => {
    const [label, row, seq] = await Promise.all([ds.tipLabels(rank, rank + 1), ds.sidecarRow(rank), ds.sequence(rank)]);
    return { label: label[0], row, seq };
  });
  const { label, row, seq } = m.result;
  const body = $('inspect').querySelector('.body')!;
  const dl = document.createElement('dl');
  for (const [k, v] of Object.entries({ label, rank, ...row })) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : String(v);
    dl.append(dt, dd);
  }
  const cost = document.createElement('p');
  cost.className = 'muted';
  cost.textContent = `read in ${m.ms.toFixed(0)} ms, ${m.requests} requests, ${fmtBytes(m.bytes)}`;
  body.replaceChildren(dl);
  if (seq) {
    const p = document.createElement('div');
    p.className = 'seq';
    p.textContent = `${seq.length} bases: ${seq}`;
    body.append(p);
  }
  body.append(cost);
  $('inspect').hidden = false;
  renderStats();
  return { ms: m.ms, requests: m.requests, bytes: m.bytes };
}
viewer.on('click', (e: TreeEvent) => {
  if (e.isTip) void inspect(e.tipStart);
});

// for the browser check and the benchmark (tests/browser/scripts/check-parquet.mjs, scripts/bench.mjs)
Object.assign(window, { __parquet: { source, viewer, ds, colourBy, inspect, measure, colouring: () => colouring } });
