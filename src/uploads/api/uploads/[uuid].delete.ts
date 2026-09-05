import { defineHandler } from 'ohne';
import { requireCapability } from 'ohne/auth';

import { deleteUpload } from '../../uploads/delete-upload.ts';

/**
 * `DELETE /uploads/[uuid]`
 *
 * Deletes a row and its object, a folder with its whole subtree, answering `204`.
 * Needs `collection.Uploads.delete`: no user `401`, no capability `403`.
 * An unknown `UUID` is a `404`.
 */
export default defineHandler(async ({ params }): Promise<null> => {
  await requireCapability('collection.Uploads.delete');
  await deleteUpload(params.uuid);
  return null;
});
