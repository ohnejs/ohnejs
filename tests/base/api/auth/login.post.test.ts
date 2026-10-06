import type { AddressInfo } from 'node:net';

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { once } from 'node:events';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import loginHandler from '../../../../src/base/api/auth/login.post.ts';
import SessionsCollection from '../../../../src/base/collections/Sessions.ts';
import UsersCollection from '../../../../src/base/collections/Users.ts';
import datePatternField from '../../../../src/base/fields/date-pattern.ts';
import languageField from '../../../../src/base/fields/language.ts';
import localeField from '../../../../src/base/fields/locale.ts';
import passwordField from '../../../../src/base/fields/password.ts';
import rolesField from '../../../../src/base/fields/roles.ts';
import timezoneField from '../../../../src/base/fields/timezone.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { createRouter } from '../../../../src/ohne/http/router.ts';
import { createServer } from '../../../../src/ohne/http/server.ts';
import { DEFAULTS } from '../../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';

usePrinter().configure({ stream: { write: () => true } });
useLayers().add({ path: '/login-test', defaults: DEFAULTS, input: {} });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const login: Route = {
  method: 'POST',
  pattern: '/auth/login',
  file: '/auth/login.ts',
  layer: 'ohnejs/base',
  handler: loginHandler as AnyHandler,
};

async function attempt(
  ip: string,
  signal?: AbortSignal,
  email = 'thrall@horde.gg',
): Promise<Response> {
  const request = new Request('http://localhost/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'lok-tar' }),
    signal,
  });
  const { response } = await dispatch(login, request, new URL(request.url), {}, { ip });
  return response;
}

describe('POST /auth/login', () => {
  it('answers 503 with Retry-After to a second login from an IP already checking one', async () => {
    const [first, second] = await Promise.all([attempt('203.0.113.7'), attempt('203.0.113.7')]);
    deepStrictEqual([first.status, second.status].sort(), [401, 503]);
    strictEqual((first.status === 503 ? first : second).headers.get('Retry-After'), '1');

    strictEqual((await attempt('203.0.113.7')).status, 401);
  });

  it('keeps the permit of a client that goes away until its check settles', async () => {
    const controller = new AbortController();
    const first = attempt('203.0.113.8', controller.signal);
    await new Promise(setImmediate);
    controller.abort();

    strictEqual((await attempt('203.0.113.8')).status, 503);
    await first;
  });

  it('answers 429 past ten attempts a minute from one IP', async () => {
    for (let i = 0; i < 10; i++)
      strictEqual((await attempt('198.51.100.1', undefined, `grunt-${i}@horde.gg`)).status, 401);
    const refused = await attempt('198.51.100.1', undefined, 'grunt-10@horde.gg');
    strictEqual(refused.status, 429);
    const retryAfter = Number(refused.headers.get('Retry-After'));
    ok(retryAfter >= 1 && retryAfter <= 6);
    strictEqual((await attempt('198.51.100.2', undefined, 'grunt-10@horde.gg')).status, 401);
  });

  it('answers 413 to a body past 4 KB', async () => {
    const { server } = createServer(createRouter([login]), {
      maxBodySize: DEFAULTS.api.maxBodySize,
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'thrall@horde.gg', password: 'x'.repeat(5 * 1024) }),
        },
      );
      strictEqual(response.status, 413);
    } finally {
      server.close();
      server.closeAllConnections();
    }
  });
});
