import type { UploadSession } from './types.ts';

import {
  readSessionRow,
  sessionEnded,
  sessionExpired,
  settleSessionUnderLock,
  wireSession,
} from './_session.ts';

/**
 * Resolves the resumable upload session `uuid`: where its file lands and how far it got.
 *
 * An unknown session is a `404`, and so is one `author` did not create, so a caller learns nothing of it.
 * An omitted `author` skips that check, for server code.
 * A session past its `expiresAt`, or one whose storage handle a crash lost, is discarded.
 * It then answers a `404` whose message says it has expired, even when a rival discarded it first.
 * One another request holds is left to it, answering the same `404` without waiting.
 * A live session is read without its lock, so a chunk in flight may advance it right after.
 *
 * @example
 * ```ts
 * const session = await readUploadSession(uuid, { author: user.UUID })
 * session.offset // -> 16777216
 * ```
 */
export async function readUploadSession(
  uuid: string,
  options: { author?: string } = {},
): Promise<UploadSession> {
  const row = await readSessionRow(uuid, options);
  if (!sessionEnded(row)) return wireSession(row);
  await settleSessionUnderLock(uuid);
  throw sessionExpired();
}
