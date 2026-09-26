import { badRequest, defineHandler, readJSONBody, setResponseStatus } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import { isNumber, isPlainObject, isString } from 'ohnejs/utils';

import type { UploadSession } from '../../../uploads/types.ts';

import { createUploadSession } from '../../../uploads/create-upload-session.ts';

/**
 * `POST /uploads/sessions`
 *
 * Opens a resumable upload from `{ directory?, name, size }` and answers `201` with its session.
 * Every later request names the session by its `UUID`.
 * `directory` defaults to the root; it and `name` are canonicalized as `POST /uploads` does.
 * Needs `collection.Uploads.create`: no user `401`, no capability `403`.
 * A missing or non-string `name`, or a non-string `directory`, is a `400`.
 * So is a `size` that is not a positive integer.
 * A refused type is a `422` at `name`, and a path past 768 bytes a `422` at `directory`.
 * A `size` past `uploads.maxFileSize` is a `422` at `size`.
 * So is one that needs more parts than the storage holds, or an SVG's past `uploads.maxSVGSize`.
 * A storage without part-wise writes is a `501`.
 */
export default defineHandler(async (): Promise<UploadSession> => {
  const { UUID: author } = await requireCapability('collection.Uploads.create');
  const body = await readJSONBody<unknown>();
  const { directory = '', name, size } = isPlainObject(body) ? body : {};
  if (!isString(directory) || !isString(name) || !isNumber(size)) throw badRequest();
  setResponseStatus(201);
  return createUploadSession({ directory, name, size, author });
});
