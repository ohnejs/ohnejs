import type { RouteOptions } from 'ohnejs';

import { badRequest, readRawBody, useRequest } from 'ohnejs';
import {
  coerceToNumber,
  isArray,
  isInteger,
  isNull,
  isPositiveInteger,
  isRealNumber,
  isString,
  uniqueArray,
} from 'ohnejs/utils';

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
 * The options the chunk route of a resumable upload declares.
 * A body may be as large as `uploads.chunkSize`, so a longer `Content-Length` is a `413` before the handler.
 * The handler runs without a deadline, as the body is read inside it.
 */
export const CHUNK_ROUTE_OPTIONS: RouteOptions = {
  maxBodySize: useUploadsConfig().chunkSize,
  handlerTimeout: false,
};

/**
 * The options the completion and abort routes of a resumable upload declare.
 * Each waits out any request that holds the session, and a crashed one's lock, so it runs without a deadline.
 * A completion's landing and journal drain run without one too, as they do for a whole upload.
 */
export const SESSION_ROUTE_OPTIONS: RouteOptions = {
  handlerTimeout: false,
};

/**
 * The request's raw body stream and its declared length, when `Content-Length` carries one.
 * A request without a body is a `400`: no `Transfer-Encoding` and no `Content-Length` above zero.
 * The headers decide, since the adapter hands every `POST` a stream, empty or not.
 */
export function uploadBody(): { body: ReadableStream<Uint8Array>; size: number | undefined } {
  const request = useRequest();
  const declared = coerceToNumber(request.headers.get('content-length'));
  const sized = isRealNumber(declared) && declared > 0;
  const chunked = !isNull(request.headers.get('transfer-encoding'));
  if (isNull(request.body) || !(sized || chunked)) throw badRequest();
  return { body: request.body, size: sized ? declared : undefined };
}

/**
 * A chunk request's offset and declared length, and a reader for its bytes.
 * `Upload-Offset` must be an integer and `Content-Length` a positive one, or it is a `400`.
 * So a chunked transfer, or a request without either header, is a `400`.
 * Nothing is read until `read`, so a route can refuse the chunk before reading it.
 * `read` buffers the whole body, and a body of any other length than the declared one is a `400`.
 */
export function chunkBody(): { offset: number; size: number; read(): Promise<Uint8Array> } {
  const { headers } = useRequest();
  const offset = coerceToNumber(headers.get('upload-offset'));
  const size = coerceToNumber(headers.get('content-length'));
  const chunked = !isNull(headers.get('transfer-encoding'));
  if (chunked || !isInteger(offset) || !isPositiveInteger(size)) throw badRequest();
  return {
    offset,
    size,
    async read() {
      const bytes = await readRawBody();
      if (bytes?.byteLength !== size) throw badRequest();
      return bytes;
    },
  };
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
