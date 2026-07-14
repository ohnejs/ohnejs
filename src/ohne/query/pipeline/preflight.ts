import type { LogicalType } from '../../database/dialect.ts';

import {
  coerceToBoolean,
  coerceToInteger,
  coerceToString,
  isBoolean,
  isInteger,
  isString,
} from '../../../utils/index.ts';

/**
 * Soft-coerces a column value toward its storage primitive, the preflight's forgiving first pass.
 *
 * A string that reads as an integer becomes one, `'true'`/`'1'` become booleans, and so on.
 * Coercion never fails: a value it cannot convert passes through for the base-type check to reject.
 * A `json` column takes any value as-is, since every value is a candidate for JSON storage.
 *
 * @example
 * ```ts
 * coerceColumn('42', 'integer')   // -> 42
 * coerceColumn('nope', 'integer') // -> 'nope'
 * ```
 */
export function coerceColumn(value: unknown, type: LogicalType): unknown {
  switch (type) {
    case 'text':
      return coerceToString(value);
    case 'integer':
      return coerceToInteger(value);
    case 'boolean':
      return coerceToBoolean(value);
    case 'json':
      return value;
  }
}

/**
 * Whether a coerced value is a legal member of its storage primitive, the preflight's base-type gate.
 *
 * A non-safe integer is rejected, so a value outside `Number.MAX_SAFE_INTEGER` never silently truncates.
 * A `json` column accepts any value; its storability is the dialect codec's concern.
 *
 * @example
 * ```ts
 * isValidColumn(42, 'integer')   // -> true
 * isValidColumn('42', 'integer') // -> false
 * ```
 */
export function isValidColumn(value: unknown, type: LogicalType): boolean {
  switch (type) {
    case 'text':
      return isString(value);
    case 'integer':
      return isInteger(value);
    case 'boolean':
      return isBoolean(value);
    case 'json':
      return true;
  }
}
