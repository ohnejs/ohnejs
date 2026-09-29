import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { tierOf } from '../../../src/ai/turns/tiers.ts';
import { withAI } from '../_fixture.ts';

describe('tierOf', () => {
  it('reads the default table, and answers `undefined` for a route it never names', async () => {
    await withAI(undefined, () => {
      strictEqual(tierOf('POST', '/collections/[collection]/query'), 'read');
      strictEqual(tierOf('PATCH', '/collections/[collection]/[uuid]'), 'write');
      strictEqual(tierOf('DELETE', '/collections/[collection]/[uuid]'), 'destructive');
      strictEqual(
        tierOf('POST', '/collections/[collection]/[uuid]/translations/copy'),
        'destructive',
      );
      strictEqual(tierOf('GET', '/collections/[collection]'), undefined);
      strictEqual(tierOf('GET', '/reports'), undefined);
    });
  });

  it('lets the first matching key win, in object order, and `false` forbid', async () => {
    await withAI(
      {
        routes: {
          'DELETE /collections/**': false,
          '/collections/**': 'write',
          'GET /reports/[id]': 'read',
        },
      },
      () => {
        strictEqual(tierOf('DELETE', '/collections/[collection]/[uuid]'), false);
        strictEqual(tierOf('PATCH', '/collections/[collection]/[uuid]'), 'write');
        strictEqual(tierOf('POST', '/collections/[collection]/query'), 'write');
        strictEqual(tierOf('GET', '/reports/[id]'), 'read');
        strictEqual(tierOf('POST', '/reports/[id]'), undefined);
      },
    );
  });

  it('never opens `/auth/**` or `/ai/**`, whatever the table says', async () => {
    await withAI({ routes: { '/**': 'read' } }, () => {
      strictEqual(tierOf('POST', '/auth/login'), false);
      strictEqual(tierOf('GET', '/auth/me'), false);
      strictEqual(tierOf('POST', '/ai/turns'), false);
      strictEqual(tierOf('POST', '/ai/turns/[id]/results'), false);
      strictEqual(tierOf('GET', '/items'), 'read');
    });
  });
});
