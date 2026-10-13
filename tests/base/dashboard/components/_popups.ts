import type { DashboardMeta } from '../../../../src/dashboard/runtime/meta-types.ts';

import { flush } from '../../../../src/utils/reactive/_scheduler.ts';
import { FakeElement, type FakeNode } from '../../../dashboard/_fake-dom.ts';
import { settle } from '../../../dashboard/router/_browser.ts';

type Listener = (event: unknown) => void;

const handlers = new WeakMap<object, Map<string, Listener[]>>();

/**
 * The discovery data the popup reads its gates from.
 */
export function metaWith(routes: string[], capabilities: string[]): DashboardMeta {
  return {
    menu: [],
    collections: [],
    blocks: [],
    roles: [],
    capabilities,
    routes,
    locales: ['en'],
    defaultLocale: 'en',
    languages: ['en'],
    accountFields: [],
    accountLayout: [],
    defaultViews: {},
  };
}

/**
 * Records every listener an element or the window adds, so `fire` can run them.
 */
export function recordListeners(): void {
  const record = (target: object, type: string, listener: Listener): void => {
    const byType = handlers.get(target) ?? new Map<string, Listener[]>();
    handlers.set(target, byType);
    byType.set(type, [...(byType.get(type) ?? []), listener]);
  };
  Object.assign(FakeElement.prototype, {
    addEventListener(this: FakeElement, type: string, listener: Listener) {
      record(this, type, listener);
    },
    matches: () => false,
    scrollTo() {},
    showPopover() {},
    hidePopover() {},
  });
  const create = document.createElement.bind(document);
  Object.assign(document, {
    createElement: (tag: string) => {
      const element = create(tag) as unknown as FakeElement;
      Object.assign(element.style, { removeProperty() {}, setProperty() {} });
      Object.assign(element.classList, {
        remove: (...names: string[]) => names.forEach((name) => element.classList.delete(name)),
        contains: (name: string) => element.classList.has(name),
      });
      return element;
    },
    addEventListener() {},
  });
  Object.assign(document, { body: document.createElement('body') });
  Object.defineProperty(FakeElement.prototype, 'textContent', {
    get(this: FakeElement): string {
      return this.childNodes.map((node) => node.textContent).join('');
    },
    set(this: FakeElement, text: string) {
      this.replaceChildren();
      if (text) this.appendChild(document.createTextNode(text) as unknown as FakeNode);
    },
  });
  Object.assign(window, {
    addEventListener: (type: string, listener: Listener) => record(window, type, listener),
    getSelection: () => ({ removeAllRanges() {} }),
    dispatchEvent: () => true,
  });
}

/**
 * Runs every `type` listener `target` holds with a minimal event carrying `extra`.
 */
export function fire(target: object, type: string, extra: Record<string, unknown> = {}): void {
  const event = {
    type,
    target,
    currentTarget: target,
    key: '',
    preventDefault() {},
    stopPropagation() {},
    ...extra,
  };
  for (const listener of handlers.get(target)?.get(type) ?? []) listener(event);
  flush();
}

/**
 * Every element under `root` that `match` admits, in document order.
 */
export function findAll(root: FakeNode, match: (element: FakeElement) => boolean): FakeElement[] {
  return root.childNodes.flatMap((child) => [
    ...(child instanceof FakeElement && match(child) ? [child] : []),
    ...findAll(child, match),
  ]);
}

/**
 * The document body, where every popup, menu, and dialog mounts.
 */
export function body(): FakeElement {
  return document.body as unknown as FakeElement;
}

/**
 * The button whose text is `label`, the last one mounted.
 */
export function textButton(label: string): FakeElement {
  return findAll(
    body(),
    (element) => element.tagName === 'BUTTON' && element.textContent === label,
  ).at(-1)!;
}

/**
 * The last `input` mounted, typed into by setting its value and firing `input`.
 */
export function lastInput(): FakeElement & { value: string } {
  return findAll(body(), (element) => element.tagName === 'INPUT').at(-1)! as FakeElement & {
    value: string;
  };
}

/**
 * Lets the requests and their reloads settle.
 */
export async function idle(): Promise<void> {
  for (let i = 0; i < 3; i++) await settle();
}

/**
 * One request the recording `fetch` saw, its JSON body parsed.
 */
export interface Sent {
  method: string;
  path: string;
  body: unknown;
}

/**
 * Installs a `fetch` that records each request into `sent` before `answer` answers it.
 */
export function recordFetch(sent: Sent[], answer: (request: Sent) => Response): void {
  Object.assign(globalThis, {
    fetch: async (url: string, init: RequestInit = {}) => {
      const request = {
        method: init.method ?? 'GET',
        path: new URL(url).pathname,
        body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
      };
      sent.push(request);
      return answer(request);
    },
  });
}
