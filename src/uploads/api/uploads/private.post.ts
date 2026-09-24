import { badRequest, defineHandler, readJSONBody } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import { isBoolean, isPlainObject } from 'ohnejs/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { bulkUUIDs } from '../../uploads/_body.ts';
import { assertUploadsReach } from '../../uploads/_reach.ts';
import { uploadReach } from '../../uploads/_reader.ts';
import { setUploadsPrivate } from '../../uploads/set-uploads-private.ts';

/**
 * `POST /uploads/private`
 *
 * Locks or unlocks the rows `{ uuids, private }` names, all or none, and answers their records.
 * A folder takes everything inside it along, as `PATCH /uploads/[uuid]` does.
 * Needs `collection.Uploads.update` and the `Uploads` read guard: no user `401`, no capability `403`.
 * `uuids` must be a non-empty array of strings, at most `BULK_LIMIT` (`1000`), or the request is a `400`.
 * An unknown `UUID`, or one the read `access` scope hides, is a `404`, before any other `400`.
 * A `private` that is not a boolean is a `400`.
 * A row made public inside a private folder is a `422`, and nothing changes.
 * A write that would hide a row from the caller's read `access` scope is a `422`, and nothing changes.
 */
export default defineHandler(async (): Promise<UploadRecord[]> => {
  await requireCapability('collection.Uploads.update');
  const reach = await uploadReach();
  const body = await readJSONBody<unknown>();
  const input = isPlainObject(body) ? body : {};
  const uuids = bulkUUIDs(input);
  await assertUploadsReach(uuids, reach);
  if (!isBoolean(input.private)) throw badRequest();
  return setUploadsPrivate(uuids, input.private, { reach });
});
