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
