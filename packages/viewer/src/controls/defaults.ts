// The usual set of controls. Each key turns one on (true, or its options) or off (false); zoom and fit are on by default, the others
// off. The order is the order they are added, which is their order within a corner.

import type { Control } from '../control.ts';
import { Fit, type FitOptions } from './fit.ts';
import { LayoutToggle, type LayoutToggleOptions } from './layout-toggle.ts';
import { Legend, type LegendOptions } from './legend.ts';
import { OverviewControl } from './overview.ts';
import { Search, type SearchOptions } from './search.ts';
import { Zoom, type ZoomOptions } from './zoom.ts';

export interface DefaultControlsOptions {
  zoom?: boolean | ZoomOptions;
  fit?: boolean | FitOptions;
  layoutToggle?: boolean | LayoutToggleOptions;
  search?: boolean | SearchOptions;
  legend?: boolean | LegendOptions;
  overview?: boolean;
}

export function defaultControls(o: DefaultControlsOptions = {}): Control[] {
  const opt = <T extends object>(v: boolean | T | undefined, on: boolean): T | null =>
    v === undefined ? (on ? ({} as T) : null) : v === false ? null : v === true ? ({} as T) : v;
  const out: Control[] = [];
  const zoom = opt(o.zoom, true);
  if (zoom) out.push(new Zoom(zoom));
  const fit = opt(o.fit, true);
  if (fit) out.push(new Fit(fit));
  const lt = opt(o.layoutToggle, false);
  if (lt) out.push(new LayoutToggle(lt));
  const search = opt(o.search, false);
  if (search) out.push(new Search(search));
  const legend = opt(o.legend, false);
  if (legend) out.push(new Legend(legend));
  if (o.overview) out.push(new OverviewControl());
  return out;
}
