import { setImmediate } from 'node:timers/promises';
import { conflict, queryUntyped } from 'ohnejs';
import { isNull, isUndefined } from 'ohnejs/utils';
import { createSHA256 } from 'ohnejs/utils/crypto';

import type { SessionRow } from './_session.ts';
import type { UploadSession } from './types.ts';

import { PEEK_SIZE } from './_peek.ts';
import {
  assertOnGrid,
  readSessionRow,
  sessionEnded,
  sessionExpired,
  sessionParts,
  sessionTemp,
  settleSession,
  wireSession,
  withSessionLock,
} from './_session.ts';
import { checkHead } from './_stage.ts';

const HASH_SLICE = 256 * 1024;

/**
 * Stores one chunk of the resumable upload session `uuid` and resolves the session advanced past it.
 *
 * The chunk must start at the session's `offset`, and it goes to storage as one part of the file.
 * The whole-file SHA-256 carries on over it, so completion never reads the file back.
 * An unknown session is a `404`, and so is one `author` did not create.
 * An omitted `author` skips that check, for server code.
 * An expired session, or one whose storage handle a crash lost, is discarded and answers an expired `404`.
 * A chunk off the session's grid is a `400`: an `offset` that is no multiple of `chunkSize` below `size`.
 * So is a length other than `chunkSize`, or the rest of the file for the last chunk.
 * A chunk at any other offset, or for a session past its last chunk, is a `409` with the session as `data`.
 * The first chunk's bytes must match the session's type, or the session is discarded with a `422`.
 * An image's dimensions are read from that chunk.
 * A failed part write leaves the session as it was, so the same chunk can be sent again.
 *
 * @example
 * ```ts
 * const session = await writeUploadChunk(uuid, { offset: 0, bytes: first }, { author: user.UUID })
 * session.offset // -> 8388608
 * ```
 */
export function writeUploadChunk(
  uuid: string,
  chunk: { offset: number; bytes: Uint8Array },
  options: { author?: string } = {},
): Promise<UploadSession> {
  const { offset, bytes } = chunk;
  return withSessionLock(uuid, async () => {
    const row = await readSessionRow(uuid, options);
    if (sessionEnded(row)) {
      await settleSession(row);
      throw sessionExpired();
    }
    assertOnGrid(row, offset, bytes.byteLength);
    if (isNull(row.token) || offset !== row.offset) throw conflict(undefined, wireSession(row));
    const measured = offset === 0 ? await checkFirstChunk(row, bytes) : {};
    const number = offset / row.chunkSize + 1;
    const [receipt, hashState] = await Promise.all([
      sessionParts().write(sessionTemp(uuid), row.token, { number, offset, bytes }),
      advanceHash(row.hashState, bytes),
    ]);
    const receipts = JSON.parse(row.receipts) as string[];
    receipts[number - 1] = receipt;
    const [advanced] = await queryUntyped('UploadsSessions')
      .unscoped()
      .where({ UUID: uuid, offset })
      .updateOrThrow({
        offset: offset + bytes.byteLength,
        hashState,
        receipts: JSON.stringify(receipts),
        ...measured,
      });
    if (isUndefined(advanced)) {
      throw conflict(undefined, wireSession(await readSessionRow(uuid, options)));
    }
    return wireSession(advanced as unknown as SessionRow);
  });
}

/**
 * The SHA-256 midstate `state` carried on over `bytes`, yielding to the event loop between slices.
 * A `null` `state` starts a fresh hash.
 */
async function advanceHash(state: string | null, bytes: Uint8Array): Promise<string> {
  const sha = createSHA256(state ?? undefined);
  for (let start = 0; start < bytes.byteLength; start += HASH_SLICE) {
    if (start > 0) await setImmediate();
    sha.update(bytes.subarray(start, start + HASH_SLICE));
  }
  return sha.state();
}

/**
 * Checks the first chunk of `row` against its type, and measures a raster image by it.
 * The chunk holds the whole `PEEK_SIZE` head, since `uploads.chunkSize` never goes below it.
 * Only that head is read, so the verdict and the size match what `putUpload` finds for the same bytes.
 * Bytes that contradict the type settle the session before the `422` is thrown.
 */
async function checkFirstChunk(
  row: SessionRow,
  bytes: Uint8Array,
): Promise<Pick<SessionRow, 'width' | 'height'>> {
  try {
    return checkHead(bytes.subarray(0, PEEK_SIZE), row.type);
  } catch (error) {
    await settleSession(row);
    throw error;
  }
}
