// Prop plumbing of <TreeView>, kept apart from the component so the logic can be tested without a DOM:
//  - shallowEqualOwn / stripUndefined: pure helpers
//  - useStable / useShallowStable: return the previous object while the next one is equal, so an inline `options={{...}}` or
//    `theme={{...}}` (a new object on every parent render) does not re-run the effects that depend on it.

import { useRef } from 'react';

/** True when both have the same own enumerable keys and every value is `Object.is`-equal (functions by identity, nested objects by
 *  reference). null / undefined count as an empty object. */
export function shallowEqualOwn(a: object | null | undefined, b: object | null | undefined): boolean {
  if (a === b) return true;
  const x = (a ?? {}) as Record<string, unknown>;
  const y = (b ?? {}) as Record<string, unknown>;
  const kx = Object.keys(x);
  if (kx.length !== Object.keys(y).length) return false;
  for (const k of kx) if (!Object.prototype.hasOwnProperty.call(y, k) || !Object.is(x[k], y[k])) return false;
  return true;
}

/** A copy without the keys whose value is undefined, so spreading it over defaults cannot overwrite them with undefined. */
export function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

/** The first value of a run of renders whose values are equal under `equals`. (A ref written during render, as in the usual
 *  "latest value" memo: the result depends only on the inputs, so a discarded render cannot leave a wrong value behind.) */
export function useStable<T>(value: T, equals: (a: T, b: T) => boolean): T {
  const ref = useRef(value);
  if (ref.current !== value && !equals(ref.current, value)) ref.current = value;
  return ref.current;
}

/** `useStable` with `shallowEqualOwn`: the same object while every own value is `Object.is`-equal to the previous render's. */
export function useShallowStable<T extends object>(value: T): T {
  return useStable(value, shallowEqualOwn);
}
