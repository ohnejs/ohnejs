import type { RouteOptions } from 'ohnejs';

import { badRequest, useRequest } from 'ohnejs';
import { coerceToNumber, isArray, isNull, isRealNumber, isString, uniqueArray } from 'ohnejs/utils';

import { useUploadsConfig } from '../config.ts';

/**
 * The most `UUID`s one bulk request may name.
 */
export const BULK_LIMIT = 1000;

/**
 * The options every route that streams a file body declares.
 * The body may be as large as `uploads.maxFileSize`, and the handler runs without a deadline.
 * Config is resolved before routes load, so reading it at module scope is sound.
 */
export const UPLOAD_ROUTE_OPTIONS: RouteOptions = {
  maxBodySize: useUploadsConfig().maxFileSize,
  handlerTimeout: false,
};

/**
 * The request's raw body stream and its declared length, when `Content-Length` carries a finite one.
 * A request without a body is a `400`.
 */
export function uploadBody(): { body: ReadableStream<Uint8Array>; size: number | undefined } {
  const request = useRequest();
  if (isNull(request.body)) throw badRequest();
  const header = request.headers.get('content-length');
  const declared = coerceToNumber(header);
  return { body: request.body, size: isRealNumber(declared) ? declared : undefined };
}

/**
 * The `uuids` a bulk request body names, duplicates dropped.
 * Anything but a non-empty array of strings, or more than `BULK_LIMIT` of them, is a `400`.
 */
export function bulkUUIDs(body: Record<string, unknown>): string[] {
  const { uuids } = body;
  const valid = isArray(uuids) && uuids.length > 0 && uuids.length <= BULK_LIMIT;
  if (!valid || !uuids.every(isString)) throw badRequest();
  return uniqueArray(uuids);
}
