import { defineHandler } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';

import type { UploadRecord } from '../../../uploads/types.ts';

import { UPLOAD_ROUTE_OPTIONS, uploadBody } from '../../../uploads/_body.ts';
import { replaceUpload } from '../../../uploads/replace-upload.ts';

/**
 * `POST /uploads/[uuid]/replace`
 *
 * Replaces a file's bytes with the raw request body and answers its record.
 * Needs `collection.Uploads.update`: no user `401`, no capability `403`.
 * A missing body is a `400`; a folder or mismatching content a `422`; an unknown `UUID` a `404`.
 */
export default defineHandler(async ({ params }): Promise<UploadRecord> => {
  await requireCapability('collection.Uploads.update');
  const { body, size } = uploadBody();
  return replaceUpload(params.uuid, body, { size });
}, UPLOAD_ROUTE_OPTIONS);
