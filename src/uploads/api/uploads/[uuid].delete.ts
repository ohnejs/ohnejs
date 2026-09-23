import { defineHandler } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';

import { assertUploadReach, uploadReach } from '../../uploads/_reader.ts';
import { deleteUpload } from '../../uploads/delete-upload.ts';

/**
 * `DELETE /uploads/[uuid]`
 *
 * Deletes a row and its object, a folder with its whole subtree, answering `204`.
 * Needs `collection.Uploads.delete` and the `Uploads` read guard: no user `401`, no capability `403`.
 * An unknown `UUID`, or one the read `access` scope hides, is a `404`.
 */
export default defineHandler(async ({ params }): Promise<null> => {
  await requireCapability('collection.Uploads.delete');
  await assertUploadReach(params.uuid, await uploadReach());
  await deleteUpload(params.uuid);
  return null;
});
