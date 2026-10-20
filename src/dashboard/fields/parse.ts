import type { CurrencyCode } from '../../utils/i18n/currency-digits.ts';
import type { DashboardField } from '../runtime/meta-types.ts';

import { parseWholeDuration } from '../../utils/duration/parse-whole-duration.ts';
import { amountEditText } from '../../utils/i18n/amount-edit-text.ts';
import { currencyDigits } from '../../utils/i18n/currency-digits.ts';
import { isDecimalString } from '../../utils/is/is-decimal-string.ts';
import { isInteger } from '../../utils/is/is-integer.ts';
import { isRealNumber } from '../../utils/is/is-real-number.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { parseMinorUnits } from '../../utils/number/parse-minor-units.ts';

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
   * The message of the parse failure that blocks the write: a key, or a key with its params.
   */
  error?:
    | 'dashboard.invalidDuration'
    | 'dashboard.invalidInteger'
    | 'dashboard.invalidNumber'
    | 'validation.invalidJSON'
    | { key: 'dashboard.invalidAmount'; params: { example: string } };
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
 * A real-number input parsed strictly to a finite double, with `.` or `,` as the decimal mark.
 * Emptied, a nullable field writes `null` and a non-nullable one is omitted.
 */
export function parseRealValue(field: DashboardField, raw: string): ScalarParse {
  const text = raw.trim().replace(',', '.');
  if (text === '') return field.nullable ? { value: null } : {};
  if (!isDecimalString(text) || !isRealNumber(Number(text))) {
    return { error: 'dashboard.invalidNumber' };
  }
  return { value: Number(text) };
}

/**
 * A duration input parsed into whole milliseconds, from text like `1h 30m` or `90m`.
 * A bare number other than `0` names no unit, so it is refused rather than guessed.
 * Emptied, a nullable field writes `null` and a non-nullable one is omitted.
 */
export function parseDurationValue(field: DashboardField, raw: string): ScalarParse {
  if (raw.trim() === '') return field.nullable ? { value: null } : {};
  const ms = parseWholeDuration(raw);
  return isUndefined(ms) ? { error: 'dashboard.invalidDuration' } : { value: ms };
}

/**
 * An amount input parsed into minor units of `currency`, exactly, with `.` or `,` as the decimal mark.
 * A failure shows an example amount the way `language` writes one for editing.
 * Emptied, a nullable field writes `null` and a non-nullable one is omitted.
 */
export function parseAmountValue(
  field: DashboardField,
  raw: string,
  currency: CurrencyCode,
  language: string,
): ScalarParse {
  if (raw.trim() === '') return field.nullable ? { value: null } : {};
  const digits = currencyDigits[currency];
  const value = parseMinorUnits(raw, digits);
  if (!isUndefined(value)) return { value };
  return {
    error: {
      key: 'dashboard.invalidAmount',
      params: { example: amountEditText(123456, digits, language) },
    },
  };
}

/**
 * A JSON input parsed whole, so any JSON text is a value, a top-level string or number included.
 * Emptied, a nullable field writes `null` and a non-nullable one is omitted.
 */
export function parseJSONValue(field: DashboardField, raw: string): ScalarParse {
  const text = raw.trim();
  if (text === '') return field.nullable ? { value: null } : {};
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return { error: 'validation.invalidJSON' };
  }
}
