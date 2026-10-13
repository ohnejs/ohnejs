import { isDomainName } from './is-domain-name.ts';
import { isString } from './is-string.ts';

const ATOM = "[\\p{L}\\p{M}\\p{N}!#$%&'*+\\-/=?^_`{|}~]+";
const LOCAL = new RegExp(`^${ATOM}(?:\\.${ATOM})*$`, 'u');
const IGNORABLE = /\p{DI}/u;

/**
 * Checks whether a value is an email address: a dot-atom local part, `@`, and a domain name.
 * The local part is at most 64 characters of RFC 5322 `atext`, letters, marks and digits.
 * An invisible character such as U+034F is refused anywhere.
 * The domain must pass `isDomainName`, so IP hosts and `localhost` are refused.
 * The whole address is at most 254 characters; quoted local parts are refused.
 *
 * @example
 * ```ts
 * isEmail('user@example.com')  // -> true
 * isEmail('jürgen@münchen.de') // -> true
 * isEmail('not-an-email')      // -> false
 * isEmail('a@b')               // -> false
 * isEmail('a@x.y?subject=hi')  // -> false
 * ```
 */
export function isEmail<T extends string = string>(value: unknown): value is T {
  if (!isString(value) || value.length > 254) return false;
  const at = value.lastIndexOf('@');
  const local = value.slice(0, at);
  return (
    at > 0 &&
    local.length <= 64 &&
    LOCAL.test(local) &&
    !IGNORABLE.test(local) &&
    isDomainName(value.slice(at + 1))
  );
}
