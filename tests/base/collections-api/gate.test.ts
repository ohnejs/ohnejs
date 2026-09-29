import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../src/ohne/routes/route.ts';

import { hashSessionToken } from '../../../src/base/auth/_token.ts';
import { readReach, readScope } from '../../../src/base/collections-api/gate.ts';
import SessionsCollection from '../../../src/base/collections/Sessions.ts';
import UsersCollection from '../../../src/base/collections/Users.ts';
import datePatternField from '../../../src/base/fields/date-pattern.ts';
import languageField from '../../../src/base/fields/language.ts';
import localeField from '../../../src/base/fields/locale.ts';
import passwordField from '../../../src/base/fields/password.ts';
import rolesField from '../../../src/base/fields/roles.ts';
import timezoneField from '../../../src/base/fields/timezone.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { unauthorized } from '../../../src/ohne/http/http-error.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { useMiddleware } from '../../../src/ohne/middleware/use-middleware.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({ path: '/gate-test', input: { auth: { password: { cost: 1024 } } } });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });

useRoles().register('gate-reader', {
  name: 'gate-reader',
  role: { capabilities: ['collection.GateNotes.read'] },
});

let middlewareRuns = 0;
useMiddleware().register('gate-count', () => void (middlewareRuns += 1));
useMiddleware().register('gate-block', () => unauthorized());

useCollections().register('GateScoped', {
  name: 'GateScoped',
  collection: {
    api: {
      read: {
        public: true,
        middleware: ['gate-count'],
        access: () => ({ where: { shown: true }, select: ['title'] }),
      },
    },
    fields: { title: field('text'), shown: field('boolean') },
  },
});
useCollections().register('GateNotes', {
  name: 'GateNotes',
  collection: { api: { read: true }, fields: { title: field('text') } },
});
useCollections().register('GateClosed', {
  name: 'GateClosed',
  collection: { api: { update: 'public' }, fields: { title: field('text') } },
});
useCollections().register('GateRefused', {
  name: 'GateRefused',
  collection: {
    api: { read: { public: true, access: () => false } },
    fields: { title: field('text') },
  },
});
useCollections().register('GateRefusing', {
  name: 'GateRefusing',
  collection: {
    api: {
      read: {
        public: true,
        access: () => {
          throw unauthorized();
        },
      },
    },
    fields: { title: field('text') },
  },
});
useCollections().register('GateBroken', {
  name: 'GateBroken',
  collection: {
    api: {
      read: {
        public: true,
        access: () => {
          throw new TypeError('broken scope');
        },
      },
    },
    fields: { title: field('text') },
  },
});
useCollections().register('GateBlocked', {
  name: 'GateBlocked',
  collection: {
    api: { read: { public: true, middleware: ['gate-block'] } },
    fields: { title: field('text') },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

async function userWith(email: string, roles: string[]): Promise<string> {
  const record = await queryUntyped('Users').createOrThrow({ email, password: 'pw-123456', roles });
  const token = `token-${email}`;
  await queryUntyped('Sessions').createOrThrow({
    user: record.UUID as string,
    tokenHash: hashSessionToken(token),
    expiresAt: Date.now() + 60_000,
  });
  return token;
}

const reader = await userWith('reader@example.com', ['gate-reader']);
const outsider = await userWith('outsider@example.com', []);

function route(pattern: string, handler: unknown): Route {
  return {
    method: 'POST',
    pattern,
    file: `${pattern}.ts`,
    layer: 'ohnejs/base',
    handler: handler as AnyHandler,
  };
}

const SCOPE = route(
  '/scope/[collection]',
  async ({ params }: { params: { collection: string } }) => ({
    scope: await readScope(params.collection),
  }),
);
const REACH = route(
  '/reach/[collection]',
  async ({ params }: { params: { collection: string } }) => ({
    scope: await readReach(params.collection),
  }),
);

async function ask(
  r: Route,
  collection: string,
  bearer: string | null = null,
): Promise<{ status: number; scope: unknown }> {
  const url = `http://x.test${r.pattern.replace('[collection]', collection)}`;
  const headers = new Headers();
  if (bearer !== null) headers.set('Authorization', `Bearer ${bearer}`);
  const request = new Request(url, { method: 'POST', headers });
  const { response } = await dispatch(r, request, new URL(url), { collection });
  const body = (await response.json()) as { scope?: unknown };
  return { status: response.status, scope: body.scope };
}

describe('readScope', () => {
  it('answers the read scope without running the read middleware, which readReach runs', async () => {
    middlewareRuns = 0;
    const scope = { where: { shown: true }, select: ['title'] };
    deepStrictEqual(await ask(SCOPE, 'GateScoped'), { status: 200, scope });
    strictEqual(middlewareRuns, 0);
    deepStrictEqual((await ask(REACH, 'GateScoped')).scope, scope);
    strictEqual(middlewareRuns, 1);
  });

  it('reaches a read whose middleware would answer, which readReach does not', async () => {
    deepStrictEqual((await ask(SCOPE, 'GateBlocked')).scope, {});
    strictEqual((await ask(REACH, 'GateBlocked')).scope, false);
  });

  it('reaches nothing into an unknown, a closed, or a refused read', async () => {
    strictEqual((await ask(SCOPE, 'GateNothing')).scope, false);
    strictEqual((await ask(SCOPE, 'GateClosed')).scope, false);
    strictEqual((await ask(SCOPE, 'GateRefused')).scope, false);
  });

  it('guards a read by capability: the holder reaches, an outsider and a guest do not', async () => {
    deepStrictEqual((await ask(SCOPE, 'GateNotes', reader)).scope, {});
    strictEqual((await ask(SCOPE, 'GateNotes', outsider)).scope, false);
    strictEqual((await ask(SCOPE, 'GateNotes')).scope, false);
  });

  it('reaches nothing when the resolver throws an HTTPError and 500s on anything else', async () => {
    strictEqual((await ask(SCOPE, 'GateRefusing')).scope, false);
    strictEqual((await ask(SCOPE, 'GateBroken')).status, 500);
  });
});
