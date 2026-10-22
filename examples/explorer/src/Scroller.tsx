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
      // keep what gets focus clear of a sticky group at the end (Search, Export): the browser counts that area as inside the scrollport
      const pin = el.querySelector<HTMLElement>(':scope > .ex-pinned');
      el.style.scrollPaddingRight = pin ? `${pin.offsetWidth}px` : '';
      el.style.scrollPaddingLeft = el.hasAttribute('data-start') ? '28px' : '';
    };
    // scroll-padding alone does not make the browser scroll a focused control out from under the pinned group (it counts as in view),
    // so scroll it clear of the group, and clear of the fade at the start
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      const pin = el.querySelector<HTMLElement>(':scope > .ex-pinned');
      if (!pin || pin.contains(t)) return;
      const r = t.getBoundingClientRect();
      const edge = pin.getBoundingClientRect().left - 8;
      if (r.right > edge && r.left < pin.getBoundingClientRect().right)
        el.scrollLeft += Math.min(r.right - edge, r.left - el.getBoundingClientRect().left - 8);
      else if (r.left < el.getBoundingClientRect().left + 28 && el.scrollLeft > 0) el.scrollLeft -= el.getBoundingClientRect().left + 36 - r.left;
    };
    el.addEventListener('focusin', onFocus);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update); // the row itself, and its children as they come and go
    ro.observe(el);
    const mo = new MutationObserver((ms) => {
      update();
      for (const m of ms) for (const c of m.addedNodes) if (c instanceof Element) ro.observe(c);
    });
    mo.observe(el, { childList: true });
    for (const c of el.children) ro.observe(c);
    return () => {
      el.removeEventListener('scroll', update);
      el.removeEventListener('focusin', onFocus);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return <div ref={ref} data-scroll="" {...p} />;
}
