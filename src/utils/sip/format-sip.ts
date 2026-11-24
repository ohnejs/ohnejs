import { canonicalSIPName } from './_compact-headers.ts';
import { isSIPRequest, type SIPMessage } from './parse-sip.ts';

const encoder = new TextEncoder();

/**
 * Writes `message` in SIP wire form: CRLF line ends, headers in their given order, then the body.
 * `Content-Length` is always rewritten to the body's UTF-8 byte count, in place or appended last.
 *
 * @example
 * ```ts
 * formatSIP({ method: 'OPTIONS', uri: 'sip:x', headers: [['Call-ID', 'a1']], body: '' })
 * // -> 'OPTIONS sip:x SIP/2.0\r\nCall-ID: a1\r\nContent-Length: 0\r\n\r\n'
 *
 * formatSIP({ status: 200, reason: 'OK', headers: [['Content-Length', '9']], body: 'ü' })
 * // -> 'SIP/2.0 200 OK\r\nContent-Length: 2\r\n\r\nü'
 * ```
 */
export function formatSIP(message: SIPMessage): string {
  const start = isSIPRequest(message)
    ? `${message.method} ${message.uri} SIP/2.0`
    : `SIP/2.0 ${message.status} ${message.reason}`;
  const length = `Content-Length: ${encoder.encode(message.body).byteLength}`;
  let hasLength = false;
  const lines = message.headers.map(([name, value]) => {
    if (canonicalSIPName(name) !== 'Content-Length') return `${name}: ${value}`;
    hasLength = true;
    return length;
  });
  if (!hasLength) lines.push(length);
  return `${[start, ...lines].join('\r\n')}\r\n\r\n${message.body}`;
}
