// Shows which build is being looked at. scripts/build-site.mjs writes /version.json at the root of the deployed site
// ({ sha, ref, env, builtAt, dirty }); this fills a footer element from it. Without the file (dev server, or an
// older deployment) it says so, so the footer never shows a stale or invented value.

const REPO = 'https://github.com/MortenHofft/gbif-phylo';

interface BuildInfo { sha: string; ref: string; env: string; builtAt: string; dirty?: boolean }

export async function showBuildInfo(el: HTMLElement | null): Promise<void> {
  if (!el) return;
  el.style.fontFamily = 'var(--font-mono, monospace)';
  el.style.fontSize = '12px';
  el.style.opacity = '0.85';
  try {
    const r = await fetch('/version.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const v = (await r.json()) as BuildInfo;
    if (!v || typeof v.sha !== 'string') throw new Error('bad version.json');
    const short = v.sha.slice(0, 7);
    el.textContent = '';
    el.append('Build ');
    const a = document.createElement('a');
    a.href = `${REPO}/commit/${v.sha}`;
    a.textContent = short + (v.dirty ? '+local changes' : '');
    el.append(a, ` · ${v.ref || 'unknown branch'} · ${v.env}` + ` · built ${v.builtAt.replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, ' UTC')}`);
  } catch {
    el.textContent = 'Build: local development (no version.json)';
  }
}
