import { strictEqual } from 'node:assert';
import { after, before, describe, it, mock } from 'node:test';

import { navigate, startRouter } from '../../../src/dashboard/router/router.ts';
import { loadLanguage } from '../../../src/dashboard/runtime/messages.ts';
import {
  requestDashboardLanguage,
  setDashboardLanguage,
} from '../../../src/dashboard/runtime/set-dashboard-language.ts';
import { useDashboardLanguage } from '../../../src/dashboard/runtime/use-dashboard-language.ts';
import { translateMessage } from '../../../src/dashboard/runtime/use-t.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { FakeElement, FakeText } from '../_fake-dom.ts';

const WORDS: Record<string, [home: string, required: string]> = {
  en: ['Home', 'Required'],
  de: ['Start', 'Pflichtfeld'],
  bs: ['Početna', 'Obavezno'],
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
