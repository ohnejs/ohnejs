import { isNull } from '../is/is-null.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { canonicalSIPName } from './_compact-headers.ts';

/**
 * The header fields of a SIP message in wire order, one `[name, value]` pair per header line.
 * Names are canonical long names: a compact `i` reads as `Call-ID`, a known name takes its RFC casing.
 * A repeated header keeps one pair per line, so several `Via` lines stay in order.
 */
export type SIPHeaders = [name: string, value: string][];

/**
 * A SIP request, such as a `REGISTER` or an `INVITE`.
 */
export interface SIPRequest {
  /**
   * The method as written, such as `'INVITE'`.
   */
  method: string;

  /**
   * The Request-URI.
   */
  uri: string;

  /**
   * The header fields in wire order.
   */
  headers: SIPHeaders;

  /**
   * The message body, such as an SDP offer, or `''`.
   */
  body: string;
}

/**
 * A SIP response, such as a `401` challenge or a `200` answer.
 */
export interface SIPResponse {
  /**
   * The three-digit status code.
   */
  status: number;

  /**
   * The reason phrase, such as `'Unauthorized'`, or `''`.
   */
  reason: string;

  /**
   * The header fields in wire order.
   */
  headers: SIPHeaders;

  /**
   * The message body, such as an SDP answer, or `''`.
   */
  body: string;
}

/**
 * A SIP request or response.
 */
export type SIPMessage = SIPRequest | SIPResponse;

const REQUEST_LINE = /^(\S+) (\S+) SIP\/2\.0$/i;

const STATUS_LINE = /^SIP\/2\.0 (\d{3})(?: (.*))?$/i;

const HEADER_LINE = /^([^\s:]+)[ \t]*:[ \t]*(.*)$/;

const encoder = new TextEncoder();

const decoder = new TextDecoder();

/**
 * Whether `message` is a request rather than a response.
 *
 * @example
 * ```ts
 * isSIPRequest(parseSIP('OPTIONS sip:x SIP/2.0\r\n\r\n')!) // -> true
 * isSIPRequest(parseSIP('SIP/2.0 200 OK\r\n\r\n')!)        // -> false
 * ```
 */
export function isSIPRequest(message: SIPMessage): message is SIPRequest {
  return 'method' in message;
}

/**
 * Parses one SIP message, such as a WebSocket text frame, into its start line, headers, and body.
 * Lines may end in CRLF or LF, folded header lines are unfolded, and compact names expand to long names.
 * The body is cut to `Content-Length`, counted in UTF-8 bytes; without one, the rest is the body.
 * Returns `null` for anything that is not SIP/2.0, including a blank keepalive.
 *
 * @example
 * ```ts
 * parseSIP('SIP/2.0 200 OK\r\ni: a84b4c76\r\nl: 0\r\n\r\n')
 * // -> { status: 200, reason: 'OK', headers: [['Call-ID', 'a84b4c76'], ['Content-Length', '0']], body: '' }
 *
 * parseSIP('\r\n\r\n')
 * // -> null
 * ```
 */
export function parseSIP(text: string): SIPMessage | null {
  const message = text.replace(/^(?:\r?\n)+/, '');
  const split = /\r?\n\r?\n/.exec(message);
  const head = isNull(split) ? message : message.slice(0, split.index);
  const rest = isNull(split) ? '' : message.slice(split.index + split[0].length);

  const lines: string[] = [];
  for (const line of head.split(/\r?\n/)) {
    if ((line[0] === ' ' || line[0] === '\t') && lines.length > 1) {
      lines[lines.length - 1] = `${lines.at(-1)!.trimEnd()} ${line.trim()}`;
    } else {
      lines.push(line);
    }
  }

  const headers: SIPHeaders = [];
  for (const line of lines.slice(1)) {
    const field = HEADER_LINE.exec(line);
    if (!isNull(field)) headers.push([canonicalSIPName(field[1]), field[2].trimEnd()]);
  }

  const body = cutBody(rest, headers);
  const request = REQUEST_LINE.exec(lines[0]);
  if (!isNull(request)) return { method: request[1], uri: request[2], headers, body };

  const status = STATUS_LINE.exec(lines[0]);
  if (isNull(status)) return null;
  return { status: Number(status[1]), reason: status[2] ?? '', headers, body };
}

/**
 * Cuts `rest` to the byte count its `Content-Length` header names, or keeps it whole without one.
 */
function cutBody(rest: string, headers: SIPHeaders): string {
  const length = headers.find(([name]) => name === 'Content-Length')?.[1];
  if (isUndefined(length) || !/^\d+$/.test(length)) return rest;
  return decoder.decode(encoder.encode(rest).subarray(0, Number(length)));
}
