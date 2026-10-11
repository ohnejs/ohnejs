import { deepStrictEqual } from 'node:assert';
import { before, describe, it, mock } from 'node:test';

import '../_fake-dom.ts';
import { login, signInCount } from '../../../src/dashboard/runtime/session.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { effect } from '../../../src/utils/reactive/effect.ts';

const USER = {
  UUID: 'u',
  email: 'a@b.c',
  roles: ['admin'],
  dashboardLanguage: null,
  contentLanguage: null,
  timezone: null,
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'HH:mm',
  smartClipboard: false,
};

describe('signInCount', () => {
  let accept = true;

  before(() => {
    Object.assign(document, {
      getElementById: () => ({
        textContent: JSON.stringify({
          apiURL: 'http://api',
          defaultLanguage: 'en',
          messageGroups: [],
        }),
      }),
    });
    mock.method(globalThis, 'fetch', async (url: string) => {
      if (url.endsWith('/auth/login') && !accept) return new Response(null, { status: 401 });
      if (url.endsWith('/dashboard')) return new Response(JSON.stringify({ collections: [] }));
      return new Response(JSON.stringify(USER));
    });
  });

  it('reruns a reader on each successful sign-in, and only then', async () => {
    const seen: number[] = [];
    effect(() => {
      seen.push(signInCount());
    });
    await login('a@b.c', 'secret');
    flush();
    accept = false;
    await login('a@b.c', 'wrong');
    flush();
    accept = true;
    await login('a@b.c', 'secret');
    flush();
    deepStrictEqual(seen, [0, 1, 2]);
  });
});
