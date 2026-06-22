import { AsyncLocalStorage } from 'node:async_hooks';

import type { Event } from './event.ts';

import { isUndefined } from '../../utils/index.ts';

const store = new AsyncLocalStorage<Event>();

/**
 * Runs `fn` with `event` bound as the ambient request event.
 *
 * Everything `fn` awaits, however deep, sees the same event through `useEvent`.
 * The pipeline wraps each request in this; the binding unwinds when `fn` settles.
 *
 * @example
 * ```ts
 * await runWithEvent(event, async () => {
 *   useEvent() === event // -> true
 * })
 * ```
 */
export function runWithEvent<R>(event: Event, fn: () => R): R {
  return store.run(event, fn);
}

/**
 * Returns the current request's `Event`.
 * Reaches the event bound by `runWithEvent` at any call depth, the basis for every composable.
 *
 * Throws when called outside a request, where no event is bound.
 *
 * @example
 * ```ts
 * useEvent().request // -> the inbound Request
 * useEvent().params  // -> the matched route params
 * ```
 */
export function useEvent(): Event {
  const event = store.getStore();
  if (isUndefined(event)) throw new Error('useEvent() called outside of a request.');
  return event;
}
