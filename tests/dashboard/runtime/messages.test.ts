import { deepStrictEqual, strictEqual } from 'node:assert';
import { afterEach, before, describe, it, mock } from 'node:test';

import { loadLanguage, messageCatalog } from '../../../src/dashboard/runtime/messages.ts';

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

describe('loadLanguage', () => {
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
    const load = loadLanguage('de');
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
    await loadLanguage('fr');
    await loadLanguage('fr');
    strictEqual(urls.length, 2);
  });

  it('settles after a failed first attempt and never rejects', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    mock.method(globalThis, 'fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await loadLanguage('it');
    deepStrictEqual(messageCatalog('it', 'nav'), {});
    mock.restoreAll();
    serve(catalogs);
    mock.timers.tick(3000);
    await settle();
    deepStrictEqual(messageCatalog('it', 'nav'), NAV);
  });

  it("shows the dashboard server's default-language catalog while the API cannot answer", async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const fallback = { 'nav.home': { template: 'Home', language: 'en' } };
    const urls = serve((url) =>
      url.startsWith('http://api/')
        ? [503, {}]
        : [200, url.endsWith('/messages/nav') ? fallback : {}],
    );
    await loadLanguage('nl');
    deepStrictEqual(messageCatalog('nl', 'nav'), fallback);
    strictEqual(urls.filter((url) => url.endsWith('/messages/nav')).length, 1);
    mock.restoreAll();
    serve(catalogs);
    mock.timers.tick(3000);
    await settle();
    deepStrictEqual(messageCatalog('nl', 'nav'), NAV);
  });

  it('loads the Intl data alongside only for a language the engine lacks', async () => {
    const Native = Intl.DateTimeFormat;
    const Stub = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      const tag = Array.isArray(locales) ? locales[0] : locales;
      return tag === 'bs' ? { format: () => 'M09' } : new Native(tag, options);
    } as unknown as typeof Intl.DateTimeFormat;
    Stub.supportedLocalesOf = Native.supportedLocalesOf;
    Intl.DateTimeFormat = Stub;
    try {
      const urls = serve(catalogs);
      await loadLanguage('pt');
      strictEqual(
        urls.some((url) => url.includes('/intl/')),
        false,
      );
      await loadLanguage('bs');
      strictEqual(urls.includes('http://api/intl/bs'), true);
    } finally {
      Intl.DateTimeFormat = Native;
    }
  });
});
