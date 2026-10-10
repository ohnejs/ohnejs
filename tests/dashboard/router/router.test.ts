import { strictEqual } from 'node:assert';
import { after, before, describe, it, mock } from 'node:test';

import { navigate, startRouter } from '../../../src/dashboard/router/router.ts';
import { loadMessages } from '../../../src/dashboard/runtime/messages.ts';
import { writeDashboardLanguage } from '../../../src/dashboard/runtime/set-dashboard-language.ts';
import { translateMessage } from '../../../src/dashboard/runtime/use-t.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { FakeElement, FakeText } from '../_fake-dom.ts';

const CATALOGS: Record<string, Record<string, { template: string; language: string }>> = {
  nav: { 'nav.home': { template: 'Home', language: 'en' } },
  field: { 'field.required': { template: 'Required', language: 'en' } },
};

/**
 * Lets pending fetches and their continuations settle, then runs every queued effect.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  flush();
}

describe('startRouter', () => {
  let builds = 0;
  let nextBuilds = 0;
  let fieldAttempts = 0;
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
      page: () => {
        builds++;
        return new FakeText(
          `${translateMessage('nav.home')}|${translateMessage('field.required')}`,
        );
      },
      next: () => {
        nextBuilds++;
        return new FakeText('next');
      },
    });
    mock.timers.enable({ apis: ['setTimeout'] });
    mock.method(globalThis, 'fetch', async (url: string) => {
      const group = url.includes('/nav/') ? 'nav' : 'field';
      if (group === 'field' && ++fieldAttempts === 1) return new Response('{}', { status: 503 });
      return new Response(JSON.stringify(CATALOGS[group]));
    });
    const module = (name: string): string =>
      `data:text/javascript,${encodeURIComponent(`export default (r) => globalThis.${name}(r);`)}`;
    await startRouter(
      [
        { pattern: '/', url: module('page') },
        { pattern: '/next', url: module('next') },
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

  it('rebuilds the page once when the retry lands, repairing its translations', async () => {
    mock.timers.tick(3000);
    await settle();
    strictEqual(fieldAttempts, 2);
    strictEqual(builds, 2);
    strictEqual(container.textContent, 'Home|Required');
    mock.timers.tick(3000);
    await settle();
    strictEqual(builds, 2);
  });

  it('rebuilds the page once on a language switch', async () => {
    await loadMessages('de');
    writeDashboardLanguage('de');
    await settle();
    strictEqual(builds, 3);
  });

  it('builds only the arriving page when a language switch lands with a navigation', async () => {
    writeDashboardLanguage('en');
    void navigate('/next');
    for (let i = 0; i < 5; i++) await settle();
    strictEqual(builds, 3);
    strictEqual(nextBuilds, 1);
    strictEqual(container.textContent, 'next');
  });
});
