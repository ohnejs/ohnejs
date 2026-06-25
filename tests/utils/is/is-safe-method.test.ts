import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isSafeMethod } from '../../../src/utils/index.ts';

describe('isSafeMethod', () => {
  it('is true for the safe methods', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'TRACE'])
      strictEqual(isSafeMethod(method), true);
  });

  it('is false for methods with side effects', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      strictEqual(isSafeMethod(method), false);
  });

  it('is case-sensitive', () => {
    strictEqual(isSafeMethod('get'), false);
  });
});
