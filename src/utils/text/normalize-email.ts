import { lowercase } from '../case/lowercase.ts';

/**
 * Normalizes an email address to one stored form, so two spellings of an address compare equal.
 * It trims the address and lowercases it with `lowercase`, so the domain matches the one a browser resolves.
 * Lowercasing the local part is lossy, but it is how people expect addresses to match.
 * A punycode domain is kept as written, so `xn--mnchen-3ya.de` and `münchen.de` stay distinct.
 * A compatibility form such as a fullwidth letter is kept too, for `isEmail` to refuse.
 *
 * @example
 * ```ts
 * normalizeEmail(' Thrall@Orgrimmar.Example ') // -> 'thrall@orgrimmar.example'
 * normalizeEmail('Jürgen@MÜNCHEN.de')          // -> 'jürgen@münchen.de'
 * ```
 */
export function normalizeEmail(email: string): string {
  return lowercase(email.trim());
}
