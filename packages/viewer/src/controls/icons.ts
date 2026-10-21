// Icons of the built-in controls: 16 x 16 SVG markup drawing in currentColor, so the button's CSS colour applies. Every control takes
// its own icons as options, so an app can swap them for its icon set.

const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  zoomIn: svg('<path d="M8 3v10M3 8h10"/>'),
  zoomOut: svg('<path d="M3 8h10"/>'),
  fit: svg('<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>'),
  rectangular: svg('<path d="M2 3h3v10H2M5 5h4M5 11h4M9 4h5M9 6h5M9 10h5M9 12h5"/>'),
  radial: svg('<circle cx="8" cy="8" r="1.4"/><path d="M8 6.6V2.5M9.2 8.7l3.6 2.1M6.8 8.7l-3.6 2.1"/>'),
  search: svg('<circle cx="7" cy="7" r="4"/><path d="M10 10l4 4"/>'),
  legend: svg('<path d="M2 4h2M2 8h2M2 12h2M6 4h8M6 8h8M6 12h8"/>'),
} as const;
