// The NodeEvent handed to the app's click / hover listeners: what a hit or a keyboard activation means in terms of the public API
// (node ids of the full tree, tip ids, tip ranges). Pure functions of the snapshot, so they are testable without a viewer.

import type { TreeEvent } from './events.ts';
import type { TreeSource } from './source.ts';
import type { Hit, NodeEvent, TreeSnapshot } from './types.ts';

/** `node` is a row of the snapshot; the event speaks the public ids (the preorder id in the full tree for a partial source).
 *  A run of small siblings is reported under its parent with only ITS tips (the members are adjacent, so one range). */
export function makeNodeEvent(
  t: TreeSnapshot,
  node: number,
  kind: Hit['kind'],
  via: 'pointer' | 'keyboard',
  clientX: number,
  clientY: number,
  run?: Hit['run'],
): NodeEvent {
  if (run) {
    let clades = 0,
      single = 0;
    for (let j = run.first; j <= run.last; j = t.subtreeEnd[j])
      if (t.childCount[j] === 0) single++;
      else clades++;
    return {
      node: t.globalId === null ? node : t.globalId[node],
      isTip: false,
      tipId: null,
      kind,
      tipStart: t.leafStart[run.first],
      tipEnd: t.leafEnd[run.last],
      clientX,
      clientY,
      via,
      run: { clades, single },
    };
  }
  const isTip = t.childCount[node] === 0;
  return {
    node: t.globalId === null ? node : t.globalId[node],
    isTip,
    tipId: isTip ? (t.labels[node] ?? null) : null,
    kind,
    tipStart: t.leafStart[node],
    tipEnd: t.leafEnd[node],
    clientX,
    clientY,
    via,
  };
}

/** The event listeners receive: the node event plus the 'n<id>' form of the node id, tip helpers that read through `source`, and the
 *  default-action switch. One small object per click or hover, never per frame. */
export function toTreeEvent(e: NodeEvent, source: TreeSource): TreeEvent {
  let prevented = false;
  return {
    ...e,
    nodeId: 'n' + e.node,
    tipCount: e.tipEnd - e.tipStart,
    tipIds: () => source.snapshot().tipLabels.slice(e.tipStart, e.tipEnd),
    tipLabels: () => source.tipLabels(e.tipStart, e.tipEnd),
    preventDefault: () => {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  };
}
