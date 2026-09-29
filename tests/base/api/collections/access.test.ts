import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { QueryScope } from '../../../../src/ohne/query/wire/apply.ts';
import type { AnyHandler, Route } from '../../../../src/ohne/routes/route.ts';

import uuidDelete from '../../../../src/base/api/collections/[collection]/[uuid].delete.ts';
import uuidGet from '../../../../src/base/api/collections/[collection]/[uuid].get.ts';
import uuidPatch from '../../../../src/base/api/collections/[collection]/[uuid].patch.ts';
import listGet from '../../../../src/base/api/collections/[collection]/index.get.ts';
import createPost from '../../../../src/base/api/collections/[collection]/index.post.ts';
import queryPost from '../../../../src/base/api/collections/[collection]/query.post.ts';
import { hashSessionToken } from '../../../../src/base/auth/_token.ts';
import { useUser } from '../../../../src/base/auth/use-user.ts';
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
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { hook } from '../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../src/ohne/hooks/use-hooks.ts';
import { dispatch } from '../../../../src/ohne/http/dispatch.ts';
import { forbidden, unauthorized } from '../../../../src/ohne/http/http-error.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { useMiddleware } from '../../../../src/ohne/middleware/use-middleware.ts';
import { usePrinter } from '../../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { useRoles } from '../../../../src/ohne/roles/use-roles.ts';
import { isNull } from '../../../../src/utils/index.ts';

usePrinter().configure({ stream: { write: () => true } });

// A tiny scrypt cost keeps the password field's hashing fast.
useLayers().add({ path: '/access-test', input: { auth: { password: { cost: 1024 } } } });

useFields().register('password', { name: 'password', fieldType: passwordField });
useFields().register('roles', { name: 'roles', fieldType: rolesField });
useFields().register('language', { name: 'language', fieldType: languageField });
useFields().register('locale', { name: 'locale', fieldType: localeField });
useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });
useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });
useCollections().register('Users', { name: 'Users', collection: UsersCollection });
useCollections().register('Sessions', { name: 'Sessions', collection: SessionsCollection });

useRoles().register('admin', { name: 'admin', role: { capabilities: ['*'] } });
useRoles().register('notes-user', {
  name: 'notes-user',
  role: { capabilities: ['collection.AccessNotes.*', 'collection.AccessPins.*'] },
});

const own = async (): Promise<QueryScope | boolean> => {
  const user = await useUser();
  return isNull(user) ? false : { where: { owner: user.UUID } };
};

let accessResolutions = 0;

useCollections().register('AccessNotes', {
  name: 'AccessNotes',
  collection: {
    api: {
      read: { access: own },
      create: { access: () => ({ where: { owner: 'no-such-owner' } }) },
      update: { access: own },
      delete: { access: own },
    },
    fields: { title: field('text'), owner: field('text') },
  },
});
useCollections().register('AccessDrafts', {
  name: 'AccessDrafts',
  collection: {
    api: {
      read: { public: true, access: () => ({ select: ['title'] }) },
      update: { public: true, access: () => ({ select: ['title'] }) },
    },
    fields: { title: field('text'), note: field('text') },
  },
});
useCollections().register('AccessGate', {
  name: 'AccessGate',
  collection: {
    api: {
      read: { public: true, access: async () => !isNull(await useUser()) },
      create: { access: () => false },
      update: { access: () => false },
    },
    fields: { title: field('text') },
  },
});
useCollections().register('AccessEmpty', {
  name: 'AccessEmpty',
  collection: {
    api: { read: { public: true, access: () => ({ select: [] }) } },
    fields: { title: field('text') },
  },
});
useCollections().register('AccessBlocked', {
  name: 'AccessBlocked',
  collection: {
    api: {
      read: {
        public: true,
        middleware: ['access-block'],
        access: () => ((accessResolutions += 1), true),
      },
    },
    fields: { title: field('text') },
  },
});

const contexts: unknown[] = [];
const noteContext = (context: unknown): true => (contexts.push(context), true);
useCollections().register('AccessContexts', {
  name: 'AccessContexts',
  collection: {
    api: {
      read: { public: true, access: noteContext },
      create: { public: true, access: noteContext },
      update: { public: true, access: noteContext },
      delete: { public: true, access: noteContext },
    },
    fields: { title: field('text') },
  },
});
useCollections().register('AccessPosts', {
  name: 'AccessPosts',
  collection: {
    api: {
      update: {
        public: true,
        access: async ({ input }) => {
          const user = await useUser();
          if (isNull(user)) return false;
          const me = user.UUID;
          return 'author' in input
            ? { where: { author: me } }
            : { where: { or: [{ author: me }, { editor: me }] } };
        },
      },
    },
    fields: { title: field('text'), author: field('text'), editor: field('text') },
  },
});

useCollections().register('AccessSecrets', {
  name: 'AccessSecrets',
  collection: { fields: { secret: field('text') } },
});
useCollections().register('AccessLinks', {
  name: 'AccessLinks',
  collection: {
    api: { read: 'public' },
    fields: {
      label: field('text'),
      target: field('record', { collection: 'AccessSecrets' }),
      targets: field('records', { collection: 'AccessSecrets' }),
      note: field('record', { collection: 'AccessNotes' }),
      draft: field('record', { collection: 'AccessDrafts' }),
      who: field('record', { collection: 'Users' }),
      self: field('record', { collection: 'AccessLinks' }),
      blocked: field('record', { collection: 'AccessBlocked' }),
    },
  },
});
useCollections().register('AccessVaults', {
  name: 'AccessVaults',
  collection: {
    api: {
      read: {
        public: true,
        access: () => {
          throw forbidden();
        },
      },
    },
    fields: { label: field('text') },
  },
});
useCollections().register('AccessPins', {
  name: 'AccessPins',
  collection: {
    api: { read: true, create: true, update: true },
    fields: {
      note: field('record', { collection: 'AccessNotes', onDelete: 'restrict' }),
      secret: field('record', { collection: 'AccessSecrets' }),
      vault: field('record', { collection: 'AccessVaults' }),
      who: field('record', { collection: 'Users' }),
      author: field('record', {
        collection: 'Users',
        default: async () => (await useUser())?.UUID ?? null,
      }),
      editors: field('records', { collection: 'Users' }),
    },
  },
});

useMiddleware().register('access-block', () => unauthorized());

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

const anonymous = null;
const writer = await userWith('writer@example.com', ['notes-user']);
const other = await userWith('other@example.com', ['notes-user']);
const admin = await userWith('admin@example.com', ['admin']);

async function seed(collection: string, input: Record<string, unknown>): Promise<string> {
  const record = await queryUntyped(collection).createOrThrow(input);
  return record.UUID as string;
}

const writerNote = await seed('AccessNotes', { title: 'Writer note', owner: writer.uuid });
const otherNote = await seed('AccessNotes', { title: 'Other note', owner: other.uuid });
const draft = await seed('AccessDrafts', { title: 'Draft', note: 'hidden' });
const gateRow = await seed('AccessGate', { title: 'Open' });
const contextRow = await seed('AccessContexts', { title: 'Ctx' });
const secretRow = await seed('AccessSecrets', { secret: 'top-secret' });
const link = await seed('AccessLinks', {
  label: 'Link',
  target: secretRow,
  targets: [secretRow],
  note: writerNote,
  draft,
  who: writer.uuid,
});
const outer = await seed('AccessLinks', { label: 'Outer', self: link });
const blockedRow = await seed('AccessBlocked', { title: 'Blocked' });
const gated = await seed('AccessLinks', { label: 'Gated', blocked: blockedRow });
const writerPost = await seed('AccessPosts', {
  title: 'Post',
  author: writer.uuid,
  editor: other.uuid,
});

function route(method: Route['method'], pattern: string, handler: unknown): Route {
  return {
    method,
    pattern,
    file: `${pattern}.ts`,
    layer: 'ohnejs/base',
    handler: handler as AnyHandler,
  };
}

const ROUTES = {
  list: route('GET', '/collections/[collection]', listGet),
  query: route('POST', '/collections/[collection]/query', queryPost),
  create: route('POST', '/collections/[collection]', createPost),
  read: route('GET', '/collections/[collection]/[uuid]', uuidGet),
  patch: route('PATCH', '/collections/[collection]/[uuid]', uuidPatch),
  del: route('DELETE', '/collections/[collection]/[uuid]', uuidDelete),
};

interface CallResult {
  status: number;
  body: unknown;
}

async function call(
  r: Route,
  params: Record<string, string>,
  bearer: string | null,
  init: { body?: unknown; qs?: string } = {},
): Promise<CallResult> {
  const path =
    `/collections/${params.collection}` +
    (params.uuid ? `/${params.uuid}` : '') +
    (r.pattern.endsWith('/query') ? '/query' : '');
  const url = `http://x.test${path}${init.qs ?? ''}`;
  const headers = new Headers();
  if (bearer !== null) headers.set('Authorization', `Bearer ${bearer}`);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  const request = new Request(url, {
    method: r.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const { response } = await dispatch(r, request, new URL(url), params);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

const notes = { collection: 'access-notes' };
const drafts = { collection: 'access-drafts' };
const gate = { collection: 'access-gate' };
const contextual = { collection: 'access-contexts' };
const links = { collection: 'access-links' };
const posts = { collection: 'access-posts' };
const pins = { collection: 'access-pins' };

function titlesOf(body: unknown): unknown[] {
  return (body as Record<string, unknown>[]).map((record) => record.title);
}

describe('row scoping', () => {
  it('lists only the rows inside the caller scope, on both list transports', async () => {
    const list = await call(ROUTES.list, notes, writer.token);
    strictEqual(list.status, 200);
    deepStrictEqual(titlesOf(list.body), ['Writer note']);

    const query = await call(ROUTES.query, notes, other.token, { body: {} });
    strictEqual(query.status, 200);
    deepStrictEqual(titlesOf(query.body), ['Other note']);
  });

  it('404s a cross-owner read, byte-identical to a missing record', async () => {
    strictEqual(
      (await call(ROUTES.read, { ...notes, uuid: writerNote }, writer.token)).status,
      200,
    );
    const cross = await call(ROUTES.read, { ...notes, uuid: otherNote }, writer.token);
    const missing = await call(ROUTES.read, { ...notes, uuid: 'missing' }, writer.token);
    strictEqual(cross.status, 404);
    deepStrictEqual(cross.body, missing.body);
  });

  it('patches only rows inside the scope', async () => {
    const cross = await call(ROUTES.patch, { ...notes, uuid: otherNote }, writer.token, {
      body: { title: 'Stolen' },
    });
    strictEqual(cross.status, 404);
    const untouched = await queryUntyped('AccessNotes').where({ UUID: otherNote }).findFirst();
    strictEqual(untouched?.title, 'Other note');

    const mine = await call(ROUTES.patch, { ...notes, uuid: writerNote }, writer.token, {
      body: { title: 'Writer note 2' },
    });
    strictEqual(mine.status, 200);
    strictEqual((mine.body as Record<string, unknown>).title, 'Writer note 2');
  });

  it('deletes only rows inside the scope', async () => {
    strictEqual((await call(ROUTES.del, { ...notes, uuid: writerNote }, other.token)).status, 404);
    strictEqual((await call(ROUTES.del, { ...notes, uuid: otherNote }, other.token)).status, 204);
  });

  it('leaves a create unfiltered by the scope where - only the verdict gates', async () => {
    const { status, body } = await call(ROUTES.create, notes, writer.token, {
      body: { title: 'New', owner: writer.uuid },
    });
    strictEqual(status, 201);
    strictEqual((body as Record<string, unknown>).owner, writer.uuid);
  });
});

describe('field scoping', () => {
  it('narrows list and record reads to the scope select', async () => {
    const list = await call(ROUTES.list, drafts, anonymous);
    strictEqual(list.status, 200);
    deepStrictEqual(list.body, [{ title: 'Draft' }]);

    const read = await call(ROUTES.read, { ...drafts, uuid: draft }, anonymous);
    deepStrictEqual(read.body, { title: 'Draft' });
  });

  it('refuses a field outside the scope select wherever the request names it', async () => {
    const refusals: [Route, Record<string, string>, string, string][] = [
      [ROUTES.read, { ...drafts, uuid: draft }, '?select=note', 'select[0]'],
      [ROUTES.list, drafts, '?where={note:{startsWith:hid}}', 'where.note'],
      [ROUTES.list, drafts, '?order=[-note]', 'order[0]'],
      [ROUTES.list, drafts, '?where={UUID:{startsWith:a}}', 'where.UUID'],
    ];
    for (const [r, params, qs, path] of refusals) {
      const { status, body } = await call(r, params, anonymous, { qs });
      strictEqual(status, 400, qs);
      deepStrictEqual((body as { data: unknown }).data, { code: 'invalidField', path });
    }
    const hiddenValue = await call(ROUTES.list, drafts, anonymous, {
      qs: '?where={note:{startsWith:0}}',
    });
    const absentValue = await call(ROUTES.list, drafts, anonymous, {
      qs: '?where={nope:{startsWith:0}}',
    });
    strictEqual((hiddenValue.body as { message: string }).message, 'query.invalidValue');
    strictEqual((absentValue.body as { message: string }).message, 'query.invalidValue');
    const posted = await call(ROUTES.query, drafts, anonymous, {
      body: { where: { note: { startsWith: 'hid' } } },
    });
    strictEqual(posted.status, 400);
  });

  it('suggests nothing for a near miss of a scope-hidden name', async () => {
    const { body } = await call(ROUTES.list, drafts, anonymous, {
      qs: '?where={notes:{startsWith:h}}',
    });
    strictEqual((body as { message: string }).message, 'query.invalidField');
  });

  it('still filters and sorts by fields inside the scope select', async () => {
    const { status, body } = await call(ROUTES.list, drafts, anonymous, {
      qs: '?where={title:{startsWith:Dr}}&order=[title]',
    });
    strictEqual(status, 200);
    deepStrictEqual(body, [{ title: 'Draft' }]);
  });

  it('422s a key the collection cannot take and one outside the scope select alike', async () => {
    const { status, body } = await call(ROUTES.patch, { ...drafts, uuid: draft }, anonymous, {
      body: { title: 'Draft 2', notee: 'x', note: 'rewritten' },
    });
    strictEqual(status, 422);
    deepStrictEqual((body as { data: { errors: Record<string, string> } }).data.errors, {
      notee: 'validation.unknownField',
      note: 'validation.unknownField',
    });
    const row = await queryUntyped('AccessDrafts').where({ UUID: draft }).findFirst();
    deepStrictEqual([row?.title, row?.note], ['Draft', 'hidden']);
  });

  it('narrows a patch answer to the scope select', async () => {
    const { status, body } = await call(ROUTES.patch, { ...drafts, uuid: draft }, anonymous, {
      body: { title: 'Draft 2' },
    });
    strictEqual(status, 200);
    deepStrictEqual(body, { title: 'Draft 2' });
  });
});

describe('verdicts', () => {
  it('answers false as the identical 404, never a 403', async () => {
    const denied = await call(ROUTES.list, gate, anonymous);
    const unknown = await call(ROUTES.list, { collection: 'no-such' }, anonymous);
    strictEqual(denied.status, 404);
    deepStrictEqual(denied.body, unknown.body);

    const capable = await call(ROUTES.patch, { ...gate, uuid: gateRow }, admin.token, {
      body: { title: 'X' },
    });
    strictEqual(capable.status, 404);
  });

  it('runs the operation unscoped under true', async () => {
    const { status, body } = await call(ROUTES.list, gate, writer.token);
    strictEqual(status, 200);
    deepStrictEqual(titlesOf(body), ['Open']);
  });

  it('never resolves access once a middleware answers', async () => {
    const { status } = await call(ROUTES.list, { collection: 'access-blocked' }, anonymous);
    strictEqual(status, 401);
    strictEqual(accessResolutions, 0);
  });

  it('500s an empty scope select instead of widening the read', async () => {
    const { status } = await call(ROUTES.list, { collection: 'access-empty' }, anonymous);
    strictEqual(status, 500);
  });
});

describe('context', () => {
  it('hands a create and an update the body, a read and a delete the operation alone', async () => {
    contexts.length = 0;
    await call(ROUTES.create, contextual, anonymous, { body: { title: 'New' } });
    await call(ROUTES.patch, { ...contextual, uuid: contextRow }, anonymous, {
      body: { title: 'Ctx 2' },
    });
    await call(ROUTES.read, { ...contextual, uuid: contextRow }, anonymous);
    await call(ROUTES.list, contextual, anonymous);
    await call(ROUTES.query, contextual, anonymous, { body: {} });
    await call(ROUTES.del, { ...contextual, uuid: contextRow }, anonymous);
    deepStrictEqual(contexts, [
      { operation: 'create', input: { title: 'New' } },
      { operation: 'update', input: { title: 'Ctx 2' } },
      { operation: 'read' },
      { operation: 'read' },
      { operation: 'read' },
      { operation: 'delete' },
    ]);
  });

  it('reads the body after the guard, so a refused request never parses one', async () => {
    const refused = await call(ROUTES.create, notes, anonymous, { body: 'not a record' });
    strictEqual(refused.status, 401);
    const malformed = await call(ROUTES.create, notes, writer.token, { body: 'not a record' });
    strictEqual(malformed.status, 400);
  });

  it('answers a refused caller the identical 404 whatever the params or body carry', async () => {
    const sent = { body: 'not a record', qs: '?locale=de' };
    const unknown = await call(
      ROUTES.patch,
      { collection: 'no-such', uuid: gateRow },
      admin.token,
      sent,
    );
    const patch = await call(ROUTES.patch, { ...gate, uuid: gateRow }, admin.token, sent);
    const create = await call(ROUTES.create, gate, admin.token, sent);
    strictEqual(patch.status, 404);
    strictEqual(create.status, 404);
    deepStrictEqual(patch.body, unknown.body);
    deepStrictEqual(create.body, unknown.body);
  });

  it('lets a rule judge the write: an editor edits the post but never reassigns its author', async () => {
    const target = { ...posts, uuid: writerPost };
    const edit = await call(ROUTES.patch, target, other.token, { body: { title: 'Edited' } });
    strictEqual(edit.status, 200);
    const reassign = await call(ROUTES.patch, target, other.token, {
      body: { author: other.uuid },
    });
    strictEqual(reassign.status, 404);
    const handover = await call(ROUTES.patch, target, writer.token, {
      body: { author: other.uuid },
    });
    strictEqual(handover.status, 200);
    strictEqual((handover.body as Record<string, unknown>).author, other.uuid);
  });
});

describe('reach', () => {
  const record = (body: unknown): Record<string, unknown> => body as Record<string, unknown>;

  it('hydrates nothing from a collection the caller cannot read', async () => {
    const { status, body } = await call(ROUTES.read, { ...links, uuid: link }, anonymous, {
      qs: '?populate=[target,targets,who,note]',
    });
    strictEqual(status, 200);
    strictEqual(record(body).label, 'Link');
    strictEqual(record(body).target, null);
    deepStrictEqual(record(body).targets, []);
    strictEqual(record(body).who, null);
    strictEqual(record(body).note, null);
  });

  it("hydrates a target as far as the caller's own read of it reaches", async () => {
    const asWriter = await call(ROUTES.read, { ...links, uuid: link }, writer.token, {
      qs: '?populate=[note,who]',
    });
    strictEqual((record(asWriter.body).note as Record<string, unknown>).owner, writer.uuid);
    strictEqual(record(asWriter.body).who, null);
    const asAdmin = await call(ROUTES.read, { ...links, uuid: link }, admin.token, {
      qs: '?populate=[who]',
    });
    strictEqual((record(asAdmin.body).who as Record<string, unknown>).email, 'writer@example.com');
  });

  it('narrows a populated target to its reach select and refuses a field outside it', async () => {
    const { body } = await call(ROUTES.read, { ...links, uuid: link }, anonymous, {
      qs: '?populate=[draft]',
    });
    deepStrictEqual(record(body).draft, { title: 'Draft 2' });
    const refused = await call(ROUTES.read, { ...links, uuid: link }, anonymous, {
      qs: '?populate=[{draft:{select:[note]}}]',
    });
    strictEqual(refused.status, 400);
    deepStrictEqual(record(refused.body).data, {
      code: 'invalidField',
      path: 'populate[0].draft.select[0]',
    });
  });

  it('names nothing about a target the caller cannot read, whatever the URL probes', async () => {
    for (const qs of [
      '?where={target:{has:{secre:{startsWith:top}}}}',
      '?where={target:{has:{secret:{atLeast:1}}}}',
      '?populate=[{target:{select:[secre]}}]',
    ]) {
      const { status, body } = await call(ROUTES.list, links, anonymous, { qs });
      strictEqual(status, 400, qs);
      strictEqual(record(body).message, 'query.invalidField', qs);
    }
  });

  it("runs the target's middleware for the reach: one that answers makes it unreachable", async () => {
    accessResolutions = 0;
    const { status, body } = await call(ROUTES.read, { ...links, uuid: gated }, anonymous, {
      qs: '?populate=[blocked]',
    });
    strictEqual(status, 200);
    strictEqual(record(body).blocked, null);
    strictEqual(accessResolutions, 0);
  });

  it('reaches through a second level under the same rules', async () => {
    const { body } = await call(ROUTES.read, { ...links, uuid: outer }, writer.token, {
      qs: '?populate=[{self:{populate:[target,note]}}]',
    });
    const self = record(body).self as Record<string, unknown>;
    strictEqual(self.label, 'Link');
    strictEqual(self.target, null);
    strictEqual((self.note as Record<string, unknown>).owner, writer.uuid);
  });

  it('probes a target only through the rows and fields the caller reaches', async () => {
    const hidden = await call(ROUTES.list, links, anonymous, {
      qs: '?where={target:{has:{secret:{startsWith:top}}}}',
    });
    strictEqual(hidden.status, 400);
    deepStrictEqual(record(hidden.body).data, {
      code: 'invalidField',
      path: 'where.target.secret',
    });
    const bare = await call(ROUTES.list, links, anonymous, { qs: '?where={target:{has:true}}' });
    deepStrictEqual(titlesOf(bare.body).length, 1);

    const outside = await call(ROUTES.list, links, other.token, {
      qs: '?where={note:{has:{title:{startsWith:Writer}}}}',
    });
    deepStrictEqual(outside.body, []);
    const inside = await call(ROUTES.list, links, writer.token, {
      qs: '?where={note:{has:{title:{startsWith:Writer}}}}',
    });
    strictEqual((inside.body as unknown[]).length, 1);

    const scoped = await call(ROUTES.list, links, anonymous, {
      qs: '?where={draft:{has:{note:{startsWith:hid}}}}',
    });
    strictEqual(scoped.status, 400);
    deepStrictEqual(record(scoped.body).data, { code: 'invalidField', path: 'where.draft.note' });
    const visible = await call(ROUTES.list, links, anonymous, {
      qs: '?where={draft:{has:{title:{startsWith:Dr}}}}',
    });
    strictEqual((visible.body as unknown[]).length, 1);
  });
});

describe('link reach', () => {
  const missing = '01900000-0000-7000-8000-000000000000';
  const record = (body: unknown): Record<string, unknown> => body as Record<string, unknown>;

  async function pin(body: Record<string, unknown>): Promise<CallResult> {
    return call(ROUTES.create, pins, writer.token, { body });
  }

  it('refuses a link to a record the caller cannot read exactly as a missing one', async () => {
    const hidden = await seed('AccessNotes', { title: 'Hidden', owner: other.uuid });
    for (const [key, uuid] of [
      ['note', hidden],
      ['secret', secretRow],
      ['who', other.uuid],
    ]) {
      const refused = await pin({ [key]: uuid });
      strictEqual(refused.status, 422);
      deepStrictEqual(refused.body, (await pin({ [key]: missing })).body);
    }
  });

  it('links a record the caller reads', async () => {
    strictEqual((await pin({ note: writerNote })).status, 201);
  });

  it("links the caller's own user, by body or by default", async () => {
    const named = await pin({ author: writer.uuid, who: writer.uuid });
    strictEqual(named.status, 201);
    const defaulted = await pin({});
    strictEqual(defaulted.status, 201);
    strictEqual(record(defaulted.body).author, writer.uuid);
  });

  it('keeps a hidden link the record already holds when a patch resends it', async () => {
    const held = await seed('AccessPins', { author: writer.uuid, editors: [other.uuid] });
    const resent = await call(ROUTES.patch, { ...pins, uuid: held }, writer.token, {
      body: { editors: [other.uuid, writer.uuid] },
    });
    strictEqual(resent.status, 200);
    deepStrictEqual(record(resent.body).editors, [other.uuid, writer.uuid]);

    const moved = await call(ROUTES.patch, { ...pins, uuid: held }, writer.token, {
      body: { who: other.uuid },
    });
    strictEqual(moved.status, 422);
  });

  it("never lets a `restrict` link pin another user's hidden record", async () => {
    const hidden = await seed('AccessNotes', { title: 'Pinned', owner: other.uuid });
    strictEqual((await pin({ note: hidden })).status, 422);
    strictEqual((await call(ROUTES.del, { ...notes, uuid: hidden }, other.token)).status, 204);
  });

  it('answers a target whose read `access` throws the same for a real and a missing record', async () => {
    const vault = await seed('AccessVaults', { label: 'Vault' });
    const real = await pin({ vault });
    strictEqual(real.status, 403);
    deepStrictEqual(await pin({ vault: missing }), real);
  });

  it('checks a link a `record:before-change` hook sets like one the caller sends', async () => {
    hook('record:before-change', (input, context) => {
      if (context.collection === 'AccessPins') input.secret = secretRow;
    });
    try {
      strictEqual((await pin({})).status, 422);
    } finally {
      useHooks().delete('record:before-change');
    }
  });

  it('keeps a link under the read check when a `record:before-change` hook tidies it', async () => {
    hook('record:before-change', (input) => {
      if (typeof input.note === 'string') input.note = input.note.trim().toLowerCase();
    });
    try {
      const hidden = await seed('AccessNotes', { title: 'Tidied', owner: other.uuid });
      for (const spell of [(uuid: string) => ` ${uuid} `, (uuid: string) => uuid.toUpperCase()]) {
        const refused = await pin({ note: spell(hidden) });
        strictEqual(refused.status, 422);
        deepStrictEqual(refused.body, (await pin({ note: spell(missing) })).body);
      }
    } finally {
      useHooks().delete('record:before-change');
    }
  });
});
