import { deepStrictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { defineDashboardPage } from '../../../src/dashboard/router/define-dashboard-page.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { FakeElement, hasClass } from '../_fake-dom.ts';
import { fakeBrowser, pageModule, settle } from '../router/_browser.ts';

const { navigate, startRouter } = await import('../../../src/dashboard/router/router.ts');
const { navTabs } = await import('../../../src/dashboard/ui/nav-tabs.ts');

const links = (root: HTMLElement): FakeElement[] =>
  (root as unknown as FakeElement).childNodes.filter((node) => node instanceof FakeElement);

const current = (root: HTMLElement): (string | null)[] =>
  links(root).map((link) => link.getAttribute('aria-current'));

describe('navTabs', () => {
  before(async () => {
    fakeBrowser('/guilds/1/members/7');
    Object.assign(globalThis, { testPages: { any: defineDashboardPage(() => null) } });
    await startRouter(
      [{ pattern: '/guilds/[...rest]', url: pageModule('any') }],
      new FakeElement('div') as unknown as Element,
    );
    await settle();
  });

  const tabs = (): HTMLElement =>
    navTabs([
      { label: 'Overview', href: '/guilds/1' },
      { label: 'Members', href: '/guilds/1/members?sort=name' },
      { label: 'Loot', href: '/guilds/1/loot' },
    ]);

  it('renders a real link per tab', () => {
    const root = tabs();
    deepStrictEqual(
      links(root).map((link) => [link.tagName, link.getAttribute('href'), link.textContent]),
      [
        ['A', '/guilds/1', 'Overview'],
        ['A', '/guilds/1/members?sort=name', 'Members'],
        ['A', '/guilds/1/loot', 'Loot'],
      ],
    );
  });

  it('lights the tab closest above the path and follows navigation', async () => {
    const root = tabs();
    flush();
    deepStrictEqual(current(root), [null, 'page', null]);
    deepStrictEqual(
      links(root).map((link) => hasClass(link, 'ohne-button-group-item-active')),
      [false, true, false],
    );
    await navigate('/guilds/1');
    await settle();
    deepStrictEqual(current(root), ['page', null, null]);
    await navigate('/guilds/2');
    await settle();
    deepStrictEqual(current(root), [null, null, null]);
  });
});
