import { percentDecode } from '../uri/percent-decode.ts';
import { coerceToken, type SearchParamValue } from './coerce-token.ts';

export type { SearchParamValue } from './coerce-token.ts';

/**
 * Options for `parseSearchParams`.
 */
export interface ParseSearchParamsOptions {
  /**
   * Maximum nesting depth of structured values.
   * A structure nested past this parses as flat text, never deeper.
   * Hostile depth then cannot overflow the stack; parsing never throws.
   *
   * @default
   * 32
   */
  maxDepth?: number;
}

interface Cursor {
  src: string;
  pos: number;
  maxDepth: number;
}

const VALUE_STOP = ',]}';

const DEFAULT_MAX_DEPTH = 32;

/**
 * Sets `key` as an own enumerable property, so a `__proto__` key stays data, never the prototype.
 */
function assign(
  obj: { [key: string]: SearchParamValue },
  key: string,
  value: SearchParamValue,
): void {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

/**
 * URI-decodes a string, returning it unchanged when a percent-sequence is malformed.
 */
function decode(raw: string): string {
  return percentDecode(raw) ?? raw;
}

/**
 * Reads a token up to a `stop` character; a leading backtick keeps it a string, anything else is coerced.
 */
function parseScalar(cur: Cursor, stop: string): SearchParamValue {
  const start = cur.pos;
  while (cur.pos < cur.src.length && !stop.includes(cur.src[cur.pos])) cur.pos++;
  const token = cur.src.slice(start, cur.pos);
  if (token.startsWith('`')) return decode(token.slice(1));
  return coerceToken(decode(token));
}

/**
 * Reads an object key up to the next `:`, throwing when none follows.
 */
function parseKey(cur: Cursor): string {
  const start = cur.pos;
  while (cur.pos < cur.src.length && cur.src[cur.pos] !== ':') cur.pos++;
  if (cur.pos >= cur.src.length) throw new Error('unterminated object key');
  return decode(cur.src.slice(start, cur.pos));
}

/**
 * Consumes an over-cap subtree as raw text instead of parsing it.
 * Tracks bracket balance so the enclosing structure still closes cleanly around it.
 */
function parseFlat(cur: Cursor, stop: string): string {
  const start = cur.pos;
  let open = 0;
  while (cur.pos < cur.src.length) {
    const ch = cur.src[cur.pos];
    if (ch === '[' || ch === '{') open++;
    else if (open === 0 && stop.includes(ch)) break;
    else if (ch === ']' || ch === '}') open--;
    cur.pos++;
  }
  return decode(cur.src.slice(start, cur.pos));
}

/**
 * Parses a `[...]` array from its opening bracket; a missing `,` or `]` throws.
 */
function parseArray(cur: Cursor, depth: number): SearchParamValue[] {
  cur.pos++;
  const arr: SearchParamValue[] = [];
  if (cur.src[cur.pos] === ']') {
    cur.pos++;
    return arr;
  }
  for (;;) {
    arr.push(parseValue(cur, VALUE_STOP, depth + 1));
    const ch = cur.src[cur.pos++];
    if (ch === ']') return arr;
    if (ch !== ',') throw new Error('expected , or ] in array');
  }
}

/**
 * Parses a `{...}` object from its opening brace; a missing `,` or `}` throws.
 */
function parseObject(cur: Cursor, depth: number): SearchParamValue {
  cur.pos++;
  const obj: { [key: string]: SearchParamValue } = {};
  if (cur.src[cur.pos] === '}') {
    cur.pos++;
    return obj;
  }
  for (;;) {
    const key = parseKey(cur);
    cur.pos++;
    assign(obj, key, parseValue(cur, VALUE_STOP, depth + 1));
    const ch = cur.src[cur.pos++];
    if (ch === '}') return obj;
    if (ch !== ',') throw new Error('expected , or } in object');
  }
}

/**
 * Parses the value at the cursor, handing a structure past `maxDepth` to `parseFlat` as raw text.
 */
function parseValue(cur: Cursor, stop: string, depth: number): SearchParamValue {
  const ch = cur.src[cur.pos];
  if (ch !== '[' && ch !== '{') return parseScalar(cur, stop);
  if (depth > cur.maxDepth) return parseFlat(cur, stop);
  return ch === '[' ? parseArray(cur, depth) : parseObject(cur, depth);
}

/**
 * Parses one query value whole, falling back to its decoded text when malformed or followed by stray input.
 */
function parseTopValue(raw: string, maxDepth: number): SearchParamValue {
  if (raw === '') return '';
  const cur: Cursor = { src: raw, pos: 0, maxDepth };
  try {
    const value = parseValue(cur, '', 1);
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
 * Nesting caps at `maxDepth` levels, `32` by default; a structure past it parses as raw text.
 * A `__proto__` key lands as an own property, so it cannot pollute a prototype.
 *
 * @example
 * ```ts
 * parseSearchParams('a=1&b=hi')       // -> { a: 1, b: 'hi' }
 * parseSearchParams('list=[1,2,3]')   // -> { list: [1, 2, 3] }
 * parseSearchParams('p={x:1,y:2}')    // -> { p: { x: 1, y: 2 } }
 * parseSearchParams('t=true&t=false') // -> { t: [true, false] }
 * parseSearchParams('flag')           // -> { flag: true }
 *
 * parseSearchParams('a={b:1}', { maxDepth: 0 }) // -> { a: '{b:1}' }
 * ```
 */
export function parseSearchParams(
  input: string,
  options: ParseSearchParamsOptions = {},
): { [key: string]: SearchParamValue } {
  const { maxDepth = DEFAULT_MAX_DEPTH } = options;
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
    const value = eq === -1 ? true : parseTopValue(pair.slice(eq + 1), maxDepth);

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
