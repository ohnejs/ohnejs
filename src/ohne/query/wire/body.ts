import type { SearchParamValue } from '../../../utils/index.ts';

import {
  isPlainObject,
  jsonDepthWithin,
  jsonHasNUL,
  parseMediaType,
} from '../../../utils/index.ts';
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
 * An empty, non-object, malformed, or too-nested body rejects `400`, as does a U+0000 (NUL) anywhere.
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
 * Empty, non-object, malformed, too-nested, and NUL-bearing bodies all reject.
 * The depth is scanned before `JSON.parse`.
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
 * The shared read: the content-type gate, the depth scan, `JSON.parse`, the plain-object and NUL checks.
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
  if (jsonHasNUL(text)) throw badRequest(translate('api.body.containsNUL'));
  return parsed;
}
