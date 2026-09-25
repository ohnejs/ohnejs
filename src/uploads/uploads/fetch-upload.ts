import type { FetchPublicError } from 'ohnejs/utils/net';

import {
  extensionFor,
  extname,
  formatBytes,
  isUndefined,
  mediaTypeMatches,
  mimeTypeFor,
  parseBytes,
  parseContentDisposition,
  parseDuration,
  parseMediaType,
  urlFileName,
} from 'ohnejs/utils';
import { fetchPublic, isFetchPublicError } from 'ohnejs/utils/net';

import type { ValidationError } from '../../ohne/query/write/errors.ts';
import type { UploadReach } from './_reach.ts';
import type { UploadRecord } from './types.ts';

import { useUploadsConfig } from '../config.ts';
import { uploadsError } from './_errors.ts';
import { canonicalName } from './path.ts';
import { putUpload } from './put-upload.ts';

/**
 * What `fetchUpload` takes: the URL that holds the file and where the file goes.
 */
export interface FetchUploadInput {
  /**
   * The `http:` or `https:` URL to fetch the file from.
   * It is never stored, logged, or named in an error, since a presigned URL carries its token.
   */
  url: string;

  /**
   * The parent path, canonicalized before use; `''` is the root.
   *
   * @default
   * ''
   */
  directory?: string;

  /**
   * The file name, canonicalized before use.
   * Omitted or empty, the response names the file.
   */
  name?: string;

  /**
   * The `UUID` of the uploading user, `null` when there is none.
   */
  author?: string | null;

  /**
   * The read scope every row this write touches or creates must stay inside; omitted writes unscoped.
   */
  reach?: UploadReach;

  /**
   * Aborts the fetch, as when the client that asked for it goes away.
   */
  signal?: AbortSignal;
}

const USER_AGENT = 'ohne';

const SVG = 'image/svg+xml';

/**
 * Fetches the file at a URL and stores it as `putUpload` stores a body, resolving its record.
 *
 * The fetch goes through `fetchPublic`, which only reaches public addresses, plus `uploads.fetch.allow`.
 * Its body is capped at `uploads.maxFileSize`, and the whole fetch at `uploads.fetch.timeout`.
 * A `name` ending in `.svg` caps the body at `uploads.maxSVGSize` when that is smaller.
 * A `name` whose type `uploads.types` refuses fails before any request.
 *
 * Without a `name`, the response names the file: its `Content-Disposition`, else the final URL, else `file`.
 * A name without a known extension gains the one the response's `Content-Type` stands for.
 * The type still comes from the extension and is checked against the bytes, so a lying header widens nothing.
 *
 * A failed fetch is a `422` at `url`: `urlInvalid`, `urlStatus`, `fileTooLarge`, or else `urlUnreachable`.
 * One bucket for the rest keeps an editor from mapping internal names and ports.
 * No error names the URL, and every other failure is `putUpload`'s own, such as a path past 768 bytes.
 *
 * @example
 * ```ts
 * const upload = await fetchUpload({ url: 'https://example.com/Thrall.JPG', directory: 'heroes' })
 * upload.path // -> 'heroes/thrall.jpg'
 * ```
 */
export async function fetchUpload(input: FetchUploadInput): Promise<UploadRecord> {
  const config = useUploadsConfig();
  const type = knownType(input.name ?? '');
  if (!isUndefined(type) && !mediaTypeMatches(type, config.types)) {
    throw uploadsError('name', 'typeNotAllowed', { type });
  }

  const maxFileSize = parseBytes(config.maxFileSize);
  const maxBytes =
    type === SVG ? Math.min(maxFileSize, parseBytes(config.maxSVGSize)) : maxFileSize;
  const controller = new AbortController();
  const signal = isUndefined(input.signal)
    ? controller.signal
    : AbortSignal.any([controller.signal, input.signal]);
  try {
    const response = await fetchPublic(input.url, {
      allow: config.fetch.allow,
      maxBytes,
      timeout: parseDuration(config.fetch.timeout),
      signal,
      userAgent: USER_AGENT,
    });
    return await putUpload({
      directory: input.directory ?? '',
      name: fileName(input.name, response.url, response.headers),
      body: response.body,
      size: response.size,
      author: input.author,
      reach: input.reach,
    });
  } catch (error) {
    throw isFetchPublicError(error) ? fetchFailure(error, maxBytes) : error;
  } finally {
    // A body `putUpload` refused unread would otherwise hold its socket until a deadline.
    controller.abort();
  }
}

/**
 * The name a fetched file is stored under, gaining the `Content-Type`'s extension when it has no known one.
 * Empty names fall through: the caller's, the `Content-Disposition`'s, the final URL's, then `file`.
 */
function fileName(name: string | undefined, url: URL, headers: Headers): string {
  const disposition = parseContentDisposition(headers.get('content-disposition') ?? '');
  const chosen = name || disposition.filename || urlFileName(url) || 'file';
  if (!isUndefined(knownType(chosen))) return chosen;
  return chosen + (extensionFor(headers.get('content-type') ?? '') ?? '');
}

/**
 * The media type the extension of `name` stands for once canonical, as `putUpload` derives it.
 * `undefined` when the extension is unknown or absent.
 */
function knownType(name: string): string | undefined {
  const type = mimeTypeFor(extname(canonicalName(name)));
  return isUndefined(type) ? undefined : parseMediaType(type).type;
}

/**
 * The `422` at `url` a failed fetch answers with.
 */
function fetchFailure(error: FetchPublicError, maxBytes: number): ValidationError {
  switch (error.code) {
    case 'invalid':
      return uploadsError('url', 'urlInvalid');
    case 'status':
      return uploadsError('url', 'urlStatus', { status: error.status });
    case 'tooLarge':
      return uploadsError('url', 'fileTooLarge', { max: formatBytes(maxBytes) });
    default:
      return uploadsError('url', 'urlUnreachable');
  }
}
