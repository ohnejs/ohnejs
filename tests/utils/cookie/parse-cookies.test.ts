import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseCookies } from '../../../src/utils/index.ts';

describe('parseCookies', () => {
  it('parses name=value pairs into a map', () => {
    deepStrictEqual(parseCookies('id=42; theme=dark'), { id: '42', theme: 'dark' });
  });

  it('trims whitespace and decodes percent-encoded values', () => {
    deepStrictEqual(parseCookies(' q = a%20b '), { q: 'a b' });
  });

  it('strips a single pair of surrounding double quotes', () => {
    deepStrictEqual(parseCookies('name="value"'), { name: 'value' });
  });

  it('keeps the first occurrence of a duplicate name', () => {
    deepStrictEqual(parseCookies('a=1; a=2'), { a: '1' });
  });

  it('leaves a malformed percent-sequence raw', () => {
    deepStrictEqual(parseCookies('x=%E0%A4%A'), { x: '%E0%A4%A' });
  });

  it('ignores segments without a value and blank input', () => {
    deepStrictEqual(parseCookies('a=1; ; b'), { a: '1' });
    deepStrictEqual(parseCookies(''), {});
  });

  it('lands a __proto__ name as an own property without polluting', () => {
    const cookies = parseCookies('__proto__=evil');
    deepStrictEqual(cookies.__proto__, 'evil');
    strictEqual(Object.getPrototypeOf({}), Object.prototype);
  });
});
