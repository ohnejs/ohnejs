import type { HTTPError, Transaction } from 'ohnejs';

import { badRequest, notFound, notImplemented, queryUntyped, usePrinter, withLock } from 'ohnejs';
import { errorMessage, isInteger, isNull, isUndefined, pick } from 'ohnejs/utils';

import type { StorageParts } from '../storage/adapter.ts';
import type { UploadSession } from './types.ts';

import { translate } from '../../ohne/http/translate.ts';
import { useUploadsConfig } from '../config.ts';
import { useStorage } from '../storage/use-storages.ts';
import { TEMP_PREFIX } from './path.ts';

/**
 * An `UploadsSessions` row as a read returns it: the `UploadSession` plus what only the server reads.
 */
export interface SessionRow extends UploadSession {
  /**
   * The `UUID` of the user who created the session, `null` for server code or once the user is gone.
   */
  author: string | null;

  /**
   * The SHA-256 midstate over the bytes before `offset`, as `createSHA256` resumes from it.
   * `null` until the first chunk is confirmed.
   */
  hashState: string | null;

  /**
   * The handle `parts.begin` resolved, which every part write carries.
   * `null` once `parts.complete` sealed the object, or with `offset` below `size` when a crash lost it.
   */
  token: string | null;

  /**
   * The JSON array of the receipts `parts.write` resolved, at index part number minus one.
   */
  receipts: string;

  /**
   * The width in pixels measured from the first chunk, `null` unless the file is a sized raster image.
   */
  width: number | null;

  /**
   * The height in pixels measured from the first chunk, `null` unless the file is a sized raster image.
   */
  height: number | null;

  /**
   * When the row last changed, in epoch milliseconds.
   */
  _updatedAt: number;
}

const WIRE_KEYS = [
  'UUID',
  'directory',
  'name',
  'type',
  'size',
  'chunkSize',
  'offset',
  'expiresAt',
  'upload',
] as const;

/**
 * The storage key a session's parts assemble into, `.tmp/<UUID>`, derived from the row and never stored.
 * `pruneUploads` leaves everything under `.tmp/` alone.
 */
export function sessionTemp(uuid: string): string {
  return `${TEMP_PREFIX}/${uuid}`;
}

/**
 * Reads the session `uuid`, on `tx` when the caller holds one, or throws the plain `404`.
 * A session created by anyone but `author` is the same `404`, so a caller learns nothing of it.
 * An omitted `author` skips that check, for server code.
 * It neither locks nor discards: an expired row, or one whose handle a crash lost, resolves like any other.
 * Settling those is the caller's, under `withSessionLock`.
 */
export async function readSessionRow(
  uuid: string,
  { author, tx }: { author?: string; tx?: Transaction } = {},
): Promise<SessionRow> {
  const row = await findSessionRow(uuid, tx);
  if (isUndefined(row) || (!isUndefined(author) && row.author !== author)) throw notFound();
  return row;
}

/**
 * Reads the session `uuid`, on `tx` when the caller holds one, resolving `undefined` when there is none.
 * Like `readSessionRow`, it neither locks nor discards.
 */
export async function findSessionRow(
  uuid: string,
  tx?: Transaction,
): Promise<SessionRow | undefined> {
  const builder = queryUntyped('UploadsSessions');
  return (await (isUndefined(tx) ? builder : builder.use(tx))
    .unscoped()
    .where({ UUID: uuid })
    .findFirst()) as SessionRow | undefined;
}

/**
 * Whether the session `row` can never go on: its `expiresAt` has passed, or a crash lost its handle.
 * A lost handle shows as a `null` `token` while `offset` is still below `size`.
 * The caller discards such a row and answers `sessionExpired`.
 */
export function sessionEnded(row: SessionRow): boolean {
  return row.expiresAt <= Date.now() || (isNull(row.token) && row.offset < row.size);
}

/**
 * The `404` for an ended session its caller may reach, whose message says it has expired.
 */
export function sessionExpired(): HTTPError {
  return notFound(translate('uploads.errors.sessionExpired'));
}

/**
 * The storage's part-wise writes, or the `501` every session answers on a storage without them.
 */
export function sessionParts(): StorageParts {
  const { parts } = useStorage();
  if (isUndefined(parts)) {
    const { storage } = useUploadsConfig();
    throw notImplemented(translate('uploads.errors.notResumable', { storage }));
  }
  return parts;
}

/**
 * Refuses a chunk of `length` bytes at `offset` with a `400` unless it fits the grid of `session`.
 * A chunk starts at a multiple of `chunkSize` below `size`.
 * It holds `chunkSize` bytes, or the rest of the file when fewer are left.
 */
export function assertOnGrid(session: UploadSession, offset: number, length: number): void {
  const { size, chunkSize } = session;
  const starts = isInteger(offset) && offset >= 0 && offset < size && offset % chunkSize === 0;
  if (!starts || length !== Math.min(chunkSize, size - offset)) throw badRequest();
}

/**
 * The `UploadSession` every session route answers for `row`, without what only the server reads.
 */
export function wireSession(row: SessionRow): UploadSession {
  return pick(row, WIRE_KEYS);
}

/**
 * Discards the session `row`: first the bytes it holds in storage, then the row.
 * An open session's parts are aborted; a storage without `parts` skips that.
 * The object at `sessionTemp` is then deleted: a sealed one, or on `fs` the partial write of a lost handle.
 * A completed session, `upload` set, loses only its row, and its file stays.
 * Its temp belongs to the journal then, as the `from` of the landing's `move` or `delete`.
 * Every storage call is idempotent and the row goes last, so a crash midway leaves the row to discard again.
 * A storage failure rejects and keeps the row.
 * It never takes the lock, since `withLock` is not reentrant.
 * A caller not yet inside `withSessionLock` takes it and re-reads the row before calling this.
 */
export async function discardSession(row: SessionRow): Promise<void> {
  if (isNull(row.upload)) {
    const storage = useStorage();
    const temp = sessionTemp(row.UUID);
    if (!isNull(row.token)) await storage.parts?.abort(temp, row.token);
    await storage.delete(temp);
  }
  await queryUntyped('UploadsSessions').unscoped().where({ UUID: row.UUID }).delete();
}

/**
 * Discards the session `row` as `discardSession` does, resolving whether the row is gone.
 * A failure, in storage or the database, is warned about instead of thrown.
 * The row then stays for the next sweep.
 * So a caller whose answer does not depend on the cleanup still gives that answer.
 * It never takes the lock either.
 */
export async function settleSession(row: SessionRow): Promise<boolean> {
  try {
    await discardSession(row);
    return true;
  } catch (error) {
    usePrinter().warn(`Upload session \`${row.UUID}\` not discarded: ${errorMessage(error)}`);
    return false;
  }
}

/**
 * Takes the lock of the session `uuid`, re-reads its row, and settles it, resolving whether the row is gone.
 * A row a rival already discarded counts as gone.
 * A session another call holds is left to it, resolving `false` at once, never waiting.
 */
export async function settleSessionUnderLock(uuid: string): Promise<boolean> {
  const settled = await withLock(
    sessionLockKey(uuid),
    async () => {
      const row = await findSessionRow(uuid);
      return isUndefined(row) || settleSession(row);
    },
    { wait: false },
  );
  return settled ?? false;
}

/**
 * Runs `fn` holding the cluster lock of the session `uuid`, and releases it once `fn` settles.
 * Every chunk write, seal, landing, abort, and sweep of one session runs under it.
 * That keeps the bytes a chunk stores and the bytes it hashes identical.
 * Take it only once a request body is in memory, so a slow client never holds it.
 * A holder that stops renewing it, frozen or crashed, is taken over, so a row advance is a compare-and-set.
 * Not reentrant: `fn` must never take it again for `uuid`, itself or through a helper that does.
 * State read before taking it may be stale, so `fn` re-reads the row first.
 *
 * @example
 * ```ts
 * await withSessionLock(uuid, async () => {
 *   await discardSession(await readSessionRow(uuid, { author }))
 * })
 * ```
 */
export function withSessionLock<T>(uuid: string, fn: () => Promise<T>): Promise<T> {
  return withLock(sessionLockKey(uuid), fn);
}

/**
 * The cluster-lock key of the session `uuid`.
 */
function sessionLockKey(uuid: string): string {
  return `uploads:session:${uuid}`;
}
