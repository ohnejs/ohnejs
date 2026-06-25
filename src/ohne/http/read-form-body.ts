import { isUndefined, parseMediaType } from '../../utils/index.ts';
import { badRequest, unsupportedMediaType } from './http-error.ts';
import { readRawBody } from './read-raw-body.ts';
import { useRequest } from './use-request.ts';

/**
 * Reads a form request body into `FormData`.
 * Accepts `multipart/form-data` and `application/x-www-form-urlencoded`.
 * Any other `Content-Type` rejects with `415`, a malformed body with `400`.
 * An absent body yields empty `FormData`.
 * Valid only within a request.
 *
 * File parts are buffered in memory, bounded by `server.maxBodySize`.
 *
 * @example
 * ```ts
 * const form = await readFormBody()
 * form.get('email')  // -> 'a@b.c'
 * form.get('avatar') // -> File
 * ```
 */
export async function readFormBody(): Promise<FormData> {
  const contentType = useRequest().headers.get('content-type') ?? '';
  const { type } = parseMediaType(contentType);
  if (type !== 'multipart/form-data' && type !== 'application/x-www-form-urlencoded') {
    throw unsupportedMediaType();
  }

  const bytes = await readRawBody();
  if (isUndefined(bytes)) return new FormData();

  try {
    return await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw badRequest('Request body is not valid form data');
  }
}
