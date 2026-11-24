import { quotedString } from '../authorization/_quoted-string.ts';
import { isNull } from '../is/is-null.ts';
import { parseSIPParams } from './sip-params.ts';

/**
 * An address from a `From`, `To`, or `Contact` header: an optional display name, a URI, and its parameters.
 */
export interface NameAddr {
  /**
   * The display name, unquoted and unescaped, or `null` when the address has none.
   */
  display: string | null;

  /**
   * The URI as written, without the angle brackets.
   */
  uri: string;

  /**
   * The header parameters after the address, such as `tag` or `expires`, keyed by lowercased name.
   */
  params: Record<string, string>;
}

const ADDR_SPEC = /^[a-zA-Z][\w+.-]*:/;

const TOKEN = /^[\w\-.!%*+`'~:[\]]*$/;

/**
 * Parses a SIP address in `name-addr` or bare `addr-spec` form.
 * In the bare form every `;` after the URI starts a header parameter, as RFC 3261 reads it.
 * Returns `null` for an unclosed quote or bracket, or an empty URI.
 *
 * @example
 * ```ts
 * parseNameAddr('"Anna Huber" <sip:anna@example.de>;tag=a6c8')
 * // -> { display: 'Anna Huber', uri: 'sip:anna@example.de', params: { tag: 'a6c8' } }
 *
 * parseNameAddr('sip:owner@127.0.0.1;expires=600')
 * // -> { display: null, uri: 'sip:owner@127.0.0.1', params: { expires: '600' } }
 * ```
 */
export function parseNameAddr(value: string): NameAddr | null {
  const text = value.trim();
  let display: string | null = null;
  let i = 0;

  if (text[0] === '"') {
    let name = '';
    for (i = 1; i < text.length && text[i] !== '"'; i++) {
      if (text[i] === '\\' && i + 1 < text.length) i++;
      name += text[i];
    }
    if (i === text.length) return null;
    display = name;
    i++;
  }

  const open = text.indexOf('<', i);
  if (isNull(display) && (open === -1 || ADDR_SPEC.test(text))) {
    const semicolon = text.indexOf(';');
    const uri = semicolon === -1 ? text : text.slice(0, semicolon).trim();
    if (uri === '') return null;
    return { display, uri, params: semicolon === -1 ? {} : parseSIPParams(text.slice(semicolon)) };
  }
  if (open === -1) return null;

  const close = text.indexOf('>', open);
  const uri = close === -1 ? '' : text.slice(open + 1, close).trim();
  if (uri === '') return null;

  display ??= text.slice(0, open).trim() || null;
  return { display, uri, params: parseSIPParams(text.slice(close + 1)) };
}

/**
 * Writes `addr` as a `name-addr`: the display name quoted, the URI in angle brackets, then its parameters.
 * A parameter value outside the token characters is quoted, and a `''` value writes a bare flag.
 *
 * @example
 * ```ts
 * formatNameAddr({ display: 'Anna', uri: 'sip:anna@example.de', params: { tag: 'a6c8' } })
 * // -> '"Anna" <sip:anna@example.de>;tag=a6c8'
 *
 * formatNameAddr({ display: null, uri: 'sip:owner@x', params: { '+sip.instance': '<urn:x>', ob: '' } })
 * // -> '<sip:owner@x>;+sip.instance="<urn:x>";ob'
 * ```
 */
export function formatNameAddr(addr: NameAddr): string {
  const display = isNull(addr.display) ? '' : `${quotedString(addr.display)} `;
  const params = Object.entries(addr.params).map(([name, value]) => {
    if (value === '') return `;${name}`;
    return `;${name}=${TOKEN.test(value) ? value : quotedString(value)}`;
  });
  return `${display}<${addr.uri}>${params.join('')}`;
}
