import { coerceToken, type SearchParamValue } from './coerce-token.ts';

export type { SearchParamValue } from './coerce-token.ts';

interface Cursor {
  src: string;
  pos: number;
}

const VALUE_STOP = ',]}';

function assign(
  obj: { [key: string]: SearchParamValue },
  key: string,
  value: SearchParamValue,
): void {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseScalar(cur: Cursor, stop: string): SearchParamValue {
  const start = cur.pos;
  while (cur.pos < cur.src.length && !stop.includes(cur.src[cur.pos])) cur.pos++;
  const token = cur.src.slice(start, cur.pos);
  if (token.startsWith('`')) return decode(token.slice(1));
  return coerceToken(decode(token));
}

function parseKey(cur: Cursor): string {
  const start = cur.pos;
  while (cur.pos < cur.src.length && cur.src[cur.pos] !== ':') cur.pos++;
  if (cur.pos >= cur.src.length) throw new Error('unterminated object key');
  return decode(cur.src.slice(start, cur.pos));
}

function parseArray(cur: Cursor): SearchParamValue[] {
  cur.pos++;
  const arr: SearchParamValue[] = [];
  if (cur.src[cur.pos] === ']') {
    cur.pos++;
    return arr;
  }
  for (;;) {
    arr.push(parseValue(cur, VALUE_STOP));
    const ch = cur.src[cur.pos++];
    if (ch === ']') return arr;
    if (ch !== ',') throw new Error('expected , or ] in array');
  }
}

function parseObject(cur: Cursor): SearchParamValue {
  cur.pos++;
  const obj: { [key: string]: SearchParamValue } = {};
  if (cur.src[cur.pos] === '}') {
    cur.pos++;
    return obj;
  }
  for (;;) {
    const key = parseKey(cur);
    cur.pos++;
    assign(obj, key, parseValue(cur, VALUE_STOP));
    const ch = cur.src[cur.pos++];
    if (ch === '}') return obj;
    if (ch !== ',') throw new Error('expected , or } in object');
  }
}

function parseValue(cur: Cursor, stop: string): SearchParamValue {
  const ch = cur.src[cur.pos];
  if (ch === '[') return parseArray(cur);
  if (ch === '{') return parseObject(cur);
  return parseScalar(cur, stop);
}

function parseTopValue(raw: string): SearchParamValue {
  if (raw === '') return '';
  const cur: Cursor = { src: raw, pos: 0 };
  try {
    const value = parseValue(cur, '');
    return cur.pos === raw.length ? value : decode(raw);
  } catch {
    return decode(raw);
  }
}

/**
 * Parses a URL query string into a structured object.
 * Values carry their own type: `1` is a number, `true` a boolean, `[a,b]` an array, `{k:v}` an object.
 * These nest freely, and a leading backtick forces a string (`` `1 `` is `'1'`).
 * A bare key with no value is `true`; a repeated key collects into an array.
 *
 * Untrusted input never throws: a malformed value falls back to its decoded string.
 * A `__proto__` key lands as an own property, so it cannot pollute a prototype.
 *
 * @example
 * ```ts
 * parseSearchParams('a=1&b=hi')       // -> { a: 1, b: 'hi' }
 * parseSearchParams('list=[1,2,3]')   // -> { list: [1, 2, 3] }
 * parseSearchParams('p={x:1,y:2}')    // -> { p: { x: 1, y: 2 } }
 * parseSearchParams('t=true&t=false') // -> { t: [true, false] }
 * parseSearchParams('flag')           // -> { flag: true }
 * ```
 */
export function parseSearchParams(input: string): { [key: string]: SearchParamValue } {
  const out: { [key: string]: SearchParamValue } = {};
  let query = input;
  if (query.startsWith('?') || query.startsWith('#')) query = query.slice(1);
  if (query === '') return out;

  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const key = decode(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? true : parseTopValue(pair.slice(eq + 1));

    if (!seen.has(key)) {
      seen.add(key);
      assign(out, key, value);
    } else if (repeated.has(key)) {
      (out[key] as SearchParamValue[]).push(value);
    } else {
      repeated.add(key);
      assign(out, key, [out[key], value]);
    }
  }
  return out;
}
