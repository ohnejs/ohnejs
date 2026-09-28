import type { Transaction } from 'ohnejs';

import { conflict, ohneError, queryUntyped } from 'ohnejs';
import { isNull, isUndefined } from 'ohnejs/utils';
import { createSHA256 } from 'ohnejs/utils/crypto';

import type { UploadReach } from './_reach.ts';
import type { UploadRow } from './_row.ts';
import type { SessionRow } from './_session.ts';
import type { StagedUpload } from './_stage.ts';
import type { UploadRecord } from './types.ts';

import { drainJournal, journalStorage } from '../storage/journal.ts';
import { useStorage } from '../storage/use-storages.ts';
import { landUpload } from './_land.ts';
import { decorated, readUpload } from './_row.ts';
import {
  readSessionRow,
  sessionEnded,
  sessionExpired,
  sessionParts,
  sessionTemp,
  settleSession,
  wireSession,
  withSessionLock,
} from './_session.ts';
import { claimStaged, discardStaged, stageUpload } from './_stage.ts';
import { assertTypeAllowed } from './_type.ts';

const SVG = 'image/svg+xml';

/**
 * Lands the file of the resumable upload session `uuid` in `Uploads`, resolving its record.
 *
 * The file lands exactly as `putUpload` would land the same bytes: same suffixing, folders, and privacy.
 * Its `hash` comes from the midstate the chunks carried, so the file is never read back whole.
 * An SVG is the exception: it is read back once, sanitized, and staged anew.
 * `created` is `true` the first time, and a repeat resolves the same record with `false`.
 * A repeat whose file `reach` no longer admits is the plain `404`.
 * An unknown session is a `404`, and so is one `author` did not create.
 * An omitted `author` skips that check, for server code.
 * An expired session, or one whose storage handle a crash lost, is discarded and answers an expired `404`.
 * A session still missing bytes is a `409` with the session as `data`.
 * A type `uploads.types` no longer allows is a `422` at `name`.
 * Every `422` keeps the session, to complete again once its cause is fixed, or to abort.
 * The journal drains after the session's lock is released, on a repeat too, so the file lands at its path.
 *
 * @example
 * ```ts
 * const { record, created } = await completeUploadSession(uuid, { author: user.UUID })
 * record.path // -> 'films/arthas.mp4'
 * created     // -> true
 * ```
 */
export async function completeUploadSession(
  uuid: string,
  options: { author?: string; reach?: UploadReach } = {},
): Promise<{ record: UploadRecord; created: boolean }> {
  const landed = await withSessionLock(uuid, () => land(uuid, options));
  await drainJournal();
  return landed;
}

/**
 * Seals and lands the session `uuid`, or resolves the record an earlier completion landed.
 * The caller holds the session's lock.
 */
async function land(
  uuid: string,
  { author, reach }: { author?: string; reach?: UploadReach },
): Promise<{ record: UploadRecord; created: boolean }> {
  const row = await readSessionRow(uuid, { author });
  if (sessionEnded(row)) {
    await settleSession(row);
    throw sessionExpired();
  }
  if (!isNull(row.upload)) {
    return { record: decorated(await readUpload(row.upload, undefined, reach)), created: false };
  }
  if (row.offset < row.size) throw conflict(undefined, wireSession(row));
  assertTypeAllowed(row.type);

  const staged = await stagedOf(await seal(row));
  const { directory, name, type } = row;
  try {
    const record = await landUpload(
      staged,
      { directory, name, type, author: row.author, reach },
      { claim: (tx, file) => claim(tx, row, file, staged) },
    );
    return { record, created: true };
  } catch (error) {
    if (staged.temp !== sessionTemp(uuid)) await discardStaged(staged.temp);
    throw error;
  }
}

/**
 * Assembles the parts of `row` into the object at `sessionTemp`, then forgets the handle.
 * Resolves the row as it now stands.
 * A row without a handle is sealed already.
 * A crash before the handle is forgotten is harmless, since `parts.complete` resolves again.
 */
async function seal(row: SessionRow): Promise<SessionRow> {
  if (isNull(row.token)) return row;
  const receipts = JSON.parse(row.receipts) as string[];
  await sessionParts().complete(sessionTemp(row.UUID), row.token, receipts);
  await queryUntyped('UploadsSessions')
    .unscoped()
    .where({ UUID: row.UUID })
    .updateOrThrow({ token: null });
  return { ...row, token: null };
}

/**
 * The staged upload landing takes for the sealed object of `row`, checked against the declared size.
 * An SVG is read back, sanitized, and staged as a new temp object.
 * Anything else lands as sealed, measured by its first chunk.
 * An object of another size means the storage lost bytes, a `500` that keeps the session for an abort.
 */
async function stagedOf(row: SessionRow): Promise<StagedUpload> {
  const storage = useStorage();
  const temp = sessionTemp(row.UUID);
  if (row.type === SVG) {
    const object = await storage.read(temp);
    if (object?.size === row.size) {
      return stageUpload(object.body, { type: row.type, size: row.size });
    }
    await object?.body.cancel();
    throw lostBytes(row, object);
  }
  const stored = await storage.stat(temp);
  if (stored?.size !== row.size) throw lostBytes(row, stored);
  const hash = createSHA256(row.hashState ?? undefined).digest();
  return { temp, size: row.size, hash, width: row.width, height: row.height };
}

/**
 * Records on `tx` that the session `row` landed as `file`, or throws the `409` when a rival completion won.
 * A restaged SVG also claims its new temp object and journals the delete of the sealed one.
 * From this commit on, the sealed object belongs to the journal.
 */
async function claim(
  tx: Transaction,
  row: SessionRow,
  file: UploadRow,
  staged: StagedUpload,
): Promise<void> {
  const [claimed] = await queryUntyped('UploadsSessions')
    .use(tx)
    .unscoped()
    .where({ UUID: row.UUID, upload: { isNull: true } })
    .updateOrThrow({ upload: file.UUID });
  if (isUndefined(claimed)) {
    throw conflict(undefined, wireSession(await readSessionRow(row.UUID, { tx })));
  }
  const temp = sessionTemp(row.UUID);
  if (staged.temp === temp) return;
  await claimStaged(tx, staged.temp);
  await journalStorage(tx, { op: 'delete', from: temp });
}

/**
 * The failure for a sealed object of `row` that is missing, or `stored` at a size other than declared.
 */
function lostBytes(row: SessionRow, stored: { size: number } | null): Error {
  return ohneError(
    `Upload session \`${row.UUID}\` sealed ${stored?.size ?? 0} of its ${row.size} bytes`,
  );
}
