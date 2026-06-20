import { strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { defineHandler, type Handler, useAPI, useRoutes } from '../../../src/ohne/index.ts';

describe('useAPI', () => {
  afterEach(() => useRoutes().clear());

  it('stores a handler that narrows its context', () => {
    const handler = defineHandler(({ params }: { params: { id: string } }) => ({ id: params.id }));
    // Compiles only if a narrowed handler is assignable to the registry's erased handler type.
    useRoutes().register('GET /users/[id]', {
      method: 'GET',
      pattern: '/users/[id]',
      file: '/app/api/users/[id].get.ts',
      layer: 'app',
      handler,
    });
    strictEqual(useAPI()['GET /users/[id]'].handler, handler);
  });

  it('exposes registered routes by id with their metadata', () => {
    const handler: Handler = ({ params }) => params;
    useRoutes().register('GET /users/[id]', {
      method: 'GET',
      pattern: '/users/[id]',
      file: '/app/api/users/[id].get.ts',
      layer: 'app',
      handler,
    });

    const api = useAPI();
    strictEqual(api['GET /users/[id]'].pattern, '/users/[id]');
    strictEqual(api['GET /users/[id]'].method, 'GET');
    strictEqual(api['GET /users/[id]'].handler, handler);
  });

  it('reflects a closer layer overriding a route id', () => {
    const base: Handler = () => 'base';
    const closer: Handler = () => 'closer';
    const meta = { method: 'GET', pattern: '/x', file: '/x.ts' } as const;

    useRoutes().register('GET /x', { ...meta, layer: 'dep', handler: base });
    useRoutes().register('GET /x', { ...meta, layer: 'app', handler: closer });

    strictEqual(useAPI()['GET /x'].layer, 'app');
    strictEqual(useAPI()['GET /x'].handler, closer);
  });
});
