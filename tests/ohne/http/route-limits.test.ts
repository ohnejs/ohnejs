import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Route } from '../../../src/ohne/index.ts';

import { routeLimits, routeRateLimiter } from '../../../src/ohne/http/route-limits.ts';
import { defineHandler, useRateLimitStores } from '../../../src/ohne/index.ts';
import { DEFAULTS } from '../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';

describe('routeLimits', () => {
  it('parses byte and duration overrides', () => {
    const handler = defineHandler(() => 'ok', {
      maxBodySize: '1kb',
      handlerTimeout: '2s',
      waitUntilTimeout: '500ms',
    });
    deepStrictEqual(routeLimits(handler), {
      maxBodySize: 1024,
      handlerTimeout: 2000,
      waitUntilTimeout: 500,
    });
  });

  it('passes false through as an opt-out', () => {
    const handler = defineHandler(() => 'ok', {
      maxBodySize: false,
      handlerTimeout: false,
      waitUntilTimeout: false,
    });
    deepStrictEqual(routeLimits(handler), {
      maxBodySize: false,
      handlerTimeout: false,
      waitUntilTimeout: false,
    });
  });

  it('leaves an undeclared limit undefined', () => {
    deepStrictEqual(routeLimits(defineHandler(() => 'ok')), {
      maxBodySize: undefined,
      handlerTimeout: undefined,
      waitUntilTimeout: undefined,
    });
  });

  it('memoizes the resolved limits per handler', () => {
    const handler = defineHandler(() => 'ok', { maxBodySize: '1kb' });
    strictEqual(routeLimits(handler), routeLimits(handler));
  });
});

useLayers().add({ path: '/route-limits-defaults', defaults: DEFAULTS, input: {} });

function route(method: Route['method'], handler: Route['handler']): Route {
  return { method, pattern: '/search', file: 'search.ts', layer: 'test', handler };
}

describe('routeRateLimiter', () => {
  it('leaves a route without `rateLimit` unlimited', () => {
    strictEqual(
      routeRateLimiter(
        route(
          'GET',
          defineHandler(() => 'ok'),
        ),
      ),
      undefined,
    );
  });

  it('builds one limiter per route, counting under the route id', async () => {
    const taken: string[] = [];
    useRateLimitStores().register('recording', () => ({
      async take(key) {
        taken.push(key);
        return 0;
      },
      async reset() {},
    }));
    useLayers().add({ path: '/route-limits-app', input: { api: { rateLimitStore: 'recording' } } });
    const get = route(
      'GET',
      defineHandler(() => 'ok', { rateLimit: { limit: 2, window: '1m' } }),
    );
    strictEqual(routeRateLimiter(get), routeRateLimiter(get));
    await routeRateLimiter(get)?.hit('thrall');
    useLayers().remove('/route-limits-app');
    useRateLimitStores().delete('recording');
    deepStrictEqual(taken, ['["ohne:GET /search","thrall"]']);
  });
});
