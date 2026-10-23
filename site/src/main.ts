// The hub: one card per page in examples.json (the same list scripts/build-site.mjs builds), and the build facts in the footer.

import '../../examples/react/src/gbif-tokens.css';
import './style.css';
import examples from './examples.json';

declare const __BUILD__: { commit: string; branch: string; env: string; time: string };

interface Example {
  id: string;
  dir: string;
  kind: 'playground' | 'showcase' | 'spike';
  title: string;
  description: string;
  tags: string[];
}

const REPO = 'https://github.com/MortenHofft/gbif-phylo';
const ref = __BUILD__.branch && __BUILD__.branch !== 'HEAD' ? __BUILD__.branch : 'main';

function card(e: Example): HTMLElement {
  const a = document.createElement('article');
  a.className = 'demo card';
  a.innerHTML = `
    <a class="thumb" href="/${e.id}/" tabindex="-1" aria-hidden="true"><img src="/thumbs/${e.id}.jpg" alt="" loading="lazy" width="640" height="400" /></a>
    <div class="demo-body">
      <h3><a href="/${e.id}/"></a></h3>
      <p></p>
      <ul class="tags"></ul>
      <p class="demo-links"><a class="btn btn-primary" href="/${e.id}/">Open</a> <a class="btn btn-tertiary src" href="${REPO}/tree/${encodeURIComponent(ref)}/${e.dir}">Source</a></p>
    </div>`;
  a.querySelector('h3 a')!.textContent = e.title;
  a.querySelector('.demo-body > p')!.textContent = e.description;
  for (const t of e.tags) {
    const li = document.createElement('li');
    li.textContent = t;
    a.querySelector('.tags')!.append(li);
  }
  // a missing thumbnail leaves the card without a picture, not with a broken image
  a.querySelector('img')!.addEventListener('error', (ev) => (ev.target as HTMLElement).closest('.thumb')!.remove());
  return a;
}

for (const e of examples as Example[]) document.getElementById(`${e.kind}-cards`)!.append(card(e));

const b = __BUILD__;
const commit = b.commit ? `<a href="${REPO}/commit/${b.commit}">${b.commit}</a>` : 'unknown commit';
document.getElementById('build')!.innerHTML = `Built ${b.time} from ${commit} on <code>${ref}</code> (${b.env}). Apache-2.0.`;
for (const id of ['repo-link', 'api-link']) {
  const l = document.getElementById(id) as HTMLAnchorElement;
  l.href = l.href.replace('/blob/main/', `/blob/${encodeURIComponent(ref)}/`);
}
