import { strictEqual } from 'node:assert';
import { afterEach, before, describe, it, mock } from 'node:test';

import { loadLanguage } from '../../../src/dashboard/runtime/messages.ts';
import { translateMessage } from '../../../src/dashboard/runtime/use-t.ts';

describe('translateMessage', () => {
  before(() => {
    Object.assign(globalThis, {
      document: {
        getElementById: () => ({
          textContent: JSON.stringify({
            apiURL: 'http://api',
            defaultLanguage: 'en',
            messageGroups: ['app'],
          }),
        }),
      },
    });
  });

  afterEach(() => mock.restoreAll());

  it('answers plain text outside every message group without fetching', () => {
    const fetch = mock.method(globalThis, 'fetch', async () => new Response('{}'));
    strictEqual(translateMessage('Blog posts'), 'Blog posts');
    strictEqual(translateMessage('Mr. Smith'), 'Mr. Smith');
    strictEqual(fetch.mock.callCount(), 0);
  });

  it('translates a key and a key with params from the loaded catalog', async () => {
    mock.method(
      globalThis,
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            'app.title.label': { template: 'Title', language: 'en' },
            'app.count': { template: '{n} posts', language: 'en' },
          }),
        ),
    );
    await loadLanguage('en');
    strictEqual(translateMessage('app.title.label'), 'Title');
    strictEqual(translateMessage({ key: 'app.count', params: { n: 2 } }), '2 posts');
  });

  it('answers a getter with its own string, and anything else with `undefined`', () => {
    strictEqual(
      translateMessage(() => 'Lok-tar'),
      'Lok-tar',
    );
    strictEqual(translateMessage(42), undefined);
  });
});
