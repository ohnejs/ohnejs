import { badRequest, defineHandler, notFound, readJSONBody } from 'ohnejs';
import { isNumber, isPlainObject, isString, isUndefined, parseDuration } from 'ohnejs/utils';

import type { UploadRow } from '../../../uploads/_row.ts';

import { useUploadsConfig } from '../../../config.ts';
import { hasUploadSecret } from '../../../images/sign.ts';
import { uploadsError } from '../../../uploads/_errors.ts';
import { LINK_MAX_AGE } from '../../../uploads/_link-age.ts';
import { reached } from '../../../uploads/_reach.ts';
import { uploadReach } from '../../../uploads/_reader.ts';
import { temporaryUploadURL, uploadURL } from '../../../uploads/url.ts';

/**
 * `POST /uploads/[uuid]/link`
 *
 * Answers `{ url, expires }`: a link to a file's bytes, and when it stops working in epoch milliseconds.
 * A public file's is its plain `url`, with `expires: null`.
 * A private file's is signed to last the body's `maxAge`, in milliseconds or as a string like `'7d'`.
 * Omitted, `maxAge` is `uploads.privateMaxAge`.
 * Guarded like the `Uploads` read: no user `401` and no capability `403`, unless that read is public.
 * A `maxAge` that does not parse, is not above zero, or reaches past 30 days is a `400`; a folder a `422`.
 * An unknown `UUID`, or one the read `access` scope hides, is a `404`.
 * Without `UPLOADS_SECRET` nothing can sign a link, so the route itself answers `404`.
 * It is a `POST` so that a file named `link` inside a folder still serves through `GET /uploads/[...path]`.
 */
export default defineHandler(
  async ({ params }): Promise<{ url: string; expires: number | null }> => {
    if (!hasUploadSecret()) throw notFound();
    const reach = await uploadReach();
    const body = await readJSONBody<unknown>();
    const maxAge = readMaxAge(isPlainObject(body) ? body.maxAge : undefined);
    const row = (await reached(reach).where({ UUID: params.uuid }).findFirst()) as
      | UploadRow
      | undefined;
    if (isUndefined(row)) throw notFound();
    if (row.kind !== 'file') throw uploadsError('name', 'notAFile');
    if (!row.private) return { url: uploadURL(row), expires: null };
    return temporaryUploadURL(row, maxAge);
  },
);

/**
 * How long the link lasts, in milliseconds: the body's `maxAge`, or `uploads.privateMaxAge` when absent.
 * A value `parseDuration` rejects, one of another shape, or one outside `LINK_MAX_AGE` is a `400`.
 */
function readMaxAge(value: unknown): number {
  if (isUndefined(value)) return parseDuration(useUploadsConfig().privateMaxAge);
  if (!isString(value) && !isNumber(value)) throw badRequest();
  let ms: number;
  try {
    ms = parseDuration(value);
  } catch {
    throw badRequest();
  }
  if (!(ms > 0 && ms <= LINK_MAX_AGE)) throw badRequest();
  return ms;
}
