import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type { Ref } from '../../../src/utils/reactive/ref.ts';

import { defineDashboardPage } from '../../../src/dashboard/router/define-dashboard-page.ts';
import { navigate, startRouter } from '../../../src/dashboard/router/router.ts';
import { useSearchParam } from '../../../src/dashboard/router/search-param.ts';
import { FakeElement } from '../_fake-dom.ts';
import { fakeBrowser, pageModule, settle, type FakeBrowser } from './_browser.ts';

describe('useSearchParam', () => {
  let browser: FakeBrowser;
  let builds = 0;
  let view!: Ref<'grid' | 'list'>;
  let page!: Ref<number>;
  let flag!: Ref<boolean>;
  let name!: Ref<string>;

  before(async () => {
    browser = fakeBrowser('/media?view=list&page=abc&flag=1&name=42');
    Object.assign(globalThis, {
      testPages: {
        media: defineDashboardPage(() => {
          builds++;
          view = useSearchParam('view', { fallback: 'grid', choices: ['grid', 'list'] });
          page = useSearchParam('page', { fallback: 1, history: 'push' });
          flag = useSearchParam('flag', { fallback: false });
          name = useSearchParam('name', { fallback: '' });
          return null;
        }),
        other: defineDashboardPage(() => null),
      },
    });
    await startRouter(
      [
        { pattern: '/media', url: pageModule('media') },
        { pattern: '/other', url: pageModule('other') },
      ],
      new FakeElement('div') as unknown as Element,
    );
    await settle();
  });

  it('reads a fitting value, any scalar as text, and a mismatched type as the fallback', () => {
    strictEqual(view.value, 'list');
    strictEqual(page.value, 1);
    strictEqual(flag.value, false);
    strictEqual(name.value, '42');
  });

  it('reads a value outside `choices` as the fallback', async () => {
    await navigate('/media?view=table');
    strictEqual(view.value, 'grid');
    strictEqual(name.value, '');
  });

  it('follows the URL in place, keeping the page', async () => {
    await navigate('/media?view=list&flag=true');
    strictEqual(view.value, 'list');
    strictEqual(flag.value, true);
    await settle();
    strictEqual(builds, 1);
  });

  it('removes the param when it writes the fallback, replacing history by default', () => {
    const replaces = browser.replaces.length;
    view.value = 'grid';
    strictEqual(location.search, '?flag=true');
    strictEqual(browser.replaces.length, replaces + 1);
    strictEqual(view.value, 'grid');
  });

  it('pushes history when asked to', () => {
    const pushes = browser.pushes.length;
    page.value = 2;
    deepStrictEqual(browser.pushes.slice(pushes), ['/media?flag=true&page=2']);
    strictEqual(page.value, 2);
  });

  it('round-trips text that would decode as another type', () => {
    name.value = '7';
    strictEqual(name.value, '7');
    name.value = 'true';
    strictEqual(name.value, 'true');
  });

  it('ignores a write once the location left the page', async () => {
    await navigate('/other');
    await settle();
    const writes = browser.pushes.length + browser.replaces.length;
    view.value = 'list';
    page.value = 3;
    strictEqual(browser.pushes.length + browser.replaces.length, writes);
    strictEqual(location.pathname, '/other');
  });
});
