// Every setting the playground offers, in one list: the sidebar is generated from it, the URL stores the values that differ from the
// default (?s.<id>=<value>), and main.ts applies each by its `to`. Adding a viewer option or theme token here is all it takes to
// expose it. Defaults are the library's (DEFAULT_OPTIONS, FALLBACK_THEME), so "default" in the panel means "what an app gets".

import { DEFAULT_OPTIONS, FALLBACK_THEME } from '@gbif-phylo/viewer';

export type Value = string | number | boolean;

interface Base {
  id: string;
  label: string;
  hint?: string;
  group: Group;
  /** option: viewer.setOptions({ [key]: v }); theme: a theme override; control: a built-in control on or off; app: read by main.ts.
   *  rebuild: the viewer is re-created (options read at construction only). */
  to: 'option' | 'theme' | 'control' | 'app';
  key?: string;
  rebuild?: boolean;
}
export type Setting = Base &
  (
    | { kind: 'toggle'; default: boolean }
    | { kind: 'select'; default: string; options: [string, string][] } // [value, label]
    | { kind: 'range'; default: number; min: number; max: number; step: number }
    | { kind: 'colour'; default: string }
    | { kind: 'text'; default: string; placeholder?: string }
  );

export type Group = 'Layout and labels' | 'Level of detail' | 'Theme' | 'Controls' | 'Tree operations' | 'Data and interaction' | 'Residue colours';
export const GROUPS: Group[] = [
  'Layout and labels',
  'Theme',
  'Controls',
  'Tree operations',
  'Data and interaction',
  'Residue colours',
  'Level of detail',
];

const O = DEFAULT_OPTIONS;
const T = FALLBACK_THEME;
const num = (v: number | string | null) => (v === null ? 'fit' : typeof v === 'string' || Number.isFinite(v) ? String(v) : 'Infinity');

export const SETTINGS: Setting[] = [
  // ---- layout and labels
  {
    id: 'layout',
    label: 'Layout',
    group: 'Layout and labels',
    to: 'option',
    kind: 'select',
    default: O.layout,
    options: [
      ['rectangular', 'Rectangular'],
      ['radial', 'Radial'],
    ],
  },
  {
    id: 'branchLengths',
    label: 'Branch lengths (phylogram)',
    hint: 'off: cladogram',
    group: 'Layout and labels',
    to: 'option',
    kind: 'toggle',
    default: O.branchLengths,
  },
  {
    id: 'radialOpening',
    label: 'Radial opening',
    hint: 'radial: the share of the circle left empty between the last and the first tip; 0.5 is a half circle',
    group: 'Layout and labels',
    to: 'option',
    kind: 'range',
    default: O.radialOpening,
    min: 0,
    max: 0.95,
    step: 0.05,
  },
  {
    id: 'radialRotation',
    label: 'Radial rotation (degrees)',
    hint: "radial: where the middle of the opening sits, clockwise from 3 o'clock; 90 is the bottom",
    group: 'Layout and labels',
    to: 'option',
    kind: 'range',
    default: O.radialRotation,
    min: 0,
    max: 355,
    step: 5,
  },
  { id: 'axis', label: 'Time axis / scale bar', group: 'Layout and labels', to: 'option', kind: 'toggle', default: O.axis },
  {
    id: 'rowHeight',
    label: 'Row height',
    hint: 'fixed px per tip at fit; the tree scrolls',
    group: 'Layout and labels',
    to: 'option',
    kind: 'select',
    default: num(O.rowHeight),
    options: [
      ['fit', 'Fit all tips'],
      ['auto', 'Auto (1.85 em)'],
      ['6', '6 px'],
      ['12', '12 px'],
      ['24', '24 px'],
      ['48', '48 px'],
    ],
  },
  {
    id: 'maxTipSpacing',
    label: 'Max tip spacing',
    hint: 'the most room between tips when zooming in; auto = 1.85 x label size. A small tree is never forced below its fit',
    group: 'Layout and labels',
    to: 'option',
    kind: 'select',
    default: num(O.maxTipSpacing),
    options: [
      ['auto', 'Auto (1.85 em)'],
      ['12', '12 px'],
      ['24', '24 px'],
      ['48', '48 px'],
      ['4em', '4 em'],
      ['Infinity', 'No cap'],
    ],
  },
  {
    id: 'maxViewWidth',
    label: 'Max horizontal zoom-out',
    hint: 'rectangular: widest x window in tree widths; larger lets the tree get narrower',
    group: 'Layout and labels',
    to: 'option',
    kind: 'select',
    default: num(O.maxViewWidth),
    options: [
      ['1.6', '1.6 (default)'],
      ['3', '3'],
      ['6', '6'],
      ['20', '20'],
    ],
  },
  {
    id: 'treeWidth',
    label: 'Tree width',
    hint: 'rectangular: the tree area against the columns; the alignment fills the rest',
    group: 'Layout and labels',
    to: 'option',
    kind: 'select',
    default: num(O.treeWidth),
    options: [
      ['auto', 'Auto'],
      ['20%', '20%'],
      ['35%', '35%'],
      ['50%', '50%'],
      ['300', '300 px'],
    ],
  },
  {
    id: 'labelDensity',
    label: 'Label density',
    group: 'Layout and labels',
    to: 'option',
    kind: 'select',
    default: O.labelDensity,
    options: [
      ['sparse', 'Sparse (rows ≥ 16 px at 13 px labels)'],
      ['normal', 'Normal (≥ 11 px)'],
      ['dense', 'Dense (≥ 8 px)'],
    ],
  },
  {
    id: 'alignLabels',
    label: 'Align labels',
    hint: 'rectangular phylogram: all tip labels in one column, with leader lines from the tips',
    group: 'Layout and labels',
    to: 'option',
    kind: 'toggle',
    default: O.alignLabels,
  },
  {
    id: 'nodeLabels',
    label: 'Node labels',
    hint: 'drawn on internal nodes with room: support left of the node, length on the branch',
    group: 'Layout and labels',
    to: 'option',
    kind: 'select',
    default: O.nodeLabels as string,
    options: [
      ['none', 'None'],
      ['support', 'Support values'],
      ['length', 'Branch lengths'],
    ],
  },
  {
    id: 'supportPercent',
    label: 'Support as percent',
    hint: "the app's formatNodeLabel: 0.95 is shown as 95",
    group: 'Layout and labels',
    to: 'app',
    kind: 'toggle',
    default: false,
  },
  {
    id: 'highlightStyle',
    label: 'Highlight style',
    hint: 'how highlighted tips (search, "Highlight tips containing") stand out',
    group: 'Layout and labels',
    to: 'option',
    kind: 'select',
    default: O.highlightStyle,
    options: [
      ['band', 'Band (row band, ring, bold label)'],
      ['dim', 'Dim (everything else fades)'],
      ['both', 'Both'],
    ],
  },
  {
    id: 'underscores',
    label: 'Underscores as spaces',
    hint: 'the default formatLabel',
    group: 'Layout and labels',
    to: 'app',
    kind: 'toggle',
    default: true,
  },
  {
    id: 'tipLinks',
    label: 'Tip labels link to GBIF',
    hint: 'tipHref: a species search per tip',
    group: 'Layout and labels',
    to: 'app',
    kind: 'toggle',
    default: false,
  },

  // ---- theme (token overrides; "default" is FALLBACK_THEME, a preset replaces them all)
  {
    id: 'preset',
    label: 'Preset',
    hint: 'sets the tokens below',
    group: 'Theme',
    to: 'app',
    kind: 'select',
    default: 'default',
    options: [
      ['default', 'Library default'],
      ['gbif', 'GBIF'],
      ['dark', 'Dark'],
      ['grid', 'Transparent on a dotted page'],
    ],
  },
  { id: 'background', label: 'Background', group: 'Theme', to: 'theme', kind: 'colour', default: T.background },
  {
    id: 'transparent',
    label: 'Transparent background',
    hint: 'the page shows through the canvas',
    group: 'Theme',
    to: 'app',
    kind: 'toggle',
    default: false,
  },
  { id: 'foreground', label: 'Labels', group: 'Theme', to: 'theme', kind: 'colour', default: T.foreground },
  { id: 'branch', label: 'Branches', group: 'Theme', to: 'theme', kind: 'colour', default: T.branch },
  { id: 'muted', label: 'Axis and headers', group: 'Theme', to: 'theme', kind: 'colour', default: T.muted },
  { id: 'highlight', label: 'Highlight', group: 'Theme', to: 'theme', kind: 'colour', default: T.highlight },
  { id: 'summary', label: 'Collapsed clades', group: 'Theme', to: 'theme', kind: 'colour', default: T.summary },
  { id: 'labelSize', label: 'Label size (px)', group: 'Theme', to: 'theme', kind: 'range', default: T.labelSize, min: 8, max: 24, step: 0.5 },
  {
    id: 'labelFontStyle',
    label: 'Label style',
    group: 'Theme',
    to: 'theme',
    kind: 'select',
    default: T.labelFontStyle,
    options: [
      ['italic', 'Italic'],
      ['normal', 'Normal'],
    ],
  },
  { id: 'branchWidth', label: 'Branch width (px)', group: 'Theme', to: 'theme', kind: 'range', default: T.branchWidth, min: 0.5, max: 5, step: 0.1 },
  {
    id: 'cladeBranchWidth',
    label: 'Coloured branch width',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.cladeBranchWidth,
    min: 0.5,
    max: 6,
    step: 0.1,
  },
  { id: 'tipRadius', label: 'Tip dot radius', group: 'Theme', to: 'theme', kind: 'range', default: T.tipRadius, min: 0, max: 8, step: 0.1 },
  {
    id: 'nodeMarkerSize',
    label: 'Node marker size',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.nodeMarkerSize,
    min: 0,
    max: 10,
    step: 0.5,
  },
  {
    id: 'summaryOpacity',
    label: 'Collapsed clade opacity',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.summaryOpacity,
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    id: 'summaryStripeColour',
    label: 'Stripe colour',
    hint: 'empty = the collapsed clade colour',
    group: 'Theme',
    to: 'theme',
    kind: 'text',
    default: T.summaryStripeColour,
    placeholder: 'e.g. #64748b',
  },
  {
    id: 'summaryStripeGap',
    label: 'Stripe gap (px)',
    hint: 'least distance between stripes',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.summaryStripeGap,
    min: 2,
    max: 12,
    step: 0.5,
  },
  {
    id: 'highlightOpacity',
    label: 'Highlight band opacity',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.highlightOpacity,
    min: 0,
    max: 1,
    step: 0.02,
  },
  {
    id: 'dimOpacity',
    label: 'Dimmed opacity',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.dimOpacity,
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    id: 'leaderColour',
    label: 'Leader colour',
    hint: 'empty = the axis colour',
    group: 'Theme',
    to: 'theme',
    kind: 'text',
    default: T.leaderColour,
    placeholder: 'e.g. #94a3b8',
  },
  { id: 'leaderDash', label: 'Leader dash', hint: 'px, e.g. 1 3; none = solid', group: 'Theme', to: 'theme', kind: 'text', default: T.leaderDash },
  { id: 'leaderWidth', label: 'Leader width (px)', group: 'Theme', to: 'theme', kind: 'range', default: T.leaderWidth, min: 0.5, max: 4, step: 0.1 },
  { id: 'leaderOpacity', label: 'Leader opacity', group: 'Theme', to: 'theme', kind: 'range', default: T.leaderOpacity, min: 0, max: 1, step: 0.05 },
  {
    id: 'nodeLabelSize',
    label: 'Node label size (px)',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.nodeLabelSize,
    min: 6,
    max: 20,
    step: 0.5,
  },
  {
    id: 'supportColour',
    label: 'Support colour',
    hint: 'empty = the axis colour',
    group: 'Theme',
    to: 'theme',
    kind: 'text',
    default: T.supportColour,
    placeholder: 'e.g. #4c9b45',
  },
  {
    id: 'lengthColour',
    label: 'Length colour',
    hint: 'empty = the axis colour',
    group: 'Theme',
    to: 'theme',
    kind: 'text',
    default: T.lengthColour,
    placeholder: 'e.g. #684393',
  },
  { id: 'axisFontSize', label: 'Axis text (px)', group: 'Theme', to: 'theme', kind: 'range', default: T.axisFontSize, min: 6, max: 16, step: 0.5 },
  {
    id: 'alignRowGap',
    label: 'Alignment row gap (px)',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.alignRowGap,
    min: 0,
    max: 4,
    step: 1,
  },
  {
    id: 'selectionColour',
    label: 'Selection colour',
    hint: 'empty = the label colour',
    group: 'Theme',
    to: 'theme',
    kind: 'text',
    default: T.selectionColour,
    placeholder: 'e.g. #d0628d',
  },
  {
    id: 'selectionWidth',
    label: 'Selection width (px)',
    hint: '0 = no ring',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.selectionWidth,
    min: 0,
    max: 6,
    step: 0.5,
  },
  {
    id: 'selectionRadius',
    label: 'Selection radius (px)',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.selectionRadius,
    min: 3,
    max: 16,
    step: 0.5,
  },
  {
    id: 'markColour',
    label: 'Mark colour',
    hint: 'setMarked; empty = the highlight colour',
    group: 'Theme',
    to: 'theme',
    kind: 'text',
    default: T.markColour,
    placeholder: 'e.g. #d0628d',
  },
  {
    id: 'markWidth',
    label: 'Mark width (px)',
    hint: '0 = no ring',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.markWidth,
    min: 0,
    max: 6,
    step: 0.5,
  },
  {
    id: 'markRadius',
    label: 'Mark radius (px)',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.markRadius,
    min: 3,
    max: 20,
    step: 0.5,
  },
  {
    id: 'markDash',
    label: 'Mark dash',
    hint: 'px, e.g. 3 2; none = solid',
    group: 'Theme',
    to: 'theme',
    kind: 'text',
    default: T.markDash,
  },
  {
    id: 'hoverPathColour',
    label: 'Hover path colour',
    hint: 'the path from the hovered node to the root; empty = the highlight colour',
    group: 'Theme',
    to: 'theme',
    kind: 'text',
    default: T.hoverPathColour,
    placeholder: 'e.g. #d0628d',
  },
  {
    id: 'hoverPathWidth',
    label: 'Hover path width (px)',
    hint: '0 = no path',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.hoverPathWidth,
    min: 0,
    max: 6,
    step: 0.5,
  },
  {
    id: 'hoverRingRadius',
    label: 'Hover ring radius (px)',
    hint: 'a collapsed clade’s ring is 1.5 times this',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.hoverRingRadius,
    min: 2,
    max: 16,
    step: 0.5,
  },
  {
    id: 'hoverRingWidth',
    label: 'Hover ring width (px)',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.hoverRingWidth,
    min: 0.5,
    max: 6,
    step: 0.5,
  },
  {
    id: 'hoverRingDuration',
    label: 'Hover ring duration (ms)',
    hint: 'how long the hover ring takes to grow in (option Hover animation); 0 = at once',
    group: 'Theme',
    to: 'theme',
    kind: 'range',
    default: T.hoverRingDuration,
    min: 0,
    max: 1000,
    step: 10,
  },

  // ---- built-in controls
  { id: 'zoom', label: 'Zoom buttons', group: 'Controls', to: 'control', kind: 'toggle', default: true },
  { id: 'fit', label: 'Fit button', group: 'Controls', to: 'control', kind: 'toggle', default: true },
  { id: 'layoutToggle', label: 'Layout toggle', group: 'Controls', to: 'control', kind: 'toggle', default: false },
  { id: 'search', label: 'Search', group: 'Controls', to: 'control', kind: 'toggle', default: true },
  { id: 'legend', label: 'Legend (clade colours)', group: 'Controls', to: 'control', kind: 'toggle', default: true },
  { id: 'overview', label: 'Overview', group: 'Controls', to: 'control', kind: 'toggle', default: false },
  { id: 'tooltip', label: 'Hover tooltip', group: 'Controls', to: 'control', kind: 'toggle', default: true },

  // ---- data and interaction
  {
    id: 'click',
    label: 'Click on a tip or clade',
    group: 'Data and interaction',
    to: 'app',
    kind: 'select',
    default: 'menu',
    options: [
      ['menu', 'Node menu'],
      ['colour', 'Colour the clade'],
      ['zoom', 'Zoom to the clade'],
      ['focus', 'Show only the clade'],
      ['collapse', 'Collapse or expand the clade'],
      ['nothing', 'Nothing (events only)'],
    ],
  },
  // ---- tree operations (@gbif-phylo/tree-ops), as views of the loaded tree: the focus and the collapsed clades are page state, below
  {
    id: 'supportCollapse',
    label: 'Collapse branches with low support',
    hint: 'tree-ops collapseBySupport: such branches become polytomies; a view, untick to get them back',
    group: 'Tree operations',
    to: 'app',
    kind: 'toggle',
    default: false,
  },
  {
    id: 'minSupport',
    label: 'Support below (% of the scale)',
    hint: 'support values of 0–1 are compared with this / 100',
    group: 'Tree operations',
    to: 'app',
    kind: 'range',
    default: 70,
    min: 0,
    max: 100,
    step: 1,
  },
  {
    id: 'hoverPath',
    label: 'Hover path',
    hint: 'hovering a node highlights its path to the root (with nothing hovered, the keyboard cursor’s)',
    group: 'Data and interaction',
    to: 'option',
    kind: 'toggle',
    default: O.hoverPath,
  },
  {
    id: 'hoverAnimation',
    label: 'Hover animation',
    hint: 'the hover and keyboard rings grow in (theme Hover ring duration); off when the system asks for reduced motion',
    group: 'Data and interaction',
    to: 'option',
    kind: 'toggle',
    default: O.hoverAnimation,
  },
  {
    id: 'find',
    label: 'Highlight tips containing',
    group: 'Data and interaction',
    to: 'app',
    kind: 'text',
    default: '',
    placeholder: 'e.g. Homo or _ott',
  },
  {
    id: 'fillAlignment',
    label: 'Alignment fills the width',
    hint: "column width 'fill': it takes what the tree area leaves, scaled to fit",
    group: 'Data and interaction',
    to: 'app',
    kind: 'toggle',
    default: false,
  },
  {
    id: 'columns',
    label: 'Columns from the tree’s data',
    hint: 'per-tip values (TSV) and the alignment, when the tree has them',
    group: 'Data and interaction',
    to: 'app',
    kind: 'toggle',
    default: true,
  },
  {
    id: 'alphabet',
    label: 'Alignment alphabet',
    hint: 'auto: nucleotide when more than 90% of a sample is ACGTUN',
    group: 'Data and interaction',
    to: 'app',
    kind: 'select',
    default: 'auto',
    options: [
      ['auto', 'Auto'],
      ['protein', 'Protein'],
      ['nucleotide', 'Nucleotide'],
    ],
  },
  {
    id: 'alignStyle',
    label: 'Alignment style',
    group: 'Data and interaction',
    to: 'option',
    kind: 'select',
    default: O.alignStyle,
    options: [
      ['residues', 'Residues'],
      ['blocks', 'Blocks (gaps as lines)'],
    ],
  },

  // ---- residue colours of alignment columns: unset (empty) means the default for a light or a dark theme, so these are text, not pickers
  {
    id: 'residueHydrophobic',
    label: 'Hydrophobic (A I L M F W V C)',
    hint: 'any CSS colour; empty = default for the theme',
    group: 'Residue colours',
    to: 'theme',
    kind: 'text',
    default: '',
    placeholder: 'default',
  },
  { id: 'residuePositive', label: 'Positive (K R)', group: 'Residue colours', to: 'theme', kind: 'text', default: '', placeholder: 'default' },
  { id: 'residueNegative', label: 'Negative (E D)', group: 'Residue colours', to: 'theme', kind: 'text', default: '', placeholder: 'default' },
  { id: 'residuePolar', label: 'Polar (N Q S T)', group: 'Residue colours', to: 'theme', kind: 'text', default: '', placeholder: 'default' },
  { id: 'residueAromatic', label: 'Aromatic (H Y)', group: 'Residue colours', to: 'theme', kind: 'text', default: '', placeholder: 'default' },
  { id: 'residueGlycine', label: 'Glycine (G)', group: 'Residue colours', to: 'theme', kind: 'text', default: '', placeholder: 'default' },
  { id: 'residueProline', label: 'Proline (P)', group: 'Residue colours', to: 'theme', kind: 'text', default: '', placeholder: 'default' },
  { id: 'residueA', label: 'Nucleotide A', group: 'Residue colours', to: 'theme', kind: 'text', default: '', placeholder: 'default' },
  { id: 'residueC', label: 'Nucleotide C', group: 'Residue colours', to: 'theme', kind: 'text', default: '', placeholder: 'default' },
  { id: 'residueG', label: 'Nucleotide G', group: 'Residue colours', to: 'theme', kind: 'text', default: '', placeholder: 'default' },
  { id: 'residueT', label: 'Nucleotide T / U', group: 'Residue colours', to: 'theme', kind: 'text', default: '', placeholder: 'default' },
  { id: 'residueOther', label: 'Any other residue', group: 'Residue colours', to: 'theme', kind: 'text', default: '', placeholder: 'default' },

  // ---- level of detail and performance
  {
    id: 'lod',
    label: 'Level of detail',
    hint: 'collapse small clades into triangles, cull off-screen',
    group: 'Level of detail',
    to: 'option',
    kind: 'toggle',
    default: O.lod,
  },
  {
    id: 'showSummaries',
    label: 'Draw collapsed clades as triangles',
    group: 'Level of detail',
    to: 'option',
    kind: 'toggle',
    default: O.showSummaries,
  },
  {
    id: 'summaryStyle',
    label: 'Collapsed clade fill',
    hint: 'striped: fine stripes along the hidden branches, best with a larger smallest clade',
    group: 'Level of detail',
    to: 'option',
    kind: 'select',
    default: O.summaryStyle,
    options: [
      ['solid', 'Solid'],
      ['striped', 'Striped'],
    ],
  },
  {
    id: 'stripeCollapsed',
    label: 'Stripe clades collapsed by the app too',
    group: 'Level of detail',
    to: 'option',
    kind: 'toggle',
    default: O.stripeCollapsed,
  },
  {
    id: 'minCladePx',
    label: 'Smallest clade drawn (px)',
    group: 'Level of detail',
    to: 'option',
    kind: 'select',
    default: String(O.minCladePx),
    options: [
      ['1', '1 px (most detail)'],
      ['2', '2 px'],
      ['3', '3 px'],
      ['5', '5 px'],
      ['8', '8 px'],
    ],
  },
  {
    id: 'drawBudget',
    label: 'Draw budget per frame',
    group: 'Level of detail',
    to: 'option',
    kind: 'select',
    default: String(O.drawBudget),
    options: [
      ['500', '500 primitives'],
      ['2000', '2,000'],
      ['20000', '20,000'],
      ['100000', '100,000'],
      ['400000', '400,000'],
    ],
  },
  {
    id: 'radialMaxNodes',
    label: 'Radial: most primitives',
    group: 'Level of detail',
    to: 'option',
    kind: 'select',
    default: num(O.radialMaxNodes),
    options: [
      ['500', '500'],
      ['2000', '2,000'],
      ['10000', '10,000'],
      ['Infinity', 'Only the draw budget'],
    ],
  },
  {
    id: 'summaryNotice',
    label: 'Radial: notice when clades are summarised',
    group: 'Level of detail',
    to: 'option',
    kind: 'toggle',
    default: O.summaryNotice,
  },
  {
    id: 'interactionLOD',
    label: 'Reduced frames while moving',
    group: 'Level of detail',
    to: 'option',
    kind: 'select',
    default: String(O.interactionLOD),
    options: [
      ['auto', 'When frames are slow'],
      ['true', 'Always'],
      ['false', 'Never'],
    ],
  },
  {
    id: 'refineMs',
    label: 'Full frame after (ms idle)',
    group: 'Level of detail',
    to: 'option',
    kind: 'select',
    default: String(O.refineMs),
    options: [
      ['0', '0'],
      ['120', '120'],
      ['300', '300'],
      ['1000', '1,000'],
    ],
  },
  {
    id: 'dprCap',
    label: 'Pixel ratio cap',
    group: 'Level of detail',
    to: 'option',
    kind: 'select',
    default: num(O.dprCap),
    options: [
      ['1', '1×'],
      ['2', '2×'],
      ['3', '3×'],
      ['Infinity', 'Native'],
    ],
  },
  {
    id: 'softwareCanvas',
    label: 'CPU-backed canvas',
    hint: 'willReadFrequently; re-creates the viewer',
    group: 'Level of detail',
    to: 'option',
    kind: 'toggle',
    default: O.softwareCanvas,
    rebuild: true,
  },
];

export const BY_ID = new Map(SETTINGS.map((s) => [s.id, s]));

/** A setting's value as the viewer wants it ('fit' → null, 'Infinity' → Infinity, numeric selects → numbers). */
export function toViewer(s: Setting, v: Value): unknown {
  if (s.kind !== 'select' || typeof v !== 'string') return v;
  if (v === 'fit') return null;
  if (v === 'Infinity') return Infinity;
  if (v === 'true' || v === 'false') return v === 'true';
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
}

/** Presets: theme token values (and the transparent flag); anything not listed is the library default. */
export const PRESETS: Record<string, Record<string, Value>> = {
  default: {},
  gbif: {
    background: '#ffffff',
    foreground: '#211f1f',
    muted: '#767171',
    branch: '#524d4d',
    highlight: '#4c9b45',
    summary: '#94a3b8',
  },
  dark: {
    background: '#0f172a',
    foreground: '#e2e8f0',
    muted: '#94a3b8',
    branch: '#cbd5e1',
    highlight: '#7dd87f',
    summary: '#64748b',
    summaryOpacity: 0.5,
  },
  grid: { transparent: true, branch: '#475569', foreground: '#1e293b', highlight: '#6366f1' },
};

// ---------------------------------------------------------------- state in the URL

export type State = Record<string, Value>;

export function defaults(): State {
  return Object.fromEntries(SETTINGS.map((s) => [s.id, s.default]));
}

/** Values from ?s.<id>=..., checked against each setting (an unknown or malformed value is ignored). */
export function fromUrl(search: string): State {
  const st = defaults();
  const q = new URLSearchParams(search);
  for (const s of SETTINGS) {
    const raw = q.get('s.' + s.id);
    if (raw === null) continue;
    if (s.kind === 'toggle') st[s.id] = raw === '1';
    else if (s.kind === 'range') {
      const n = Number(raw);
      if (Number.isFinite(n)) st[s.id] = Math.min(s.max, Math.max(s.min, n));
    } else if (s.kind === 'select') {
      if (s.options.some(([v]) => v === raw)) st[s.id] = raw;
    } else if (s.kind === 'colour') {
      if (/^#[0-9a-f]{6}$/i.test(raw)) st[s.id] = raw;
    } else st[s.id] = raw;
  }
  return st;
}

/** The query string for a state: the tree, then only the settings that differ from their default. */
export function toUrl(tree: string | null, st: State): string {
  const q = new URLSearchParams();
  if (tree) q.set('tree', tree);
  for (const s of SETTINGS) {
    const v = st[s.id];
    if (v === s.default) continue;
    q.set('s.' + s.id, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  const str = q.toString();
  return str ? '?' + str : '';
}
