import { defineHandler } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';

import type { UploadRecord } from '../../../uploads/types.ts';

import { UPLOAD_ROUTE_OPTIONS, uploadBody } from '../../../uploads/_body.ts';
import { assertUploadReach } from '../../../uploads/_reader.ts';
import { replaceUpload } from '../../../uploads/replace-upload.ts';

/**
 * `POST /uploads/[uuid]/replace`
 *
 * Replaces a file's bytes with the raw request body and answers its record.
 * Needs `collection.Uploads.update` and the `Uploads` read guard: no user `401`, no capability `403`.
 * An unknown `UUID`, or one the read `access` scope hides, is a `404`, before any `400`.
 * The scope is checked again once the bytes are staged, so a row it hides by then is the same `404`.
 * A missing body is a `400`; a folder or mismatching content a `422`.
 */
export default defineHandler(async ({ params }): Promise<UploadRecord> => {
  await requireCapability('collection.Uploads.update');
  await assertUploadReach(params.uuid);
  const { body, size } = uploadBody();
  return replaceUpload(params.uuid, body, {
    size,
    admit: (tx) => assertUploadReach(params.uuid, tx),
  });
}, UPLOAD_ROUTE_OPTIONS);
