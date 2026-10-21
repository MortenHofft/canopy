// Two helpers for building the renderer's DOM skeleton (shared by the modules that own a piece of it). Browser only.

/** Create an element with an inline style sheet. */
export function mk<K extends keyof HTMLElementTagNameMap>(tag: K, css: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.style.cssText = css;
  return el;
}

/** Visually hidden but read by assistive technology. */
export const SR_ONLY = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
