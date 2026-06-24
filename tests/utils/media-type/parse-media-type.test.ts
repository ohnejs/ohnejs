import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseMediaType } from '../../../src/utils/index.ts';

describe('parseMediaType', () => {
  it('splits essence from parameters', () => {
    deepStrictEqual(parseMediaType('text/html; charset=utf-8'), {
      type: 'text/html',
      parameters: { charset: 'utf-8' },
    });
  });

  it('lowercases the essence and parameter names but not values', () => {
    deepStrictEqual(parseMediaType('Text/HTML; Charset=UTF-8'), {
      type: 'text/html',
      parameters: { charset: 'UTF-8' },
    });
  });

  it('preserves a case-sensitive boundary value', () => {
    deepStrictEqual(parseMediaType('multipart/form-data; boundary=AbCdEf'), {
      type: 'multipart/form-data',
      parameters: { boundary: 'AbCdEf' },
    });
  });

  it('unwraps a quoted value and keeps a semicolon inside it', () => {
    deepStrictEqual(parseMediaType('multipart/form-data; boundary="--; x"'), {
      type: 'multipart/form-data',
      parameters: { boundary: '--; x' },
    });
  });

  it('honors a backslash escape inside a quoted value', () => {
    deepStrictEqual(parseMediaType('text/plain; note="a\\"b"'), {
      type: 'text/plain',
      parameters: { note: 'a"b' },
    });
  });

  it('reads multiple parameters', () => {
    deepStrictEqual(parseMediaType('text/plain; charset=utf-8; format=flowed'), {
      type: 'text/plain',
      parameters: { charset: 'utf-8', format: 'flowed' },
    });
  });

  it('keeps the first occurrence of a duplicate parameter', () => {
    deepStrictEqual(parseMediaType('text/plain; a=1; a=2'), {
      type: 'text/plain',
      parameters: { a: '1' },
    });
  });

  it('ignores valueless and blank parameter segments', () => {
    deepStrictEqual(parseMediaType('text/plain; ; charset=utf-8; boundary'), {
      type: 'text/plain',
      parameters: { charset: 'utf-8' },
    });
  });

  it('returns an empty essence for a blank header', () => {
    deepStrictEqual(parseMediaType(''), { type: '', parameters: {} });
  });

  it('lands a __proto__ parameter as an own property without polluting', () => {
    const { parameters } = parseMediaType('text/plain; __proto__=evil');
    deepStrictEqual(parameters.__proto__, 'evil');
    strictEqual(Object.getPrototypeOf({}), Object.prototype);
  });
});
