import { jsonDepthWithin, parseMediaType } from '../../utils/index.ts';
import { badRequest, unsupportedMediaType } from './http-error.ts';
import { readTextBody } from './read-text-body.ts';
import { translate } from './translate.ts';
import { useRequest } from './use-request.ts';

/**
 * Options for `readJSONBody`.
 */
export interface ReadJSONBodyOptions {
  /**
   * The deepest bracket nesting the JSON body may reach before it rejects `400`.
   * Scanned before `JSON.parse`, so a depth bomb is refused before it overflows the parser's stack.
   *
   * @default
   * 64
   */
  maxDepth?: number;
}

/**
 * Reads and parses a JSON request body.
 * Rejects with `415` unless the `Content-Type` is `application/json` or a `+json` suffix.
 * An empty, malformed, or too-nested body rejects with `400`.
 * Valid only within a request.
 *
 * The result is typed as `T` but unverified; validate it before you trust it.
 *
 * @example
 * ```ts
 * await readJSONBody<{ email: string }>() // -> { email: 'a@b.c' }
 * ```
 */
export async function readJSONBody<T = unknown>({
  maxDepth = 64,
}: ReadJSONBodyOptions = {}): Promise<T> {
  const { type } = parseMediaType(useRequest().headers.get('content-type') ?? '');
  if (type !== 'application/json' && !type.endsWith('+json')) throw unsupportedMediaType();

  const text = await readTextBody();
  if (text === '') throw badRequest(translate('api.body.empty'));
  if (!jsonDepthWithin(text, maxDepth)) throw badRequest(translate('api.body.tooNested'));

  try {
    return JSON.parse(text) as T;
  } catch {
    throw badRequest(translate('api.body.invalidJSON'));
  }
}
