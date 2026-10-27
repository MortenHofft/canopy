// Custom column renderers of this example (ColumnRenderer of @canopy/viewer): a heatmap with the value written in each cell, and a
// gene location track. Both turn the values into arrays by tip rank once (prepare) and draw only the visible rows (draw).
//
// The heatmap's colours are CSS custom properties of the page (--table-heat-low, --table-heat-high, --table-heat-text,
// --table-heat-text-strong in style.css, GBIF tokens), read by readHeatColours(); a cell is the low colour with the high colour over it at
// the value's share, which is a linear ramp between the two without parsing any colour.

import type { ColumnRenderer } from '@canopy/viewer';

export interface HeatColours {
  low: string;
  high: string;
  text: string;
  textStrong: string;
}
const heat: HeatColours = { low: '#f1f5f9', high: '#4c9b45', text: '#211f1f', textStrong: '#ffffff' };

/** Read the heatmap colours from the custom properties in force on `el`; true when they changed (redraw then). */
export function readHeatColours(el: Element): boolean {
  const cs = getComputedStyle(el);
  const next: HeatColours = {
    low: cs.getPropertyValue('--table-heat-low').trim() || heat.low,
    high: cs.getPropertyValue('--table-heat-high').trim() || heat.high,
    text: cs.getPropertyValue('--table-heat-text').trim() || heat.text,
    textStrong: cs.getPropertyValue('--table-heat-text-strong').trim() || heat.textStrong,
  };
  const changed = (Object.keys(next) as (keyof HeatColours)[]).some((k) => next[k] !== heat[k]);
  Object.assign(heat, next);
  return changed;
}

/** The tissues of the sample expression data (sources.ts), one heatmap cell each. */
export const TISSUES = ['Brain', 'Heart', 'Liver', 'Testis'];
const HEAT_MAX = 10;
const K = TISSUES.length;

/** Expression per tissue: one cell per tissue, coloured by the value (0 to HEAT_MAX), the value written in it when the row is tall
 *  enough. Values by rank, K per tip, NaN for none. */
export const heatmapRenderer: ColumnRenderer<number[], Float32Array> = {
  prepare({ values, nodeValues, tipLabels, tipNodes, tipCount }) {
    const out = new Float32Array(tipCount * K).fill(NaN);
    for (let r = 0; r < tipCount; r++) {
      const v = nodeValues?.get(tipNodes[r]) ?? values[tipLabels[r]];
      if (v) for (let k = 0; k < K; k++) out[r * K + k] = v[k];
    }
    return out;
  },
  hasCell: (data, r) => !Number.isNaN(data[r * K]),
  draw(ctx, f, data) {
    const cw = f.width / K;
    const gap = cw >= 8 && f.rowHeight >= 4 ? 1 : 0;
    const h = Math.max(1, f.rowHeight - (f.rowHeight >= 4 ? 1 : 0));
    const text = f.rowHeight >= 12 && cw >= 24;
    if (text) {
      ctx.font = `${Math.min(11, Math.floor(f.rowHeight * 0.6))}px ${f.theme.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }
    const step = f.rowHeight >= 1 ? 1 : Math.ceil(1 / f.rowHeight);
    for (let r = f.r0; r <= f.r1; r += step) {
      const y = f.oy + r * f.rowHeight;
      for (let k = 0; k < K; k++) {
        const v = data[r * K + k];
        if (Number.isNaN(v)) continue;
        const x = f.x + k * cw;
        const t = Math.max(0, Math.min(1, v / HEAT_MAX));
        ctx.globalAlpha = 1;
        ctx.fillStyle = heat.low;
        ctx.fillRect(x, y, cw - gap, h);
        ctx.globalAlpha = t;
        ctx.fillStyle = heat.high;
        ctx.fillRect(x, y, cw - gap, h);
        if (text) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = t > 0.55 ? heat.textStrong : heat.text;
          ctx.fillText(v.toFixed(1), x + (cw - gap) / 2, y + h / 2);
        }
      }
    }
    ctx.globalAlpha = 1;
  },
};

export interface Locus {
  region: string;
  start: number;
  end: number;
  strand: 1 | -1;
}

interface LocusData {
  /** By rank: the share of its region's span where the gene starts and ends, NaN for none; strand; region index. */
  a: Float64Array;
  b: Float64Array;
  strand: Int8Array;
  region: Int32Array;
}

/** Gene location: per tip a box from start to end on a line spanning every member of the same region (chromosome), with an arrow head
 *  for the strand. Members on another region are scaled to that region's span. */
export const locusRenderer: ColumnRenderer<Locus, LocusData> = {
  prepare({ values, nodeValues, tipLabels, tipNodes, tipCount }) {
    const loci: (Locus | undefined)[] = [];
    const span = new Map<string, [number, number]>();
    for (let r = 0; r < tipCount; r++) {
      const l = nodeValues?.get(tipNodes[r]) ?? values[tipLabels[r]];
      loci.push(l);
      if (!l) continue;
      const s = span.get(l.region);
      span.set(l.region, s ? [Math.min(s[0], l.start), Math.max(s[1], l.end)] : [l.start, l.end]);
    }
    const regions = [...span.keys()];
    const d: LocusData = {
      a: new Float64Array(tipCount).fill(NaN),
      b: new Float64Array(tipCount).fill(NaN),
      strand: new Int8Array(tipCount),
      region: new Int32Array(tipCount).fill(-1),
    };
    loci.forEach((l, r) => {
      if (!l) return;
      const [lo, hi] = span.get(l.region)!;
      const w = hi - lo || 1;
      d.a[r] = (l.start - lo) / w;
      d.b[r] = (l.end - lo) / w;
      d.strand[r] = l.strand;
      d.region[r] = regions.indexOf(l.region);
    });
    return d;
  },
  hasCell: (d, r) => !Number.isNaN(d.a[r]),
  draw(ctx, f, d) {
    const pad = 4;
    const w = f.width - 2 * pad;
    const step = f.rowHeight >= 1 ? 1 : Math.ceil(1 / f.rowHeight);
    const bh = Math.max(1, Math.min(8, f.rowHeight * 0.4));
    const pal = f.theme.categorical;
    for (let r = f.r0; r <= f.r1; r += step) {
      if (Number.isNaN(d.a[r])) continue;
      const cy = f.oy + (r + 0.5) * f.rowHeight;
      ctx.fillStyle = f.theme.muted;
      ctx.globalAlpha = 0.4;
      ctx.fillRect(f.x + pad, cy - 0.5, w, 1);
      ctx.globalAlpha = 1;
      const x0 = f.x + pad + d.a[r] * w;
      const x1 = Math.max(x0 + 2, f.x + pad + d.b[r] * w);
      ctx.fillStyle = pal[d.region[r] % pal.length] ?? f.theme.branch;
      ctx.fillRect(x0, cy - bh / 2, x1 - x0, bh);
      if (f.rowHeight >= 8) {
        // the strand: an arrow head at the gene's 3' end
        const tip = d.strand[r] > 0 ? x1 + 4 : x0 - 4;
        const base = d.strand[r] > 0 ? x1 : x0;
        ctx.beginPath();
        ctx.moveTo(base, cy - bh / 2 - 1);
        ctx.lineTo(tip, cy);
        ctx.lineTo(base, cy + bh / 2 + 1);
        ctx.fill();
      }
    }
  },
};
