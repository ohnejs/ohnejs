import { badRequest, defineHandler, readJSONBody, setResponseStatus } from 'ohne';
import { requireCapability } from 'ohne/auth';
import { isString } from 'ohne/utils';

import type { UploadRecord } from '../../uploads/types.ts';

import { createFolder } from '../../uploads/create-folder.ts';

/**
 * `POST /uploads/folders`
 *
 * Creates a folder from `{ directory?, name }` and answers `201` with its record.
 * Needs `collection.Uploads.create`: no user `401`, no capability `403`.
 * A body without a `name` is a `400`; a name already taken a `422`.
 */
export default defineHandler(async (): Promise<UploadRecord> => {
  const user = await requireCapability('collection.Uploads.create');
  const body = await readJSONBody<{ directory?: unknown; name?: unknown } | null>();
  const name = body?.name;
  const directory = body?.directory ?? '';
  if (!isString(name) || !isString(directory)) throw badRequest();
  setResponseStatus(201);
  return createFolder({ directory, name, author: user.UUID });
});
