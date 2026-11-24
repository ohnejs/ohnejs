import { isNull } from '../is/is-null.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { parseSIPParams } from './sip-params.ts';

/**
 * A `sip:` or `sips:` URI split into its parts, per RFC 3261.
 */
export interface SIPURI {
  /**
   * The lowercased scheme.
   */
  scheme: 'sip' | 'sips';

  /**
   * The percent-decoded user part, or `null` when the URI names only a host.
   */
  user: string | null;

  /**
   * The host as written: a domain, an IPv4 address, or a bracketed IPv6 reference.
   */
  host: string;

  /**
   * The port, or `null` when the URI leaves it to the transport default.
   */
  port: number | null;

  /**
   * The URI parameters after the host, keyed by lowercased name; a flag such as `lr` maps to `''`.
   */
  params: Record<string, string>;
}

const SCHEME = /^(sips?):/i;

const HOST_PORT = /^(\[[\da-fA-F:.]+\]|[^:[\]]+)(?::(\d{1,5}))?$/;

/**
 * Parses a `sip:` or `sips:` URI into scheme, user, host, port, and parameters.
 * A password in the user info and any `?` headers are dropped.
 * Returns `null` for another scheme, an empty host, a port above 65535, or a malformed escape.
 *
 * @example
 * ```ts
 * parseSIPURI('sip:owner@127.0.0.1:8088;transport=ws')
 * // -> { scheme: 'sip', user: 'owner', host: '127.0.0.1', port: 8088, params: { transport: 'ws' } }
 *
 * parseSIPURI('sips:%2B4989123@voip.example.de')
 * // -> { scheme: 'sips', user: '+4989123', host: 'voip.example.de', port: null, params: {} }
 *
 * parseSIPURI('tel:+4989123')
 * // -> null
 * ```
 */
export function parseSIPURI(uri: string): SIPURI | null {
  const match = SCHEME.exec(uri);
  if (isNull(match)) return null;

  const scheme = match[1].toLowerCase() as SIPURI['scheme'];
  const rest = uri.slice(match[0].length);
  const at = rest.indexOf('@');
  let user: string | null = null;
  if (at !== -1) {
    const info = rest.slice(0, at);
    const password = info.indexOf(':');
    try {
      user = decodeURIComponent(password === -1 ? info : info.slice(0, password));
    } catch {
      return null;
    }
  }

  const tail = rest.slice(at + 1).split('?', 1)[0];
  const semicolon = tail.indexOf(';');
  const hostPort = HOST_PORT.exec(semicolon === -1 ? tail : tail.slice(0, semicolon));
  if (isNull(hostPort)) return null;

  const port = isUndefined(hostPort[2]) ? null : Number(hostPort[2]);
  if (!isNull(port) && port > 65535) return null;

  return {
    scheme,
    user,
    host: hostPort[1],
    port,
    params: semicolon === -1 ? {} : parseSIPParams(tail.slice(semicolon)),
  };
}
