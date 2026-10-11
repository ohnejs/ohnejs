import { FakeElement, FakeNode, findElement, hasClass } from '../../_fake-dom.ts';
import '../_events.ts';

const listeners = new WeakMap<FakeElement, Map<string, ((event: unknown) => void)[]>>();

/**
 * The width every observed element reports, so charts draw as if laid out.
 */
export const WIDTH = 600;

Object.assign(FakeElement.prototype, {
  addEventListener(this: FakeElement, type: string, listener: (event: unknown) => void) {
    const byType = listeners.get(this) ?? new Map<string, ((event: unknown) => void)[]>();
    listeners.set(this, byType);
    byType.set(type, [...(byType.get(type) ?? []), listener]);
  },
  replaceChildren(this: FakeElement, ...nodes: FakeNode[]) {
    for (const child of this.childNodes.slice()) child.remove();
    for (const node of nodes) this.appendChild(node);
  },
});

Object.defineProperty(FakeElement.prototype, 'children', {
  get(this: FakeElement): FakeElement[] {
    return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement);
  },
});

Object.assign(globalThis, {
  ResizeObserver: class {
    readonly callback: (entries: { contentRect: { width: number } }[]) => void;

    constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
      this.callback = callback;
    }

    observe(): void {
      this.callback([{ contentRect: { width: WIDTH } }]);
    }

    disconnect(): void {}
  },
});

/**
 * Runs every `type` listener `element` holds with `event`, plus `preventDefault`.
 */
export function dispatch(element: FakeElement, type: string, event: object = {}): void {
  const full = { ...event, preventDefault() {} };
  for (const listener of listeners.get(element)?.get(type) ?? []) listener(full);
}

/**
 * Every element under `root`, depth first, that carries the class `name`.
 */
export function allByClass(root: FakeNode, name: string): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (node: FakeNode): void => {
    for (const child of node.childNodes) {
      if (child instanceof FakeElement && hasClass(child, name)) found.push(child);
      walk(child);
    }
  };
  walk(root);
  return found;
}

/**
 * The first element under `root` that carries the class `name`.
 */
export function byClass(root: FakeNode, name: string): FakeElement | undefined {
  return findElement(root, (element) => hasClass(element, name));
}
