import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type { TableURLState } from '../../../../src/base/dashboard/components/collection-table-state.ts';
import type {
  DashboardCollection,
  DashboardField,
  DashboardMeta,
} from '../../../../src/dashboard/runtime/meta-types.ts';

import { dashboardMeta, invalidateDashboardMeta } from '../../../../src/dashboard/runtime/meta.ts';
import { login } from '../../../../src/dashboard/runtime/session.ts';
import { settle } from '../../../dashboard/router/_browser.ts';
import { baseBrowser } from '../_browser.ts';

const POSTS: DashboardCollection = {
  name: 'Posts',
  segment: 'posts',
  label: 'Posts',
  translatable: false,
  singleton: false,
  duplicable: false,
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

describe('rememberedView', () => {
  let data!: typeof import('../../../../src/base/dashboard/components/collection-table-data.ts');
  const named = (name: string): DashboardCollection => ({
    ...POSTS,
    name,
    segment: name.toLowerCase(),
  });
  const meta: DashboardMeta = {
    menu: [],
    collections: [],
    blocks: [],
    roles: [],
    capabilities: [],
    routes: [],
    locales: ['en'],
    defaultLocale: 'en',
    languages: ['en'],
    accountFields: [],
    accountLayout: [],
    defaultViews: {
      Notes: { bookmark: 'b-notes', view: 'order=title' },
      Tags: { bookmark: 'b-tags', view: '' },
    },
  };

  before(async () => {
    baseBrowser('/collections/notes');
    data = await import('../../../../src/base/dashboard/components/collection-table-data.ts');
    await signIn('linus');
    Object.assign(globalThis, {
      fetch: async (url: string) =>
        url.endsWith('/dashboard') ? Response.json(meta) : new Response(null, { status: 404 }),
    });
    invalidateDashboardMeta();
    dashboardMeta();
    await settle();
  });

  it("falls back to the user's default view, prefixed for `location.search`", () => {
    strictEqual(data.rememberedView(named('Notes')), '?order=title');
  });

  it('keeps an empty default view bare, without a stray `?`', () => {
    strictEqual(data.rememberedView(named('Tags')), '');
  });

  it('answers an empty view without a memory or a default', () => {
    strictEqual(data.rememberedView(named('Drafts')), '');
  });

  it('prefers the remembered view over the default, an empty one included', () => {
    data.rememberView('notes', '?page=2');
    strictEqual(data.rememberedView(named('Notes')), '?page=2');
    data.rememberView('notes', '');
    strictEqual(data.rememberedView(named('Notes')), '');
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

describe('defaultOrder', () => {
  let data!: typeof import('../../../../src/base/dashboard/components/collection-table-data.ts');
  const column = (name: string, readable = true) =>
    ({ name, kind: 'column', logicalType: 'text', readable }) as DashboardField;
  const fields = [
    column('_updatedAt'),
    column('title'),
    column('due'),
    column('secret', false),
    { name: 'tags', kind: 'records', readable: true } as DashboardField,
  ];
  const ordered = (order?: readonly string[]): DashboardCollection => ({
    ...POSTS,
    fields,
    ...(order ? { table: { order } } : {}),
  });

  before(async () => {
    baseBrowser('/collections/posts');
    data = await import('../../../../src/base/dashboard/components/collection-table-data.ts');
  });

  it('returns the declared order', () => {
    deepStrictEqual(data.defaultOrder(ordered(['title', '-due'])), ['title', '-due']);
  });

  it('drops an entry the viewer cannot read or the table cannot sort by', () => {
    deepStrictEqual(data.defaultOrder(ordered(['-secret', 'tags', 'due', 'gone'])), ['due']);
  });

  it('falls back to newest updated first when nothing is declared or nothing is left', () => {
    deepStrictEqual(data.defaultOrder(ordered()), ['-_updatedAt']);
    deepStrictEqual(data.defaultOrder(ordered(['secret'])), ['-_updatedAt']);
  });
});
