import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Config } from '../../../src/ohne/layers/config.ts';

import '../../../src/ai/boot/users.ts';
import meGetHandler from '../../../src/base/api/auth/me.get.ts';
import mePatchHandler from '../../../src/base/api/auth/me.patch.ts';
import updateHandler from '../../../src/base/api/collections/[collection]/[uuid].patch.ts';
import createHandler from '../../../src/base/api/collections/[collection]/index.post.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { call, route, signIn, withAI } from '../_fixture.ts';

const ME = route('PATCH', '/auth/me', mePatchHandler);
const ME_GET = route('GET', '/auth/me', meGetHandler);
const UPDATE = route('PATCH', '/collections/[collection]/[uuid]', updateHandler);
const CREATE = route('POST', '/collections/[collection]', createHandler);

const ON: Config['ai'] = {
  model: 'smart',
  models: { smart: { provider: 'anthropic', model: 'claude-test', key: false } },
  autoAccept: { max: 5, fields: { Items: ['name'] } },
};

const admin = await signIn('admin@users.example.com', ['admin']);
const editor = await signIn('editor@users.example.com', ['editor']);

/**
 * The stored `autoAccept` of the user `uuid`.
 */
async function stored(uuid: string): Promise<unknown> {
  const record = await queryUntyped('Users').where({ UUID: uuid }).select('autoAccept').findFirst();
  return record?.autoAccept;
}

/**
 * The field errors of a `422`.
 */
async function errorsOf(response: Response): Promise<Record<string, string>> {
  strictEqual(response.status, 422);
  const body = (await response.json()) as { data: { errors: Record<string, string> } };
  return body.data.errors;
}

describe('the `Users` collection of the layer', () => {
  it('starts every account with auto-accept off', async () => {
    strictEqual(await stored(editor.uuid), false);
  });

  it("refuses an update by the collections API that turns it on, even on one's own row", async () => {
    const params = { collection: 'users', uuid: editor.uuid };
    const path = `/collections/users/${editor.uuid}`;
    const { response } = await call(UPDATE, {
      path,
      params,
      token: admin.token,
      body: { autoAccept: true },
    });
    deepStrictEqual(Object.keys(await errorsOf(response)), ['autoAccept']);
    strictEqual(await stored(editor.uuid), false);
    const own = await call(UPDATE, {
      path: `/collections/users/${admin.uuid}`,
      params: { collection: 'users', uuid: admin.uuid },
      token: admin.token,
      body: { autoAccept: true },
    });
    deepStrictEqual(Object.keys(await errorsOf(own.response)), ['autoAccept']);
    strictEqual(await stored(admin.uuid), false);
  });

  it('takes any other change through the collections API, and turning it off', async () => {
    const params = { collection: 'users', uuid: editor.uuid };
    const path = `/collections/users/${editor.uuid}`;
    const body = { firstName: 'Jaina', autoAccept: false };
    const { response } = await call(UPDATE, { path, params, token: admin.token, body });
    strictEqual(response.status, 200);
  });

  it('refuses a create that turns it on, and takes one that leaves it off', async () => {
    const params = { collection: 'users' };
    const path = '/collections/users';
    const on = { email: 'new@users.example.com', password: 'pw-123456', autoAccept: true };
    const refused = await call(CREATE, { path, params, token: admin.token, body: on });
    deepStrictEqual(Object.keys(await errorsOf(refused.response)), ['autoAccept']);
    const off = { ...on, autoAccept: null };
    const created = await call(CREATE, { path, params, token: admin.token, body: off });
    strictEqual(created.response.status, 201);
  });

  it('lets the person turn it on through `PATCH /auth/me`', async () => {
    await withAI(ON, async () => {
      const { response } = await call(ME, {
        path: '/auth/me',
        token: editor.token,
        body: { autoAccept: true },
      });
      strictEqual(response.status, 200);
      strictEqual(((await response.json()) as { autoAccept: unknown }).autoAccept, true);
      strictEqual(await stored(editor.uuid), true);
      const read = await call(ME_GET, { path: '/auth/me', token: editor.token });
      strictEqual(((await read.response.json()) as { autoAccept: unknown }).autoAccept, true);
      await call(ME, { path: '/auth/me', token: editor.token, body: { autoAccept: false } });
      strictEqual(await stored(editor.uuid), false);
    });
  });

  it('keeps it off the account page while the app offers no auto-accept', async () => {
    await withAI(undefined, async () => {
      const { response } = await call(ME, {
        path: '/auth/me',
        token: editor.token,
        body: { autoAccept: true },
      });
      deepStrictEqual(Object.keys(await errorsOf(response)), ['autoAccept']);
    });
    ok((await stored(editor.uuid)) !== true);
  });
});
