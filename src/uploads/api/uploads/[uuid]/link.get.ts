import type { SearchParamValue } from 'ohnejs/utils';

import { badRequest, defineHandler, notFound, useSearchParams } from 'ohnejs';
import { queryScoped } from 'ohnejs/auth';
import { isNumber, isString, isUndefined, parseDuration } from 'ohnejs/utils';

import type { UploadRow } from '../../../uploads/_row.ts';

import { useUploadsConfig } from '../../../config.ts';
import { uploadsError } from '../../../uploads/_errors.ts';
import { temporaryUploadURL, uploadURL } from '../../../uploads/url.ts';

/**
 * `GET /uploads/[uuid]/link`
 *
 * Answers `{ url, expires }`: a link to a file's bytes, and when it stops working in epoch milliseconds.
 * A public file's is its plain `url`, with `expires: null`.
 * A private file's is signed to last `?maxAge=`, a `parseDuration` value.
 * Omitted, `maxAge` is `uploads.privateMaxAge`.
 * Guarded like the `Uploads` read: no user `401` and no capability `403`, unless that read is public.
 * A `maxAge` that does not parse is a `400`; a folder a `422`.
 * An unknown `UUID`, or one the read `access` scope hides, is a `404`.
 * Without `UPLOADS_SECRET` no link can be signed, so a private file fails the request.
 */
export default defineHandler(
  async ({ params }): Promise<{ url: string; expires: number | null }> => {
    const uploads = await queryScoped('Uploads', 'read');
    const maxAge = readMaxAge(useSearchParams().maxAge);
    const row = (await uploads.where({ UUID: params.uuid }).findFirst()) as UploadRow | undefined;
    if (isUndefined(row)) throw notFound();
    if (row.kind !== 'file') throw uploadsError('name', 'notAFile');
    if (!row.private) return { url: uploadURL(row), expires: null };
    return temporaryUploadURL(row, maxAge);
  },
);

/**
 * How long the link lasts, in milliseconds: `?maxAge=` parsed, or `uploads.privateMaxAge` when absent.
 * A value `parseDuration` rejects, or one of another shape, is a `400`.
 */
function readMaxAge(value: SearchParamValue | undefined): number {
  if (isUndefined(value)) return parseDuration(useUploadsConfig().privateMaxAge);
  if (!isNumber(value) && !isString(value)) throw badRequest();
  try {
    return parseDuration(value);
  } catch {
    throw badRequest();
  }
}
