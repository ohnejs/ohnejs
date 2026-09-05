import {
  defineHandler,
  isFresh,
  queryUntyped,
  sendNotModified,
  setResponseStatus,
  useRequest,
  useResponse,
} from 'ohne';
import { cacheControl, contentDisposition, isNull, isUndefined, parseRange } from 'ohne/utils';

import { notFound } from '../../../ohne/http/http-error.ts';
import { useUploadsConfig } from '../../config.ts';
import { useStorage } from '../../storage/use-storages.ts';
import { splitUploadPath, uploadPath } from '../../uploads/path.ts';

const SVG = 'image/svg+xml';

const SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * Types a browser would run as a document; served as attachments so they never execute on this origin.
 */
const ATTACHMENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
  'application/xslt+xml',
  'application/mathml+xml',
  'application/rss+xml',
  'application/atom+xml',
]);

/**
 * `GET /uploads/[...path]`
 *
 * Serves a file's bytes by its path; public.
 * The row's `hash` is the `ETag`, so a fresh `If-None-Match` answers `304`.
 * `Cache-Control` comes from `uploads.cache`; `Range` answers `206`, or `416` past the end.
 * Every type is `nosniff`, a script-capable one downloads as an attachment, and an SVG carries a sandbox CSP.
 * A folder or an unknown path is a `404`; `HEAD` comes from the router.
 */
export default defineHandler(async ({ params }) => {
  const location = splitUploadPath(params.path);
  const row = await queryUntyped('Uploads')
    .where({ ...location, kind: 'file' })
    .findFirst();
  if (isUndefined(row)) throw notFound();
  const { type, size, hash } = row as { type: string; size: number; hash: string };

  const { headers } = useResponse();
  headers.set('accept-ranges', 'bytes');
  headers.set('content-type', type);
  headers.set('etag', `"${hash}"`);
  headers.set('cache-control', cacheControl(useUploadsConfig().cache));
  headers.set('x-content-type-options', 'nosniff');
  headers.set(
    'content-disposition',
    contentDisposition(location.name, { inline: !ATTACHMENT_TYPES.has(type) }),
  );
  if (type === SVG) headers.set('content-security-policy', SVG_POLICY);
  if (isFresh()) return sendNotModified();

  const header = useRequest().headers.get('range');
  const requested = isNull(header) ? undefined : parseRange(header, size);
  if (requested?.type === 'unsatisfiable') {
    setResponseStatus(416);
    headers.set('content-range', `bytes */${size}`);
    return null;
  }
  const range = requested?.type === 'satisfiable' ? requested.ranges[0] : undefined;
  if (!isUndefined(range)) {
    setResponseStatus(206);
    headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
  }

  const object = await useStorage().read(uploadPath(location), range);
  if (isNull(object)) throw notFound();
  headers.set(
    'content-length',
    String(isUndefined(range) ? object.size : range.end - range.start + 1),
  );
  return object.body;
});
