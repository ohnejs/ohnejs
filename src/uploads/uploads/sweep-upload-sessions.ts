import { queryUntyped } from 'ohnejs';
import { isUndefined } from 'ohnejs/utils';

import { settleSessionUnderLock } from './_session.ts';

/**
 * Discards every resumable upload session that expired before `before`, a Unix-millisecond time.
 *
 * The oldest go first, and `limit` caps how many one call takes; omitted, it takes them all.
 * Each is discarded under its own lock, re-read inside it, as `abortUploadSession` does.
 * One a request holds is skipped without waiting, left for the next sweep.
 * An open session's parts are aborted and a sealed one's object deleted; a completed one loses only its row.
 * One whose discard fails, in storage or the database, is warned about and kept for the next sweep.
 * Resolves how many sessions it settled, counting one whose row was already gone.
 *
 * @example
 * ```ts
 * await sweepUploadSessions()                         // -> 3
 * await sweepUploadSessions(Date.now() - 60_000, 100) // -> 0
 * ```
 */
export async function sweepUploadSessions(before = Date.now(), limit?: number): Promise<number> {
  const expired = queryUntyped('UploadsSessions')
    .unscoped()
    .where({ expiresAt: { lessThan: before } })
    .orderBy('expiresAt');
  const oldest = isUndefined(limit) ? expired : expired.limit(limit);
  const uuids = (await oldest.pluck('UUID')) as string[];
  let settled = 0;
  for (const uuid of uuids) {
    if (await settleSessionUnderLock(uuid)) settled++;
  }
  return settled;
}
