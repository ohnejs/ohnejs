import { isString } from './is-string.ts';

/**
 * Checks whether a value is a valid email address.
 * Practical RFC 5321 shape: one `@`, local <= 64, domain <= 255, total <= 254.
 * Rejects whitespace and ASCII control characters.
 *
 * @example
 * ```ts
 * isEmail('user@example.com') // -> true
 * isEmail('not-an-email')     // -> false
 * isEmail('a@b')              // -> false
 * ```
 */
export function isEmail<T extends string = string>(value: unknown): value is T {
  if (!isString(value)) return false;
  const n = value.length;
  if (n === 0 || n > 254) return false;

  let atIndex = -1;
  for (let i = 0; i < n; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x40) {
      if (atIndex !== -1) return false;
      atIndex = i;
    } else if (c <= 0x20 || c === 0x7f) {
      return false;
    }
  }
  if (atIndex < 1) return false;

  const local = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);
  if (local.length > 64 || domain.length === 0 || domain.length > 255) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!domain.includes('.')) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;

  return true;
}
