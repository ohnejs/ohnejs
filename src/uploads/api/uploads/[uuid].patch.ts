import {
  badRequest,
  defineHandler,
  parseLocaleParam,
  queryMetadata,
  readJSONBody,
  useSearchParams,
} from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import { isNull, isNumber, isPlainObject, isString, isUndefined } from 'ohnejs/utils';

import type { MoveUploadTarget } from '../../uploads/move-upload.ts';
import type { UploadRecord } from '../../uploads/types.ts';
import type { UpdateUploadInput } from '../../uploads/update-upload.ts';

import { moveUpload } from '../../uploads/move-upload.ts';
import { updateUpload } from '../../uploads/update-upload.ts';

/**
 * `PATCH /uploads/[uuid]`
 *
 * Changes a row from `{ name?, directory?, description?, focalX?, focalY? }` and answers its final record.
 * `name` and `directory` move the row and its object; the other three change its metadata.
 * `?locale=` writes `description` at that content locale.
 * Needs `collection.Uploads.update`: no user `401`, no capability `403`.
 * A body naming nothing, or a value of the wrong JSON type, is a `400`; an unknown `UUID` a `404`.
 */
export default defineHandler(async ({ params }): Promise<UploadRecord> => {
  await requireCapability('collection.Uploads.update');
  const body = await readJSONBody<unknown>();
  const input = isPlainObject(body) ? body : {};
  const locale = parseLocaleParam(useSearchParams().locale, queryMetadata('Uploads')) ?? undefined;
  const target = readTarget(input);
  const changes = readChanges(input);
  if (!isUndefined(changes)) {
    if (!isUndefined(target)) await moveUpload(params.uuid, target);
    return updateUpload(params.uuid, changes, { locale });
  }
  if (isUndefined(target)) throw badRequest();
  return moveUpload(params.uuid, target);
});

/**
 * The move a body asks for, or `undefined` when it names neither `name` nor `directory`.
 */
function readTarget(input: Record<string, unknown>): MoveUploadTarget | undefined {
  const { directory, name } = input;
  if (isUndefined(directory) && isUndefined(name)) return undefined;
  const validDirectory = isUndefined(directory) || isString(directory);
  const validName = isUndefined(name) || isString(name);
  if (!validDirectory || !validName) throw badRequest();
  return { directory, name };
}

/**
 * The metadata changes a body asks for, or `undefined` when it names none.
 */
function readChanges(input: Record<string, unknown>): UpdateUploadInput | undefined {
  const { description, focalX, focalY } = input;
  if (isUndefined(description) && isUndefined(focalX) && isUndefined(focalY)) return undefined;
  const validDescription = isUndefined(description) || isNull(description) || isString(description);
  const validX = isUndefined(focalX) || isNull(focalX) || isNumber(focalX);
  const validY = isUndefined(focalY) || isNull(focalY) || isNumber(focalY);
  if (!validDescription || !validX || !validY) throw badRequest();
  return { description, focalX, focalY };
}
