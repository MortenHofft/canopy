// The legend of the selections, lower right of the map: plain DOM. A row per selection: a handle to drag it up or down (the top row is
// drawn on top of the map), the colour, an eye (shows or hides the layer on the map), "show in the tree", a link to the same
// occurrences on gbif.org, the name, and remove. It holds no state: `render(items)` draws the list it is given and the handlers say what
// was asked.

import { occurrenceUrl, MAX_KEYS, type SelectedNode } from './selection.ts';

export interface LegendHandlers {
  colour(node: number, colour: string): void;
  visible(node: number, visible: boolean): void;
  zoom(node: number): void;
  remove(node: number): void;
  clear(): void;
  /** move the row at index `from` to index `to` */
  move(from: number, to: number): void;
}

const ICONS = {
  handle:
    '<circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  tree: '<path d="M4 12h5m0 0V6m0 6v6M9 6h4m-4 12h4"/><circle cx="16" cy="6" r="2"/><circle cx="16" cy="18" r="2"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
  trash: '<path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
};
const NS = 'http://www.w3.org/2000/svg';

function icon(name: keyof typeof ICONS): SVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', name === 'handle' ? 'currentColor' : 'none');
  svg.setAttribute('stroke', name === 'handle' ? 'none' : 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICONS[name];
  return svg;
}

function button(name: keyof typeof ICONS, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'legend-action';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(icon(name));
  b.addEventListener('click', onClick);
  return b;
}

export class Legend {
  private readonly header = document.createElement('div');
  private readonly count = document.createElement('span');
  private readonly list = document.createElement('ul');
  private items: SelectedNode[] = [];

  constructor(
    readonly element: HTMLElement,
    private readonly on: LegendHandlers,
  ) {
    element.classList.add('legend');
    element.setAttribute('aria-label', 'Selected clades');
    this.header.className = 'legend-header';
    this.header.append(
      this.count,
      button('trash', 'Remove all', () => this.on.clear()),
    );
    this.list.className = 'legend-list';
    element.append(this.header, this.list);
  }

  render(items: SelectedNode[], focusNode?: number): void {
    this.items = items;
    this.count.textContent = items.length === 0 ? 'Nothing selected' : items.length === 1 ? '1 clade selected' : `${items.length} clades selected`;
    this.element.classList.toggle('legend--empty', items.length === 0);
    const rows = items.map((item, index) => this.row(item, index));
    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'legend-empty';
      li.textContent = 'Click a node in the tree to show it on the map';
      rows.push(li);
    }
    this.list.replaceChildren(...rows);
    if (focusNode !== undefined) this.list.querySelector<HTMLElement>(`[data-node="${focusNode}"] .legend-handle`)?.focus();
  }

  private row(item: SelectedNode, index: number): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'legend-item';
    li.dataset.node = String(item.node);
    li.classList.toggle('legend-item--hidden', !item.visible);

    const handle = document.createElement('span');
    handle.className = 'legend-handle';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'button');
    handle.setAttribute('aria-label', `Move ${item.name}: drag, or press the up and down arrow keys`);
    handle.title = 'Drag to change the order';
    handle.append(icon('handle'));
    // a row is draggable by its handle only, so the colour input and the buttons keep their own gestures
    handle.addEventListener('pointerdown', () => (li.draggable = true));
    li.addEventListener('dragend', () => {
      li.draggable = false;
      li.classList.remove('legend-item--dragging');
    });
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', String(index));
      li.classList.add('legend-item--dragging');
    });
    li.addEventListener('dragover', (e) => e.preventDefault());
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer?.getData('text/plain'));
      if (Number.isInteger(from) && from !== index) this.on.move(from, index);
    });
    handle.addEventListener('keydown', (e) => {
      const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : -1;
      if (to < 0 || to >= this.items.length) return;
      e.preventDefault();
      this.on.move(index, to);
    });

    const colour = document.createElement('input');
    colour.type = 'color';
    colour.className = 'legend-colour';
    colour.value = item.colour;
    colour.setAttribute('aria-label', `Colour of ${item.name}`);
    colour.addEventListener('input', () => this.on.colour(item.node, colour.value));

    const name = document.createElement('div');
    name.className = 'legend-name';
    const title = document.createElement('span');
    title.className = 'legend-title';
    title.textContent = item.name;
    const detail = document.createElement('span');
    detail.className = 'legend-detail';
    detail.textContent =
      item.total === 0
        ? 'no GBIF match'
        : item.total > MAX_KEYS
          ? `first ${MAX_KEYS} of ${item.total} taxa`
          : `${item.total} ${item.total === 1 ? 'taxon' : 'taxa'}`;
    name.append(title, detail);

    li.append(handle, colour);
    if (item.keys.length > 0) {
      li.append(
        button(item.visible ? 'eye' : 'eyeOff', item.visible ? 'Hide on the map' : 'Show on the map', () =>
          this.on.visible(item.node, !item.visible),
        ),
      );
    } else li.append(document.createElement('span')); // keeps the columns of the grid
    li.append(button('tree', 'Show this clade in the tree', () => this.on.zoom(item.node)));
    if (item.keys.length > 0) {
      const a = document.createElement('a');
      a.className = 'legend-action';
      a.href = occurrenceUrl(item.keys);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = 'See these occurrences on gbif.org';
      a.setAttribute('aria-label', 'See these occurrences on gbif.org');
      a.append(icon('filter'));
      li.append(a);
    } else li.append(document.createElement('span'));
    li.append(
      name,
      button('trash', 'Remove', () => this.on.remove(item.node)),
    );
    return li;
  }
}
