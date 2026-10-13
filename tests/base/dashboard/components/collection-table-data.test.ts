import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type { TableURLState } from '../../../../src/base/dashboard/components/collection-table-state.ts';
import type { DashboardCollection } from '../../../../src/dashboard/runtime/meta-types.ts';

import { login } from '../../../../src/dashboard/runtime/session.ts';
import { baseBrowser } from '../_browser.ts';

const POSTS: DashboardCollection = {
  name: 'Posts',
  segment: 'posts',
  label: 'Posts',
  translatable: false,
  singleton: false,
  operations: {
    read: { allowed: true, public: false, scoped: false },
    create: null,
    update: null,
    delete: null,
  },
  fields: [],
  labelFields: [],
};

const VIEW: TableURLState = { page: 2, order: ['title'], where: undefined, columns: undefined };

/**
 * Signs in as the user `UUID`, answering the login request with that user.
 */
async function signIn(UUID: string): Promise<void> {
  const user = {
    UUID,
    email: 'a@b.c',
    roles: [],
    dashboardLanguage: null,
    contentLanguage: null,
    timezone: null,
    dateFormat: 'YYYY-MM-DD',
    timeFormat: 'HH:mm',
    smartClipboard: false,
  };
  Object.assign(globalThis, { fetch: async () => Response.json(user) });
  await login('a@b.c', 'secret');
}

describe('table view memory', () => {
  let data!: typeof import('../../../../src/base/dashboard/components/collection-table-data.ts');

  before(async () => {
    baseBrowser('/collections/posts');
    data = await import('../../../../src/base/dashboard/components/collection-table-data.ts');
    await signIn('ada');
    data.rememberView('posts', '?order=title');
    data.rememberPickerView('posts', VIEW);
  });

  it('keeps both memories when the same user signs in again in place', async () => {
    await signIn('ada');
    strictEqual(data.rememberedView(POSTS), '?order=title');
    deepStrictEqual(data.rememberedPickerView('posts'), VIEW);
  });

  it('forgets both memories when another user signs in', async () => {
    await signIn('grace');
    strictEqual(data.rememberedView(POSTS), '');
    strictEqual(data.rememberedPickerView('posts'), undefined);
  });
});

describe('loadTablePage', () => {
  let data!: typeof import('../../../../src/base/dashboard/components/collection-table-data.ts');
  const PAGE = { records: [], page: 1, lastPage: 1, perPage: 50, total: 0 };

  /**
   * Answers every request with `response`.
   */
  const answer = (response: () => Response): void => {
    Object.assign(globalThis, { fetch: async () => response() });
  };

  before(async () => {
    baseBrowser('/collections/posts');
    data = await import('../../../../src/base/dashboard/components/collection-table-data.ts');
  });

  it('resolves the page the endpoint answers', async () => {
    answer(() => Response.json(PAGE));
    deepStrictEqual(await data.loadTablePage('posts', {}), PAGE);
    deepStrictEqual(await data.loadPage('posts', {}), PAGE);
  });

  it('resolves the refused path of a `400`, which `loadPage` reads as a failure', async () => {
    const refusal = {
      statusCode: 400,
      message: 'Unknown field',
      data: { code: 'invalidField', path: 'where.x' },
    };
    answer(() => Response.json(refusal, { status: 400 }));
    deepStrictEqual(await data.loadTablePage('posts', {}), { refused: 'where.x' });
    strictEqual(await data.loadPage('posts', {}), undefined);
  });

  it('keeps an empty refused path, which ties the refusal to no part', async () => {
    const refusal = { data: { code: 'invalidPagination', path: '' } };
    answer(() => Response.json(refusal, { status: 400 }));
    deepStrictEqual(await data.loadTablePage('posts', {}), { refused: '' });
  });

  it('resolves `undefined` for any other failure', async () => {
    answer(() => Response.json({ data: { path: 'where.x' } }, { status: 403 }));
    strictEqual(await data.loadTablePage('posts', {}), undefined);
    answer(() => Response.json({ message: 'Bad body' }, { status: 400 }));
    strictEqual(await data.loadTablePage('posts', {}), undefined);
    answer(() => new Response('not json', { status: 400 }));
    strictEqual(await data.loadTablePage('posts', {}), undefined);
    answer(() => {
      throw new TypeError('offline');
    });
    strictEqual(await data.loadTablePage('posts', {}), undefined);
    strictEqual(await data.loadPage('posts', {}), undefined);
  });
});
