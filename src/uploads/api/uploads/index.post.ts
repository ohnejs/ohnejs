import { badRequest, defineHandler, setResponseStatus, useEvent } from 'ohne';
import { requireCapability } from 'ohne/auth';
import { isNull } from 'ohne/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { UPLOAD_ROUTE_OPTIONS, uploadBody } from '../../uploads/_body.ts';
import { putUpload } from '../../uploads/put-upload.ts';

/**
 * `POST /uploads?directory=&name=`
 *
 * Stores the raw request body as a new file and answers `201` with its record.
 * `name` is required and `directory` defaults to the root; both are raw search params, read as text.
 * Needs `collection.Uploads.create`: no user `401`, no capability `403`.
 * A missing `name` or body is a `400`; a refused type or mismatching content a `422`.
 */
export default defineHandler(async (): Promise<UploadRecord> => {
  const user = await requireCapability('collection.Uploads.create');
  const { searchParams } = useEvent().url;
  const name = searchParams.get('name');
  if (isNull(name)) throw badRequest();
  const { body, size } = uploadBody();
  setResponseStatus(201);
  return putUpload({
    directory: searchParams.get('directory') ?? '',
    name,
    body,
    size,
    author: user.UUID,
  });
}, UPLOAD_ROUTE_OPTIONS);
