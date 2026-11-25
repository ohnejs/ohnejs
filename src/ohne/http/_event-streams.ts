import type { Event } from './event.ts';

import { getOrSet, isEmpty, isUndefined } from '../../utils/index.ts';

const streams = new WeakMap<Event, Set<() => void>>();

/**
 * Registers `close` to end one of `event`'s event streams when its server starts draining.
 * Returns the fn that unregisters it.
 */
export function trackEventStream(event: Event, close: () => void): () => void {
  const closes = getOrSet(streams, event, () => new Set());
  closes.add(close);
  return () => closes.delete(close);
}

/**
 * Ends every event stream `event` still has open, answering whether there was one.
 */
export function endEventStreams(event: Event): boolean {
  const closes = streams.get(event);
  if (isUndefined(closes) || isEmpty(closes)) return false;
  for (const close of closes) close();
  return true;
}
