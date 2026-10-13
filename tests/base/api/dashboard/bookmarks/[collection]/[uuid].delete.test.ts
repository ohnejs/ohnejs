import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { queryUntyped } from '../../../../../../src/ohne/query/query.ts';
import { call, defaultsOf, ROUTES, save, signIn } from './_fixture.ts';

const me = await signIn('me@delete.example.com', ['sharer']);
const other = await signIn('other@delete.example.com', ['reader']);

/**
 * Deletes the bookmark `uuid` of `collection` as the holder of `token`.
 */
function remove(
  collection: string,
  uuid: string,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  return call(ROUTES.remove, { params: { collection, uuid }, token });
}

describe('DELETE /dashboard/bookmarks/[collection]/[uuid]', () => {
  it('401s an anonymous caller', async () => {
    const { UUID } = await save(me.token, 'blog-posts', { name: 'A', view: '' });
    strictEqual((await remove('blog-posts', UUID)).status, 401);
  });

  it("404s someone else's bookmark, another collection's, and an unknown one alike", async () => {
    const { UUID } = await save(me.token, 'blog-posts', { name: 'A', view: '', shared: true });
    const unknown = await remove('blog-posts', '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b', me.token);
    strictEqual(unknown.status, 404);
    deepStrictEqual(await remove('blog-posts', UUID, other.token), unknown);
    deepStrictEqual(await remove('users', UUID, me.token), unknown);
    deepStrictEqual(await remove('nope', UUID, me.token), unknown);
    strictEqual(await queryUntyped('DashboardBookmarks').where({ UUID }).count(), 1);
  });

  it('deletes the bookmark with every default view naming it, answering 204', async () => {
    const { UUID } = await save(me.token, 'blog-posts', { name: 'A', view: '', shared: true });
    const put = await call(ROUTES.setDefault, {
      params: { collection: 'blog-posts' },
      token: other.token,
      body: { bookmark: UUID },
    });
    strictEqual(put.status, 200);
    deepStrictEqual(await remove('blog-posts', UUID, me.token), { status: 204, body: null });
    strictEqual(await queryUntyped('DashboardBookmarks').where({ UUID }).count(), 0);
    deepStrictEqual(await defaultsOf(other.uuid), []);
  });
});
