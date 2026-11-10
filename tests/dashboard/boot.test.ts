import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it, mock } from 'node:test';

import { defineDashboardPage } from '../../src/dashboard/router/define-dashboard-page.ts';
import { sessionUser, setLanguageFallback } from '../../src/dashboard/runtime/session.ts';
import { useDashboardLanguage } from '../../src/dashboard/runtime/use-dashboard-language.ts';
import { translateMessage } from '../../src/dashboard/runtime/use-t.ts';
import { FakeElement } from './_fake-dom.ts';
import { fakeBrowser, pageModule } from './router/_browser.ts';

const HOME: Record<string, string> = { en: 'Home', bs: 'Početna' };

const module = (body: string): string => `data:text/javascript,${encodeURIComponent(body)}`;

describe('the dashboard kernel', () => {
  it('builds the first page in the language a later boot file picks for a signed-out visitor', async () => {
    fakeBrowser('/login');
    const app = new FakeElement('div');
    const fetched: string[] = [];
    const builds: string[] = [];
    const answered = Promise.withResolvers<void>();
    Object.assign(document, {
      getElementById: (id: string) =>
        id === 'app'
          ? app
          : {
              textContent: JSON.stringify({
                apiURL: 'http://api',
                defaultLanguage: 'en',
                messageGroups: ['nav'],
                pages: [{ pattern: '/login', url: pageModule('login') }],
                boot: [
                  module('globalThis.readSession();'),
                  module('await globalThis.answered; globalThis.pickLanguage();'),
                ],
              }),
            },
    });
    Object.assign(globalThis, {
      window: { addEventListener: () => {}, dispatchEvent: () => true },
      answered: answered.promise.then(() => new Promise((resolve) => setTimeout(resolve, 10))),
      readSession: sessionUser,
      pickLanguage: () => setLanguageFallback(() => 'bs'),
      testPages: {
        login: defineDashboardPage(
          () => {
            builds.push(useDashboardLanguage().value);
            return () => translateMessage('nav.home');
          },
          { frame: false },
        ),
      },
    });
    mock.method(globalThis, 'fetch', async (url: string) => {
      fetched.push(url);
      if (url.endsWith('/auth/me')) {
        answered.resolve();
        return new Response(null, { status: 204 });
      }
      const language = url.split('/').at(-1)!;
      return new Response(JSON.stringify({ 'nav.home': { template: HOME[language], language } }));
    });
    await import('../../src/dashboard/boot.ts');
    deepStrictEqual(builds, ['bs']);
    strictEqual(app.textContent, 'Početna');
    deepStrictEqual(fetched, [
      'http://api/auth/me',
      'http://api/messages/nav/en',
      'http://api/messages/nav/bs',
    ]);
  });
});
