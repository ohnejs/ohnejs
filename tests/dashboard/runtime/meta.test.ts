import { strictEqual } from 'node:assert';
import { before, describe, it, mock } from 'node:test';

import { knownLabel, seedLabel } from '../../../src/dashboard/fields/labels.ts';
import { append } from '../../../src/dashboard/render/insert.ts';
import { when } from '../../../src/dashboard/render/when.ts';
import { dashboardMeta, invalidateDashboardMeta } from '../../../src/dashboard/runtime/meta.ts';
import { login, sessionUser } from '../../../src/dashboard/runtime/session.ts';
import { setDashboardLanguage } from '../../../src/dashboard/runtime/set-dashboard-language.ts';
import { isUndefined } from '../../../src/utils/is/is-undefined.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { FakeNode, FakeText } from '../_fake-dom.ts';

const ADMIN = {
  UUID: 'u',
  email: 'a@b.c',
  roles: ['admin', 'editor'],
  dashboardLanguage: null,
  contentLanguage: null,
  timezone: null,
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'HH:mm',
  smartClipboard: false,
};

/**
 * Lets pending fetches and their continuations settle, then runs every queued effect.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
  flush();
}

describe('dashboardMeta', () => {
  const root = new FakeNode();
  const stats = { pages: 0, empties: 0, fetches: 0 };
  let signedIn = ADMIN;

  before(async () => {
    Object.assign(document, {
      getElementById: () => ({
        textContent: JSON.stringify({
          apiURL: 'http://api',
          defaultLanguage: 'en',
          messageGroups: [],
        }),
      }),
    });
    mock.method(globalThis, 'fetch', async (url: string) => {
      if (url.endsWith('/dashboard')) {
        stats.fetches++;
        return new Response(JSON.stringify({ collections: [], locales: [], menu: [] }));
      }
      return new Response(JSON.stringify(signedIn));
    });
    sessionUser();
    await settle();
    append(
      root as unknown as Node,
      when(
        () => !isUndefined(dashboardMeta()),
        () => {
          stats.pages++;
          return new FakeText('page') as unknown as Node;
        },
        () => {
          stats.empties++;
          return new FakeText('empty') as unknown as Node;
        },
      ),
    );
    await settle();
  });

  it('builds the gated page once the first answer lands', () => {
    strictEqual(stats.pages, 1);
    strictEqual(stats.fetches, 1);
    strictEqual(root.textContent, 'page');
  });

  it('refreshes in place when the same user signs in again', async () => {
    await login('a@b.c', 'secret');
    await settle();
    strictEqual(stats.fetches, 2);
    strictEqual(stats.pages, 1);
    strictEqual(stats.empties, 1);
    strictEqual(root.textContent, 'page');
  });

  it('keeps the data while an invalidation refetches', async () => {
    invalidateDashboardMeta();
    await settle();
    strictEqual(stats.fetches, 3);
    strictEqual(stats.pages, 1);
    strictEqual(stats.empties, 1);
  });

  it('keeps the data on a language switch, fetching nothing', async () => {
    await setDashboardLanguage('de');
    await settle();
    strictEqual(stats.fetches, 3);
    strictEqual(stats.pages, 1);
    strictEqual(stats.empties, 1);
  });

  it('keeps resolved labels when the same user signs in again', async () => {
    seedLabel('Notes', 'n1', 'Note one');
    await login('a@b.c', 'secret');
    await settle();
    strictEqual(knownLabel('Notes', 'n1'), 'Note one');
  });

  it('empties the store and the labels when the same user signs in with other roles', async () => {
    signedIn = { ...ADMIN, roles: ['editor'] };
    await login('a@b.c', 'secret');
    await settle();
    strictEqual(stats.pages, 2);
    strictEqual(root.textContent, 'page');
    strictEqual(knownLabel('Notes', 'n1'), undefined);
  });
});
