// Tooltip: a small box near the pointer naming what is under it (a tip, a clade, a collapsed clade, a run of small siblings). It is a
// DEFAULT action of the hover event, so a hover listener that calls `preventDefault()` keeps it hidden for that hover. Content: the
// default text, or `render(event, viewer)` returning a node, a string, or null for none.

import { BaseControl, type ControlOptions } from '../control.ts';
import type { TreeEvent } from '../events.ts';
import type { TreeViewer } from '../viewer.ts';

export interface TooltipOptions extends Omit<ControlOptions, 'position' | 'target'> {
  render?(e: TreeEvent, viewer: TreeViewer): Node | string | null;
  /** From the pointer, px. Default [14, 14]. */
  offset?: [number, number];
}

export class Tooltip extends BaseControl {
  private opts: TooltipOptions;

  constructor(opts: TooltipOptions = {}) {
    super('tooltip', { ...opts, position: 'custom' });
    this.opts = opts;
    this.element.setAttribute('role', 'tooltip');
    this.element.dataset.treeviewTooltip = '';
    const s = this.element.style;
    s.position = 'absolute';
    s.left = '0';
    s.top = '0';
    s.pointerEvents = 'none';
    this.element.hidden = true;
  }

  protected attach(v: TreeViewer): void {
    this.listen(v.on('hover', (e) => (e ? this.show(v, e) : this.hide()), { asDefault: true }));
    this.listen(v.on('click', () => this.hide())); // a click (a menu opening, say) hides it until the next hover
  }

  protected detach(): void {
    this.hide();
  }

  hide(): void {
    this.element.hidden = true;
    this.element.replaceChildren();
  }

  private show(v: TreeViewer, e: TreeEvent): void {
    const content = this.opts.render ? this.opts.render(e, v) : defaultTooltip(e, v);
    if (content === null || content === '') return this.hide();
    this.element.replaceChildren(content);
    this.element.hidden = false;
    const r = v.element.getBoundingClientRect();
    const [ox, oy] = this.opts.offset ?? [14, 14];
    const w = this.element.offsetWidth,
      h = this.element.offsetHeight;
    // right and below the pointer; flipped to the other side when it would leave the viewer
    let x = e.clientX - r.left + ox,
      y = e.clientY - r.top + oy;
    if (x + w > r.width - 4) x = Math.max(4, e.clientX - r.left - ox - w);
    if (y + h > r.height - 4) y = Math.max(4, e.clientY - r.top - oy - h);
    this.element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}

/** The default content: a title line (the tip label in italics, or what kind of clade) and the node's name under it. */
export function defaultTooltip(e: TreeEvent, v: TreeViewer): Node {
  const t = v.getTree();
  const row = t.globalId === null ? e.node : t.toLocal(e.node);
  const name = row >= 0 ? (t.labels[row] ?? '') : '';
  const box = document.createDocumentFragment();
  const title = document.createElement('div');
  title.className = 'phylo-tooltip__title';
  if (e.isTip) {
    title.classList.add('phylo-tooltip__title--tip');
    title.textContent = v.options.formatLabel(e.tipId ?? '');
  } else title.textContent = e.run ? runText(e) : e.kind === 'summary' ? `Collapsed clade, ${n(e.tipCount)} tips` : `Clade, ${n(e.tipCount)} tips`;
  box.append(title);
  const sub = !e.isTip && (e.run ? `under ${name || 'an unnamed node'}` : name);
  if (sub) {
    const d = document.createElement('div');
    d.className = 'phylo-tooltip__detail';
    d.textContent = sub;
    box.append(d);
  }
  return box;
}

const n = (v: number) => v.toLocaleString('en');

/** Headline of a run of small siblings: '6,900 tips in 3,450 clades and 12 single tips'. */
function runText(e: TreeEvent): string {
  const r = e.run!;
  const parts: string[] = [];
  if (r.clades) parts.push(`${n(r.clades)} ${r.clades === 1 ? 'clade' : 'clades'}`);
  if (r.single) parts.push(`${n(r.single)} single ${r.single === 1 ? 'tip' : 'tips'}`);
  return `${n(e.tipCount)} tips in ${parts.join(' and ')}`;
}
