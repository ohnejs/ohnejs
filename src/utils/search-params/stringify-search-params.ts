import { isArray } from '../is/is-array.ts';
import { isBoolean } from '../is/is-boolean.ts';
import { isNull } from '../is/is-null.ts';
import { isRealNumber } from '../is/is-real-number.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { coerceToken, type SearchParamValue } from './coerce-token.ts';

const ENCODE = new Set([' ', '"', '#', '<', '>', "'", '%', '&', '[', ']', '{', '}', ',', ':']);

function encode(str: string, encodeEquals: boolean): string {
  let out = '';
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code > 0x7e || ENCODE.has(ch) || (encodeEquals && ch === '=')) {
      out += ch === "'" ? '%27' : encodeURIComponent(ch);
    } else {
      out += ch;
    }
  }
  return out;
}

function needsMarker(value: string): boolean {
  return value.startsWith('`') || coerceToken(value) !== value;
}

function encodeValue(value: SearchParamValue): string {
  if (isNull(value)) return 'null';
  if (isBoolean(value)) return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!isRealNumber(value)) return 'null';
    const token = String(value);
    return coerceToken(token) === value ? token : value.toExponential().replace('e+', 'e');
  }
  if (isString(value)) return (needsMarker(value) ? '`' : '') + encode(value, false);
  if (isArray<SearchParamValue[]>(value)) {
    const items = value.map((v) => {
      const item = encodeValue(isUndefined(v) ? null : v);
      // Mark an empty string so a lone `['']` is not read back as an empty array.
      return item === '' ? '`' : item;
    });
    return `[${items.join(',')}]`;
  }
  const parts: string[] = [];
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (!isUndefined(v)) parts.push(`${encode(key, false)}:${encodeValue(v)}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * Serializes an object into a URL query string, the inverse of `parseSearchParams`.
 * Numbers, booleans, `null`, arrays, and objects keep their type through the grammar.
 * Strings that would read back as another type get a leading backtick (`'1'` -> `` `1 ``).
 *
 * Only characters that truly need it are percent-encoded, so structure and operators stay readable.
 * The result has no leading `?`; an `undefined` value drops its key.
 *
 * @example
 * ```ts
 * stringifySearchParams({ a: 1, b: 'hi' })   // -> 'a=1&b=hi'
 * stringifySearchParams({ list: [1, true] }) // -> 'list=[1,true]'
 * stringifySearchParams({ p: { x: 1 } })     // -> 'p={x:1}'
 * stringifySearchParams({ s: '1' })          // -> 's=`1'
 * ```
 */
export function stringifySearchParams(params: {
  [key: string]: SearchParamValue | undefined;
}): string {
  const pairs: string[] = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (!isUndefined(value)) pairs.push(`${encode(key, true)}=${encodeValue(value)}`);
  }
  return pairs.join('&');
}
