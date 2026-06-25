import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { isIdempotentMethod } from '../../../src/utils/index.ts';

describe('isIdempotentMethod', () => {
  it('is true for the safe methods and PUT and DELETE', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'TRACE', 'PUT', 'DELETE'])
      strictEqual(isIdempotentMethod(method), true);
  });

  it('is false for POST and PATCH', () => {
    strictEqual(isIdempotentMethod('POST'), false);
    strictEqual(isIdempotentMethod('PATCH'), false);
  });

  it('is case-sensitive', () => {
    strictEqual(isIdempotentMethod('put'), false);
  });
});
