import { discardSession, readSessionRow, withSessionLock } from './_session.ts';

/**
 * Ends the resumable upload session `uuid`, dropping every byte it holds in storage and then its row.
 *
 * An unknown session is a `404`, and so is one `author` did not create.
 * An omitted `author` skips that check, for server code.
 * An expired session is discarded all the same.
 * A completed session loses only its row, and the file it landed as stays.
 * A storage failure rejects and keeps the session, so a repeat or the sweep finishes the job.
 *
 * @example
 * ```ts
 * await abortUploadSession(uuid, { author: user.UUID })
 * ```
 */
export function abortUploadSession(uuid: string, options: { author?: string } = {}): Promise<void> {
  return withSessionLock(uuid, async () => discardSession(await readSessionRow(uuid, options)));
}
