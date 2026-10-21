// A minimal fake DOM for unit tests of the controls and overlays (no DOM package): elements with attributes, class lists, styles, children,
// listeners and dispatch with bubbling, `closest` on class and attribute selectors. Install with `installFakeDom()` before importing a
// module that touches `document` at call time.

class ClassList {
  constructor(el) {
    this.el = el;
    this.set = new Set();
  }
  add(...c) {
    for (const x of c) this.set.add(x);
  }
  remove(...c) {
    for (const x of c) this.set.delete(x);
  }
  contains(c) {
    return this.set.has(c);
  }
  toggle(c, on) {
    const want = on === undefined ? !this.set.has(c) : on;
    if (want) this.set.add(c);
    else this.set.delete(c);
    return want;
  }
  toString() {
    return [...this.set].join(' ');
  }
}

export class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.style = { cssText: '' };
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.classList = new ClassList(this);
    this._text = '';
    this.innerHTML = '';
    this.hidden = false;
    this.value = '';
    this.id = '';
  }
  get className() {
    return this.classList.toString();
  }
  set className(v) {
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return k in this.attrs ? this.attrs[k] : null;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  hasAttribute(k) {
    return k in this.attrs;
  }
  appendChild(c) {
    c.remove();
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  append(...cs) {
    for (const c of cs) this.appendChild(c);
  }
  insertBefore(c, ref) {
    c.remove();
    c.parentNode = this;
    const k = ref ? this.children.indexOf(ref) : -1;
    if (k < 0) this.children.push(c);
    else this.children.splice(k, 0, c);
    return c;
  }
  replaceChildren(...cs) {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    this.append(...cs);
  }
  remove() {
    if (!this.parentNode) return;
    const p = this.parentNode;
    p.children = p.children.filter((x) => x !== this);
    this.parentNode = null;
  }
  /** This element and its parents, innermost first. */
  ancestors() {
    const out = [this];
    while (out[out.length - 1].parentNode) out.push(out[out.length - 1].parentNode);
    return out;
  }
  contains(n) {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  addEventListener(t, f) {
    (this.listeners[t] ??= []).push(f);
  }
  removeEventListener(t, f) {
    this.listeners[t] = (this.listeners[t] ?? []).filter((x) => x !== f);
  }
  listenerCount() {
    return Object.values(this.listeners).reduce((n, l) => n + l.length, 0);
  }
  dispatch(type, init = {}) {
    const e = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      ...init,
    };
    for (const x of this.ancestors()) for (const f of x.listeners[type] ?? []) f(e);
    return e;
  }
  click() {
    return this.dispatch('click');
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  matches(sel) {
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    const a = /^\[([\w-]+)\]$/.exec(sel);
    if (a) {
      const k = a[1];
      if (k.startsWith('data-')) return k.slice(5).replace(/-(\w)/g, (_m, c) => c.toUpperCase()) in this.dataset;
      return k in this.attrs;
    }
    return this.tagName === sel.toUpperCase();
  }
  closest(sel) {
    for (const x of this.ancestors()) if (x.matches?.(sel)) return x;
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (c.matches(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.w ?? 0, bottom: this.h ?? 0, width: this.w ?? 0, height: this.h ?? 0 };
  }
  get offsetWidth() {
    return this.w ?? 0;
  }
  get offsetHeight() {
    return this.h ?? 0;
  }
  get clientWidth() {
    return this.w ?? 0;
  }
  get clientHeight() {
    return this.h ?? 0;
  }
  get isConnected() {
    return this.ancestors().pop() === globalThis.document?.body;
  }
}

export function installFakeDom() {
  const body = new FakeElement('body');
  globalThis.document = {
    body,
    activeElement: body,
    createElement: (t) => new FakeElement(t),
    documentElement: body,
  };
  globalThis.HTMLButtonElement ??= FakeElement;
  globalThis.window ??= globalThis;
  return globalThis.document;
}
