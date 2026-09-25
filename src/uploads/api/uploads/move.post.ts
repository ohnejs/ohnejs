import { badRequest, defineHandler, readJSONBody } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import { isPlainObject, isString } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { bulkUUIDs } from '../../uploads/_body.ts';
import { assertUploadsReach } from '../../uploads/_reach.ts';
import { uploadReach } from '../../uploads/_reader.ts';
import { moveUploads } from '../../uploads/move-uploads.ts';

/**
 * `POST /uploads/move`
 *
 * Moves the rows `{ uuids, directory }` names into `directory`, all or none, and answers their records.
 * A row already in `directory` stays; one inside a named folder that moves goes along with it.
 * A move into a private folder locks, as `PATCH /uploads/[uuid]` does.
 * Needs `collection.Uploads.update` and the `Uploads` read guard: no user `401`, no capability `403`.
 * `uuids` must be a non-empty array of strings, at most `BULK_LIMIT` (`1000`), or the request is a `400`.
 * An unknown `UUID`, or one the read `access` scope hides, is a `404`, before any other `400`.
 * A `directory` that is not a string is a `400`.
 * A folder moved into itself, a target already taken, or a path past 768 bytes is a `422`, and nothing moves.
 * A write that would hide a row from the caller's read `access` scope is a `422`, and nothing changes.
 */
export default defineHandler(async (): Promise<UploadRecord[]> => {
  await requireCapability('collection.Uploads.update');
  const reach = await uploadReach();
  const body = await readJSONBody<unknown>();
  const input = isPlainObject(body) ? body : {};
  const uuids = bulkUUIDs(input);
  await assertUploadsReach(uuids, reach);
  if (!isString(input.directory)) throw badRequest();
  return moveUploads(uuids, input.directory, { reach });
});
