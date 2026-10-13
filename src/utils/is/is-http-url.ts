import { isSafeHref } from '../html/is-safe-href.ts';
import { isDomainName } from './is-domain-name.ts';
import { isPort } from './is-port.ts';
import { isString } from './is-string.ts';
import { isUndefined } from './is-undefined.ts';

const SCHEME = /^https?:\/\//i;
const INVISIBLE = /[\s\p{Cf}\\]/u;
const AUTHORITY = /^https?:\/\/([^/?#]*)/i;
const HOST_PORT = /^(.*?)(?::(\d+))?$/s;

/**
 * Checks whether a value is an absolute `http:` or `https:` address with a public domain name as its host.
 * It is refused when a browser would read it differently than it is written.
 * That covers a missing `//`, a backslash, an invisible or space character, and userinfo.
 * The host must pass `isDomainName`, so IP hosts and `localhost` are refused.
 *
 * @example
 * ```ts
 * isHTTPURL('https://dalaran.example/a?b=1') // -> true
 * isHTTPURL('http://münchen.de:8080')        // -> true
 * isHTTPURL('https:dalaran.example')         // -> false
 * isHTTPURL('https://127.0.0.1')             // -> false
 * isHTTPURL('mailto:a@x.y')                  // -> false
 * ```
 */
export function isHTTPURL(value: unknown): value is string {
  if (!isString(value) || !SCHEME.test(value) || INVISIBLE.test(value)) return false;
  if (!isSafeHref(value)) return false;
  const [, host = '', port] = HOST_PORT.exec(AUTHORITY.exec(value)![1]!)!;
  return isDomainName(host) && (isUndefined(port) || isPort(Number(port)));
}
