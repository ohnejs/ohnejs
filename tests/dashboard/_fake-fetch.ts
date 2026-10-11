import { mock } from 'node:test';

import './_fake-dom.ts';

/**
 * A request the fake `fetch` holds until the test answers it.
 */
export interface HeldRequest {
  url: string;
  init: RequestInit;
  aborted: boolean;
  answer(status: number, body?: unknown, headers?: Record<string, string>): void;
  fail(): void;
}

/**
 * Every request sent since the last `resetFetch`, oldest first.
 */
export const requests: HeldRequest[] = [];

const listeners = new Map<string, Set<() => void>>();

Object.assign(document, {
  visibilityState: 'visible',
  getElementById: () => ({
    textContent: JSON.stringify({ apiURL: 'http://api', defaultLanguage: 'en', messageGroups: [] }),
  }),
  addEventListener: (type: string, listener: () => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(listener);
  },
  removeEventListener: (type: string, listener: () => void) =>
    listeners.get(type)?.delete(listener),
});

mock.method(
  globalThis,
  'fetch',
  (url: string, init: RequestInit = {}) =>
    new Promise<Response>((resolve, reject) => {
      const held: HeldRequest = {
        url,
        init,
        aborted: false,
        answer: (status, body, headers) =>
          resolve(
            new Response(status === 204 || body === undefined ? null : JSON.stringify(body), {
              status,
              headers,
            }),
          ),
        fail: () => reject(new TypeError('Failed to fetch')),
      };
      init.signal?.addEventListener('abort', () => {
        held.aborted = true;
        reject(init.signal?.reason);
      });
      requests.push(held);
    }),
);

/**
 * Forgets every held request.
 */
export function resetFetch(): void {
  requests.length = 0;
}

/**
 * Sets the document's visibility and tells its `visibilitychange` listeners.
 */
export function setVisibility(state: 'visible' | 'hidden'): void {
  Object.assign(document, { visibilityState: state });
  for (const listener of listeners.get('visibilitychange') ?? []) listener();
}

/**
 * Lets pending promise callbacks run.
 */
export function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
