import './hub.css';
import { showBuildInfo } from '../../shared/build-info.ts';

void showBuildInfo(document.getElementById('build-info'));

const REPO = 'https://github.com/MortenHofft/gbif-phylo';
const blob = (p: string) => `${REPO}/blob/main/${p}`;

type Cap = 'y' | 'p' | 'n' | 'u';
interface Cell { c: Cap; e: string; t: string }
interface Dim { id: string; label: string; group: string; help: string }
interface Cand {
  id: string; title: string; kind: 'spike' | 'design' | 'reference'; repo: string; demo: string; license: string;
  version: string; rendering: string; research: string; summary: string; verdict: string; cells: Record<string, Cell>;
}
interface Findings { asOf: string; legend: { c: Record<string, string>; e: Record<string, string> }; dimensions: Dim[]; candidates: Cand[] }
interface Built { name: string; title: string; version: string; license: string; description: string; repo: string; rendering: string; path: string }

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = (tag: string, attrs: Record<string, string> = {}, html = '') => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const label: Record<Cap, string> = { y: 'Yes', p: 'Partial', n: 'No', u: '?' };
const sym: Record<Cap, string> = { y: 'Yes', p: 'Part', n: 'No', u: '?' };

async function getJson<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url); if (!r.ok) return null; return (await r.json()) as T; } catch { return null; }
}

function renderMatrix(f: Findings) {
  const table = $<HTMLTableElement>('#matrix');
  const showRef = $<HTMLInputElement>('#t-ref');
  const showEv = $<HTMLInputElement>('#t-ev');
  const detail = $('#detail');
  const groups: { name: string; dims: Dim[] }[] = [];
  for (const d of f.dimensions) {
    const g = groups[groups.length - 1];
    if (g && g.name === d.group) g.dims.push(d); else groups.push({ name: d.group, dims: [d] });
  }
  const draw = () => {
    table.innerHTML = '';
    const thead = el('thead');
    const r1 = el('tr', { class: 'groups' });
    r1.appendChild(el('th', { class: 'first' }));
    for (const g of groups) { const th = el('th', { colspan: String(g.dims.length), class: 'gstart' }, esc(g.name)); r1.appendChild(th); }
    const r2 = el('tr', { class: 'dims' });
    r2.appendChild(el('th', { class: 'first' }, 'Library'));
    for (const g of groups) g.dims.forEach((d, i) => r2.appendChild(el('th', { class: i === 0 ? 'gstart' : '', title: d.help }, esc(d.label))));
    thead.append(r1, r2);
    const tbody = el('tbody');
    for (const c of f.candidates) {
      if (c.kind === 'reference' && !showRef.checked) continue;
      const tr = el('tr');
      const first = el('td', { class: 'first' });
      first.innerHTML = `<a class="cname" href="#card-${c.id}">${esc(c.title)}</a><span class="cmeta"><span class="badge ${c.kind}">${c.kind === 'spike' ? 'tested' : c.kind === 'design' ? 'design target' : 'not tested'}</span> ${esc(c.license)}</span>`;
      tr.appendChild(first);
      for (const g of groups) g.dims.forEach((d, i) => {
        const cell = c.cells[d.id];
        const td = el('td', { class: i === 0 ? 'gstart' : '' });
        if (cell) {
          const b = el('button', { class: `chip ${cell.c}`, type: 'button', title: `${c.title}: ${d.label}: ${label[cell.c]} (${cell.e})`, 'data-c': c.id, 'data-d': d.id },
            `${sym[cell.c]}<sup>${cell.e}</sup>`);
          b.addEventListener('click', () => {
            table.querySelectorAll('.chip.sel').forEach((x) => x.classList.remove('sel'));
            b.classList.add('sel');
            const ev = f.legend.e[cell.e] ?? '';
            detail.innerHTML = `<b>${esc(c.title)}</b> · ${esc(d.label)} · <b>${label[cell.c]}</b> · evidence <b>${cell.e}</b> (${esc(ev)})<br>${esc(cell.t) || '<i>No note.</i>'}<br><span class="note">${esc(d.help)}</span>`;
          });
          td.appendChild(b);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    table.parentElement!.classList.toggle('hide-ev', !showEv.checked);
  };
  showRef.addEventListener('change', draw);
  showEv.addEventListener('change', () => table.parentElement!.classList.toggle('hide-ev', !showEv.checked));
  draw();
  const legend = $('#legend');
  const short = (f.legend as unknown as { eShort: Record<string, string> }).eShort;
  legend.innerHTML = '<span>Capability</span> ' + (['y', 'p', 'n', 'u'] as Cap[]).map((c) => `<span class="chip ${c}">${sym[c]}</span>`).join(' ')
    + ' <span>&nbsp;Evidence</span> ' + Object.entries(short).map(([k, v]) => `<span><b>${k}</b> ${esc(v)}</span>`).join(' · ');
}

function renderCards(f: Findings, built: Built[]) {
  const wrap = $('#cards');
  const byName = new Map(built.map((b) => [b.name, b]));
  for (const c of f.candidates) {
    const b = byName.get(c.id);
    const card = el('article', { class: 'card', id: `card-${c.id}` });
    const links: string[] = [];
    if (c.kind === 'spike') {
      links.push(b ? `<a class="btn btn-primary" href="${b.path}">Open our demo</a>` : `<a class="btn btn-secondary" aria-disabled="true" href="#">Demo not built yet</a>`);
    }
    if (c.demo) links.push(`<a class="btn btn-secondary" href="${esc(c.demo)}" rel="noopener">Project demo</a>`);
    if (c.repo) links.push(`<a class="btn btn-secondary" href="${esc(c.repo)}" rel="noopener">Source</a>`);
    links.push(`<a class="btn btn-tertiary" href="${blob(c.research)}" rel="noopener">Research notes</a>`);
    const version = b?.version || c.version;
    card.innerHTML = `
      <div class="card-header">
        <h3 class="card-title">${esc(c.title)} <span class="badge ${c.kind}">${c.kind === 'spike' ? 'tested' : c.kind === 'design' ? 'design target' : 'not tested'}</span></h3>
      </div>
      <div class="card-body">
        <p>${esc(b?.description || c.summary)}</p>
        <div class="facts"><span>Licence <b>${esc(c.license)}</b></span>${version ? `<span>Version <b>${esc(version)}</b></span>` : ''}<span>Rendering <b>${esc(b?.rendering || c.rendering)}</b></span></div>
        <p class="verdict">${esc(c.verdict)}</p>
        <div class="links">${links.join('')}</div>
      </div>`;
    wrap.appendChild(card);
  }
}

function renderCallouts(f: Findings, built: Built[]) {
  const tested = f.candidates.filter((c) => c.kind === 'spike').length;
  const all = ['tip', 'node', 'clade', 'cols', 'scale', 'overview'];
  const meet = f.candidates.filter((c) => c.kind !== 'reference' && all.every((d) => c.cells[d]?.c === 'y'));
  const items: [string, string][] = [
    [String(f.candidates.filter((c) => c.kind !== 'reference' || true).length), 'libraries and builds compared'],
    [String(tested), 'tested in a browser with the same 15 scenarios'],
    [String(built.filter((b) => b.name !== 'stub').length), 'demos online now'],
    [String(meet.length), `meet tip and node events, clade colouring, columns, overview and scale together${meet.length ? ': ' + meet.map((c) => c.title).join(', ') : ''}`],
  ];
  $('#callouts').innerHTML = items.map(([n, l]) => `<div class="callout"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`).join('');
}

interface TreeEntry { id: string; label?: string; tips?: number; hasLengths?: boolean; ultrametric?: boolean; bytes?: number; groups?: string[]; licence?: string }
async function renderData() {
  const body = $('#data-body');
  const list = await getJson<TreeEntry[]>('data/available.json');
  $<HTMLAnchorElement>('#data-readme').href = blob('data/README.md');
  if (!list || !list.length) { body.innerHTML = '<p>No test trees are bundled with this build. Run the site locally with the repository data, or see the <a href="' + blob('data/README.md') + '">data README</a>.</p>'; return; }
  const rows = list.map((t) => `<tr><td>${esc(t.label ?? t.id)}</td><td class="text-end">${(t.tips ?? 0).toLocaleString('en')}</td><td>${t.hasLengths ? (t.ultrametric ? 'dated' : 'yes') : 'none'}</td><td class="text-end">${t.bytes ? (t.bytes / 1e6).toFixed(1) + ' MB' : ''}</td><td class="note">${esc(t.licence ?? '')}</td></tr>`).join('');
  body.innerHTML = `<p>${list.length} trees are bundled here. The 1 million tip trees are too large to host; see the <a href="${blob('data/README.md')}">data README</a> for how to fetch or generate them.</p>
    <div class="table-scroll"><table class="table-captions"><thead><tr><th>Tree</th><th class="text-end">Tips</th><th>Branch lengths</th><th class="text-end">File</th><th>Licence</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

interface FinalTree { treeId: string; tips: number; status: string; reason: string; firstRenderMs?: number; fpsMedian?: number; droppedRatio?: number; cpuMsPerStep?: number; clickMs?: number; heapMB?: number }
interface FinalCand { version?: string; license?: string; date?: string; load?: { start: number; end: number; max: number; noisy: boolean }; machine?: string; runIds: string[]; scenarios: Record<string, { status: string; reason: string }>; trees: FinalTree[] }
interface Final { generated: string; candidates: Record<string, FinalCand> }

const SCENARIOS: [string, string][] = [
  ['S1', 'Load and scale'], ['S2', 'Click a tip'], ['S3', 'Click a node, get its tips'], ['S4', 'Colour clades from React'],
  ['S5', 'Highlight and focus a tip'], ['S6', 'Tip labels as links'], ['S7', 'Custom column'], ['S8', 'Alignment column'],
  ['S9', 'Theme and dark mode'], ['S10', 'Zoom out, overview'], ['S11', 'Branch lengths'], ['S12', 'Radial layout'],
  ['S13', 'Two instances'], ['S14', 'Keyboard'], ['S15', 'Linked view (clade to map)'],
];
const statusClass = (s: string) => (s === 'n/a' || s === 'skipped' ? 'unsupported' : s);
const ms = (v?: number) => (v == null ? '' : v >= 10000 ? `${(v / 1000).toFixed(0)} s` : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

async function renderMeasured() {
  const body = $('#measured-body');
  const fin = await getJson<Final>('results/final.json');
  if (!fin || !Object.keys(fin.candidates).length) {
    body.innerHTML = '<p>No automated runs are included in this build. The runner (<code>spikes/runner</code>) drives each demo with real mouse and wheel input and records pass, partial, fail or timeout for 15 scenarios and the timing for each tree size.</p>';
    return;
  }
  const names = Object.keys(fin.candidates);
  const head = `<tr><th>Scenario</th>${names.map((n) => `<th><a href="#card-${n}">${esc(n)}</a></th>`).join('')}</tr>`;
  const rows = SCENARIOS.map(([id, label]) => {
    const cells = names.map((n) => {
      const sc = fin.candidates[n].scenarios[id];
      if (!sc) return '<td></td>';
      let txt = sc.status;
      if (id === 'S1') { const t = fin.candidates[n].trees; const p = t.filter((x) => x.status === 'pass').length; txt = `${p}/${t.length} trees`; }
      return `<td><span class="status ${esc(statusClass(sc.status))}" title="${esc(sc.reason)}">${esc(txt)}</span></td>`;
    }).join('');
    return `<tr><th scope="row" title="${esc(label)}">${id} <span class="note">${esc(label)}</span></th>${cells}</tr>`;
  }).join('');
  const rungs = ['syn-yule-1000', 'syn-yule-10000', 'syn-yule-100000', 'syn-yule-1000000'];
  const scaleHead = `<tr><th>Library</th><th>Tips</th><th class="text-end">First render</th><th class="text-end">Median fps</th><th class="text-end">Slow frames</th><th class="text-end">CPU per step</th><th class="text-end">Click</th><th>Status</th></tr>`;
  const scaleRows = names.map((n) => fin.candidates[n].trees.filter((t) => rungs.includes(t.treeId)).sort((a, b) => a.tips - b.tips).map((t) =>
    `<tr><td>${esc(n)}</td><td class="text-end">${t.tips.toLocaleString('en')}</td><td class="text-end">${ms(t.firstRenderMs)}</td><td class="text-end">${t.fpsMedian?.toFixed(0) ?? ''}</td><td class="text-end">${t.droppedRatio == null ? '' : Math.round(t.droppedRatio * 100) + '%'}</td><td class="text-end">${ms(t.cpuMsPerStep)}</td><td class="text-end">${ms(t.clickMs)}</td><td><span class="status ${esc(statusClass(t.status))}" title="${esc(t.reason)}">${esc(t.status)}</span></td></tr>`).join('')).join('');
  const any = fin.candidates[names[0]];
  body.innerHTML = `
    <p>Final runs of the 15 scenarios in <a href="${blob('docs/spike-plan.md')}">the spike plan</a>, one library at a time on an otherwise idle machine, in headless Chromium ${esc(any.machine ?? '')} (<b>no GPU</b>, so canvas and WebGL frame rates are pessimistic). Hover a status for the reason. Full write-up: <a href="${blob('docs/results/summary.md')}">results summary</a>. A library is called unusable when it spends more than half its time in frames over 50 ms, takes more than 100 ms of main-thread CPU per interaction step, loads for over 10 s, or takes over 300 ms to respond to a click.</p>
    <div class="table-scroll"><table class="scorecard"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
    <h3 class="subhead">Scale on balanced (Yule) trees</h3>
    <div class="table-scroll"><table class="scorecard table-captions"><thead>${scaleHead}</thead><tbody>${scaleRows}</tbody></table></div>
    <p class="note">The custom baseline is a prototype built during this spike (about 3,100 lines); the others are existing libraries used as a gbif.org developer would use them (Taxonium is GPL-3.0 and is shown for comparison only). Absolute numbers vary between rounds because the test machine's speed varies; ratios between libraries are stable. 100k trees that took over 10 s to load are not interaction-tested. Caterpillar (ladderised) trees of 10k tips overflow the call stack in every library except Phylocanvas.gl.</p>`;
}

async function main() {
  const [f, built] = await Promise.all([getJson<Findings>('findings.json'), getJson<Built[]>('candidates.json')]);
  if (!f) { $('#findings .card-body').textContent = 'findings.json could not be loaded.'; return; }
  $('#as-of').textContent = `Updated ${f.asOf}`;
  const b = built ?? [];
  renderCallouts(f, b);
  renderMatrix(f);
  renderCards(f, b);
  await Promise.all([renderMeasured(), renderData()]);
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
main();
