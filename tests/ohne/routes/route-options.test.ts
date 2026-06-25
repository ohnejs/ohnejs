import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { defineHandler } from '../../../src/ohne/index.ts';
import { getRouteOptions } from '../../../src/ohne/routes/route-options.ts';

describe('route options', () => {
  it('round-trips options attached through defineHandler', () => {
    const handler = defineHandler(() => 'ok', { maxBodySize: '1mb', handlerTimeout: '5s' });
    deepStrictEqual(getRouteOptions(handler), { maxBodySize: '1mb', handlerTimeout: '5s' });
  });

  it('returns undefined when no options were declared', () => {
    strictEqual(getRouteOptions(defineHandler(() => 'ok')), undefined);
  });

  it('stores options without adding an enumerable key', () => {
    const handler = defineHandler(() => 'ok', { maxBodySize: 1 });
    deepStrictEqual(Object.keys(handler), []);
    deepStrictEqual(handler({ params: {} }), 'ok');
  });
});
