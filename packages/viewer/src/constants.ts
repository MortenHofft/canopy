// Tuning knobs and numeric limits used in more than one place (or worth finding in one place). Values are the ones the code always had;
// the radial drawing ones are explained in docs/design/research/custom.md, section "Radial performance work".

// ---- cut and drawing windows (projection.ts)

/** Nodes are culled against the clip rectangle grown by this many px, and the radial window drawing clips arcs to is grown by the same. */
export const CULL_PAD_PX = 8;

// ---- radial drawing (draw.ts)

/** Radius (px) from which a radial arc is no longer drawn with ctx.arc(): a far-off clade is clipped to the visible angles (or drawn as a
 *  chord). docs/design/research/custom.md, "Radial performance work" change 5: before it, arcs at radius over 30,000 px were drawn as chords; why
 *  2e4 was picked is not recorded there. */
export const RADIAL_FAR_ARC_R = 2e4;

/** Sagitta test of an arc of chord length `len` at radius r: sagitta = len^2 / (8 r), so `len * len <= SAGITTA_K * r` means the arc differs
 *  from its chord by at most 0.3 px (8 * 0.3 = 2.4) and a straight line is drawn instead of an arc. */
export const ARC_SAGITTA_K = 2.4;

/** Rectangular drawing: the end points of a clade's vertical connector are clamped to this many px beyond the canvas edge (a zoomed-in
 *  connector spans millions of px; the visible part is identical). */
export const CLAMP_Y_PAD_PX = 64;

// ---- view limits (TreeViewer.clampView)

/** Rectangular: default for the `maxViewWidth` option, the widest x window in tree widths (the tree spans x 0..1, so zooming out leaves up
 *  to 60% empty). */
export const RECT_MAX_VIEW_W = 1.6;
/** Rectangular: deepest x zoom; the window is never narrower than the area width divided by this (px per unit of tree width). */
export const RECT_MAX_ZOOM_X = 5e6;
/** Rectangular: tallest y window, in tip rows, as a multiple of the tip count (zoomed out beyond the tree). */
export const RECT_MAX_VIEW_H_FACTOR = 1.6;
/** Rectangular: hard ceiling of the y zoom (px per row) whatever `maxTipSpacing` says: the window is never shorter than the area height
 *  divided by this. `maxTipSpacing: Infinity` leaves only this. */
export const RECT_MAX_ZOOM_Y = 500;
/** Zoomed in, the window may run this fraction of its own size past either edge of the tree (overscroll), ... */
export const OVERSCROLL_FRAC = 0.15;
/** ... that is, at least this fraction of the window must stay over the tree (1 - OVERSCROLL_FRAC, written out so the double is exact). */
export const OVERSCROLL_KEEP_FRAC = 0.85;
/** Radial: fit scale (px per unit radius) is at least this many px. */
export const RADIAL_FIT_MIN_R_PX = 20;
/** Radial: the fit circle leaves this margin (px) inside the smaller container side, for labels and the scale bar. */
export const RADIAL_FIT_MARGIN_PX = 28;
/** Radial: hard ceiling of the zoom, as a multiple of the fit scale, whatever `maxTipSpacing` says, unless RADIAL_MAX_TIP_PX allows more. */
export const RADIAL_MAX_ZOOM = 20000;
/** Radial: the hard ceiling never stops before neighbouring tips on the outer circle are this many px apart (the radial counterpart of
 *  RECT_MAX_ZOOM_Y, but lower: on the 2.39M-tip OTL tree 50 px is 2e7 px per unit radius, and Chromium draws far arcs a few px off above about
 *  3e7). A tree of more than about a million tips reaches RADIAL_MAX_ZOOM with its tips closer than a label (#76). */
export const RADIAL_MAX_TIP_PX = 50;
/** Radial: whatever `maxTipSpacing` says, zoom in is allowed up to this multiple of the fit scale, so short branches near the root of a
 *  small tree can still be pulled apart (rectangular keeps its x zoom free for the same reason). */
export const RADIAL_GEOMETRIC_ZOOM = 50;
/** Radial: widest zoom-out, as a fraction of the fit scale. */
export const RADIAL_MIN_ZOOM = 0.4;
/** Radial: the view centre stays within this many radii of the root. */
export const RADIAL_PAN_LIMIT = 1.3;

// ---- navigation targets (TreeViewer.focusTip, zoomToNode)

/** focusTip, rectangular: row height (px) is kept between these two when a tip is brought into view. The minimum is the value at the
 *  default `labelSize` (13, i.e. 2 em); it scales with the label size and never exceeds `maxTipSpacing`. */
export const FOCUS_TIP_MIN_ROW_PX = 26;
export const FOCUS_TIP_MAX_ROW_PX = 400;
/** focusTip, radial: wanted distance (px) between neighbouring tips on the outer circle, so labels are readable. */
export const FOCUS_TIP_RADIAL_PITCH_PX = 24;
/** zoomToNode, radial: the clade's bounding box is shown with 15% room around it. */
export const ZOOM_NODE_RADIAL_PAD = 1.15;

// ---- overview strip (the whole tree in a corner, with the current window as a box)

/** Rectangular overview: strip width (px); the plot area leaves this room (plus 8 px) right of the clip rectangle. */
export const OVERVIEW_STRIP_W_PX = 56;
/** Radial overview: side of the square disc (px). */
export const OVERVIEW_DISC_PX = 104;

/** Radial overview: the world square shown is [-OVERVIEW_WORLD_HALF, OVERVIEW_WORLD_HALF] on both axes (the unit circle plus a margin). */
export const OVERVIEW_WORLD_HALF = 1.15;
/** Width of that square in world units (2 * OVERVIEW_WORLD_HALF); the overview scale is strip px / this. */
export const OVERVIEW_WORLD_SPAN = 2.3;

// ---- input

/** Wheel zoom: factor = exp(-delta * WHEEL_ZOOM_RATE), delta in px (line and page deltas are converted first). */
export const WHEEL_ZOOM_RATE = 0.0015;
/** Animated viewport changes (zoom to clade, fit, focus) last this many ms. */
export const ANIMATION_MS = 220;
/** A pointer must move more than this many px before a press becomes a drag (below it, it is still a click). */
export const DRAG_START_PX = 3;
/** Pinch: an axis whose finger distance at the start is below this (px) is zoomed uniformly with the pinch distance instead of per axis. */
export const PINCH_MIN_AXIS_PX = 30;

// ---- accessibility

/** The screen reader list of visible tips (hidden <ul>) holds at most this many entries, followed by a "N more" summary item. */
export const SR_LIST_CAP = 60;
