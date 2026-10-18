import { deepStrictEqual, notStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import duplicatePost from '../../../../src/base/api/collections/[collection]/[uuid]/duplicate.post.ts';
import { hashSessionToken } from '../../../../src/base/auth/_token.ts';
import SessionsCollection from '../../../../src/base/collections/Sessions.ts';
import UsersCollection from '../../../../src/base/collections/Users.ts';
import datePatternField from '../../../../src/base/fields/date-pattern.ts';
import languageField from '../../../../src/base/fields/language.ts';
import localeField from '../../../../src/base/fields/locale.ts';
import passwordField from '../../../../src/base/fields/password.ts';
import rolesField from '../../../../src/base/fields/roles.ts';
import timezoneField from '../../../../src/base/fields/timezone.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { useRoles } from '../../../../src/ohne/roles/use-roles.ts';
import { connectTest, dialect } from '../../../_dialect.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({
  path: '/duplicate-route',
  input: {
    auth: { password: { cost: 1024 } },
    collections: { locales: ['en', 'de', 'fr'], defaultLocale: 'en' },
  },
});

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });
useRoles().register('admin', { name: 'admin', role: { capabilities: ['*'] } });
useRoles().register('reader', {
  name: 'reader',
  role: { capabilities: ['collection.DpPosts.read'] },
});
useRoles().register('maker', {
  name: 'maker',
  role: { capabilities: ['collection.DpPosts.create'] },
});

useCollections().register('DpPosts', {
  name: 'DpPosts',
  collection: {
    api: { read: true, create: true },
    fields: {
      title: field('text', { translatable: true }),
      slug: field('text', {
        translatable: true,
        unique: true,
        uniquePerLocale: true,
        nullable: true,
      }),
      code: field('text', { unique: true, nullable: true }),
      views: field('integer', { default: 0 }),
    },
  },
});
const contexts: Record<string, unknown>[] = [];
useCollections().register('DpScoped', {
  name: 'DpScoped',
  collection: {
    api: {
      read: {
        public: true,
        access: () => ({ where: { status: 'open' }, select: ['title', 'status', '_translations'] }),
      },
      create: {
        public: true,
        access: ({ input }) => (
          contexts.push(input),
          input.title !== 'Nein' && { select: ['title'] }
        ),
      },
    },
    fields: {
      title: field('text', { translatable: true }),
      status: field('text'),
      note: field('text', { nullable: true }),
    },
  },
});
useCollections().register('DpRequired', {
  name: 'DpRequired',
  collection: {
    api: { read: 'public', create: 'public' },
    fields: {
      title: field('text', { translatable: true }),
      slug: field('text', { translatable: true, unique: true, uniquePerLocale: true }),
    },
  },
});
useCollections().register('DpTargets', {
  name: 'DpTargets',
  collection: {
    api: { read: { public: true, access: () => ({ where: { name: 'visible' } }) } },
    fields: { name: field('text') },
  },
});
useCollections().register('DpLinks', {
  name: 'DpLinks',
  collection: {
    api: { read: 'public', create: 'public' },
    fields: {
      label: field('text'),
      target: field('record', { collection: 'DpTargets' }),
    },
  },
});
useCollections().register('DpTranslatedLinks', {
  name: 'DpTranslatedLinks',
  collection: {
    api: { read: 'public', create: 'public' },
    fields: { target: field('record', { collection: 'DpTargets', translatable: true }) },
  },
});
useCollections().register('DpFiles', {
  name: 'DpFiles',
  collection: {
    api: { read: 'public', create: 'public' },
    duplicate: false,
    fields: { label: field('text') },
  },
});
useCollections().register('DpWriteOnly', {
  name: 'DpWriteOnly',
  collection: { api: { create: 'public' }, fields: { label: field('text') } },
});
useCollections().register('DpSingle', {
  name: 'DpSingle',
  collection: {
    singleton: true,
    api: { read: 'public', update: 'public' },
    fields: { motto: field('text', { default: '' }) },
  },
});

const db = await connectTest();
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

const admin = await userWith('admin@example.com', ['admin']);
const reader = await userWith('reader@example.com', ['reader']);
const maker = await userWith('maker@example.com', ['maker']);

const post = (
  await queryUntyped('DpPosts').createOrThrow(
    { title: 'Hello', slug: 'hello', code: 'c1', views: 4 },
    { locales: { de: { title: 'Hallo', slug: 'hallo' } } },
  )
).UUID as string;
const open = (
  await queryUntyped('DpScoped').createOrThrow(
    { title: 'Open', status: 'open', note: 'secret' },
    { locales: { de: { title: 'Offen' } } },
  )
).UUID as string;
const closed = (await queryUntyped('DpScoped').createOrThrow({ title: 'Closed', status: 'closed' }))
  .UUID as string;
const refused = (
  await queryUntyped('DpScoped').createOrThrow(
    { title: 'Yes', status: 'open' },
    { locales: { de: { title: 'Nein' } } },
  )
).UUID as string;
const required = (
  await queryUntyped('DpRequired').createOrThrow(
    { title: 'News', slug: 'news' },
    { locales: { de: { title: 'Neues', slug: 'neues' } } },
  )
).UUID as string;
const visible = (await queryUntyped('DpTargets').createOrThrow({ name: 'visible' })).UUID as string;
const hidden = (await queryUntyped('DpTargets').createOrThrow({ name: 'hidden' })).UUID as string;
const linksVisible = (await queryUntyped('DpLinks').createOrThrow({ label: 'ok', target: visible }))
  .UUID as string;
const linksHidden = (await queryUntyped('DpLinks').createOrThrow({ label: 'no', target: hidden }))
  .UUID as string;
const translatedLinks = (
  await queryUntyped('DpTranslatedLinks').createOrThrow(
    { target: visible },
    { locales: { de: { target: hidden } } },
  )
).UUID as string;
const file = (await queryUntyped('DpFiles').createOrThrow({ label: 'f' })).UUID as string;
const writeOnly = (await queryUntyped('DpWriteOnly').createOrThrow({ label: 'x' })).UUID as string;
const single = (await queryUntyped('DpSingle').findFirst())?.UUID as string;

const ROUTE: Route = {
  method: 'POST',
  pattern: '/collections/[collection]/[uuid]/duplicate',
  file: '/collections/[collection]/[uuid]/duplicate.ts',
  layer: 'ohnejs/base',
  handler: duplicatePost as AnyHandler,
};

async function call(
  collection: string,
  uuid: string,
  init: { body?: unknown; qs?: string; bearer?: string } = { body: {} },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = `http://x.test/collections/${collection}/${uuid}/duplicate${init.qs ?? ''}`;
  const headers = new Headers();
  if (init.bearer !== undefined) headers.set('Authorization', `Bearer ${init.bearer}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const request = new Request(url, {
    method: 'POST',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const { response } = await dispatch(ROUTE, request, new URL(url), { collection, uuid });
  const text = await response.text();
  return { status: response.status, body: text === '' ? {} : JSON.parse(text) };
}

function errorsOf(body: Record<string, unknown>): string[] {
  return Object.keys((body.data as { errors: Record<string, string> }).errors);
}

describe('POST /collections/[collection]/[uuid]/duplicate', () => {
  it('copies every held locale into a new record and answers 201', async () => {
    const { status, body } = await call('dp-posts', post, { body: {}, bearer: admin.token });
    strictEqual(status, 201);
    notStrictEqual(body.UUID, post);
    strictEqual(body.title, 'Hello');
    strictEqual(body.slug, null);
    strictEqual(body.code, null);
    strictEqual(body.views, 4);
    deepStrictEqual(body._translations, ['en', 'de']);
    const de = await queryUntyped('DpPosts').locale('de').where({ UUID: body.UUID }).findFirst();
    strictEqual(de?.title, 'Hallo');
  });

  it('lands the body at `?locale=` and creates the copy there', async () => {
    const { status, body } = await call('dp-posts', post, {
      body: { title: 'Kopie', slug: 'kopie' },
      qs: '?locale=de',
      bearer: admin.token,
    });
    strictEqual(status, 201);
    strictEqual(body.title, 'Kopie');
    strictEqual(body.slug, 'kopie');
  });

  it('needs both read and create', async () => {
    strictEqual((await call('dp-posts', post, { body: {} })).status, 401);
    strictEqual((await call('dp-posts', post, { body: {}, bearer: reader.token })).status, 403);
    strictEqual((await call('dp-posts', post, { body: {}, bearer: maker.token })).status, 404);
  });

  it('answers the identical 404 for whatever it cannot reach', async () => {
    const missing = '00000000-0000-7000-8000-000000000000';
    strictEqual((await call('dp-posts', missing, { body: {}, bearer: admin.token })).status, 404);
    strictEqual((await call('dp-scoped', closed)).status, 404);
    strictEqual((await call('dp-write-only', writeOnly)).status, 404);
    strictEqual((await call('dp-single', single)).status, 404);
    strictEqual((await call('dp-files', file)).status, 404);
    strictEqual((await call('dp-nope', post)).status, 404);
  });

  it('copies only what the read scope selects', async () => {
    const before = new Set((await queryUntyped('DpScoped').pluck('UUID')) as string[]);
    strictEqual((await call('dp-scoped', open)).status, 201);
    const rows = await queryUntyped('DpScoped').findMany();
    const copy = rows.find((row) => !before.has(row.UUID as string));
    strictEqual(copy?.note, null);
    strictEqual(copy?.status, 'open');
    deepStrictEqual(copy?._translations, ['en', 'de']);
  });

  it('narrows the answer to the create scope', async () => {
    const { body } = await call('dp-scoped', open);
    deepStrictEqual(Object.keys(body), ['title']);
  });

  it('judges the copy once per locale it writes, shared values included', async () => {
    contexts.length = 0;
    strictEqual((await call('dp-scoped', open)).status, 201);
    deepStrictEqual(contexts, [
      { title: 'Open', status: 'open' },
      { title: 'Offen', status: 'open' },
    ]);
  });

  it('answers 404 and writes nothing when one locale is refused', async () => {
    const before = (await queryUntyped('DpScoped').unscoped().findMany()).length;
    strictEqual((await call('dp-scoped', refused)).status, 404);
    strictEqual((await queryUntyped('DpScoped').unscoped().findMany()).length, before);
  });

  it('answers 422 naming the locale that failed', async () => {
    const { status, body } = await call('dp-required', required, { body: { slug: 'news-2' } });
    strictEqual(status, 422);
    deepStrictEqual(errorsOf(body), ['slug']);
    strictEqual((body.data as { locale: string }).locale, 'de');
  });

  it('checks every copied link against the caller read reach', async () => {
    strictEqual((await call('dp-links', linksVisible)).status, 201);
    const { status, body } = await call('dp-links', linksHidden);
    strictEqual(status, 422);
    deepStrictEqual(errorsOf(body), ['target']);
  });

  it('checks a link another locale holds against the same reach', async () => {
    const { status, body } = await call('dp-translated-links', translatedLinks);
    strictEqual(status, 422);
    deepStrictEqual(errorsOf(body), ['target']);
    strictEqual((body.data as { locale: string }).locale, 'de');
  });

  it('refuses a body key no create takes', async () => {
    const { status, body } = await call('dp-posts', post, {
      body: { ghost: 1 },
      bearer: admin.token,
    });
    strictEqual(status, 422);
    deepStrictEqual(errorsOf(body), ['ghost']);
  });

  it('needs a JSON body, after the verdict', async () => {
    strictEqual((await call('dp-posts', post, { bearer: admin.token })).status, 415);
    strictEqual((await call('dp-scoped', closed, {})).status, 404);
  });

  it('rejects a bad param after the verdict', async () => {
    strictEqual(
      (await call('dp-posts', post, { body: {}, qs: '?locale=it', bearer: admin.token })).status,
      400,
    );
    strictEqual(
      (await call('dp-posts', post, { body: {}, qs: '?page=2', bearer: admin.token })).status,
      400,
    );
    strictEqual((await call('dp-scoped', closed, { body: {}, qs: '?locale=it' })).status, 404);
  });

  it('leaves out what a copy never carries on `Users`', async () => {
    const { status, body } = await call('users', reader.uuid, { body: {}, bearer: admin.token });
    strictEqual(status, 422);
    deepStrictEqual(errorsOf(body).sort(), ['email', 'password']);
    const filled = await call('users', reader.uuid, {
      body: { email: 'twin@example.com', password: 'pw-654321' },
      bearer: admin.token,
    });
    strictEqual(filled.status, 201);
    deepStrictEqual(filled.body.roles, ['reader']);
    ok(!('password' in filled.body));
  });
});
