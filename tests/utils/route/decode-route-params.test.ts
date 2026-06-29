import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { decodeRouteParams } from '../../../src/utils/index.ts';

describe('decodeRouteParams', () => {
  it('URI-decodes percent-encoded values', () => {
    deepStrictEqual(decodeRouteParams({ name: 'a%20b' }), { name: 'a b' });
  });

  it('passes through values without a percent sign', () => {
    deepStrictEqual(decodeRouteParams({ id: '42' }), { id: '42' });
  });

  it('leaves a malformed percent-sequence as its raw value', () => {
    deepStrictEqual(decodeRouteParams({ x: '%zz' }), { x: '%zz' });
  });
});
