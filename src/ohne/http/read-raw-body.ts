import type { Event } from './event.ts';

import { isNull, isUndefined } from '../../utils/index.ts';
import { useEvent } from './use-event.ts';

const cache = new WeakMap<Event, Promise<Uint8Array | undefined>>();

/**
 * Reads the raw request body as bytes, or `undefined` when there is none.
 * The body stream is consumed once and memoized per request.
 * Every body reader (`readTextBody`, `readJSONBody`, `readFormBody`) reuses the same bytes.
 * Valid only within a request.
 *
 * An over-cap body rejects with `413` from the transport; let it propagate.
 *
 * @example
 * ```ts
 * await readRawBody() // -> Uint8Array(5) or undefined
 * ```
 */
export function readRawBody(): Promise<Uint8Array | undefined> {
  const event = useEvent();

  const cached = cache.get(event);
  if (!isUndefined(cached)) return cached;

  const bytes = consume(event.request);
  cache.set(event, bytes);
  return bytes;
}

async function consume(request: Request): Promise<Uint8Array | undefined> {
  if (isNull(request.body)) return undefined;

  const bytes = await request.bytes();
  return bytes.byteLength === 0 ? undefined : bytes;
}
