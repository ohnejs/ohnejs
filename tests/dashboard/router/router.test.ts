import { strictEqual } from 'node:assert';
import { after, before, describe, it, mock } from 'node:test';

import type { RouteContext } from '../../../src/dashboard/router/router.ts';

import { h } from '../../../src/dashboard/render/h.ts';
import { defineDashboardPage } from '../../../src/dashboard/router/define-dashboard-page.ts';
import { registerPageFrame, useFrame } from '../../../src/dashboard/router/page-frame.ts';
import { loadLanguage } from '../../../src/dashboard/runtime/messages.ts';
import {
  requestDashboardLanguage,
  setDashboardLanguage,
} from '../../../src/dashboard/runtime/set-dashboard-language.ts';
import { useDashboardLanguage } from '../../../src/dashboard/runtime/use-dashboard-language.ts';
import { translateMessage } from '../../../src/dashboard/runtime/use-t.ts';
import { FakeElement, FakeText, findElement } from '../_fake-dom.ts';
import { fakeBrowser, pageModule, settle, type FakeBrowser } from './_browser.ts';

const { navigate, startRouter } = await import('../../../src/dashboard/router/router.ts');

const WORDS: Record<string, [home: string, required: string]> = {
  en: ['Home', 'Required'],
  de: ['Start', 'Pflichtfeld'],
  bs: ['Početna', 'Obavezno'],
};

describe('startRouter', () => {
  let builds = 0;
  let nextBuilds = 0;
  let fieldAttempts = 0;
  let release!: () => void;
  const container = new FakeElement('div');

  before(async () => {
    Object.assign(document, {
      title: '',
      addEventListener: () => {},
      getElementById: () => ({
        textContent: JSON.stringify({
          apiURL: 'http://api',
          defaultLanguage: 'en',
          messageGroups: ['nav', 'field'],
        }),
      }),
    });
    Object.assign(globalThis, {
      window: { addEventListener: () => {} },
      location: { pathname: '/', search: '', hash: '' },
      history: { pushState: (_: unknown, __: string, path: string) => (location.pathname = path) },
      gate: new Promise<void>((resolve) => (release = resolve)),
      page: () => {
        builds++;
        return () => `${translateMessage('nav.home')}|${translateMessage('field.required')}`;
      },
      next: () => {
        nextBuilds++;
        return new FakeText('next');
      },
    });
    mock.timers.enable({ apis: ['setTimeout'] });
    mock.method(globalThis, 'fetch', async (url: string) => {
      const [group, language] = url.split('/').slice(-2);
      if (group === 'field' && ++fieldAttempts === 1) return new Response('{}', { status: 503 });
      const [home, required] = WORDS[language];
      const catalog =
        group === 'nav'
          ? { 'nav.home': { template: home, language } }
          : { 'field.required': { template: required, language } };
      return new Response(JSON.stringify(catalog));
    });
    const module = (body: string): string => `data:text/javascript,${encodeURIComponent(body)}`;
    await startRouter(
      [
        { pattern: '/', url: module('export default (r) => globalThis.page(r);') },
        {
          pattern: '/next',
          url: module('await globalThis.gate; export default (r) => globalThis.next(r);'),
        },
      ],
      container as unknown as Element,
    );
    await settle();
  });

  after(() => {
    mock.restoreAll();
    mock.timers.reset();
  });

  it('mounts after a failed first attempt, building the page once with the missing key raw', () => {
    strictEqual(builds, 1);
    strictEqual(container.textContent, 'Home|field.required');
  });

  it('fills the repaired translation in place without rebuilding', async () => {
    mock.timers.tick(3000);
    await settle();
    strictEqual(fieldAttempts, 2);
    strictEqual(builds, 1);
    strictEqual(container.textContent, 'Home|Required');
  });

  it('keeps the page on a language switch, re-rendering its text', async () => {
    await setDashboardLanguage('de');
    await settle();
    strictEqual(useDashboardLanguage().value, 'de');
    strictEqual(builds, 1);
    strictEqual(container.textContent, 'Start|Pflichtfeld');
  });

  it('keeps the outgoing page in its language until the arriving page publishes', async () => {
    await loadLanguage('bs');
    requestDashboardLanguage('bs');
    void navigate('/next');
    for (let i = 0; i < 5; i++) {
      await settle();
      strictEqual(container.textContent, 'Start|Pflichtfeld');
      strictEqual(useDashboardLanguage().value, 'de');
    }
    release();
    for (let i = 0; i < 5; i++) await settle();
    strictEqual(nextBuilds, 1);
    strictEqual(container.textContent, 'next');
    strictEqual(useDashboardLanguage().value, 'bs');
  });
});

describe('startRouter with a page frame', () => {
  const container = new FakeElement('div');
  const counts = { frames: 0, home: 0, b: 0, logout: 0, slow: 0, guard: 0 };
  let router!: typeof import('../../../src/dashboard/router/router.ts');
  let browser!: FakeBrowser;
  let home!: RouteContext;
  let release!: () => void;

  /**
   * The frame's root element, which carries the merged options as its class.
   */
  const frameRoot = () => findElement(container, (element) => element.tagName === 'DIV');

  /**
   * The load failure the router rendered, found by its alert role.
   */
  const failure = () =>
    findElement(container, (element) => element.getAttribute('role') === 'alert');

  before(async () => {
    browser = fakeBrowser('/');
    router = (await import(
      new URL('../../../src/dashboard/router/router.ts?frame', import.meta.url).href
    )) as typeof router;
    registerPageFrame(({ content, options }) => {
      counts.frames++;
      return h('div', { class: () => (options().fill ? 'fill' : 'plain') }, '[', content, ']');
    });
    Object.assign(globalThis, {
      gate: new Promise<void>((resolve) => (release = resolve)),
      testPages: {
        home: defineDashboardPage((route) => {
          counts.home++;
          home = route;
          useFrame({ fill: true });
          return 'home';
        }),
        b: defineDashboardPage(() => {
          counts.b++;
          return 'b';
        }),
        logout: defineDashboardPage(
          () => {
            counts.logout++;
            return 'logout';
          },
          { frame: false },
        ),
        plain: () => 'plain',
        slow: defineDashboardPage(() => {
          counts.slow++;
          return 'slow';
        }),
      },
    });
    const slow = 'await globalThis.gate; export default globalThis.testPages.slow;';
    await router.startRouter(
      [
        { pattern: '/', url: pageModule('home') },
        { pattern: '/b', url: pageModule('b') },
        { pattern: '/logout', url: pageModule('logout') },
        { pattern: '/plain', url: pageModule('plain') },
        { pattern: '/slow', url: `data:text/javascript,${encodeURIComponent(slow)}` },
        { pattern: '/broken', url: `data:text/javascript,${encodeURIComponent('throw 0;')}` },
      ],
      container as unknown as Element,
    );
    await settle();
  });

  it('mounts the frame once across framed pages, following their options', async () => {
    strictEqual(container.textContent, '[home]');
    strictEqual(frameRoot()?.getAttribute('class'), 'fill');
    await router.navigate('/b');
    await settle();
    strictEqual(container.textContent, '[b]');
    strictEqual(frameRoot()?.getAttribute('class'), 'plain');
    strictEqual(counts.frames, 1);
    strictEqual(counts.home, 1);
    strictEqual(counts.b, 1);
  });

  it('builds each page once on a swap between framed and bare', async () => {
    await router.navigate('/logout');
    await settle();
    strictEqual(container.textContent, 'logout');
    strictEqual(counts.logout, 1);
    strictEqual(counts.b, 1);
    await router.navigate('/');
    await settle();
    strictEqual(container.textContent, '[home]');
    strictEqual(counts.home, 2);
    strictEqual(counts.frames, 2);
    strictEqual(counts.logout, 1);
  });

  it('renders a page without a `frame` flag framed', async () => {
    await router.navigate('/plain');
    await settle();
    strictEqual(container.textContent, '[plain]');
  });

  it('renders an unmatched location framed', async () => {
    await router.navigate('/nope');
    await settle();
    strictEqual(container.textContent, '[Not found]');
    strictEqual(router.useRoute(), null);
  });

  it('reloads the page once when a page module fails to load', async () => {
    const logged = mock.method(console, 'error', () => {});
    await router.navigate('/b');
    await settle();
    await router.navigate('/broken');
    await settle();
    logged.mock.restore();
    strictEqual(browser.reloads, 1);
    strictEqual(sessionStorage.getItem('ohne-reloaded'), '1');
    strictEqual(failure(), undefined);
  });

  it('renders a page whose module fails to load as a load failure on its route', async () => {
    const logged = mock.method(console, 'error', () => {});
    sessionStorage.setItem('ohne-reloaded', '1');
    await router.navigate('/b');
    await settle();
    await router.navigate('/broken');
    await settle();
    logged.mock.restore();
    strictEqual(logged.mock.callCount(), 1);
    strictEqual(browser.reloads, 1);
    strictEqual(container.textContent, '[Failed to loadRetry]');
    strictEqual(router.useRoute()?.path, '/broken');
    strictEqual(failure()?.classList.has('ohne-load-failed'), true);
    strictEqual(failure()?.classList.has('ohne-load-failed-bare'), false);
  });

  it('keeps a bare page bare when the next page fails to load', async () => {
    const logged = mock.method(console, 'error', () => {});
    sessionStorage.setItem('ohne-reloaded', '1');
    await router.navigate('/logout');
    await settle();
    await router.navigate('/broken');
    await settle();
    logged.mock.restore();
    strictEqual(container.textContent, 'Failed to loadRetry');
    strictEqual(failure()?.classList.has('ohne-load-failed-bare'), true);
  });

  it('keeps the page on a query step and updates `query` synchronously', async () => {
    await router.navigate('/');
    await settle();
    const builds = counts.home;
    const route = router.useRoute();
    void router.navigate('/?tab=2', { replace: true });
    strictEqual(home.query.tab, 2);
    strictEqual(router.lastNavigation(), 'navigate');
    void router.navigate('/?tab=2#top');
    strictEqual(home.query.tab, 2);
    await settle();
    strictEqual(counts.home, builds);
    strictEqual(router.useRoute(), route);
    strictEqual(container.textContent, '[home]');
  });

  it('skips the guard on a same-pathname step, by `navigate` and by `popstate`', async () => {
    router.setNavigationGuard(() => {
      counts.guard++;
      return false;
    });
    strictEqual(await router.navigate('/?tab=3'), true);
    strictEqual(home.query.tab, 3);
    browser.popstate('/?tab=2');
    strictEqual(home.query.tab, 2);
    strictEqual(router.lastNavigation(), 'popstate');
    strictEqual(counts.guard, 0);
    strictEqual(await router.navigate('/b'), false);
    strictEqual(counts.guard, 1);
    strictEqual(location.pathname, '/');
    router.setNavigationGuard(null);
  });

  it('renders in full on a query step while a render is pending', async () => {
    const builds = counts.home;
    void router.navigate('/slow');
    await settle();
    void router.navigate('/?tab=9');
    await settle();
    strictEqual(counts.home, builds + 1);
    strictEqual(home.query.tab, 9);
    release();
    await settle();
    strictEqual(counts.slow, 0);
    strictEqual(container.textContent, '[home]');
  });
});
