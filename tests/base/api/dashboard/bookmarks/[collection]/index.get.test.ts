import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { hook } from '../../../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../../../src/ohne/hooks/use-hooks.ts';
import { call, ROUTES, save, signIn } from './_fixture.ts';

const me = await signIn('me@list.example.com', ['reader']);
const other = await signIn('other@list.example.com', ['sharer']);

/**
 * Lists the bookmarks of `collection` as the holder of `token`.
 */
function list(collection: string, token?: string): Promise<{ status: number; body: unknown }> {
  return call(ROUTES.list, { params: { collection }, token });
}

describe('GET /dashboard/bookmarks/[collection]', () => {
  afterEach(() => useHooks().clear());

  it('401s an anonymous caller', async () => {
    strictEqual((await list('blog-posts')).status, 401);
  });

  it('404s an unknown, a singleton, an unreadable, and a closed collection alike', async () => {
    for (const segment of ['nope', 'settings', 'drafts', 'secrets', 'dashboard-bookmarks']) {
      deepStrictEqual(await list(segment, me.token), await list('nope', me.token), segment);
      strictEqual((await list(segment, me.token)).status, 404, segment);
    }
  });

  it('lists own and shared bookmarks by name, never naming the owner', async () => {
    const mine = await save(me.token, 'blog-posts', { name: 'View 10', view: 'order=[title]' });
    const second = await save(me.token, 'blog-posts', { name: 'View 2', view: '' });
    const shared = await save(other.token, 'blog-posts', {
      name: 'Shared',
      view: 'where={title:Hi}',
      shared: true,
    });
    await save(other.token, 'blog-posts', { name: 'Private', view: '' });
    await save(me.token, 'users', { name: 'Elsewhere', view: '' });
    const { status, body } = await list('blog-posts', me.token);
    strictEqual(status, 200);
    deepStrictEqual(body, {
      bookmarks: [
        { UUID: shared.UUID, name: 'Shared', view: 'where={title:Hi}', shared: true, mine: false },
        { UUID: second.UUID, name: 'View 2', view: '', shared: false, mine: true },
        { UUID: mine.UUID, name: 'View 10', view: 'order=[title]', shared: false, mine: true },
      ],
      default: null,
    });
  });

  it("names the caller's default only while it is listed", async () => {
    const owner = await signIn('owner@list.example.com', ['sharer']);
    const reader = await signIn('reader@list.example.com', ['reader']);
    const shared = await save(owner.token, 'users', { name: 'Team', view: '', shared: true });
    const put = (bookmark: string | null) =>
      call(ROUTES.setDefault, {
        params: { collection: 'users' },
        token: reader.token,
        body: { bookmark },
      });
    const share = (value: boolean) =>
      call(ROUTES.patch, {
        params: { collection: 'users', uuid: shared.UUID },
        token: owner.token,
        body: { shared: value },
      });
    const chosen = async () =>
      ((await list('users', reader.token)).body as { default: unknown }).default;

    strictEqual((await put(shared.UUID)).status, 200);
    strictEqual(await chosen(), shared.UUID);
    strictEqual((await share(false)).status, 200);
    strictEqual(await chosen(), null);
    strictEqual((await share(true)).status, 200);
    strictEqual(await chosen(), shared.UUID);
  });

  it('reads the default past an app hook that scopes the defaults away', async () => {
    const reader = await signIn('scoped@list.example.com', ['reader']);
    const { UUID } = await save(reader.token, 'users', { name: 'Mine', view: '' });
    const put = await call(ROUTES.setDefault, {
      params: { collection: 'users' },
      token: reader.token,
      body: { bookmark: UUID },
    });
    strictEqual(put.status, 200);
    hook('query:filter', (ir) =>
      ir.collection === 'DashboardBookmarkDefaults' ? { ...ir, limit: 0 } : ir,
    );
    strictEqual(((await list('users', reader.token)).body as { default: unknown }).default, UUID);
  });
});
