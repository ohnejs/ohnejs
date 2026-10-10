import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, before, describe, it, mock } from 'node:test';

import {
  loadMessages,
  messageCatalog,
  messageRepairs,
} from '../../../src/dashboard/runtime/messages.ts';
import { useDashboardLanguage } from '../../../src/dashboard/runtime/use-dashboard-language.ts';

const NAV = { 'nav.home': { template: 'Start', language: 'de' } };
const FIELD = { 'field.required': { template: 'Pflichtfeld', language: 'de' } };

/**
 * Answers each request with `respond`'s status and JSON body, recording every requested URL.
 */
function serve(respond: (url: string) => [number, unknown]): string[] {
  const urls: string[] = [];
  mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    const [status, body] = respond(url);
    return new Response(JSON.stringify(body), { status });
  });
  return urls;
}

/**
 * Answers each group's catalog by the group named in the URL.
 */
function catalogs(url: string): [number, unknown] {
  return [200, url.includes('/nav/') ? NAV : FIELD];
}

/**
 * Lets pending fetches and their continuations settle.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('loadMessages', () => {
  before(() => {
    Object.assign(globalThis, {
      document: {
        getElementById: () => ({
          textContent: JSON.stringify({
            apiURL: 'http://api',
            defaultLanguage: 'en',
            messageGroups: ['nav', 'field'],
          }),
        }),
      },
    });
  });

  afterEach(() => {
    mock.restoreAll();
    mock.timers.reset();
  });

  it('fetches every listed group in parallel, so a later read answers at once and fetches nothing', async () => {
    const urls: string[] = [];
    const pending: (() => void)[] = [];
    mock.method(globalThis, 'fetch', (url: string) => {
      urls.push(url);
      const body = url.includes('/nav/') ? NAV : FIELD;
      return new Promise<Response>((resolve) =>
        pending.push(() => resolve(new Response(JSON.stringify(body)))),
      );
    });
    const load = loadMessages('de');
    await settle();
    deepStrictEqual(urls, ['http://api/messages/nav/de', 'http://api/messages/field/de']);
    for (const answer of pending) answer();
    await load;
    deepStrictEqual(messageCatalog('de', 'nav'), NAV);
    deepStrictEqual(messageCatalog('de', 'field'), FIELD);
    strictEqual(urls.length, 2);
  });

  it('loads a language once', async () => {
    const urls = serve(catalogs);
    await loadMessages('fr');
    await loadMessages('fr');
    strictEqual(urls.length, 2);
  });

  it('settles after a failed first attempt and never rejects', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await loadMessages('it');
    deepStrictEqual(messageCatalog('it', 'nav'), {});
    mock.restoreAll();
    serve(catalogs);
    mock.timers.tick(3000);
    await settle();
    deepStrictEqual(messageCatalog('it', 'nav'), NAV);
  });

  it('repairs the dashboard language once every failed group has loaded on retry', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const before = messageRepairs();
    serve(() => [503, {}]);
    await loadMessages('en');
    mock.restoreAll();
    let calls = 0;
    serve((url) => (url.includes('/nav/') || ++calls > 1 ? catalogs(url) : [503, {}]));
    mock.timers.tick(3000);
    await settle();
    strictEqual(messageRepairs(), before);
    mock.timers.tick(3000);
    await settle();
    strictEqual(messageRepairs(), before + 1);
  });

  it('does not repair a load that succeeds at once, or one for another language', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const before = messageRepairs();
    const language = useDashboardLanguage();
    language.value = 'bs';
    serve(catalogs);
    await loadMessages('bs');
    mock.restoreAll();
    serve(() => [500, {}]);
    await loadMessages('pt');
    mock.restoreAll();
    serve(catalogs);
    mock.timers.tick(3000);
    await settle();
    deepStrictEqual(messageCatalog('pt', 'nav'), NAV);
    strictEqual(messageRepairs(), before);
    language.value = 'en';
  });
});
