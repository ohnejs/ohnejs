import type { LogicalType } from '../../database/dialect.ts';

import {
  coerceToBoolean,
  coerceToNumber,
  coerceToString,
  isBoolean,
  isInteger,
  isRealNumber,
  isString,
} from '../../../utils/index.ts';

/**
 * Soft-coerces a column value toward its storage primitive, the preflight's forgiving first pass.
 *
 * A string that reads as an integer becomes one, `'true'`/`'1'` become booleans, and so on.
 * Coercion never fails: a value it cannot convert passes through for the base-type check to reject.
 * An `integer` never truncates: `'1.9'` becomes `1.9`, which the base-type check rejects.
 * A `-0` becomes `0`, since SQLite drops the sign in storage; every other value stays bit-exact.
 * A `json` column takes any value as-is, since every value is a candidate for JSON storage.
 *
 * @example
 * ```ts
 * coerceColumn('42', 'integer')   // -> 42
 * coerceColumn('1.9', 'integer')  // -> 1.9
 * coerceColumn('nope', 'integer') // -> 'nope'
 * ```
 */
export function coerceColumn(value: unknown, type: LogicalType): unknown {
  switch (type) {
    case 'text':
      return coerceToString(value);
    case 'integer':
    case 'real': {
      const coerced = coerceToNumber(value);
      return Object.is(coerced, -0) ? 0 : coerced;
    }
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
 * A `real` must be finite: SQLite silently stores a bound `NaN` as SQL `NULL`, and JSON has no infinities.
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
    case 'real':
      return isRealNumber(value);
    case 'boolean':
      return isBoolean(value);
    case 'json':
      return true;
  }
}
