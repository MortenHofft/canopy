// The map: maplibre with GBIF's basemaps and one layer of GBIF's occurrence map per selection (as the proof of concept labs-phylogeny
// did). `sync(items)` brings the layers in line with the list: added, recoloured, shown or hidden, and in the order of the list (the
// first is drawn on top). It does the same again after a change of basemap, which drops the layers.

import 'maplibre-gl/dist/maplibre-gl.css';
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
// the tile worker as a file of its own that the bundler builds and serves (maplibre cannot find it itself in a bundled app)
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { darker, tileUrl, type SelectedNode } from './selection.ts';

export const BASEMAPS = [
  { id: 'gbif-classic', title: 'Classic' },
  { id: 'gbif-light', title: 'Light' },
  { id: 'gbif-natural', title: 'Natural' },
  { id: 'gbif-dark', title: 'Dark' },
];

// GBIF serves 512 px tiles at @1x and the same extent at higher resolution for @2x
const pixelRatio = window.devicePixelRatio > 1 ? 2 : 1;

function baseStyle(style: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: [`https://tile.gbif.org/3857/omt/{z}/{x}/{y}@${pixelRatio}x.png?style=${style}`],
        tileSize: 512,
        attribution:
          '<a href="https://www.gbif.org/citation-guidelines">GBIF</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
  };
}

setWorkerUrl(workerUrl);

export const layerId = (node: number): string => `occurrences-${node}`;

export class OccurrenceMap {
  readonly map: MapLibreMap;
  private items: SelectedNode[] = [];
  private styleReady = false;
  private base = 'gbif-light';

  constructor(container: HTMLElement) {
    this.map = new MapLibreMap({ container, style: baseStyle(this.base), zoom: 1, center: [10, 20] });
    this.map.addControl(new NavigationControl({ showCompass: false }), 'top-left');
    // the style is ready (again) at the start and after setStyle: only then can layers be added
    this.map.on('style.load', () => {
      this.styleReady = true;
      this.sync(this.items);
    });
    new ResizeObserver(() => this.map.resize()).observe(container);
  }

  setBasemap(id: string): void {
    if (id === this.base) return;
    this.base = id;
    this.styleReady = false;
    this.map.setStyle(baseStyle(id), { diff: false }); // a full reload, so `style.load` follows and the layers come back
  }

  sync(items: SelectedNode[]): void {
    this.items = items;
    if (!this.styleReady) return;
    const map = this.map;
    const wanted = new Set(items.filter((i) => i.keys.length > 0).map((i) => layerId(i.node)));
    for (const l of map.getStyle().layers) {
      if (l.id.startsWith('occurrences-') && !wanted.has(l.id)) {
        map.removeLayer(l.id);
        map.removeSource(l.id);
      }
    }
    for (const item of items) {
      if (item.keys.length === 0) continue; // no taxon key, nothing to ask GBIF for
      const id = layerId(item.node);
      if (!map.getLayer(id)) {
        map.addLayer({
          id,
          type: 'circle',
          source: { type: 'vector', tiles: [tileUrl(item.keys)] },
          'source-layer': 'occurrence',
          paint: {
            // the circles grow with the number of occurrences they stand for
            'circle-radius': ['step', ['get', 'total'], 2, 10, 3, 100, 5, 1000, 8, 10000, 15],
            'circle-color': item.colour,
            'circle-stroke-color': darker(item.colour),
            'circle-stroke-width': 1,
          },
        });
      }
      map.setPaintProperty(id, 'circle-color', item.colour);
      map.setPaintProperty(id, 'circle-stroke-color', darker(item.colour));
      map.setLayoutProperty(id, 'visibility', item.visible ? 'visible' : 'none');
    }
    // the first item is drawn on top: move the others up in turn, from the last
    for (let k = items.length - 1; k >= 0; k--) if (map.getLayer(layerId(items[k].node))) map.moveLayer(layerId(items[k].node));
  }
}
