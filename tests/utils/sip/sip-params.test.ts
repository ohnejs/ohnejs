import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { parseSIPParams } from '../../../src/utils/index.ts';

describe('parseSIPParams', () => {
  it('lowercases names, maps a flag to an empty value, and keeps the first of each name', () => {
    deepStrictEqual(parseSIPParams(';Branch=z9hG4bK776; rport ;branch=other;received=10.0.0.1'), {
      branch: 'z9hG4bK776',
      rport: '',
      received: '10.0.0.1',
    });
  });

  it('unwraps quoted values with escapes', () => {
    deepStrictEqual(parseSIPParams('a="x;y \\"z\\"";b=1'), { a: 'x;y "z"', b: '1' });
  });

  it('lands `__proto__` as an own property', () => {
    const params = parseSIPParams('__proto__=x');
    strictEqual(Object.hasOwn(params, '__proto__'), true);
    strictEqual(Object.getPrototypeOf(params), Object.prototype);
  });

  it('reads nothing from an empty text', () => {
    deepStrictEqual(parseSIPParams(''), {});
    deepStrictEqual(parseSIPParams(';;'), {});
  });
});
