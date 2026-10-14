// Timing marks, rAF frame sampler and heap reading. Browser only (uses performance, requestAnimationFrame).
// installMetrics() puts the sampler on window.__spikeMetrics so the Playwright runner can start and stop it
// around a scripted interaction.

export interface FrameStats {
  frames: number; // rAF callbacks observed
  durationMs: number;
  meanFps: number;
  medianFps: number; // 1000 / median frame interval
  p5Fps: number; // TIME-weighted: 95% of the time was spent in frames at least this fast (a frozen page makes few frames, so frame counts hide freezes); the "unusable" criterion
  p5FpsByFrame: number; // fps of the slowest 5% of frames by frame count (1000 / 95th percentile interval)
  p95Fps: number; // fps of the fastest 5% of frames
  droppedFrames: number; // intervals over 25 ms, counted as round(interval/16.67) - 1 each
  maxIntervalMs: number; // longest gap between two frames (a freeze shows up here)
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const k = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[k];
}

export function summariseIntervals(intervals: number[], durationMs: number): FrameStats {
  const s = intervals.slice().sort((a, b) => a - b);
  const med = percentile(s, 50);
  const hi = percentile(s, 95);
  const lo = percentile(s, 5);
  let dropped = 0;
  for (const d of intervals) if (d > 25) dropped += Math.max(1, Math.round(d / 16.667) - 1);
  const sum = intervals.reduce((a, b) => a + b, 0);
  // time-weighted 95th percentile of the interval: walk from the slowest frame until 5% of the time is covered
  let acc = 0;
  let slow = s.length ? s[s.length - 1] : 0;
  for (let i = s.length - 1; i >= 0; i--) {
    acc += s[i];
    slow = s[i];
    if (acc >= 0.05 * sum) break;
  }
  return {
    frames: intervals.length,
    durationMs,
    meanFps: intervals.length ? 1000 / (sum / intervals.length) : 0,
    medianFps: med ? 1000 / med : 0,
    p5Fps: slow ? 1000 / slow : 0,
    p5FpsByFrame: hi ? 1000 / hi : 0,
    p95Fps: lo ? 1000 / lo : 0,
    droppedFrames: dropped,
    maxIntervalMs: s.length ? s[s.length - 1] : 0,
  };
}

export class FrameSampler {
  private intervals: number[] = [];
  private last = 0;
  private raf = 0;
  private t0 = 0;
  private running = false;

  start(): void {
    this.stop();
    this.intervals = [];
    this.last = 0;
    this.running = true;
    this.t0 = performance.now();
    const tick = (t: number) => {
      if (!this.running) return;
      if (this.last) this.intervals.push(t - this.last);
      this.last = t;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Stops sampling and returns the statistics (a page that froze for the whole window returns frames 0). */
  stop(): FrameStats {
    const now = performance.now();
    if (this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
      // a frame that has not arrived yet still counts as a gap
      if (this.last) this.intervals.push(Math.max(0, now - this.last));
    }
    return summariseIntervals(this.intervals, now - this.t0);
  }
}

export interface HeapReading {
  usedMB: number;
  totalMB: number;
  limitMB: number;
}

/** JS heap (Chromium only; needs --enable-precise-memory-info for exact numbers). Calls gc() first if exposed. */
export function readHeap(gcFirst = true): HeapReading | null {
  const w = window as unknown as { gc?: () => void };
  if (gcFirst && typeof w.gc === 'function') {
    try {
      w.gc();
    } catch {
      /* ignore */
    }
  }
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (!m) return null;
  const MB = 1024 * 1024;
  return { usedMB: m.usedJSHeapSize / MB, totalMB: m.totalJSHeapSize / MB, limitMB: m.jsHeapSizeLimit / MB };
}

/** Resolves with performance.now() after two animation frames ("first painted frame" after a DOM or canvas update). */
export function nextPaint(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))));
}

export class Marks {
  private m = new Map<string, number>();
  mark(name: string): number {
    const t = performance.now();
    this.m.set(name, t);
    return t;
  }
  get(name: string): number | undefined {
    return this.m.get(name);
  }
  /** Milliseconds from mark `from` to mark `to` (or now). NaN if `from` is missing. */
  measure(from: string, to?: string): number {
    const a = this.m.get(from);
    const b = to ? this.m.get(to) : performance.now();
    return a === undefined || b === undefined ? NaN : b - a;
  }
  clear(): void {
    this.m.clear();
  }
}

/** Timestamps the shell records for input-to-effect latency (read by the runner). All performance.now() based. */
export interface InputMarks {
  /** event.timeStamp of the last pointerdown (the browser's input timestamp, so queueing delay is included). */
  pointerDown: number;
  /** SpikeEvent.t of the last click-type event the candidate reported. */
  lastEvent: number;
  /** React commit time (useEffect) of the shell state that follows that event. */
  lastEventCommit: number;
  /** Two animation frames after that commit: the first frame in which the new coloured state could be visible. */
  lastEventPaint: number;
}

export interface SpikeMetricsApi {
  startSampler(): void;
  stopSampler(): FrameStats;
  heap(gcFirst?: boolean): HeapReading | null;
  marks: Marks;
  input: InputMarks;
  /** Errors thrown by the page or logged with console.error, for the runner to collect. */
  errors: string[];
}

export function installMetrics(): SpikeMetricsApi {
  const sampler = new FrameSampler();
  const api: SpikeMetricsApi = {
    startSampler: () => sampler.start(),
    stopSampler: () => sampler.stop(),
    heap: (g = true) => readHeap(g),
    marks: new Marks(),
    input: { pointerDown: 0, lastEvent: 0, lastEventCommit: 0, lastEventPaint: 0 },
    errors: [],
  };
  (window as unknown as { __spikeMetrics: SpikeMetricsApi }).__spikeMetrics = api;
  window.addEventListener('error', (e) => api.errors.push(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => api.errors.push(`unhandledrejection: ${String((e as PromiseRejectionEvent).reason)}`));
  window.addEventListener('pointerdown', (e) => (api.input.pointerDown = e.timeStamp), true);
  return api;
}
