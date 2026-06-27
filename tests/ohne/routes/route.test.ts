import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { routeID } from '../../../src/ohne/index.ts';

describe('routeID', () => {
  it('prefixes the method when present', () => {
    strictEqual(routeID('GET', '/users/[id]'), 'GET /users/[id]');
  });

  it('uses the bare pattern when the method is null', () => {
    strictEqual(routeID(null, '/users/[id]'), '/users/[id]');
  });
});
