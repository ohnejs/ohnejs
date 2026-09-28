import type { DashboardField } from '../runtime/meta-types.ts';

import { isDecimalString } from '../../utils/is/is-decimal-string.ts';
import { isInteger } from '../../utils/is/is-integer.ts';
import { isRealNumber } from '../../utils/is/is-real-number.ts';

/**
 * One scalar input parsed toward the wire.
 * `value` absent and no `error` means the field is omitted, so a server default may apply.
 */
export interface ScalarParse {
  /**
   * The wire value to send.
   */
  value?: unknown;

  /**
   * The message key of the parse failure that blocks the write.
   */
  error?: 'dashboard.invalidInteger' | 'dashboard.invalidNumber';
}

/**
 * A text input's wire value: the string as typed, an emptied nullable input as `null`.
 * A non-nullable field keeps the empty string; `allowEmpty` is the server's call to refuse it.
 */
export function parseTextValue(field: DashboardField, raw: string): unknown {
  if (raw === '' && field.nullable) return null;
  return raw;
}

/**
 * An integer input parsed strictly: any decimal notation of a safe integer, like `12`, `1e3`, or `2.0`.
 * Fractions, hex, and integers past the safe range are refused.
 * Emptied, a nullable field writes `null` and a non-nullable one is omitted.
 */
export function parseIntegerValue(field: DashboardField, raw: string): ScalarParse {
  const text = raw.trim();
  if (text === '') return field.nullable ? { value: null } : {};
  if (!isDecimalString(text) || !isInteger(Number(text))) {
    return { error: 'dashboard.invalidInteger' };
  }
  return { value: Number(text) };
}

/**
 * A real-number input parsed strictly to a finite double.
 * Emptied, a nullable field writes `null` and a non-nullable one is omitted.
 */
export function parseRealValue(field: DashboardField, raw: string): ScalarParse {
  const text = raw.trim();
  if (text === '') return field.nullable ? { value: null } : {};
  if (!isDecimalString(text) || !isRealNumber(Number(text))) {
    return { error: 'dashboard.invalidNumber' };
  }
  return { value: Number(text) };
}
