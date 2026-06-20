import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { routeId } from '../../../src/ohne/index.ts';

describe('routeId', () => {
  it('prefixes the method when present', () => {
    strictEqual(routeId('GET', '/users/[id]'), 'GET /users/[id]');
  });

  it('uses the bare pattern when the method is null', () => {
    strictEqual(routeId(null, '/users/[id]'), '/users/[id]');
  });
});
