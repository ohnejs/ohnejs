import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { queryUntyped } from '../../../../../../src/ohne/query/query.ts';
import { call, errorsOf, ROUTES, signIn } from './_fixture.ts';

const me = await signIn('me@create.example.com', ['reader']);
const sharer = await signIn('sharer@create.example.com', ['sharer']);

/**
 * Saves `body` as a bookmark of `collection` as the holder of `token`.
 */
function create(
  collection: string,
  body: unknown,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  return call(ROUTES.create, { params: { collection }, token, body });
}

describe('POST /dashboard/bookmarks/[collection]', () => {
  it('401s an anonymous caller', async () => {
    strictEqual((await create('blog-posts', { name: 'A', view: '' })).status, 401);
  });

  it('404s an unknown, a singleton, and an unreadable collection before reading the body', async () => {
    for (const segment of ['nope', 'settings', 'drafts', 'secrets']) {
      strictEqual((await create(segment, { name: 'A', view: '' }, me.token)).status, 404, segment);
      strictEqual((await create(segment, { name: 1 }, me.token)).status, 404, segment);
    }
  });

  it('answers 201 with a private bookmark the caller owns, ignoring a body `user`', async () => {
    const { status, body } = await create(
      'blog-posts',
      { name: 'Recent', view: 'order=[-title]', user: sharer.uuid },
      me.token,
    );
    strictEqual(status, 201);
    const entry = body as { UUID: string };
    deepStrictEqual(body, {
      UUID: entry.UUID,
      name: 'Recent',
      view: 'order=[-title]',
      shared: false,
      mine: true,
    });
    const stored = await queryUntyped('DashboardBookmarks').where({ UUID: entry.UUID }).findFirst();
    strictEqual(stored?.user, me.uuid);
    strictEqual(stored?.collection, 'BlogPosts');
  });

  it('400s a body without a name or a view, or with a value of the wrong type', async () => {
    for (const body of [
      null,
      [],
      {},
      { name: 'A' },
      { view: '' },
      { name: 1, view: '' },
      { name: 'A', view: 2 },
      { name: 'A', view: '', shared: 'yes' },
    ]) {
      strictEqual((await create('blog-posts', body, me.token)).status, 400, JSON.stringify(body));
    }
  });

  it('403s sharing without `dashboard.bookmarks.share`, and shares with it', async () => {
    const refused = await create('blog-posts', { name: 'A', view: '', shared: true }, me.token);
    strictEqual(refused.status, 403);
    const shared = await create('blog-posts', { name: 'A', view: '', shared: true }, sharer.token);
    strictEqual(shared.status, 201);
    strictEqual((shared.body as { shared: boolean }).shared, true);
  });

  it('422s an empty or an overlong name at `name`', async () => {
    const empty = await create('blog-posts', { name: '', view: '' }, me.token);
    strictEqual(empty.status, 422);
    deepStrictEqual(errorsOf(empty.body), { name: 'validation.emptyValue' });
    const long = await create('blog-posts', { name: 'x'.repeat(121), view: '' }, me.token);
    strictEqual(long.status, 422);
    deepStrictEqual(errorsOf(long.body), { name: 'validation.maxLength' });
  });

  it("422s a view that is not a table's query string at `view`", async () => {
    for (const view of [
      '?order=[title]',
      '#order=[title]',
      'page=2',
      'edit=abc',
      'order',
      'order=[1]',
      'columns={a:1}',
      'where=abc',
      'where={title:null}',
    ]) {
      const { status, body } = await create('blog-posts', { name: 'A', view }, me.token);
      strictEqual(status, 422, view);
      deepStrictEqual(errorsOf(body), { view: 'validation.invalidValue' }, view);
    }
  });

  it('accepts every view part a table writes, and the declared view', async () => {
    for (const view of [
      '',
      'order=[-title,_updatedAt]',
      'order=title',
      'where={or:[{title:A},{title:{contains:B}}]}',
      'columns=[title|200px,_updatedAt]',
      'columns=[]',
    ]) {
      strictEqual((await create('blog-posts', { name: 'A', view }, me.token)).status, 201, view);
    }
  });
});
