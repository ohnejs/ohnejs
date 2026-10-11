import { isPlainObject } from '../../utils/is/is-plain-object.ts';
import { isString } from '../../utils/is/is-string.ts';
import { defaultText } from './text.ts';

/**
 * A failed API call.
 */
export interface APIError {
  /**
   * The HTTP status; `0` means no answer arrived, from a network failure or a timeout.
   */
  status: number;

  /**
   * The server's `message`, or a translated fallback.
   */
  message: string;

  /**
   * The error body's `data`, like `{ errors }` on a `422`.
   */
  data?: unknown;
}

/**
 * Reads an error answer's `{ statusCode, message, data }` body into an `APIError`.
 * A body without a `message`, or one that is not JSON, reads `fallback` as its message.
 */
export async function readAPIError(response: Response, fallback: string): Promise<APIError> {
  const body: unknown = await response.json().catch(() => undefined);
  const answer = isPlainObject(body) ? body : {};
  const message = isString(answer.message) && answer.message !== '' ? answer.message : fallback;
  return 'data' in answer
    ? { status: response.status, message, data: answer.data }
    : { status: response.status, message };
}

/**
 * The `APIError` of a request that got no answer: a network failure or a timeout.
 */
export function unreachableError(): APIError {
  return {
    status: 0,
    message: defaultText('dashboard.unreachable', 'The server cannot be reached'),
  };
}
