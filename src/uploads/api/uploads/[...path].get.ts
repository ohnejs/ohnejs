import {
  defineHandler,
  isFresh,
  notFound,
  queryUntyped,
  sendNotModified,
  setResponseStatus,
  useRequest,
  useResponse,
  useSearchParams,
} from 'ohnejs';
import {
  cacheControl,
  contentDisposition,
  isBoolean,
  isNull,
  isNumber,
  isString,
  isUndefined,
  parseRange,
} from 'ohnejs/utils';

import { useUploadsConfig } from '../../config.ts';
import { useStorage } from '../../storage/use-storages.ts';
import { privateUploads } from '../../uploads/_private.ts';
import { readerReaches } from '../../uploads/_reader.ts';
import { splitUploadPath, uploadPath } from '../../uploads/path.ts';
import { uploadSecrets, verifyUploadLink } from '../../uploads/sign.ts';

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
 * Serves a file's bytes by its path.
 * A public file opens for anyone, as does every file while no `UPLOADS_SECRET` is set.
 * A private one opens through an unexpired link signed under `UPLOADS_SECRET`, or for a signed-in reader.
 * The link carries `?e=&s=`, and any other query is ignored.
 * The reader holds `collection.Uploads.read`, and the collection's read `access` scope admits the row.
 * Anything else is the `404` an unknown path answers, decided before any header tells the file apart.
 * The row's `hash` is the `ETag`, so a fresh `If-None-Match` answers `304`.
 * `Cache-Control` comes from `uploads.cache`; a private file's is marked `private` and never `public`.
 * `Range` answers `206`, or `416` past the end.
 * Every type is `nosniff`, a script-capable one downloads as an attachment, and an SVG carries a sandbox CSP.
 * A folder or an unknown path is a `404`; `HEAD` comes from the router.
 */
export default defineHandler(async ({ params }) => {
  const location = splitUploadPath(params.path);
  const path = uploadPath(location);
  const row = await queryUntyped('Uploads')
    .where({ ...location, kind: 'file' })
    .findFirst();
  if (isUndefined(row)) throw notFound();
  const { UUID, type, size, hash } = row as {
    UUID: string;
    type: string;
    size: number;
    hash: string;
  };
  const locked = privateUploads() && isBoolean(row.private) && row.private;
  if (locked && !linkVerifies(path) && !(await readerReaches(UUID))) throw notFound();

  const { cache } = useUploadsConfig();
  const { headers } = useResponse();
  headers.set('accept-ranges', 'bytes');
  headers.set('content-type', type);
  headers.set('etag', `"${hash}"`);
  headers.set(
    'cache-control',
    cacheControl(locked ? { ...cache, public: false, private: true } : cache),
  );
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

  const object = await useStorage().read(path, range);
  if (isNull(object)) throw notFound();
  headers.set(
    'content-length',
    String(isUndefined(range) ? object.size : range.end - range.start + 1),
  );
  return object.body;
});

/**
 * Whether the request's `?e=&s=` signs `path` under a listed secret, with `e` still ahead of now.
 * Either value missing, or of another shape, is no link at all.
 */
function linkVerifies(path: string): boolean {
  const { e, s } = useSearchParams();
  if (!isNumber(e) || !isString(s)) return false;
  return e > Date.now() && verifyUploadLink(s, path, e, uploadSecrets());
}
