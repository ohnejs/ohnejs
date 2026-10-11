import { FakeElement } from '../_fake-dom.ts';

const listeners = new WeakMap<FakeElement, Map<string, ((event: unknown) => void)[]>>();

Object.assign(FakeElement.prototype, {
  addEventListener(this: FakeElement, type: string, listener: (event: unknown) => void) {
    const byType = listeners.get(this) ?? new Map<string, ((event: unknown) => void)[]>();
    listeners.set(this, byType);
    byType.set(type, [...(byType.get(type) ?? []), listener]);
  },
  removeEventListener() {},
  append(this: FakeElement, ...nodes: FakeElement[]) {
    for (const node of nodes) this.appendChild(node);
  },
  closest: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  matches: () => false,
  contains: () => false,
  focus() {},
  scrollTo() {},
  showPopover() {},
  hidePopover() {},
  getBoundingClientRect: () => ({
    x: 0,
    y: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
  }),
});

Object.defineProperty(FakeElement.prototype, 'textContent', {
  get(this: FakeElement): string {
    return this.childNodes.map((node) => node.textContent).join('');
  },
  set(this: FakeElement, text: string) {
    this.replaceChildren();
    if (text) this.appendChild(document.createTextNode(text) as unknown as FakeElement);
  },
});

Object.assign(globalThis, {
  window: { addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true },
  getComputedStyle: () => ({ display: 'inline', getPropertyValue: () => '' }),
});
const createElement = document.createElement.bind(document);

Object.assign(document, {
  createElement: (tag: string) => {
    const element = createElement(tag) as unknown as FakeElement;
    Object.assign(element.style, { removeProperty() {}, setProperty() {} });
    Object.assign(element.classList, {
      remove: (...names: string[]) => names.forEach((name) => element.classList.delete(name)),
      contains: (name: string) => element.classList.has(name),
    });
    return element;
  },
  activeElement: null,
  getElementById: () => ({
    textContent: JSON.stringify({ apiURL: 'http://api', defaultLanguage: 'en', messageGroups: [] }),
  }),
  addEventListener() {},
  removeEventListener() {},
});
Object.assign(document, {
  body: document.createElement('body'),
  documentElement: document.createElement('html'),
});

/**
 * Runs every `type` listener `element` holds with a minimal event, and returns that event.
 */
export function fire(element: FakeElement, type: string): { defaultPrevented: boolean } {
  const event = {
    type,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {},
  };
  for (const listener of listeners.get(element)?.get(type) ?? []) listener(event);
  return event;
}
