// DetailLoader: opening the stubs of a partial TreeSource. After a full-quality frame the renderer hands it the draw list; it picks the
// stubs (summaries of clades whose rows are not loaded) that are big enough on screen, asks the source for their rows through
// ensureClade (biggest first, a few at a time, cancelled when they leave the view) and tells the renderer when the source's version
// moved, so the next frame draws the new rows as regular nodes.
//
// It owns the requests in flight and the bookkeeping that keeps it from asking twice (failures, "resolved without effect at version v").
// It does NOT draw, decide when a frame happens or touch the DOM; it only reads the draw list and the transform. Only used for a source
// whose snapshots have stubs.

import type { Transform } from './geom.ts';
import type { Layout } from './layout.ts';
import { K_SUMMARY, type DrawList } from './lod.ts';
import type { TreeSource } from './source.ts';
import type { TreeSnapshot } from './types.ts';

const DETAIL_PX = 40; // a stub taller than this on screen is opened
const BIG_CLADE_ROWS = 20000; // a stub that costs more rows than this waits until it fills DETAIL_FRAC of the view
const DETAIL_FRAC = 0.33;
const DETAIL_INFLIGHT = 4; // clade requests in flight at once, below the browser's 6 connections per host

export class DetailLoader {
  private pending = new Map<number, AbortController>(); // clade requests in flight, by node id of the full tree
  private failed = new Set<number>();
  private doneAt = new Map<number, number>(); // node id -> source version at which ensureClade resolved without effect

  /** `onChanged`: a request finished and the source has new rows (its version moved): redraw. */
  constructor(
    private source: TreeSource,
    private onChanged: () => void,
  ) {}

  /** Stubs in the draw list that are big enough on screen to be worth opening: ask the source for their rows (biggest first, a few
   *  at a time, cancelled when they leave the view). The source bumps its version when they arrive and the next frame draws them
   *  as regular rows. `version` is the source version the snapshot `tree` was read at; `fitted`: the view is the fit view. */
  request(tree: TreeSnapshot, list: DrawList, T: Transform, L: Layout, rect: boolean, fitted: boolean, version: number): void {
    if (fitted) return; // the first view is the overview as it is; opening starts with the first zoom or pan
    const extent = rect ? T.clipB - T.clipT : Math.min(T.clipR - T.clipL, T.clipB - T.clipT);
    const want: Array<{ id: number; px: number }> = [];
    for (let e = 0; e < list.count; e++) {
      if (list.kind[e] !== K_SUMMARY) continue;
      const i = list.node[e];
      if (tree.stub![i] !== 1) continue;
      const px = rect ? (tree.leafEnd[i] - tree.leafStart[i]) * T.ky : (tree.leafEnd[i] - tree.leafStart[i]) * T.da * L.XMAX[i] * T.k;
      const id = tree.globalId![i];
      // a clade that costs many rows must fill a good part of the view first; a small one opens as soon as it is DETAIL_PX tall
      const need = (this.source.openCost?.(id) ?? 0) > BIG_CLADE_ROWS ? Math.max(DETAIL_PX, DETAIL_FRAC * extent) : DETAIL_PX;
      if (px >= need && this.doneAt.get(id) !== version) want.push({ id, px });
    }
    want.sort((a, b) => b.px - a.px);
    const keep = new Set(want.map((w) => w.id));
    for (const [id, ac] of this.pending)
      if (!keep.has(id)) {
        ac.abort();
        this.pending.delete(id);
      }
    for (const w of want) {
      if (this.pending.size >= DETAIL_INFLIGHT) break;
      if (this.pending.has(w.id) || this.failed.has(w.id)) continue;
      const ac = new AbortController();
      const v0 = this.source.version;
      this.pending.set(w.id, ac);
      this.source.ensureClade(w.id, { signal: ac.signal, priority: w.px }).then(
        () => {
          this.pending.delete(w.id);
          if (this.source.version !== v0) this.onChanged();
          else {
            // nothing changed: do not ask again until the version moves
            this.doneAt.set(w.id, v0);
          }
        },
        (err) => {
          this.pending.delete(w.id);
          if (!ac.signal.aborted) {
            this.failed.add(w.id);
            console.warn('TreeSource.ensureClade failed', w.id, err);
          }
        },
      );
    }
  }

  /** Cancel everything in flight (the renderer is destroyed). */
  destroy(): void {
    for (const ac of this.pending.values()) ac.abort();
    this.pending.clear();
  }
}
