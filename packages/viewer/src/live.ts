// `live`: build the object a module reads the renderer's state through. The renderer replaces some of its fields over time (options,
// tree, layout, theme), so a module must never keep a copy: every property of the object returned here is a getter that runs the given
// function at access time. Plain methods (the actions the module may ask for) are passed separately and copied as they are.

type Methods<H> = { [K in keyof H as H[K] extends (...args: never[]) => unknown ? K : never]: H[K] };
type Props<H> = { [K in keyof H as H[K] extends (...args: never[]) => unknown ? never : K]: () => H[K] };

export function live<H extends object>(props: Props<H>, methods: Methods<H>): H {
  const o = { ...methods } as H;
  for (const k of Object.keys(props) as Array<keyof Props<H> & string>)
    Object.defineProperty(o, k, { get: props[k] as () => unknown, enumerable: true });
  return o;
}
