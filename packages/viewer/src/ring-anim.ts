// The animation of the hover and keyboard-cursor rings (option `hoverAnimation`, theme `hoverRingDuration`): a ring grows into existence,
// radius and opacity from 0 with an ease-out, and the hover ring it replaces fades out. Only the overlay canvas is redrawn for it, one
// frame per step and only while a ring is still changing.
//
// Times are requestAnimationFrame timestamps. A ring that starts outside a frame (a key press draws at once) starts at the first frame
// that draws it, so a test with a fake clock sees the same steps as a browser. No allocation: the viewer keeps three of these, made once.

/** The first frame of a ring shows its first step, as if it had started a frame earlier (a ring of radius 0 would be a wasted frame). */
const FIRST_STEP_MS = 1000 / 60;

/** Quadratic ease-out: quick at first, slowing to a stop at 1. */
export function easeOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - (1 - t) * (1 - t);
}

/** One ring: the node it is on (-1 for none), its size relative to the theme's radius, and how far its animation got. */
export class RingAnim {
  node = -1;
  scale = 1;
  /** What the ring is faded from (its eased level when it was left), for a ring fading out. */
  peak = 1;
  private start = NaN; // NaN: not started yet; -Infinity: settled without an animation
  private t = 0;

  /** Put the ring on `node` (-1: none). A new node starts the animation again; returns whether it did. */
  to(node: number, scale: number): boolean {
    this.scale = scale;
    if (node === this.node) return false;
    this.node = node;
    this.peak = 1;
    this.start = NaN;
    this.t = 0;
    return true;
  }

  /** Take over `o`'s node to fade it out from where it got. */
  fadeFrom(o: RingAnim): void {
    this.to(-1, 1);
    this.to(o.node, o.scale);
    this.peak = easeOut(o.t);
  }

  clear(): void {
    this.to(-1, 1);
  }

  /** Progress (0..1) at `now`, a frame's timestamp, over `ms`; 1 at once when `ms` is 0 (no animation). Outside a frame (`now` NaN), where
   *  the last frame left it. */
  progress(now: number, ms: number): number {
    if (!(ms > 0)) {
      this.start = -Infinity;
      return (this.t = 1);
    }
    if (Number.isNaN(now)) return this.t;
    if (Number.isNaN(this.start)) this.start = now - FIRST_STEP_MS;
    return (this.t = Math.min(1, Math.max(0, (now - this.start) / ms)));
  }
}
