// Theme or option? The theme is how things look: colours, sizes and widths in px, opacities, font family and style. Everything in it
// can be a --phylo-* property, so a stylesheet (light/dark, GBIF tokens) sets it without JavaScript. Options (ViewerOptions in
// types.ts) are what is shown and how the viewer behaves: layout, which elements appear, density and level-of-detail thresholds,
// functions, performance knobs. The rule and the exceptions are in docs/api.md ("Theme or option").
//
// The canvas theme from CSS: every TreeTheme field can be given as a custom property, --phylo-<field in kebab case> (THEME_CSS_VARS),
// on the viewer's target or any ancestor. The viewer reads them when it is created, on `refreshTheme()` and when the colour scheme
// preference changes, so one stylesheet themes both the canvas and the DOM (controls, popups; see css/viewer.css).
//
//   --phylo-background: #0f172a; --phylo-foreground: #e2e8f0; --phylo-branch: #94a3b8; --phylo-highlight: #4c9b45;
//   --phylo-categorical: #684393, #6985bd, #d0628d;   (comma-separated)
//   --phylo-branch-width: 1.5;  --phylo-summary-opacity: 0.5;   (numbers, CSS px where they are sizes; a trailing 'px' is accepted)
//
// A value that cannot be read (empty, or not a number where one is needed) is left out, so the fallback theme applies.

import { luminanceOf, resolveColour } from './colour.ts';
import { RESIDUE_THEME_KEYS } from './residues.ts';
import type { TreeTheme } from './types.ts';

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

const COLOURS = ['background', 'foreground', 'muted', 'branch', 'highlight', 'summary'] as const;
const NUMBERS = [
  'branchWidth',
  'cladeBranchWidth',
  'tipRadius',
  'nodeMarkerSize',
  'summaryOpacity',
  'markerOpacity',
  'highlightOpacity',
  'dimOpacity',
  'labelSize',
  'axisFontSize',
  'leaderWidth',
  'leaderOpacity',
  'alignRowGap',
] as const;
const STRINGS = ['fontFamily', 'leaderColour', 'leaderDash'] as const;

/** The custom property of each theme field. */
export const THEME_CSS_VARS: Record<keyof TreeTheme, string> = Object.fromEntries(
  (['dark', ...COLOURS, ...STRINGS, 'labelFontStyle', 'categorical', ...NUMBERS, ...RESIDUE_THEME_KEYS] as (keyof TreeTheme)[]).map((k) => [
    k,
    '--phylo-' + kebab(k),
  ]),
) as Record<keyof TreeTheme, string>;

/** Whether a background is dark (luminance under 0.4); null when it is not a colour or is translucent, which says nothing about the
 *  colour of the page behind it. */
export function deriveDark(background: string): boolean | null {
  const c = resolveColour(background);
  return c && c.a === 1 ? luminanceOf(c) < 0.4 : null;
}

/** The theme fields set as custom properties on `el` (or inherited from its ancestors). Fields that are not set are absent. Without
 *  `--phylo-dark`, `dark` is derived from `--phylo-background` unless `deriveDarkFromBackground` is false. */
export function themeFromCss(el: Element, deriveDarkFromBackground = true): Partial<TreeTheme> {
  if (typeof getComputedStyle !== 'function') return {};
  const cs = getComputedStyle(el);
  const get = (k: keyof TreeTheme) => cs.getPropertyValue(THEME_CSS_VARS[k]).trim();
  const out: Partial<TreeTheme> = {};
  for (const k of COLOURS) {
    const v = get(k);
    if (v) out[k] = v;
  }
  for (const k of RESIDUE_THEME_KEYS) {
    const v = get(k);
    if (v) out[k] = v;
  }
  for (const k of STRINGS) {
    const v = get(k);
    if (v) out[k] = v;
  }
  const fontStyle = get('labelFontStyle').toLowerCase(); // 'oblique' is italic to the canvas and the DOM alike
  if (fontStyle === 'italic' || fontStyle === 'oblique') out.labelFontStyle = 'italic';
  else if (fontStyle === 'normal') out.labelFontStyle = 'normal';
  const cat = splitList(get('categorical'));
  if (cat.length) out.categorical = cat;
  for (const k of NUMBERS) {
    const n = parseFloat(get(k));
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  const dark = get('dark');
  if (dark === 'true' || dark === '1') out.dark = true;
  else if (dark === 'false' || dark === '0') out.dark = false;
  else if (deriveDarkFromBackground && out.background) {
    const d = deriveDark(out.background);
    if (d !== null) out.dark = d;
  }
  return out;
}

/** Split a comma-separated list, keeping commas inside parentheses (rgb(1, 2, 3)). */
export function splitList(v: string): string[] {
  const out: string[] = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i <= v.length; i++) {
    const c = v[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if ((c === ',' && depth === 0) || i === v.length) {
      const item = v.slice(start, i).trim();
      if (item) out.push(item);
      start = i + 1;
    }
  }
  return out;
}

/** Relative luminance (0..1) of a #rgb, #rrggbb or rgb()/rgba() colour; null for anything else. */
export function luminance(colour: string): number | null {
  let r: number, g: number, b: number;
  const c = colour.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
    if (!m) return null;
    [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
