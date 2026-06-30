import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { dashboardRoots, type OhneLayer } from '../../../src/ohne/index.ts';

describe('dashboardRoots', () => {
  it('orders each layer dashboard directory closest-first', () => {
    const dep: OhneLayer = { name: 'dep', dir: '/dep' };
    const app: OhneLayer = { name: 'app', dir: '/app' };
    deepStrictEqual(dashboardRoots([dep, app]), ['/app/dashboard', '/dep/dashboard']);
  });
});
