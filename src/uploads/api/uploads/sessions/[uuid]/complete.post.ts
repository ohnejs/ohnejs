import { defineHandler, setResponseStatus } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';

import type { UploadRecord } from '../../../../uploads/types.ts';

import { SESSION_ROUTE_OPTIONS } from '../../../../uploads/_body.ts';
import { readerReach } from '../../../../uploads/_reader.ts';
import { completeUploadSession } from '../../../../uploads/complete-upload-session.ts';

/**
 * `POST /uploads/sessions/[uuid]/complete`
 *
 * Lands the file of a session whose every chunk arrived and answers `201` with its record.
 * A repeat answers `200` with the same record, so a retry after a lost answer is harmless.
 * A repeat whose file the caller's read `access` scope no longer admits is a `404`.
 * Needs `collection.Uploads.create`: no user `401`, no capability `403`.
 * An unknown session, or another user's, is a `404`.
 * An expired one is discarded first, and its `404` says so.
 * A session still missing bytes is a `409` with the session as `data`, so this is the offset probe too.
 * A type `uploads.types` no longer allows, or a file in the way of a folder, is a `422`.
 * So is a write that would hide the row from the caller's read `access` scope.
 * So is an SVG whose markup holds no `<svg>` root.
 * Each of those keeps the session, to complete again once the cause is fixed, or to abort.
 * A storage without part-wise writes is a `501`.
 */
export default defineHandler(async ({ params }): Promise<UploadRecord> => {
  const { UUID: author } = await requireCapability('collection.Uploads.create');
  const reach = await readerReach();
  const { record, created } = await completeUploadSession(params.uuid, { author, reach });
  if (created) setResponseStatus(201);
  return record;
}, SESSION_ROUTE_OPTIONS);
