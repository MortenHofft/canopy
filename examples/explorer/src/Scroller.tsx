// A row that scrolls sideways when it is too narrow, and says so: data-start / data-end are set while there is more to see before / after,
// and the CSS fades that edge. The attributes are set on the element, not in state, so a scroll does not render the explorer.
import React, { useEffect, useRef } from 'react';

export function Scroller(p: React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      el.toggleAttribute('data-start', el.scrollLeft > 1);
      el.toggleAttribute('data-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update); // the row itself, and its children as they come and go
    ro.observe(el);
    const mo = new MutationObserver(() => {
      update();
      for (const c of el.children) ro.observe(c);
    });
    mo.observe(el, { childList: true });
    for (const c of el.children) ro.observe(c);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return <div ref={ref} data-scroll="" {...p} />;
}
