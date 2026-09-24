import { defineHandler, readJSONBody } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import { isPlainObject } from 'ohnejs/utils';

import { bulkUUIDs } from '../../uploads/_body.ts';
import { uploadReach } from '../../uploads/_reader.ts';
import { deleteUploads } from '../../uploads/delete-uploads.ts';

/**
 * `POST /uploads/delete`
 *
 * Deletes the rows `{ uuids }` names and their objects, all or none, answering `204`.
 * A folder goes with its whole subtree; a row inside a named folder goes with it.
 * Needs `collection.Uploads.delete` and the `Uploads` read guard: no user `401`, no capability `403`.
 * `uuids` must be a non-empty array of strings, at most `BULK_LIMIT` (`1000`), or the request is a `400`.
 * An unknown `UUID`, or one the read `access` scope hides, is a `404`, and nothing is deleted.
 */
export default defineHandler(async (): Promise<null> => {
  await requireCapability('collection.Uploads.delete');
  const reach = await uploadReach();
  const body = await readJSONBody<unknown>();
  await deleteUploads(bulkUUIDs(isPlainObject(body) ? body : {}), { reach });
  return null;
});
