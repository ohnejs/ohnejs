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
 * Runs `fn` with no event bound, however deep inside a request the caller sits.
 * The composables then answer as outside a request: `tryUseEvent` is `undefined`, `useUser` resolves `null`.
 * Work `fn` starts keeps the unbound context; the caller's event is back once `fn` returns.
 *
 * @example
 * ```ts
 * await runWithoutEvent(() => readScope('Posts')) // -> the read scope of a visitor without a session
 * ```
 */
export function runWithoutEvent<R>(fn: () => R): R {
  return store.exit(fn);
}

/**
 * Returns the current request's `Event`, or `undefined` outside a request.
 * The non-throwing counterpart to `useEvent`, for code that runs with or without a bound event.
 *
 * @example
 * ```ts
 * tryUseEvent()?.request.url // -> the inbound URL, or undefined outside a request
 * ```
 */
export function tryUseEvent(): Event | undefined {
  return store.getStore();
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
  const event = tryUseEvent();
  if (isUndefined(event)) throw new Error('`useEvent()` called outside of a request.');
  return event;
}
