import { HTTPError, useEvent, useResponse } from 'ohnejs';
import { createPermits, isNull, type Permits } from 'ohnejs/utils';

import { translate } from '../../ohne/http/translate.ts';

let permits: Permits | undefined;

/**
 * Takes a permit to run one password check, and returns the release fn to call once it is done.
 * A process runs at most half its libuv pool of checks at once, so file serving and uploads keep threads.
 * One client IP runs at most one check at a time, so a single source cannot hold every permit.
 * A request over either limit answers `503` with `Retry-After: 1`.
 */
export function acquirePasswordPermit(): () => void {
  // Node sizes the libuv pool from UV_THREADPOOL_SIZE, 4 when unset.
  permits ??= createPermits(
    Math.max(1, Math.floor((Number(process.env.UV_THREADPOOL_SIZE) || 4) / 2)),
    1,
  );
  const { ip } = useEvent();
  const release = permits.acquire(ip === '' ? undefined : ip);
  if (isNull(release)) {
    useResponse().headers.set('Retry-After', '1');
    throw new HTTPError(503, translate('api.http.serviceUnavailable'));
  }
  return release;
}
