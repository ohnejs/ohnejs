import { hmacTag } from './_tag.ts';
import { secureCompare } from './secure-compare.ts';

/**
 * Verifies a `value.tag` string from `signValue` and returns the value, or `null` if the tag fails.
 * The tag is recomputed and checked with `secureCompare`, so a forged or tampered value is rejected.
 *
 * The value is split off at the last dot; a base64url tag has none, so a value may itself contain dots.
 *
 * `context` must match the one given to `signValue`; a mismatch is rejected like any other tampering.
 *
 * @example
 * ```ts
 * unsignValue(signValue('hi', secret), secret)               // -> 'hi'
 * unsignValue(signValue('hi', secret, 'sid'), secret, 'sid') // -> 'hi'
 * unsignValue('hi.forged', secret)                           // -> null
 * ```
 */
export function unsignValue(signed: string, secret: string, context = ''): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot === -1) return null;

  const value = signed.slice(0, dot);
  return secureCompare(signed.slice(dot + 1), hmacTag(value, secret, context)) ? value : null;
}
