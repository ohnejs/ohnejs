import type { SearchParamValue } from '../../../utils/index.ts';

import { isPlainObject, jsonDepthWithin, parseMediaType } from '../../../utils/index.ts';
import { badRequest, unsupportedMediaType } from '../../http/http-error.ts';
import { readTextBody } from '../../http/read-text-body.ts';
import { translate } from '../../http/translate.ts';
import { useRequest } from '../../http/use-request.ts';

/**
 * Options for `readQueryBody`.
 */
export interface ReadQueryBodyOptions {
  /**
   * The deepest bracket nesting the JSON body may reach before it rejects `400`.
   * Scanned before `JSON.parse`, so a depth bomb is refused before it overflows the parser's stack.
   *
   * @default
   * 32
   */
  maxDepth?: number;
}

/**
 * Reads a wire query from a JSON request body, the POST twin of reading it off the URL.
 *
 * The parsed object feeds the same `parseQueryParams` a URL does, so both transports converge.
 * Rejects `415` unless the `Content-Type` is `application/json` or a `+json` suffix.
 * An empty, non-object, or malformed body rejects `400`.
 * The text is depth-scanned against `maxDepth` (default `32`, matching the URL grammar) before `JSON.parse`.
 * A deeply nested payload is refused before it can overflow the parser's stack.
 * The result is unverified; `parseQueryParams` validates it.
 *
 * @example
 * ```ts
 * const parsed = parseQueryParams(
 *   await readQueryBody(),
 *   queryMetadata('Posts'),
 *   resolveGuards(),
 * )
 * ```
 */
export async function readQueryBody({ maxDepth = 32 }: ReadQueryBodyOptions = {}): Promise<
  Record<string, SearchParamValue>
> {
  return (await readBoundedObject(maxDepth)) as Record<string, SearchParamValue>;
}

/**
 * Options for `readRecordBody`.
 */
export interface ReadRecordBodyOptions {
  /**
   * The deepest bracket nesting the JSON body may reach before it rejects `400`.
   * Scanned before `JSON.parse`, so a depth bomb is refused before it overflows the parser's stack.
   *
   * @default
   * 32
   */
  maxDepth?: number;
}

/**
 * Reads a record write input from a JSON request body - the create and update endpoints' reader.
 *
 * The same gates as `readQueryBody`: `415` on a non-JSON `Content-Type`, `400` on a bad body.
 * Empty, non-object, malformed, and too-nested all reject, the depth scanned before `JSON.parse`.
 * The result is unverified; the write pipeline validates it.
 *
 * @example
 * ```ts
 * const outcome = await queryUntyped('Posts').create(await readRecordBody())
 * ```
 */
export async function readRecordBody({ maxDepth = 32 }: ReadRecordBodyOptions = {}): Promise<
  Record<string, unknown>
> {
  return readBoundedObject(maxDepth);
}

/**
 * The shared read: the content-type gate, the depth scan, `JSON.parse`, and the plain-object check.
 */
async function readBoundedObject(maxDepth: number): Promise<Record<string, unknown>> {
  const { type } = parseMediaType(useRequest().headers.get('content-type') ?? '');
  if (type !== 'application/json' && !type.endsWith('+json')) throw unsupportedMediaType();

  const text = await readTextBody();
  if (text === '') throw badRequest(translate('api.body.empty'));
  if (!jsonDepthWithin(text, maxDepth)) throw badRequest(translate('api.body.tooNested'));

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest(translate('api.body.invalidJSON'));
  }
  if (!isPlainObject(parsed)) throw badRequest(translate('api.body.invalidJSON'));
  return parsed;
}
