// What a selection of a node is, apart from the page: the taxon keys of a node, the urls of GBIF's map and search for them, the palette,
// the name in the legend. Plain functions with no DOM and no map, so the page and the check agree on them.

import type { SidecarBinding, TreeModel } from '@canopy/io';

/** The checklist the taxon keys of the sidecar belong to: GBIF's map and occurrence search need it for these keys (without it the map
 *  answers with an empty tile). */
export const CHECKLIST_KEY = '7ddf754f-d193-4cc9-b351-99906754a03b';

/** As in the proof of concept (labs-phylogeny): the first 200 taxon keys of a selection go to the map and to the search link. */
export const MAX_KEYS = 200;

export interface SelectedNode {
  node: number;
  colour: string;
  /** shown on the map; the colour in the tree stays */
  visible: boolean;
  /** at most MAX_KEYS of the taxon keys of the node, the ones the map and the link use */
  keys: string[];
  /** how many taxon keys the node has, before the cut */
  total: number;
  name: string;
  tips: number;
}

/** The taxon keys a node stands for: its own key if the sidecar has a row for the node (a matched name such as the root `Acacia`), else
 *  the keys of the matched tips below it, in tree order. `total` is their number, `keys` the first MAX_KEYS. */
export function taxonKeysOf(tree: TreeModel, binding: SidecarBinding, node: number): { keys: string[]; total: number } {
  const own = binding.get(node, 'taxonKey');
  if (own !== undefined) return { keys: [String(own)], total: 1 };
  const keys: string[] = [];
  let total = 0;
  for (let r = tree.leafStart[node]; r < tree.leafEnd[node]; r++) {
    const key = binding.get(tree.tipNode[r], 'taxonKey');
    if (key === undefined) continue;
    total++;
    if (keys.length < MAX_KEYS) keys.push(String(key));
  }
  return { keys, total };
}

/** The name in the legend: the GBIF name of the node, else its name in the tree, else how many tips it holds. */
export function nodeName(tree: TreeModel, binding: SidecarBinding, node: number): string {
  const gbif = binding.get(node, 'scientificName');
  if (gbif !== undefined) return String(gbif);
  const label = tree.nodeName(node);
  if (label !== '') return label.replace(/_/g, ' ');
  const n = tree.leafEnd[node] - tree.leafStart[node];
  return `Clade of ${n} tips`;
}

const taxa = (keys: string[]): string => keys.map((k) => `&taxonKey=${encodeURIComponent(k)}`).join('');

/** The vector tiles of GBIF's occurrence map for these taxon keys (the `{z}/{x}/{y}` are maplibre's). */
export function tileUrl(keys: string[]): string {
  return (
    'https://api.gbif.org/v2/map/occurrence/adhoc/{z}/{x}/{y}.mvt?style=scaled.circles&mode=GEO_CENTROID&occurrenceStatus=present' +
    `&srs=EPSG%3A3857&squareSize=512&hasGeospatialIssue=false&checklistKey=${CHECKLIST_KEY}${taxa(keys)}`
  );
}

/** The same occurrences in the search on gbif.org, shown as a map. */
export function occurrenceUrl(keys: string[]): string {
  return `https://www.gbif.org/occurrence/search?view=MAP&checklistKey=${CHECKLIST_KEY}${taxa(keys)}`;
}

/** The colours for the selections, in turn: each family of the GBIF design tokens (`--<family>-100`), then the same families lighter
 *  (`-300`). Read from the page's custom properties, so a change of a token reaches the map and the tree. */
const FAMILIES = ['green', 'blue', 'fuchsia', 'purple', 'periwinkle', 'orange', 'lightblue', 'peach', 'yellow'];
export function paletteFromTokens(style: CSSStyleDeclaration): string[] {
  const colours: string[] = [];
  for (const shade of [100, 300])
    for (const family of FAMILIES) {
      const v = style.getPropertyValue(`--${family}-${shade}`).trim();
      if (v) colours.push(v);
    }
  return colours;
}

/** The first colour of the palette that no selection uses; when all are in use, the least used. */
export function nextColour(palette: string[], used: string[]): string {
  const count = (c: string): number => used.filter((u) => u.toLowerCase() === c.toLowerCase()).length;
  let best = palette[0];
  for (const c of palette) if (count(c) < count(best)) best = c;
  return best;
}

/** A colour 30% darker, for the outline of the circles (`#rrggbb` in, `#rrggbb` out). */
export function darker(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (shift: number): string =>
    Math.round(((n >> shift) & 255) * 0.7)
      .toString(16)
      .padStart(2, '0');
  return `#${f(16)}${f(8)}${f(0)}`;
}
