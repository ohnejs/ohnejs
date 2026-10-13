import { isEmail } from '../is/is-email.ts';
import { encodeRFC3986 } from './encode-rfc3986.ts';

/**
 * The `mailto:` href that writes to `email`, or `undefined` when it is no email address.
 * The local part is percent-encoded, so a `?` or `#` in it never starts a query or fragment.
 *
 * @example
 * ```ts
 * mailtoHref('thrall@orgrimmar.example') // -> 'mailto:thrall@orgrimmar.example'
 * mailtoHref('a?b@x.y')                  // -> 'mailto:a%3Fb@x.y'
 * mailtoHref('nope')                     // -> undefined
 * ```
 */
export function mailtoHref(email: string): string | undefined {
  if (!isEmail(email)) return undefined;
  const at = email.lastIndexOf('@');
  return `mailto:${encodeRFC3986(email.slice(0, at))}@${email.slice(at + 1)}`;
}
