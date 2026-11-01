import { deepStrictEqual } from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { Routes } from '../../src/base/ohne.contract.ts';

import { DEFAULT_ACCOUNT_LAYOUT } from '../../src/base/auth/account-layout.ts';
import { collectRoutes } from '../../src/ohne/routes/collect-routes.ts';
import { routeID } from '../../src/ohne/routes/route.ts';
import { layoutFieldNames } from '../../src/utils/index.ts';

const BASE = join(import.meta.dirname, '..', '..', 'src', 'base');

describe('ohnejs/base contract', () => {
  it('declares every `/auth` route the layer serves', async () => {
    const declared: Record<keyof Routes, true> = {
      'POST /auth/login': true,
      'POST /auth/logout': true,
      'POST /auth/logout/others': true,
      'GET /auth/me': true,
      'PATCH /auth/me': true,
      'GET /auth/install': true,
      'POST /auth/install': true,
    };
    const served = (await collectRoutes([{ name: 'base', dir: BASE }]))
      .map((route) => routeID(route.method, route.pattern))
      .filter((id) => id.includes(' /auth/'));

    deepStrictEqual(Object.keys(declared).sort(), served.sort());
  });

  it('types the `PATCH /auth/me` body as the fields the default account layout places', () => {
    const declared: Record<keyof Routes['PATCH /auth/me']['body'], true> = {
      firstName: true,
      lastName: true,
      contentLanguage: true,
      dashboardLanguage: true,
      timezone: true,
      dateFormat: true,
      timeFormat: true,
      smartClipboard: true,
      password: true,
    };

    deepStrictEqual(Object.keys(declared).sort(), layoutFieldNames(DEFAULT_ACCOUNT_LAYOUT).sort());
  });
});
