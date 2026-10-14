import './hub.css';

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
  const none = f.candidates.filter((c) => c.kind !== 'design' && ['tip', 'node', 'clade', 'cols', 'scale', 'overview'].every((d) => c.cells[d]?.c === 'y')).length;
  const items = [
    [String(f.candidates.filter((c) => c.kind !== 'design').length), 'libraries compared'],
    [String(tested), 'libraries being tested in a browser'],
    [String(built.length), 'demos online now'],
    [String(none), 'libraries that meet tip and node events, clade colouring, columns, overview and scale together'],
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

async function renderMeasured() {
  const body = $('#measured-body');
  const idx = await getJson<Record<string, string>>('results/index.json');
  if (!idx || !Object.keys(idx).length) {
    body.innerHTML = '<p>No automated runs are included in this build yet. The runner (<code>spikes/runner</code>) drives each demo with real mouse and wheel input and records pass, partial, fail or timeout for 15 scenarios and the timing for each tree size.</p>';
    return;
  }
  const runs = await Promise.all(Object.entries(idx).map(async ([name, file]) => [name, await getJson<any>(`results/${file}`)] as const));
  const ok = runs.filter(([, r]) => r);
  if (!ok.length) { body.innerHTML = '<p>Result files could not be loaded.</p>'; return; }
  // Tolerant renderer: expects { scenarios: { S1: { status, ... } } } or { results: [{ scenario, status }] }
  const scen = (r: any): Record<string, string> => {
    const out: Record<string, string> = {};
    if (r?.scenarios && !Array.isArray(r.scenarios)) for (const [k, v] of Object.entries<any>(r.scenarios)) out[k] = v?.status ?? String(v);
    else if (Array.isArray(r?.scenarios)) for (const s of r.scenarios) out[s.id ?? s.scenario] = s.status;
    else if (Array.isArray(r?.results)) for (const s of r.results) out[s.scenario ?? s.id] = out[s.scenario ?? s.id] === 'fail' ? 'fail' : s.status;
    return out;
  };
  const ids = Array.from(new Set(ok.flatMap(([, r]) => Object.keys(scen(r))))).sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));
  const head = `<tr><th>Library</th>${ids.map((i) => `<th>${esc(i)}</th>`).join('')}</tr>`;
  const rows = ok.map(([name, r]) => {
    const s = scen(r);
    return `<tr><td><a href="#card-${name}">${esc(name)}</a></td>${ids.map((i) => `<td>${s[i] ? `<span class="status ${esc(s[i])}">${esc(s[i])}</span>` : ''}</td>`).join('')}</tr>`;
  }).join('');
  body.innerHTML = `<p>Latest automated run per library (headless Chromium, no GPU). Scenario definitions: <a href="${blob('docs/spike-plan.md')}">spike plan</a>.</p><div class="table-scroll"><table class="scorecard"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
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
