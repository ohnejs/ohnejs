import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { hook } from '../../../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../../../src/ohne/hooks/use-hooks.ts';
import { queryUntyped } from '../../../../../../src/ohne/query/query.ts';
import { call, defaultsOf, errorsOf, ROUTES, save, signIn } from './_fixture.ts';

const owner = await signIn('owner@default.example.com', ['sharer']);

/**
 * Sets the default view of `collection` to `body` as the holder of `token`.
 */
function put(
  collection: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  return call(ROUTES.setDefault, { params: { collection }, token, body });
}

describe('PUT /dashboard/bookmarks/[collection]/default', () => {
  afterEach(() => useHooks().clear());

  it('401s an anonymous caller', async () => {
    strictEqual((await put('blog-posts', { bookmark: null })).status, 401);
  });

  it('404s an unknown, a singleton, and an unreadable collection before reading the body', async () => {
    const me = await signIn('segments@default.example.com', ['reader']);
    for (const segment of ['nope', 'settings', 'drafts', 'secrets']) {
      strictEqual((await put(segment, { bookmark: null }, me.token)).status, 404, segment);
      strictEqual((await put(segment, { bookmark: 1 }, me.token)).status, 404, segment);
    }
  });

  it('400s a `bookmark` that is neither a string nor `null`', async () => {
    const me = await signIn('body@default.example.com', ['reader']);
    for (const body of [null, {}, { bookmark: 1 }, { bookmark: true }]) {
      strictEqual((await put('blog-posts', body, me.token)).status, 400, JSON.stringify(body));
    }
  });

  it('sets, replaces, and clears the default, keeping one row per collection', async () => {
    const me = await signIn('set@default.example.com', ['reader']);
    const first = await save(me.token, 'blog-posts', { name: 'A', view: 'order=[title]' });
    const second = await save(me.token, 'blog-posts', { name: 'B', view: '' });
    const users = await save(me.token, 'users', { name: 'U', view: '' });

    const set = await put('blog-posts', { bookmark: first.UUID }, me.token);
    deepStrictEqual(set, { status: 200, body: { bookmark: first.UUID, view: 'order=[title]' } });
    strictEqual((await put('users', { bookmark: users.UUID }, me.token)).status, 200);
    const replaced = await put('blog-posts', { bookmark: second.UUID }, me.token);
    deepStrictEqual(replaced, { status: 200, body: { bookmark: second.UUID, view: '' } });
    deepStrictEqual(
      new Set((await defaultsOf(me.uuid)).map((row) => JSON.stringify(row))),
      new Set([
        JSON.stringify({ collection: 'BlogPosts', bookmark: second.UUID }),
        JSON.stringify({ collection: 'Users', bookmark: users.UUID }),
      ]),
    );

    deepStrictEqual(await put('blog-posts', { bookmark: null }, me.token), {
      status: 204,
      body: null,
    });
    deepStrictEqual(await defaultsOf(me.uuid), [{ collection: 'Users', bookmark: users.UUID }]);
  });

  it("takes someone else's shared bookmark, never their private one", async () => {
    const me = await signIn('shared@default.example.com', ['reader']);
    const shared = await save(owner.token, 'blog-posts', { name: 'S', view: '', shared: true });
    const hidden = await save(owner.token, 'blog-posts', { name: 'P', view: '' });
    strictEqual((await put('blog-posts', { bookmark: shared.UUID }, me.token)).status, 200);
    strictEqual((await put('blog-posts', { bookmark: hidden.UUID }, me.token)).status, 404);
    deepStrictEqual(await defaultsOf(me.uuid), [
      { collection: 'BlogPosts', bookmark: shared.UUID },
    ]);
  });

  it("404s another collection's bookmark and an unknown one alike", async () => {
    const me = await signIn('cross@default.example.com', ['reader']);
    const users = await save(me.token, 'users', { name: 'U', view: '' });
    const unknown = await put('blog-posts', { bookmark: 'nope' }, me.token);
    strictEqual(unknown.status, 404);
    deepStrictEqual(await put('blog-posts', { bookmark: users.UUID }, me.token), unknown);
    deepStrictEqual(await defaultsOf(me.uuid), []);
  });

  it('drops the default when its bookmark is deleted', async () => {
    const me = await signIn('cascade@default.example.com', ['reader']);
    const { UUID } = await save(me.token, 'blog-posts', { name: 'A', view: '' });
    strictEqual((await put('blog-posts', { bookmark: UUID }, me.token)).status, 200);
    await queryUntyped('DashboardBookmarks').where({ UUID }).delete();
    deepStrictEqual(await defaultsOf(me.uuid), []);
  });

  it('replaces the default past an app hook that scopes the defaults away', async () => {
    const me = await signIn('scoped@default.example.com', ['reader']);
    const first = await save(me.token, 'blog-posts', { name: 'A', view: '' });
    const second = await save(me.token, 'blog-posts', { name: 'B', view: '' });
    strictEqual((await put('blog-posts', { bookmark: first.UUID }, me.token)).status, 200);
    hook('record:condition', (condition, { collection }) =>
      collection === 'DashboardBookmarkDefaults'
        ? { kind: 'compare', path: ['UUID'], op: 'equalsTo', value: 'none', negated: false }
        : condition,
    );
    hook('query:filter', (ir) =>
      ir.collection === 'DashboardBookmarkDefaults' ? { ...ir, limit: 0 } : ir,
    );
    strictEqual((await put('blog-posts', { bookmark: second.UUID }, me.token)).status, 200);
    useHooks().clear();
    deepStrictEqual(await defaultsOf(me.uuid), [
      { collection: 'BlogPosts', bookmark: second.UUID },
    ]);
  });

  it('422s a bookmark deleted before the default is written, and changes nothing', async () => {
    const me = await signIn('race@default.example.com', ['reader']);
    const kept = await save(me.token, 'blog-posts', { name: 'Kept', view: '' });
    const doomed = await save(me.token, 'blog-posts', { name: 'Doomed', view: '' });
    strictEqual((await put('blog-posts', { bookmark: kept.UUID }, me.token)).status, 200);
    hook('record:validate', async (errors, _scope, ctx) => {
      if (ctx.collection !== 'DashboardBookmarkDefaults') return errors;
      await queryUntyped('DashboardBookmarks').use(ctx.tx).where({ UUID: doomed.UUID }).delete();
      return errors;
    });
    const { status, body } = await put('blog-posts', { bookmark: doomed.UUID }, me.token);
    strictEqual(status, 422);
    deepStrictEqual(errorsOf(body), { bookmark: 'validation.invalidReference' });
    deepStrictEqual(await defaultsOf(me.uuid), [{ collection: 'BlogPosts', bookmark: kept.UUID }]);
  });
});
