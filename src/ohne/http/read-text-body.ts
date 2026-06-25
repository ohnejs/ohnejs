import { decodeText, isUndefined } from '../../utils/index.ts';
import { badRequest } from './http-error.ts';
import { readRawBody } from './read-raw-body.ts';

/**
 * Reads the request body as a UTF-8 string, or `''` when there is none.
 * Invalid UTF-8 rejects with `400`.
 * Valid only within a request.
 *
 * @example
 * ```ts
 * await readTextBody() // -> 'hello'
 * ```
 */
export async function readTextBody(): Promise<string> {
  const bytes = await readRawBody();
  if (isUndefined(bytes)) return '';

  try {
    return decodeText(bytes);
  } catch {
    throw badRequest('Request body is not valid UTF-8');
  }
}
