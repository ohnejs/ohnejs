import type { SIPMessage } from './parse-sip.ts';

import { canonicalSIPName } from './_compact-headers.ts';

const UNSPLIT = new Set([
  'WWW-Authenticate',
  'Proxy-Authenticate',
  'Authorization',
  'Proxy-Authorization',
  'Date',
  'Subject',
  'User-Agent',
  'Server',
  'Organization',
  'Retry-After',
]);

/**
 * The first value of the header `name` in `message`, or `undefined` when it has none.
 * The name matches case-insensitively, and a compact form such as `i` finds `Call-ID`.
 * A comma list counts as several values, so this is the top `Via` or the first `Contact`.
 *
 * @example
 * ```ts
 * const message = parseSIP('SIP/2.0 200 OK\r\nv: SIP/2.0/WSS a;branch=1, SIP/2.0/WSS b\r\n\r\n')!
 * sipHeader(message, 'via')     // -> 'SIP/2.0/WSS a;branch=1'
 * sipHeader(message, 'Call-ID') // -> undefined
 * ```
 */
export function sipHeader(message: SIPMessage, name: string): string | undefined {
  return sipHeaders(message, name)[0];
}

/**
 * Every value of the header `name` in `message`, across all of its lines, in wire order.
 * The name matches case-insensitively, and a compact form such as `v` finds `Via`.
 * A comma list splits into its values, except commas inside quotes or angle brackets.
 * An auth header never splits, nor does a free-text one such as `Date` or `User-Agent`.
 *
 * @example
 * ```ts
 * const message = parseSIP('SIP/2.0 200 OK\r\nv: SIP/2.0/WS a, SIP/2.0/WS b\r\nVia: SIP/2.0/WS c\r\n\r\n')!
 * sipHeaders(message, 'Via') // -> ['SIP/2.0/WS a', 'SIP/2.0/WS b', 'SIP/2.0/WS c']
 * ```
 */
export function sipHeaders(message: SIPMessage, name: string): string[] {
  const canonical = canonicalSIPName(name);
  const wanted = canonical.toLowerCase();
  const values: string[] = [];
  for (const [header, value] of message.headers) {
    if (canonicalSIPName(header).toLowerCase() !== wanted) continue;
    if (UNSPLIT.has(canonical)) values.push(value);
    else values.push(...splitList(value));
  }
  return values;
}

/**
 * Splits a header value at each comma outside quotes and angle brackets, dropping empty items.
 */
function splitList(value: string): string[] {
  const items: string[] = [];
  let quoted = false;
  let bracketed = false;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quoted) {
      if (char === '\\') i++;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '<') bracketed = true;
    else if (char === '>') bracketed = false;
    else if (char === ',' && !bracketed) {
      items.push(value.slice(start, i));
      start = i + 1;
    }
  }
  items.push(value.slice(start));
  return items.map((item) => item.trim()).filter((item) => item !== '');
}
