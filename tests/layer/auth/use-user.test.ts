import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../src/ohne/routes/route.ts';

import { hashSessionToken } from '../../../src/layer/auth/_token.ts';
import { userColumns } from '../../../src/layer/auth/_user.ts';
import { useSession } from '../../../src/layer/auth/use-session.ts';
import { useUser } from '../../../src/layer/auth/use-user.ts';
import SessionsCollection from '../../../src/layer/collections/Sessions.ts';
import UsersCollection from '../../../src/layer/collections/Users.ts';
import datePatternField from '../../../src/layer/fields/date-pattern.ts';
import languageField from '../../../src/layer/fields/language.ts';
import localeField from '../../../src/layer/fields/locale.ts';
import passwordField from '../../../src/layer/fields/password.ts';
import rolesField from '../../../src/layer/fields/roles.ts';
import timezoneField from '../../../src/layer/fields/timezone.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({ path: '/use-user-test', input: { auth: { password: { cost: 1024 } } } });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });
useCollections().register('OwnedNotes', {
  name: 'OwnedNotes',
  collection: {
    fields: {
      title: field('text'),
      owner: field('text', {
        writable: false,
        nullable: true,
        default: async () => (await useUser())?.UUID ?? null,
      }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const user = await queryUntyped('Users').createOrThrow({
  email: 'owner@example.com',
  password: 'pw-123456',
  roles: [],
});
const uuid = user.UUID as string;
const token = 'token-owner';
await queryUntyped('Sessions').createOrThrow({
  user: uuid,
  tokenHash: hashSessionToken(token),
  expiresAt: Date.now() + 60_000,
});

function route(pattern: string, handler: AnyHandler): Route {
  return { method: 'POST', pattern, file: `${pattern}.ts`, layer: 'ohnejs', handler };
}

const WHO = route('/who', async () => ({
  user: await useUser(),
  session: (await useSession())?.user ?? null,
}));
const CREATE = route('/create', () => queryUntyped('OwnedNotes').createOrThrow({ title: 'in' }));

async function call(r: Route, bearer: string | null): Promise<Record<string, unknown>> {
  const url = `http://x.test${r.pattern}`;
  const headers = new Headers();
  if (bearer !== null) headers.set('Authorization', `Bearer ${bearer}`);
  const { response } = await dispatch(
    r,
    new Request(url, { method: 'POST', headers }),
    new URL(url),
    {},
  );
  return (await response.json()) as Record<string, unknown>;
}

describe('useUser and useSession', () => {
  it('resolve null outside a request', async () => {
    strictEqual(await useUser(), null);
    strictEqual(await useSession(), null);
  });

  it('resolve the session user inside a request, settings at their defaults', async () => {
    const who = await call(WHO, token);
    deepStrictEqual(who.user, {
      UUID: uuid,
      email: 'owner@example.com',
      roles: [],
      dashboardLanguage: null,
      contentLanguage: null,
      timezone: null,
      dateFormat: 'LL',
      timeFormat: 'LTS',
      smartClipboard: false,
    });
    strictEqual(who.session, uuid);
    strictEqual((await call(WHO, null)).user, null);
  });

  it('let an ownership default read the caller inside a request and null outside', async () => {
    strictEqual((await call(CREATE, token)).owner, uuid);
    const seeded = await queryUntyped('OwnedNotes').createOrThrow({ title: 'seed' });
    strictEqual(seeded.owner, null);
  });
});

describe('userColumns', () => {
  it('names every declared user column for a read', () => {
    deepStrictEqual(userColumns(), [
      'UUID',
      'email',
      'roles',
      'dashboardLanguage',
      'contentLanguage',
      'timezone',
      'dateFormat',
      'timeFormat',
      'smartClipboard',
    ]);
  });
});
