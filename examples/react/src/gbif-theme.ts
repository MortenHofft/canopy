// GBIF theme values for libraries that cannot be styled with CSS (canvas, WebGL, config objects).
// Single source of truth stays gbif-tokens.css: this reads the computed custom properties at runtime, so
// a change to a token there reaches both the CSS-styled UI and the canvas-drawn tree. Never hardcode hex here.
//
// Usage:  import '../../shared/gbif-tokens.css'; import { gbifTheme } from './gbif-theme';
//         const t = gbifTheme();  // t.primary, t.danger, t.fg1, ... resolved colours (#rrggbb or rgb())

export interface GbifTheme {
  primary: string;
  primaryHover: string;
  primaryLight: string;
  accentBlue: string;
  danger: string;
  warning: string;
  info: string;
  fg1: string;
  fg2: string;
  fg3: string;
  fg4: string;
  subtle: string;
  bg1: string;
  bg2: string;
  surface: string;
  dark: string;
  border: string;
  tableBorder: string;
  slate200: string;
  slate400: string;
  categorical: string[]; // purple, periwinkle, fuchsia, peach, lightblue, yellow, green: for categories
  fontBody: string;
  fontDisplay: string;
  fontMono: string;
}

const NAMES = {
  primary: '--color-primary',
  primaryHover: '--color-primary-hover',
  primaryLight: '--color-primary-light',
  accentBlue: '--color-accent-blue',
  danger: '--color-danger',
  warning: '--color-warning',
  info: '--color-info',
  fg1: '--fg1',
  fg2: '--fg2',
  fg3: '--fg3',
  fg4: '--fg4',
  subtle: '--text-subtle',
  bg1: '--bg1',
  bg2: '--bg2',
  surface: '--bg-surface',
  dark: '--bg-dark',
  border: '--border-default',
  tableBorder: '--table-border-color',
  slate200: '--slate-200',
  slate400: '--slate-400',
  fontBody: '--font-body',
  fontDisplay: '--font-display',
  fontMono: '--font-mono',
} as const;

const CATEGORICAL = ['--purple-100', '--periwinkle-100', '--fuchsia-100', '--peach-100', '--lightblue-100', '--yellow-100', '--green-100'];

export function gbifTheme(el: Element = document.documentElement): GbifTheme {
  const cs = getComputedStyle(el);
  const get = (v: string) => cs.getPropertyValue(v).trim();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(NAMES)) out[k] = get(v);
  out.categorical = CATEGORICAL.map(get);
  return out as unknown as GbifTheme;
}

/** Dark variant is not part of the GBIF tokens ("Not covered here"); this derives a minimal one so that the
 *  dark-theme scenario has something to switch to. Values still come from tokens. */
export function gbifDarkTheme(el: Element = document.documentElement): GbifTheme {
  const t = gbifTheme(el);
  return {
    ...t,
    fg1: t.bg1,
    fg2: t.slate200,
    fg3: t.slate400,
    bg1: t.dark,
    bg2: getComputedStyle(el).getPropertyValue('--grey-200').trim(),
    surface: getComputedStyle(el).getPropertyValue('--grey-100').trim(),
  };
}
