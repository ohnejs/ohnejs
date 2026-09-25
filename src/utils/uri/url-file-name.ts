import { isString } from '../is/is-string.ts';
import { percentDecode } from './percent-decode.ts';

const PATH_PARAMETERS = /;.*/;

/**
 * Returns the file name a URL's path ends in: its last non-empty segment, percent-decoded.
 * Path parameters after a `;` are cut, so a `;jsessionid=...` never reaches the name.
 * A malformed escape keeps the segment's raw text.
 *
 * Only the path is read, so the query, the fragment and the userinfo never leak into the name.
 * Returns `''` when the path names no segment, or when `url` is a string no URL parser accepts.
 * The name is returned raw: sanitize it before it names anything, as `slugifyFileName` does.
 *
 * @example
 * ```ts
 * urlFileName('https://cdn.example/thrall/axe.png?sig=x') // -> 'axe.png'
 * urlFileName('https://cdn.example/Jaina%20Proudmoore/')  // -> 'Jaina Proudmoore'
 * urlFileName('https://cdn.example/img.jpg;jsessionid=x') // -> 'img.jpg'
 * urlFileName('https://cdn.example/%E0%A4%A.png')         // -> '%E0%A4%A.png'
 * urlFileName('https://cdn.example/')                     // -> ''
 * ```
 */
export function urlFileName(url: URL | string): string {
  const { pathname } = (isString(url) ? URL.parse(url) : url) ?? { pathname: '' };
  const names = pathname.split('/').map((segment) => segment.replace(PATH_PARAMETERS, ''));
  const name = names.findLast(Boolean) ?? '';
  return percentDecode(name) ?? name;
}
