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
  const gestures = new Map<string, (event: unknown) => void>();

  const find = (name: string) =>
    findElement(container, (element) => element.classList.has(name) || hasClass(element, name));

  before(async () => {
    browser = baseBrowser('/home');
    const record = (type: string, listener: (event: unknown) => void) =>
      gestures.set(type, listener);
    const matchMedia = (query: string) => ({
      matches: query === '(max-width: 1024px)',
      addEventListener() {},
      removeEventListener() {},
    });
    const classes = new Set<string>();
    Object.assign(document.body, {
      addEventListener: record,
      classList: Object.assign(classes, { remove: (name: string) => classes.delete(name) }),
    });
    Object.assign(document, { addEventListener: record });
    Object.assign(window, { matchMedia });
    Object.assign(globalThis, {
      matchMedia,
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

  it('opens the drawer on an edge swipe, unless a popup is up or the gesture scrolled', async () => {
    const swipe = async (scrolls = false) => {
      gestures.get('touchstart')?.({ touches: [{ clientX: 10, clientY: 300 }] });
      if (scrolls) gestures.get('scroll')?.({});
      gestures.get('touchend')?.({ changedTouches: [{ clientX: 220, clientY: 305 }] });
      await nextTick();
    };
    const { acquireOverlay } = await import('../../../../src/dashboard/ui/overlay.ts');
    const overlay = acquireOverlay();
    await swipe();
    strictEqual(shell.sidebarExpanded(), false);
    overlay.release();
    await swipe(true);
    strictEqual(shell.sidebarExpanded(), false);
    await swipe();
    strictEqual(shell.sidebarExpanded(), true);
    shell.toggleSidebar();
    await nextTick();
    strictEqual(shell.sidebarExpanded(), false);
  });

  it('leaves an edge swipe to a control that drags sideways itself', async () => {
    const track = new FakeElement('div');
    const thumb = new FakeElement('input');
    thumb.parentNode = track;
    const actions = new Map([[track, 'pan-y']]);
    const computed = globalThis.getComputedStyle;
    Object.assign(globalThis, {
      getComputedStyle: (node: FakeElement) => ({
        getPropertyValue: () => '1ms',
        touchAction: actions.get(node) ?? 'auto',
      }),
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 320));
    const swipe = async (target: FakeElement) => {
      gestures.get('touchstart')?.({ target, touches: [{ clientX: 10, clientY: 300 }] });
      gestures.get('touchend')?.({ changedTouches: [{ clientX: 220, clientY: 305 }] });
      await nextTick();
    };
    await settle();
    await swipe(thumb);
    strictEqual(shell.sidebarExpanded(), false);
    actions.set(track, 'manipulation');
    await swipe(thumb);
    strictEqual(shell.sidebarExpanded(), true);
    shell.toggleSidebar();
    await settle();
    Object.assign(globalThis, { getComputedStyle: computed });
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
