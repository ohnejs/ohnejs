import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type { FakeBrowser } from '../../../dashboard/router/_browser.ts';

import { defineDashboardPage } from '../../../../src/dashboard/router/define-dashboard-page.ts';
import { navigate, startRouter, useRoute } from '../../../../src/dashboard/router/router.ts';
import { effect, effectScope, onCleanup, untracked } from '../../../../src/utils/index.ts';
import { FakeElement } from '../../../dashboard/_fake-dom.ts';
import { pageModule, settle } from '../../../dashboard/router/_browser.ts';
import { baseBrowser } from '../_browser.ts';

type Popup = typeof import('../../../../src/base/dashboard/components/edit-table-field-popup.ts');

describe('the `edit` query param', () => {
  let browser!: FakeBrowser;
  let popup!: Popup;
  let builds = 0;
  const seen: string[][] = [];
  const arrivals: string[][] = [];

  before(async () => {
    browser = baseBrowser('/collections/posts?page=2');
    popup = await import('../../../../src/base/dashboard/components/edit-table-field-popup.ts');
    Object.assign(globalThis, {
      testPages: {
        posts: defineDashboardPage(() => {
          builds++;
          arrivals.push(popup.editQueryParam());
          return 'posts';
        }),
        tags: defineDashboardPage(() => {
          const route = untracked(useRoute);
          onCleanup(() => popup.setEditQueryParam(null, route));
          return 'tags';
        }),
      },
    });
    await startRouter(
      [
        { pattern: '/collections/posts', url: pageModule('posts') },
        { pattern: '/collections/tags', url: pageModule('tags') },
      ],
      new FakeElement('div') as unknown as Element,
    );
    await settle();
    effectScope().run(() => effect(() => void seen.push(popup.editQueryParam())));
  });

  it('opens over the live page, pushing history', () => {
    popup.setEditQueryParam(['title', 'abc']);
    deepStrictEqual(seen.at(-1), ['title', 'abc']);
    strictEqual(browser.pushes.at(-1), '/collections/posts?page=2&edit=[title,abc]');
    strictEqual(builds, 1);
  });

  it('closes when back drops the param, keeping the page', async () => {
    browser.popstate('/collections/posts?page=2');
    await settle();
    deepStrictEqual(seen.at(-1), []);
    strictEqual(builds, 1);
  });

  it('removes the param on `null`', () => {
    popup.setEditQueryParam(['body', 'xyz']);
    popup.setEditQueryParam(null);
    deepStrictEqual(seen.at(-1), []);
    strictEqual(browser.pushes.at(-1), '/collections/posts?page=2');
  });

  it('removes the param through a route bound before a query step', () => {
    const route = untracked(useRoute);
    popup.setEditQueryParam(['title', 'abc']);
    popup.setEditQueryParam(null, route);
    deepStrictEqual(seen.at(-1), []);
    strictEqual(browser.pushes.at(-1), '/collections/posts?page=2');
  });

  it('never writes from a page a pop tore down', async () => {
    await navigate('/collections/tags?edit=[name,tag]');
    await settle();
    const pushes = browser.pushes.length;
    browser.popstate('/collections/posts?edit=[title,xyz]');
    await settle();
    strictEqual(browser.pushes.length, pushes);
    strictEqual(location.pathname + location.search, '/collections/posts?edit=[title,xyz]');
    deepStrictEqual(arrivals.at(-1), ['title', 'xyz']);
    deepStrictEqual(seen.at(-1), ['title', 'xyz']);
  });
});
