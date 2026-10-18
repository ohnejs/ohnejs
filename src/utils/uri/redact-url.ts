import { percentDecode } from './percent-decode.ts';
import { stripUserinfo } from './strip-userinfo.ts';

/**
 * Removes the secrets a connection URL can carry, so the rest is safe to print or log.
 * It drops every `password` query parameter and the `user:password@` part.
 * The parameters go first, so an `@` inside one never reads as the end of a userinfo.
 * Works on the raw text, so a value no URL parser accepts is redacted too.
 *
 * @example
 * ```ts
 * redactURL('postgres://app:secret@db/main')       // -> 'postgres://db/main'
 * redactURL('postgres://db/main?password=secret')  // -> 'postgres://db/main'
 * redactURL('postgres://db/main?password=s&ssl=1') // -> 'postgres://db/main?ssl=1'
 * redactURL('postgres://db/main?password=p@ss')    // -> 'postgres://db/main'
 * redactURL('.data/app.db')                        // -> '.data/app.db'
 * ```
 */
export function redactURL(url: string): string {
  const start = url.indexOf('?');
  if (start === -1) return stripUserinfo(url);
  let query = '';
  for (const [, separator, param] of url.slice(start).matchAll(/([?&])([^?&]*)/g)) {
    if (param === '' || isPasswordParam(param)) continue;
    query += query === '' ? `?${param}` : `${separator}${param}`;
  }
  return stripUserinfo(url.slice(0, start) + query);
}

/**
 * Whether a raw `name=value` pair names `password`, decoded as a URL parser decodes it.
 * The whole pair goes, so a `#` inside the value takes the rest of the secret with it.
 */
function isPasswordParam(param: string): boolean {
  return percentDecode(param.split('=', 1)[0])?.toLowerCase() === 'password';
}
