import { lowercase } from '../case/lowercase.ts';
import { isUndefined } from '../is/is-undefined.ts';

const SHAPE = /^(https?):\/\/([^/?#]*?)(?::(\d+))?([/?#].*)?$/is;
const DEFAULT_PORT: Record<string, number> = { http: 80, https: 443 };

/**
 * Normalizes an `http:` or `https:` address to one stored form, so two spellings of it compare equal.
 * The scheme and host are lowercased with `lowercase`, so the host matches the one a browser resolves.
 * A default port and a path that is only `/` are dropped.
 * The rest of the path, the query and the fragment are kept as written, so their case still matters.
 * The host is never converted to punycode, and a compatibility form in it is kept for `isHTTPURL` to refuse.
 * A value that is not shaped like an `http(s)://` address comes back trimmed only.
 *
 * @example
 * ```ts
 * normalizeHTTPURL(' HTTPS://Dalaran.Example:443/?q=A ') // -> 'https://dalaran.example?q=A'
 * normalizeHTTPURL('https://MÜNCHEN.de/Ä')               // -> 'https://münchen.de/Ä'
 * normalizeHTTPURL('dalaran.example')                    // -> 'dalaran.example'
 * ```
 */
export function normalizeHTTPURL(value: string): string {
  const text = value.trim();
  const match = SHAPE.exec(text);
  if (!match) return text;
  const [, scheme, host, port, rest = ''] = match;
  const lower = scheme!.toLowerCase();
  const kept = isUndefined(port) || Number(port) === DEFAULT_PORT[lower] ? '' : `:${Number(port)}`;
  const path =
    rest === '/' || rest.startsWith('/?') || rest.startsWith('/#') ? rest.slice(1) : rest;
  return `${lower}://${lowercase(host!)}${kept}${path}`;
}
