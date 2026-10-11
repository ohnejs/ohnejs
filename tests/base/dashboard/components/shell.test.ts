import { ok, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import type { FakeBrowser } from '../../../dashboard/router/_browser.ts';

import { defineDashboardPage } from '../../../../src/dashboard/router/define-dashboard-page.ts';
import { useFrame } from '../../../../src/dashboard/router/page-frame.ts';
import { navigate, startRouter } from '../../../../src/dashboard/router/router.ts';
import { logout } from '../../../../src/dashboard/runtime/session.ts';
import { nextTick } from '../../../../src/utils/index.ts';
import { FakeElement, findElement, hasClass } from '../../../dashboard/_fake-dom.ts';
import { pageModule, settle } from '../../../dashboard/router/_browser.ts';
import { baseBrowser } from '../_browser.ts';

type Shell = typeof import('../../../../src/base/dashboard/components/shell.ts');

describe('the base frame', () => {
  const container = new FakeElement('div');
  const builds = { home: 0, wide: 0, login: 0 };
  let browser!: FakeBrowser;
  let shell!: Shell;

  const find = (name: string) =>
    findElement(container, (element) => element.classList.has(name) || hasClass(element, name));

  before(async () => {
    browser = baseBrowser('/home');
    Object.assign(globalThis, {
      fetch: async (url: string) =>
        url.endsWith('/auth/me')
          ? Response.json({ UUID: 'u1', email: 'a@b.c' })
          : new Response(null, { status: 404 }),
      testPages: {
        home: defineDashboardPage(() => {
          builds.home++;
          useFrame({ fill: true });
          return 'home';
        }),
        wide: defineDashboardPage(() => {
          builds.wide++;
          useFrame({ wide: true });
          return 'wide';
        }),
        login: defineDashboardPage(
          () => {
            builds.login++;
            return 'login';
          },
          { frame: false },
        ),
      },
    });
    shell = await import('../../../../src/base/dashboard/components/shell.ts');
    await import('../../../../src/base/dashboard/boot/shell.ts');
    await startRouter(
      [
        { pattern: '/home', url: pageModule('home') },
        { pattern: '/wide', url: pageModule('wide') },
        { pattern: '/login', url: pageModule('login') },
      ],
      container as unknown as Element,
    );
    for (let i = 0; i < 3; i++) await settle();
  });

  it('builds the page inside the main area once signed in, following `fill`', () => {
    strictEqual(builds.home, 1);
    strictEqual(find('o-main-content')?.textContent, 'home');
    strictEqual(find('o-main')?.classList.has('o-main-fill'), true);
    strictEqual(hasClass(find('o-layout') as FakeElement, 'o-layout-wide'), false);
  });

  it('keeps the frame across pages, following `wide`', async () => {
    const header = find('o-header');
    await navigate('/wide');
    await settle();
    strictEqual(builds.wide, 1);
    strictEqual(find('o-header'), header);
    strictEqual(find('o-main-content')?.textContent, 'wide');
    strictEqual(find('o-main')?.classList.has('o-main-fill'), false);
    ok(hasClass(find('o-layout') as FakeElement, 'o-layout-wide'));
  });

  it('closes the expanded sidebar on a query step', async () => {
    shell.toggleSidebar();
    await nextTick();
    strictEqual(shell.sidebarExpanded(), true);
    await navigate('/wide?tab=2');
    await nextTick();
    strictEqual(shell.sidebarExpanded(), false);
    strictEqual(builds.wide, 1);
  });

  it('redirects a signed-out session to the login page, carrying `next`', async () => {
    shell.toggleSidebar();
    await nextTick();
    await logout();
    for (let i = 0; i < 3; i++) await settle();
    strictEqual(browser.pushes.at(-1), '/login?next=/wide');
    strictEqual(builds.login, 1);
    strictEqual(container.textContent, 'login');
    strictEqual(shell.sidebarExpanded(), false);
  });
});
