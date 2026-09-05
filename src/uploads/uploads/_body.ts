import type { RouteOptions } from 'ohne';

import { badRequest, useRequest } from 'ohne';
import { coerceToNumber, isNull, isRealNumber } from 'ohne/utils';

import { useUploadsConfig } from '../config.ts';

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
