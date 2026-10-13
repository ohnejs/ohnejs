import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { queryUntyped } from '../../../../../../src/ohne/query/query.ts';
import { call, errorsOf, ROUTES, save, setRoles, signIn } from './_fixture.ts';

const me = await signIn('me@patch.example.com', ['reader']);
const other = await signIn('other@patch.example.com', ['sharer']);

/**
 * Patches the bookmark `uuid` of `collection` with `body` as the holder of `token`.
 */
function patch(
  collection: string,
  uuid: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  return call(ROUTES.patch, { params: { collection, uuid }, token, body });
}

/**
 * Deletes the bookmark `uuid` of `collection` as the holder of `token`.
 */
function remove(collection: string, uuid: string, token: string): Promise<{ status: number }> {
  return call(ROUTES.remove, { params: { collection, uuid }, token });
}

describe('PATCH /dashboard/bookmarks/[collection]/[uuid]', () => {
  it('401s an anonymous caller', async () => {
    const { UUID } = await save(me.token, 'blog-posts', { name: 'A', view: '' });
    strictEqual((await patch('blog-posts', UUID, { name: 'B' })).status, 401);
  });

  it("404s someone else's bookmark, another collection's, and an unknown one alike", async () => {
    const theirs = await save(other.token, 'blog-posts', { name: 'A', view: '', shared: true });
    const mine = await save(me.token, 'blog-posts', { name: 'A', view: '' });
    const unknown = await patch('blog-posts', '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b', {}, me.token);
    strictEqual(unknown.status, 404);
    deepStrictEqual(await patch('blog-posts', theirs.UUID, { name: 'B' }, me.token), unknown);
    deepStrictEqual(await patch('users', mine.UUID, { name: 'B' }, me.token), unknown);
    deepStrictEqual(await patch('nope', mine.UUID, { name: 'B' }, me.token), unknown);
    deepStrictEqual(await patch('blog-posts', theirs.UUID, { name: 1 }, me.token), unknown);
    strictEqual(await queryUntyped('DashboardBookmarks').where({ name: 'B' }).count(), 0);
  });

  it('changes the named fields and answers the bookmark, ignoring a body `user`', async () => {
    const { UUID } = await save(me.token, 'blog-posts', { name: 'A', view: '' });
    const { status, body } = await patch(
      'blog-posts',
      UUID,
      { name: 'Renamed', view: 'order=[title]', user: other.uuid },
      me.token,
    );
    strictEqual(status, 200);
    deepStrictEqual(body, {
      UUID,
      name: 'Renamed',
      view: 'order=[title]',
      shared: false,
      mine: true,
    });
    strictEqual(
      (await queryUntyped('DashboardBookmarks').where({ UUID }).findFirst())?.user,
      me.uuid,
    );
  });

  it('400s a body naming nothing, or a value of the wrong type', async () => {
    const { UUID } = await save(me.token, 'blog-posts', { name: 'A', view: '' });
    for (const body of [null, {}, { user: other.uuid }, { name: 1 }, { shared: 'no' }]) {
      strictEqual(
        (await patch('blog-posts', UUID, body, me.token)).status,
        400,
        JSON.stringify(body),
      );
    }
  });

  it('422s an empty name or a bad view at that field', async () => {
    const { UUID } = await save(me.token, 'blog-posts', { name: 'A', view: '' });
    const name = await patch('blog-posts', UUID, { name: '' }, me.token);
    strictEqual(name.status, 422);
    deepStrictEqual(errorsOf(name.body), { name: 'validation.emptyValue' });
    const view = await patch('blog-posts', UUID, { view: 'page=3' }, me.token);
    strictEqual(view.status, 422);
    deepStrictEqual(errorsOf(view.body), { view: 'validation.invalidValue' });
  });

  it('403s sharing without `dashboard.bookmarks.share`', async () => {
    const { UUID } = await save(me.token, 'blog-posts', { name: 'A', view: '' });
    strictEqual((await patch('blog-posts', UUID, { shared: true }, me.token)).status, 403);
    strictEqual(
      (await queryUntyped('DashboardBookmarks').where({ UUID }).findFirst())?.shared,
      false,
    );
  });

  it('lets a revoked sharer withdraw a shared bookmark but never change it', async () => {
    const sharer = await signIn('revoked@patch.example.com', ['sharer']);
    const { UUID } = await save(sharer.token, 'blog-posts', { name: 'A', view: '', shared: true });
    await setRoles(sharer.uuid, ['reader']);
    strictEqual(
      (await patch('blog-posts', UUID, { view: 'order=[title]' }, sharer.token)).status,
      403,
    );
    strictEqual((await patch('blog-posts', UUID, { name: 'B' }, sharer.token)).status, 403);
    strictEqual((await patch('blog-posts', UUID, { shared: true }, sharer.token)).status, 403);
    const unshared = await patch('blog-posts', UUID, { shared: false }, sharer.token);
    strictEqual(unshared.status, 200);
    strictEqual((unshared.body as { shared: boolean }).shared, false);
    strictEqual((await patch('blog-posts', UUID, { name: 'B' }, sharer.token)).status, 200);
    strictEqual((await remove('blog-posts', UUID, sharer.token)).status, 204);
  });

  it('lets an owner who lost read withdraw a bookmark but never change it', async () => {
    const owner = await signIn('lost@patch.example.com', ['sharer']);
    const { UUID } = await save(owner.token, 'blog-posts', { name: 'A', view: '', shared: true });
    await setRoles(owner.uuid, []);
    strictEqual((await patch('blog-posts', UUID, { name: 'B' }, owner.token)).status, 404);
    strictEqual((await patch('blog-posts', UUID, { shared: true }, owner.token)).status, 404);
    strictEqual((await patch('blog-posts', UUID, { shared: false }, owner.token)).status, 200);
    strictEqual((await remove('blog-posts', UUID, owner.token)).status, 204);
  });
});
