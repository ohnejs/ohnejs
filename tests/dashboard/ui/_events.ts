import { isUndefined } from '../../../src/utils/is/is-undefined.ts';
import { detectPlatform } from '../../../src/utils/keys/platform.ts';
import { FakeElement, type FakeNode, hasClass } from '../_fake-dom.ts';

const listeners = new WeakMap<FakeElement, Map<string, ((event: unknown) => void)[]>>();

Object.assign(FakeElement.prototype, {
  addEventListener(this: FakeElement, type: string, listener: (event: unknown) => void) {
    const byType = listeners.get(this) ?? new Map<string, ((event: unknown) => void)[]>();
    listeners.set(this, byType);
    byType.set(type, [...(byType.get(type) ?? []), listener]);
  },
  removeEventListener(this: FakeElement, type: string, listener: (event: unknown) => void) {
    const byType = listeners.get(this);
    byType?.set(
      type,
      (byType.get(type) ?? []).filter((held) => held !== listener),
    );
  },
  append(this: FakeElement, ...nodes: FakeElement[]) {
    for (const node of nodes) this.appendChild(node);
  },
  closest: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  matches: () => false,
  contains: () => false,
  focus() {},
  blur() {},
  select() {},
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
 * `init` adds event fields, like a keydown's `key`.
 */
export function fire(
  element: FakeElement,
  type: string,
  init: Record<string, unknown> = {},
): { defaultPrevented: boolean; propagationStopped: boolean } {
  return bubble([element], type, init);
}

/**
 * Runs one minimal event through the `type` listeners of each element in `path`, and returns it.
 * `path` lists the innermost element first; a listener that stops propagation ends the walk.
 */
export function bubble(
  path: FakeElement[],
  type: string,
  init: Record<string, unknown> = {},
): { defaultPrevented: boolean; propagationStopped: boolean } {
  const event = {
    ...init,
    type,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {
      event.propagationStopped = true;
    },
  };
  for (const element of path) {
    if (event.propagationStopped) break;
    for (const listener of listeners.get(element)?.get(type) ?? []) listener(event);
  }
  return event;
}

/**
 * Lets `querySelectorAll` match one class selector, and `focus` set `document.activeElement`.
 * A test calls it once to follow focus as it roves through `.ohne-dropdown-item` rows.
 */
export function trackRowFocus(): void {
  const descendants = (node: FakeNode): FakeElement[] =>
    node.childNodes.flatMap((child) => [
      ...(child instanceof FakeElement ? [child] : []),
      ...descendants(child),
    ]);
  Object.assign(FakeElement.prototype, {
    querySelectorAll(this: FakeElement, selector: string) {
      return descendants(this).filter((element) => hasClass(element, selector.slice(1)));
    },
    focus(this: FakeElement) {
      Object.assign(document, { activeElement: this });
    },
  });
}

/**
 * Lets `closest` match comma-separated simple selectors, and `contains` follow parents.
 * A part is a class like `.ohne-row`, a tag, an attribute like `[contenteditable]`, or both, like `a[href]`.
 */
export function matchSelectors(): void {
  const matches = (node: FakeElement, selector: string): boolean => {
    if (selector.startsWith('.')) {
      return hasClass(node, selector.slice(1)) || node.classList.has(selector.slice(1));
    }
    const [, tag, attribute] = /^([a-z]*)(?:\[([a-z-]+)\])?$/.exec(selector) ?? [];
    if (isUndefined(tag)) return false;
    return (
      (!tag || node.tagName === tag.toUpperCase()) &&
      (isUndefined(attribute) || node.getAttribute(attribute) !== null)
    );
  };
  const nearest = (node: FakeElement | null, parts: string[]): FakeElement | null => {
    if (!node) return null;
    return parts.some((part) => matches(node, part)) ? node : nearest(node.parentElement, parts);
  };
  Object.assign(FakeElement.prototype, {
    closest(this: FakeElement, selector: string): FakeElement | null {
      return nearest(
        this,
        selector.split(',').map((part) => part.trim()),
      );
    },
    contains(this: FakeElement, other: FakeElement): boolean {
      for (let node: FakeElement | null = other; node; node = node.parentElement) {
        if (node === this) return true;
      }
      return false;
    },
  });
}

/**
 * The keydown fields of the platform's undo hotkey, Command+Z on mac and Control+Z elsewhere.
 */
export function undoKeydown(): Record<string, unknown> {
  const mac = detectPlatform() === 'mac';
  return { key: 'z', ctrlKey: !mac, metaKey: mac, altKey: false, shiftKey: false };
}
