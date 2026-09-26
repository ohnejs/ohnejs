import { badRequest, queryUntyped } from 'ohnejs';
import { formatBytes, isPositiveInteger, parseBytes, parseDuration } from 'ohnejs/utils';

import type { SessionRow } from './_session.ts';
import type { CreateUploadSessionInput, UploadSession } from './types.ts';

import { useUploadsConfig } from '../config.ts';
import { dispositionFor } from './_disposition.ts';
import { uploadsError } from './_errors.ts';
import { assertPathFits } from './_path-limit.ts';
import { sessionParts, sessionTemp, wireSession } from './_session.ts';
import { assertTypeAllowed, uploadType } from './_type.ts';
import { canonicalDirectory, canonicalName, uploadPath } from './path.ts';
import { sweepUploadSessions } from './sweep-upload-sessions.ts';

const SVG = 'image/svg+xml';

const OCTET_STREAM = 'application/octet-stream';

const SWEEP_LIMIT = 10;

/**
 * Opens a resumable upload of `size` bytes and resolves its session, which every later call names.
 *
 * `directory` and `name` are canonicalized, and the type derived from the extension, as `putUpload` does.
 * The chunk size is `uploads.chunkSize` at create, fixed for the session's life.
 * The session expires `uploads.sessionMaxAge` after create, and nothing extends it.
 * A `size` that is not a positive integer is a `400`, and a storage without `parts` a `501`.
 * A type outside `uploads.types` is a `422` at `name`, and a path past 768 bytes a `422` at `directory`.
 * A `size` past `uploads.maxFileSize` is a `422` `fileTooLarge` at `size`.
 * So is one that needs more parts than the storage holds, or an SVG past `uploads.maxSVGSize`.
 * An SVG's parts are written as an `application/octet-stream` attachment, so its raw markup never renders.
 * Completion reads that object back and stages it sanitized, never landing it as is.
 * A storage that cannot begin the write leaves no session behind.
 * The oldest expired sessions are swept first, a few per call, skipping any a request holds.
 * So a create never waits on another session.
 *
 * @example
 * ```ts
 * const session = await createUploadSession({ directory: 'films', name: 'Arthas.MP4', size: 90_000_000 })
 * session.name   // -> 'arthas.mp4'
 * session.offset // -> 0
 * ```
 */
export async function createUploadSession(input: CreateUploadSessionInput): Promise<UploadSession> {
  const { size } = input;
  if (!isPositiveInteger(size)) throw badRequest();
  const parts = sessionParts();
  const config = useUploadsConfig();
  const directory = canonicalDirectory(input.directory ?? '');
  const name = canonicalName(input.name);
  const type = uploadType(name);
  assertTypeAllowed(type);
  assertPathFits(uploadPath({ directory, name }));
  const chunkSize = parseBytes(config.chunkSize);
  const max = Math.min(
    parseBytes(config.maxFileSize),
    chunkSize * parts.maxCount,
    type === SVG ? parseBytes(config.maxSVGSize) : Infinity,
  );
  if (size > max) throw uploadsError('size', 'fileTooLarge', { max: formatBytes(max) });

  await sweepUploadSessions(Date.now(), SWEEP_LIMIT);
  const row = await queryUntyped('UploadsSessions')
    .unscoped()
    .createOrThrow({
      author: input.author ?? null,
      directory,
      name,
      type,
      size,
      chunkSize,
      expiresAt: Date.now() + Math.round(parseDuration(config.sessionMaxAge)),
    });
  const uuid = row.UUID as string;
  const raw = type === SVG;
  let token: string;
  try {
    token = await parts.begin(sessionTemp(uuid), {
      type: raw ? OCTET_STREAM : type,
      size,
      disposition: raw ? 'attachment' : dispositionFor(type),
    });
  } catch (error) {
    await queryUntyped('UploadsSessions').unscoped().where({ UUID: uuid }).delete();
    throw error;
  }
  const [opened] = await queryUntyped('UploadsSessions')
    .unscoped()
    .where({ UUID: uuid })
    .updateOrThrow({ token });
  return wireSession(opened as unknown as SessionRow);
}
