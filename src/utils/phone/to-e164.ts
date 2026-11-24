/**
 * Options for `toE164`.
 */
export interface E164Options {
  /**
   * The country calling code a national number with a leading `0` belongs to.
   *
   * @default
   * '49'
   */
  callingCode?: string;

  /**
   * Reads bare digits, without `+`, `00`, or `0`, as an international number.
   * Omitted, bare digits are not a phone number.
   */
  bare?: 'international';
}

const LABEL = /^[^+\d(]*/;

const SEPARATORS = /[\s()\-./]/g;

const TRUNK = /^\+(41|43|49)0/;

const E164 = /^\+\d{8,15}$/;

/**
 * Normalizes a phone number as people write it to E.164: `+`, then 8 to 15 digits.
 * A leading label like `Tel.:`, spaces, `()-./` and a `(0)` trunk marker are dropped.
 * `00` becomes `+`, and a leading `0` becomes `+` and the calling code.
 * A trunk `0` written after `+49`, `+43` or `+41` is dropped.
 * Returns `null` for anything that does not end up as E.164.
 *
 * @example
 * ```ts
 * toE164('0171 1234567')                          // -> '+491711234567'
 * toE164('+49 (0)89 123456')                      // -> '+4989123456'
 * toE164('Tel.: +49 089 123456')                  // -> '+4989123456'
 * toE164('0043 1 5052000')                        // -> '+4315052000'
 * toE164('01 23 45 67 89', { callingCode: '33' }) // -> '+33123456789'
 * toE164('4989123456')                            // -> null
 * toE164('4989123456', { bare: 'international' }) // -> '+4989123456'
 * ```
 */
export function toE164(input: string, options: E164Options = {}): string | null {
  const { callingCode = '49', bare } = options;
  const digits = input.replace(LABEL, '').replaceAll('(0)', '').replace(SEPARATORS, '');
  let number: string;
  if (digits.startsWith('+')) number = digits;
  else if (digits.startsWith('00')) number = `+${digits.slice(2)}`;
  else if (digits.startsWith('0')) number = `+${callingCode}${digits.slice(1)}`;
  else if (bare === 'international') number = `+${digits}`;
  else return null;
  number = number.replace(TRUNK, '+$1');
  return E164.test(number) ? number : null;
}
