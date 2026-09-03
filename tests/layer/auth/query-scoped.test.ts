import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { CollectionOperation } from '../../../src/ohne/collections/define-collection.ts';
import type { AnyHandler, Route } from '../../../src/ohne/routes/route.ts';

import { hashSessionToken } from '../../../src/layer/auth/_token.ts';
import { queryScoped } from '../../../src/layer/auth/query-scoped.ts';
import { useUser } from '../../../src/layer/auth/use-user.ts';
import SessionsCollection from '../../../src/layer/collections/Sessions.ts';
import UsersCollection from '../../../src/layer/collections/Users.ts';
import passwordField from '../../../src/layer/fields/password.ts';
import rolesField from '../../../src/layer/fields/roles.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { readJSONBody } from '../../../src/ohne/http/read-json-body.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { useRoles } from '../../../src/ohne/roles/use-roles.ts';
import { isNull } from '../../../src/utils/index.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({
  path: '/query-scoped-test',
  input: {
    auth: { password: { cost: 1024 } },
    collections: { locales: ['en', 'de'], defaultLocale: 'en' },
  },
});

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });
useRoles().register('scoped-reader', {
  name: 'scoped-reader',
  role: { capabilities: ['collection.ScopedNotes.read'] },
});

const contexts: unknown[] = [];
useCollections().register('ScopedNotes', {
  name: 'ScopedNotes',
  collection: {
    api: {
      read: {
        access: async () => {
          const user = await useUser();
          return isNull(user) ? false : { where: { owner: user.UUID }, select: ['title'] };
        },
      },
      create: {
        public: true,
        access: (context) => (contexts.push(context), { where: { owner: 'nobody' } }),
      },
      update: {
        public: true,
        access: (context) => (contexts.push(context), { where: { owner: 'nobody' } }),
      },
      delete: {
        public: true,
        access: () => ({ where: { owner: 'nobody' }, select: ['title'], limit: 1, locale: 'en' }),
      },
    },
    fields: {
      title: field('text', { translatable: true }),
      owner: field('text'),
      note: field('text'),
    },
  },
});
useCollections().register('ScopedRefused', {
  name: 'ScopedRefused',
  collection: {
    api: { read: { public: true, access: () => false } },
    fields: { title: field('text') },
  },
});
useCollections().register('ScopedClosed', {
  name: 'ScopedClosed',
  collection: { fields: { title: field('text') } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

async function userWith(email: string, roles: string[]): Promise<{ uuid: string; token: string }> {
  const record = await queryUntyped('Users').createOrThrow({ email, password: 'pw-123456', roles });
  const token = `token-${email}`;
  await queryUntyped('Sessions').createOrThrow({
    user: record.UUID as string,
    tokenHash: hashSessionToken(token),
    expiresAt: Date.now() + 60_000,
  });
  return { uuid: record.UUID as string, token };
}

const reader = await userWith('reader@example.com', ['scoped-reader']);
const stranger = await userWith('stranger@example.com', []);
await queryUntyped('ScopedNotes').createOrThrow({ title: 'Mine', owner: reader.uuid, note: 'n' });
await queryUntyped('ScopedNotes').createOrThrow({
  title: 'Theirs',
  owner: stranger.uuid,
  note: 'n',
});

interface Ask {
  collection: string;
  operation: CollectionOperation;
  input?: Record<string, unknown>;
}

const handler: AnyHandler = async () => {
  const ask = await readJSONBody<Ask>();
  const builder = await queryScoped(ask.collection, ask.operation, ask.input);
  return ask.operation === 'delete' ? builder.delete() : builder.findMany();
};

const ROUTE: Route = {
  method: 'POST',
  pattern: '/scoped',
  file: '/scoped.ts',
  layer: 'ohne',
  handler,
};

async function call(bearer: string | null, ask: Ask): Promise<{ status: number; body: unknown }> {
  const url = 'http://x.test/scoped';
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (bearer !== null) headers.set('Authorization', `Bearer ${bearer}`);
  const request = new Request(url, { method: 'POST', headers, body: JSON.stringify(ask) });
  const { response } = await dispatch(ROUTE, request, new URL(url), {});
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

describe('queryScoped', () => {
  it('404s a closed operation and an unknown collection alike', async () => {
    strictEqual((await call(null, { collection: 'ScopedClosed', operation: 'read' })).status, 404);
    strictEqual((await call(null, { collection: 'NoSuch', operation: 'read' })).status, 404);
  });

  it('guards a non-public operation: no user 401, no capability 403', async () => {
    strictEqual((await call(null, { collection: 'ScopedNotes', operation: 'read' })).status, 401);
    const denied = await call(stranger.token, { collection: 'ScopedNotes', operation: 'read' });
    strictEqual(denied.status, 403);
  });

  it('composes the resolved scope onto the builder', async () => {
    const { status, body } = await call(reader.token, {
      collection: 'ScopedNotes',
      operation: 'read',
    });
    strictEqual(status, 200);
    deepStrictEqual(body, [{ title: 'Mine' }]);
  });

  it('404s a false verdict', async () => {
    strictEqual((await call(null, { collection: 'ScopedRefused', operation: 'read' })).status, 404);
  });

  it('ANDs a delete scope where in and nothing else, so the delete runs', async () => {
    const { status, body } = await call(null, { collection: 'ScopedNotes', operation: 'delete' });
    strictEqual(status, 200);
    deepStrictEqual(body, { deleted: 0 });
    strictEqual((await queryUntyped('ScopedNotes').findMany()).length, 2);
  });

  it('hands an update its input, judging an empty write when none is given', async () => {
    contexts.length = 0;
    const scoped = await call(null, {
      collection: 'ScopedNotes',
      operation: 'update',
      input: { title: 'x' },
    });
    deepStrictEqual(scoped.body, []);
    await call(null, { collection: 'ScopedNotes', operation: 'update' });
    deepStrictEqual(contexts, [
      { operation: 'update', input: { title: 'x' } },
      { operation: 'update', input: {} },
    ]);
  });

  it('leaves a create bare: its verdict alone applies', async () => {
    contexts.length = 0;
    const { body } = await call(null, {
      collection: 'ScopedNotes',
      operation: 'create',
      input: { title: 'y' },
    });
    strictEqual((body as unknown[]).length, 2);
    deepStrictEqual(contexts, [{ operation: 'create', input: { title: 'y' } }]);
  });
});
