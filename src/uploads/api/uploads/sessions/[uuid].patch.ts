import { conflict, defineHandler } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';

import type { UploadSession } from '../../../uploads/types.ts';

import { CHUNK_ROUTE_OPTIONS, chunkBody } from '../../../uploads/_body.ts';
import { assertOnGrid } from '../../../uploads/_session.ts';
import { readUploadSession } from '../../../uploads/read-upload-session.ts';
import { writeUploadChunk } from '../../../uploads/write-upload-chunk.ts';

/**
 * `PATCH /uploads/sessions/[uuid]`
 *
 * Stores the raw request body as the session's chunk at the byte its `Upload-Offset` header names.
 * Answers the session advanced past that chunk.
 * The offset rides in a header, so every chunk of a session shares one URL and one cached CORS preflight.
 * Needs `collection.Uploads.create`: no user `401`, no capability `403`.
 * An unknown session, or another user's, is a `404`.
 * An expired one is discarded first, and its `404` says so.
 * A body without a positive integer `Content-Length`, such as a chunked one, is a `400`.
 * So is a missing `Upload-Offset`, or one off the session's grid: no multiple of `chunkSize` below `size`.
 * So is a length other than `chunkSize`, or the rest of the file for the last chunk.
 * A chunk at any other offset than the session's, or for a session past its last chunk, is a `409`.
 * Its `data` is the session, so a client resumes from that one answer.
 * Each of those answers comes before the body is read, so a client awaiting `100 Continue` never sends it.
 * A body past `uploads.chunkSize` is a `413`, and one of any other length than declared a `400`.
 * A first chunk that contradicts the type is a `422` at `name`, and the session is discarded.
 * A storage without part-wise writes is a `501`.
 */
export default defineHandler(async ({ params }): Promise<UploadSession> => {
  const { UUID: author } = await requireCapability('collection.Uploads.create');
  const { offset, size, read } = chunkBody();
  const session = await readUploadSession(params.uuid, { author });
  assertOnGrid(session, offset, size);
  if (offset !== session.offset) throw conflict(undefined, session);
  return writeUploadChunk(params.uuid, { offset, bytes: await read() }, { author });
}, CHUNK_ROUTE_OPTIONS);
