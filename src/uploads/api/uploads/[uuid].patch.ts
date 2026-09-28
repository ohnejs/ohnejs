import {
  badRequest,
  defineHandler,
  parseLocaleParam,
  queryMetadata,
  readJSONBody,
  useSearchParams,
} from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';
import { isBoolean, isNull, isNumber, isPlainObject, isString, isUndefined } from 'ohnejs/utils';

import type { MoveUploadTarget } from '../../uploads/move-upload.ts';
import type { UploadRecord } from '../../uploads/types.ts';
import type { UpdateUploadInput } from '../../uploads/update-upload.ts';

import { patchUpload } from '../../uploads/_patch.ts';
import { assertUploadReach, reachesAt } from '../../uploads/_reach.ts';
import { uploadReach } from '../../uploads/_reader.ts';

/**
 * `PATCH /uploads/[uuid]`
 *
 * Changes a row from `{ name?, directory?, description?, focalX?, focalY?, private? }` and answers the row.
 * `name` and `directory` move the row and its object; the rest change its metadata.
 * `private` locks or unlocks it, a folder with everything inside; a move into a private folder locks too.
 * `?locale=` writes `description` at that content locale, the default one without it.
 * Needs `collection.Uploads.update` and the `Uploads` read guard: no user `401`, no capability `403`.
 * An unknown locale is a `400`.
 * An unknown `UUID`, or one the read `access` scope hides, is a `404`, before any body `400`.
 * The scope judges the row at its own locale and at the written one, and hidden at either is that `404`.
 * A body naming nothing, or a value of the wrong JSON type, is a `400`.
 * A changed extension, a folder moved into itself, a taken target, or an out-of-range value is a `422`.
 * So is a path past 768 bytes, a folder's deepest row included.
 * So is a row made public inside a private folder, or moved into one with `private: false`.
 * A write that would hide a row from the caller's read `access` scope is a `422`, and nothing changes.
 */
export default defineHandler(async ({ params }): Promise<UploadRecord> => {
  await requireCapability('collection.Uploads.update');
  const reach = await uploadReach();
  const locale = parseLocaleParam(useSearchParams().locale, queryMetadata('Uploads')) ?? undefined;
  for (const each of reachesAt(reach, locale)) await assertUploadReach(params.uuid, each);
  const body = await readJSONBody<unknown>();
  const input = isPlainObject(body) ? body : {};
  const target = readTarget(input);
  const changes = readChanges(input);
  if (isUndefined(target) && isUndefined(changes)) throw badRequest();
  return patchUpload(params.uuid, { target, changes }, { locale, reach });
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
  const { description, focalX, focalY, private: locked } = input;
  if ([description, focalX, focalY, locked].every(isUndefined)) return undefined;
  const validDescription = isUndefined(description) || isNull(description) || isString(description);
  const validX = isUndefined(focalX) || isNull(focalX) || isNumber(focalX);
  const validY = isUndefined(focalY) || isNull(focalY) || isNumber(focalY);
  const validPrivate = isUndefined(locked) || isBoolean(locked);
  if (!validDescription || !validX || !validY || !validPrivate) throw badRequest();
  return { description, focalX, focalY, private: locked };
}
