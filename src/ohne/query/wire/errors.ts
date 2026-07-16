import type { ConditionError } from '../../../utils/index.ts';

import { isUndefined } from '../../../utils/index.ts';
import { badRequest, type HTTPError } from '../../http/http-error.ts';
import { translate } from '../../http/translate.ts';

/**
 * The machine-readable failure category a wire error carries under `data.code`.
 *
 * A client switches on it; the human `message` is translated and may vary by language.
 * Field-level failures collapse to `invalidField` so a URL can never probe which fields exist.
 */
export type WireErrorCode =
  | 'unknownParam'
  | 'invalidField'
  | 'invalidShape'
  | 'unknownOperator'
  | 'invalidValue'
  | 'nullEquality'
  | 'tooDeep'
  | 'invalidNumber'
  | 'invalidPagination'
  | 'emptySelect'
  | 'duplicateOrderField'
  | 'tooManyConditions'
  | 'hasTooDeep'
  | 'listTooLong'
  | 'tooManyBoundParams'
  | 'tooManyFields'
  | 'tooManyOrderKeys'
  | 'valueTooLarge'
  | 'patternTooLarge';

/**
 * The payload a wire error serializes under the response body's `data`.
 * `code` is the stable category; `path` locates the failure, `where.views.atLeast` or `select[2]` style.
 */
export interface WireErrorData {
  /**
   * The stable failure category, switched on by a client.
   */
  code: WireErrorCode;

  /**
   * The dot path to the offending value, or `''` when the failure is not tied to one location.
   */
  path: string;
}

function wireError(
  code: WireErrorCode,
  path: string,
  params?: Record<string, string | number>,
): HTTPError {
  return badRequest(translate(`query.${code}`, params), { code, path } satisfies WireErrorData);
}

/**
 * A top-level query parameter that is not part of the grammar.
 */
export function unknownParamError(param: string): HTTPError {
  return wireError('unknownParam', param, { param });
}

/**
 * An unknown field, or a real field the operation cannot use, in `where`/`select`/`order`/`populate`.
 * Both collapse to one code and message, with a `did you mean` hint when a near field exists.
 */
export function invalidFieldError(
  field: string,
  path: string,
  suggestion: string | undefined,
): HTTPError {
  const message = isUndefined(suggestion)
    ? translate('query.invalidField', { field })
    : translate('query.invalidFieldSuggestion', { field, suggestion });
  return badRequest(message, { code: 'invalidField', path } satisfies WireErrorData);
}

/**
 * A malformed `where` condition, mapping a `parseCondition` shape failure onto the wire.
 * The condition's own dot path is prefixed with `where` so the location reads from the query root.
 */
export function conditionShapeError(error: ConditionError): HTTPError {
  const path = error.path === '' ? 'where' : `where.${error.path}`;
  const key = error.key ?? '';
  switch (error.code) {
    case 'unknownOperator':
      return wireError('unknownOperator', path, { operator: key });
    case 'invalidValue':
      return wireError('invalidValue', path);
    case 'nullEquality':
      return wireError('nullEquality', path);
    case 'tooDeep':
      return wireError('tooDeep', path);
    default:
      return wireError('invalidShape', path);
  }
}

/**
 * A `where` value that does not match its column's type, caught by the wire's own value check.
 */
export function invalidValueError(path: string): HTTPError {
  return wireError('invalidValue', path);
}

/**
 * A `limit`/`offset`/`page`/`perPage` value that is not the whole number the parameter requires.
 */
export function invalidNumberError(param: string): HTTPError {
  return wireError('invalidNumber', param, { param });
}

/**
 * `limit`/`offset` mixed with `page`/`perPage` in one query; the two windowing modes are exclusive.
 */
export function paginationError(): HTTPError {
  return wireError('invalidPagination', '');
}

/**
 * An explicit `select=[]`; a query that names zero fields is a mistake, not a way to read the id alone.
 */
export function emptySelectError(): HTTPError {
  return wireError('emptySelect', 'select');
}

/**
 * The same field ordered more than once; the wire rejects it where the fluent path keeps the first.
 */
export function duplicateOrderFieldError(field: string, path: string): HTTPError {
  return wireError('duplicateOrderField', path, { field });
}

/**
 * A DoS ceiling the untrusted query exceeded, naming the ceiling it crossed.
 */
export function limitError(
  code:
    | 'tooManyConditions'
    | 'hasTooDeep'
    | 'listTooLong'
    | 'tooManyBoundParams'
    | 'tooManyFields'
    | 'tooManyOrderKeys'
    | 'valueTooLarge'
    | 'patternTooLarge',
  path: string,
  max: number,
): HTTPError {
  return wireError(code, path, { max });
}
