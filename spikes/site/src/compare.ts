import './compare.css';
import { showBuildInfo } from '../../shared/build-info.ts';

void showBuildInfo(document.getElementById('build-info'));
import { catalogue, loadTree, loadColumns } from '../../shared/data.ts';
import { parseNewick } from '../../shared/newick.ts';
import type { TreeModel } from '../../shared/tree.ts';
import type { SpikeApi, SpikeEvent, Layout } from '../../shared/types.ts';

interface Built { name: string; title: string; version: string; path: string }
interface Avail { id: string }

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Clade colours come from the GBIF palette tokens, never hardcoded.
const token = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const CLADE_COLOURS = ['--purple-100', '--lightblue-100', '--fuchsia-100', '--peach-100', '--periwinkle-100'];

interface Frame { built: Built; wrap: HTMLElement; iframe: HTMLIFrameElement; meta: HTMLElement; api: SpikeApi | null; mountInfo: string; caps: string; last: SpikeEvent | null }
const frames: Frame[] = [];
let tree: TreeModel | null = null;
let treeId = '';
let dark = false;
let links = false;
let rng = 12345;
const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

function status(msg: string) { $('#status').textContent = msg; }

async function getJson<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

function pickClades(n: number): string[] {
  if (!tree) return [];
  const lo = Math.max(3, Math.floor(tree.tipCount * 0.01)), hi = Math.max(6, Math.floor(tree.tipCount * 0.15));
  const ids: string[] = [];
  const used: [number, number][] = [];
  for (let tries = 0; tries < 400 && ids.length < n; tries++) {
    const i = 1 + Math.floor(rand() * (tree.nodeCount - 1));
    if (tree.tipRank[i] >= 0) continue;
    const size = tree.leafEnd[i] - tree.leafStart[i];
    if (size < lo || size > hi) continue;
    if (used.some(([a, b]) => tree!.leafStart[i] < b && a < tree!.leafEnd[i])) continue;
    used.push([tree.leafStart[i], tree.leafEnd[i]]);
    ids.push(tree.nodeId(i));
  }
  return ids;
}
function pickTips(n: number): string[] {
  if (!tree) return [];
  const out = new Set<string>();
  while (out.size < Math.min(n, tree.tipCount)) out.add(tree.tipLabels[Math.floor(rand() * tree.tipCount)]);
  return [...out];
}

async function each(label: string, fn: (f: Frame, api: SpikeApi) => Promise<unknown>) {
  await Promise.all(frames.map(async (f) => {
    if (!f.api) return;
    try { await fn(f, f.api); } catch (e) { f.wrap.querySelector('.err')!.textContent = `${label}: ${(e as Error).message}`; }
  }));
}

async function waitApi(f: Frame): Promise<SpikeApi> {
  for (let i = 0; i < 200; i++) {
    const w = f.iframe.contentWindow as (Window & { __spike?: SpikeApi }) | null;
    if (w?.__spike) { await w.__spike.ready; return w.__spike; }
    await sleep(100);
  }
  throw new Error('viewer did not expose window.__spike');
}

async function load() {
  const id = $<HTMLSelectElement>('#tree').value;
  treeId = id;
  status(`Loading ${id}…`);
  const lt = await loadTree(id);
  tree = parseNewick(lt.newick);
  const layout = ($('#layout button[aria-checked="true"]') as HTMLElement).dataset.v as Layout;
  const bl = $<HTMLInputElement>('#bl').checked;
  status(`Mounting ${frames.length} viewer(s) on ${tree.tipCount.toLocaleString('en')} tips…`);
  await Promise.all(frames.map(async (f) => {
    f.wrap.querySelector('.err')!.textContent = '';
    try {
      f.api = f.api ?? (await waitApi(f));
      await f.api.unmount().catch(() => {});
      const size = { width: f.iframe.clientWidth, height: f.iframe.clientHeight };
      const r = await f.api.mount({ treeId: id, newick: lt.newick, layout, branchLengths: bl, size });
      f.mountInfo = `parse ${Math.round(r.parseMs)} ms · first render ${Math.round(r.firstRenderMs)} ms · ${r.tips.toLocaleString('en')} tips`;
      f.meta.textContent = f.mountInfo;
      const caps = await f.api.getCapabilities();
      const v = Object.values(caps);
      f.caps = `${v.filter((c) => c.level === 'yes').length} yes · ${v.filter((c) => c.level === 'partial').length} partial · ${v.filter((c) => c.level === 'no').length} no`;
    } catch (e) {
      f.wrap.querySelector('.err')!.textContent = `mount failed: ${(e as Error).message}`;
    }
  }));
  status(`${tree.tipCount.toLocaleString('en')} tips loaded.`);
}

function buildFrames(built: Built[], chosen: string[]) {
  const host = $('#frames');
  host.innerHTML = '';
  frames.length = 0;
  for (const name of chosen) {
    const b = built.find((x) => x.name === name);
    if (!b) continue;
    const wrap = document.createElement('div');
    wrap.className = 'frame';
    wrap.innerHTML = `<div class="frame-head"><b>${esc(b.title)} <span class="note">${esc(b.version)}</span></b><span class="meta">not loaded</span></div><div class="err"></div>`;
    const iframe = document.createElement('iframe');
    iframe.title = `${b.title} viewer`;
    iframe.src = `${b.path}?embed=1`;
    wrap.appendChild(iframe);
    host.appendChild(wrap);
    frames.push({ built: b, wrap, iframe, meta: wrap.querySelector('.meta') as HTMLElement, api: null, mountInfo: '', caps: '', last: null });
  }
  const q = new URLSearchParams(location.search);
  q.set('libs', chosen.join(','));
  history.replaceState(null, '', `?${q}`);
}

async function pollEvents() {
  const tbody = $('#events tbody');
  for (;;) {
    await sleep(500);
    for (const f of frames) {
      if (!f.api) continue;
      try { const ev = await f.api.getEvents(); if (ev.length) f.last = ev[ev.length - 1]; } catch { /* viewer busy */ }
    }
    tbody.innerHTML = frames.map((f) => {
      const e = f.last;
      return `<tr><td><b>${esc(f.built.title)}</b></td><td>${e ? esc(e.type) : '<span class="note">no events yet</span>'}</td><td>${e ? esc(e.isTip ? (tree?.tipLabels[tree.tipRank[tree.nodeIndex(e.nodeId)]] ?? e.nodeId) : e.nodeId) : ''}</td><td class="text-end">${e ? e.tipIds.length.toLocaleString('en') : ''}</td><td>${e ? `<span class="status ${e.source === 'library' ? 'pass' : 'partial'}">${esc(e.source)}</span>` : ''}</td><td class="note">${esc(f.mountInfo)}</td><td class="note">${esc(f.caps)}</td></tr>`;
    }).join('');
  }
}

async function main() {
  const built = (await getJson<Built[]>('candidates.json')) ?? [];
  const avail = await getJson<Avail[]>('data/available.json');
  const ids = new Set(avail ? avail.map((a) => a.id) : catalogue.map((t) => t.id));
  const sel = $<HTMLSelectElement>('#tree');
  for (const t of catalogue.filter((t) => ids.has(t.id))) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.label ?? t.id} (${t.tips.toLocaleString('en')} tips${t.hasLengths ? '' : ', no lengths'})`;
    sel.appendChild(o);
  }
  const q = new URLSearchParams(location.search);
  if (q.get('tree') && ids.has(q.get('tree')!)) sel.value = q.get('tree')!;
  else if (ids.has('syn-yule-1000')) sel.value = 'syn-yule-1000';

  const picker = $('#picker');
  const wanted = q.get('libs') ? q.get('libs')!.split(',') : built.slice(0, 3).map((b) => b.name);
  if (!built.length) picker.insertAdjacentHTML('beforeend', '<span class="note">No demos are built into this site yet.</span>');
  for (const b of built) {
    const l = document.createElement('label');
    l.className = 'field-option';
    l.innerHTML = `<input type="checkbox" value="${esc(b.name)}" ${wanted.includes(b.name) ? 'checked' : ''}/> ${esc(b.title)} <span class="note">${esc(b.version)}</span>`;
    picker.appendChild(l);
  }
  const rebuild = () => buildFrames(built, [...picker.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.value));
  picker.addEventListener('change', rebuild);
  rebuild();

  document.querySelectorAll<HTMLElement>('#layout .btn-group-item').forEach((b) => b.addEventListener('click', async () => {
    document.querySelectorAll('#layout .btn-group-item').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    if (tree) await each('layout', (_f, a) => a.setLayout(b.dataset.v as Layout));
  }));
  $('#bl').addEventListener('change', async () => { if (tree) await each('branch lengths', (_f, a) => a.setBranchLengths($<HTMLInputElement>('#bl').checked)); });
  $('#load').addEventListener('click', () => void load().catch((e) => status(`Load failed: ${(e as Error).message}`)));
  const need = (fn: () => Promise<void>) => () => { if (!tree) return status('Load a tree first.'); void fn(); };
  $('#a-clade').addEventListener('click', need(async () => {
    const [n] = pickClades(1);
    if (!n) return status('No suitable clade in this tree.');
    await each('clade', (_f, a) => a.setColouredClades([{ nodeId: n, colour: token(CLADE_COLOURS[0]) }]));
    status(`Coloured clade ${n}.`);
  }));
  $('#a-clades2').addEventListener('click', need(async () => {
    const ns = pickClades(2);
    await each('clades', (_f, a) => a.setColouredClades(ns.map((nodeId, i) => ({ nodeId, colour: token(CLADE_COLOURS[i % CLADE_COLOURS.length]) }))));
    status(`Coloured ${ns.length} clade(s).`);
  }));
  $('#a-clear').addEventListener('click', need(async () => {
    await each('clear', async (_f, a) => { await a.setColouredClades([]); await a.highlightTips([]); });
    status('Cleared.');
  }));
  $('#a-hl').addEventListener('click', need(async () => { const t = pickTips(3); await each('highlight', (_f, a) => a.highlightTips(t)); status(`Highlighted ${t.join(', ')}.`); }));
  $('#a-focus').addEventListener('click', need(async () => { const [t] = pickTips(1); await each('focus', async (_f, a) => { await a.highlightTips([t]); await a.focusTip(t); }); status(`Focused ${t}.`); }));
  $('#a-cols').addEventListener('click', need(async () => {
    const lc = await loadColumns(treeId, tree!);
    if (!lc.columns.length) return status('This tree has no metadata columns (try a synthetic yule tree with metadata).');
    await each('columns', (_f, a) => a.setColumns(lc.columns));
    status(`Added ${lc.columns.map((c) => c.header).join(', ')}.`);
  }));
  $('#a-links').addEventListener('click', need(async () => {
    links = !links;
    await each('links', (_f, a) => a.setTipLinks(links ? (tip: string) => `https://www.gbif.org/species/search?q=${encodeURIComponent(tip.replace(/_/g, ' '))}` : null));
    status(links ? 'Tip labels now link to a GBIF species search.' : 'Tip links off.');
  }));
  $('#a-dark').addEventListener('click', need(async () => {
    dark = !dark;
    await each('theme', (_f, a) => a.setTheme({ dark }));
    $('#a-dark').textContent = dark ? 'Light theme' : 'Dark theme';
  }));
  void pollEvents();
}
main();
