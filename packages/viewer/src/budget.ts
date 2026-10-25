// The adaptive draw budget (`drawBudget: 'auto'`, `radialMaxNodes: 'auto'`, #114): the number of primitives one frame may draw, kept
// where the machine draws a frame in about TARGET_MS. Pure functions over a small state object, so the viewer only feeds it frame
// measurements and reads the budget back; nothing here runs per node and nothing is read by the cut loops (the cut gets the number).
//
// What it measures. The JS time of full-quality frames (`observeFrame`, FrameStats.frameMs), and the time between animation frames while
// the view moves (`observeInterval`): on a weak device the pixels dominate, and only the interval shows that. An interval is capped by the
// display's refresh (16.7 ms at 60 Hz), so it is only ever used to lower the budget (when it is over the target), never to raise it.
//
// When it moves (`stepBudget`, called by the viewer on a settled frame only, never while the view moves):
//   over the target     budget * target / time, at most halved
//   well under it       (below RAISE_BELOW of the target) budget * aim / time, at most doubled, and only while the last cut was
//                       limited by the budget (it overflowed, or folded clades because of it: `forced` > 0). A budget that already shows
//                       everything the canvas can tell apart is not raised further, however fast the frames are
//   in between          unchanged, so the budget does not bounce around the target
// The budget stays within [floor, ceiling]. The measurements are smoothed (SMOOTH) and a step needs MIN_SAMPLES of them.
//
// `pressed` is set when a step lowered the budget. It is cleared by a fast measurement only when that measurement says the limit would not
// slow the frames again: the budget has risen past the list length the limit needed (`need`, taken from the slow frame that set it), or
// the cut shows everything anyway. A fast measurement taken with the limit off (cheaper lists) proves nothing about it, so the limit
// does not flap on and off. The radial view's wedge limit (MAX_WEDGE_DEG,
// see wedgeLimitPx) holds while it is clear, and gives way to the budget while it is set.

/** Frame time (ms) that `'auto'` aims for: 40 fps. */
export const TARGET_MS = 25;
/** A raise needs frames under this share of the target. */
export const RAISE_BELOW = 0.6;
/** A raise aims at this share of the target (under 1, since the cost of a frame is not proportional to the budget). */
export const RAISE_AIM = 0.85;
/** One step changes the budget by at most this factor, up or down. */
export const MAX_STEP = 2;
/** Weight of the newest measurement in the smoothed time. */
export const SMOOTH = 0.5;
/** Measurements a step needs. */
export const MIN_SAMPLES = 2;
/** A longer gap between two animation frames is a pause, not a frame time. */
export const MAX_INTERVAL_MS = 250;

/** Starting budgets: the fixed values `'auto'` replaces (drawBudget, radialMaxNodes). */
export const START_RECT = 20000;
export const START_RADIAL = 2000;
/** The least budget, as the fixed budgets have it (drawBudget 500, radialMaxNodes 100). */
export const FLOOR_RECT = 500;
export const FLOOR_RADIAL = 100;
/** The most `'auto'` raises the budget to. In practice it stops sooner, where the canvas has nothing more to show. */
export const CEILING = 200000;

/** The finest collapse threshold (CSS px): below it two clades are drawn on the same pixels, so nothing is gained. `minCladePx` and the
 *  search for a threshold stay at or above it. CSS px, not device px: the dedupe grid and every threshold are in CSS px. */
export const MIN_THRESHOLD_PX = 1;
/** `minCladePx: 'auto'` where no adaptive budget follows the frame rate (a fixed `drawBudget` in the rectangular layout, a fixed
 *  `radialMaxNodes` in the radial one): the threshold the option had as a number before #122. Where one does it is MIN_THRESHOLD_PX: the
 *  budget alone folds more. */
export const AUTO_MIN_CLADE_PX = 3;
/** Radial, `'auto'`: no summary wedge wider than this many degrees (arc at the outermost ring), unless frames are over the target. */
export const MAX_WEDGE_DEG = 4;
/** After a step that changed the budget, this many frames may be drawn to settle on a value, without any input. */
export const CHAIN_FRAMES = 16;
/** Pause (ms) before each of those frames, so the browser is idle between them and a hover or gesture is not made to wait. */
export const BUDGET_FRAME_MS = 60;

export interface BudgetState {
  /** The budget in force. */
  budget: number;
  /** Smoothed JS time (ms) of the full-quality frames since the last step, 0 for none. */
  ms: number;
  /** Measurements in `ms`. */
  n: number;
  /** Smoothed time (ms) between animation frames while the view moved since the last step, 0 for none. */
  iv: number;
  /** The last step lowered the budget and frames have not been fast since: the wedge limit gives way. */
  pressed: boolean;
  /** While pressed: the list length (primitives) of the slow frame cut at the wedge limit, 0 if not known. */
  need: number;
}

export function newBudgetState(start: number): BudgetState {
  return { budget: start, ms: 0, n: 0, iv: 0, pressed: false, need: 0 };
}

/** Fold the JS time of a full-quality frame into the state. */
export function observeFrame(s: BudgetState, ms: number): void {
  if (!(ms >= 0)) return;
  s.ms = s.n > 0 ? s.ms * (1 - SMOOTH) + ms * SMOOTH : ms;
  s.n++;
}

/** Fold the time between two animation frames of a moving view into the state; a gap that is a pause is ignored. */
export function observeInterval(s: BudgetState, dt: number): void {
  if (!(dt > 0) || dt > MAX_INTERVAL_MS) return;
  s.iv = s.iv > 0 ? s.iv * (1 - SMOOTH) + dt * SMOOTH : dt;
}

export interface BudgetLimits {
  floor: number;
  ceiling: number;
  /** The cut of the last frame fit the budget without folding anything for its sake: nothing to gain from a larger one. */
  saturated: boolean;
  /** The measured frames were cut at the wedge limit (it was in force), and the primitives of the last list. Both only matter for `pressed`. */
  limited?: boolean;
  drawn?: number;
}

/** Whether what is measured so far would move the budget once there are enough measurements: the viewer then draws a frame to get them. */
export function wantsStep(s: BudgetState, saturated: boolean): boolean {
  if (s.n === 0) return false;
  const slow = s.iv > TARGET_MS ? Math.max(s.ms, s.iv) : s.ms;
  return slow > TARGET_MS || (slow < RAISE_BELOW * TARGET_MS && !saturated);
}

/** Move the budget by what was measured since the last step, and start the next measurement. Call it on a settled frame only. Returns
 *  true if the budget changed. Without enough measurements it changes nothing (and keeps them). */
export function stepBudget(s: BudgetState, lim: BudgetLimits): boolean {
  const before = s.budget;
  const floor = Math.min(lim.floor, lim.ceiling);
  s.budget = Math.min(lim.ceiling, Math.max(floor, s.budget));
  if (s.n < MIN_SAMPLES) return s.budget !== before;
  const slow = s.iv > TARGET_MS ? Math.max(s.ms, s.iv) : s.ms;
  if (slow > TARGET_MS) {
    s.budget = Math.max(floor, s.budget * Math.max(1 / MAX_STEP, TARGET_MS / slow));
    if (lim.limited) s.need = Math.max(s.pressed ? s.need : 0, lim.drawn ?? 0);
    s.pressed = true;
  } else if (slow < RAISE_BELOW * TARGET_MS) {
    if (!lim.saturated) s.budget = Math.min(lim.ceiling, s.budget * Math.min(MAX_STEP, (RAISE_AIM * TARGET_MS) / Math.max(slow, 0.1)));
    if (lim.limited || lim.saturated || s.budget >= s.need) {
      s.pressed = false;
      s.need = 0;
    }
  }
  s.budget = Math.round(s.budget);
  s.ms = 0;
  s.n = 0;
  s.iv = 0;
  return s.budget !== before;
}

/** The collapse threshold (px) at which a radial summary wedge is MAX_WEDGE_DEG wide at the outermost ring: `rootRadiusPx` is the
 *  outermost ring's radius in px (L.XMAX[0] * k). The cut's rule A compares a clade's arc at its own outer radius with the threshold, so
 *  for tips on the outer ring (an ultrametric tree) a threshold at this value folds no wedge wider than MAX_WEDGE_DEG; a clade that
 *  ends nearer the root is folded by its arc in px, which is what rule A means. */
export function wedgeLimitPx(rootRadiusPx: number): number {
  return (MAX_WEDGE_DEG * Math.PI * rootRadiusPx) / 180;
}
