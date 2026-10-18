import { isString, isUndefined, parseMediaType } from '../../utils/index.ts';
import { badRequest, unsupportedMediaType } from './http-error.ts';
import { readRawBody } from './read-raw-body.ts';
import { translate } from './translate.ts';
import { useRequest } from './use-request.ts';

/**
 * Reads a form request body into `FormData`.
 * Accepts `multipart/form-data` and `application/x-www-form-urlencoded`.
 * Any other `Content-Type` rejects with `415`, a malformed body with `400`.
 * A U+0000 (NUL) in a field name, a text value, or a file name rejects with `400`; file content may hold one.
 * An absent body yields empty `FormData`.
 * Valid only within a request.
 *
 * File parts are buffered in memory, bounded by `api.maxBodySize`.
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

  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw badRequest(translate('api.body.invalidForm'));
  }
  for (const [name, value] of form) {
    if (name.includes('\0') || (isString(value) ? value : value.name).includes('\0'))
      throw badRequest(translate('api.body.containsNUL'));
  }
  return form;
}
