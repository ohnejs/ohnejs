import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { defineMiddleware } from '../../../src/ohne/index.ts';

describe('defineMiddleware', () => {
  it('returns the middleware unchanged', () => {
    const middleware = () => undefined;
    strictEqual(defineMiddleware(middleware), middleware);
  });
});
