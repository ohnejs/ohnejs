import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it, mock } from 'node:test';

import '../_fake-dom.ts';
import {
  login,
  logout,
  sessionUser,
  setLanguageFallback,
  settleSessionLanguage,
  signInCount,
} from '../../../src/dashboard/runtime/session.ts';
import { requestedLanguage } from '../../../src/dashboard/runtime/use-dashboard-language.ts';
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

describe('setLanguageFallback', () => {
  it('picks the signed-out language while the session is unknown', async () => {
    setLanguageFallback((user) => (user ? undefined : 'bs'));
    settleSessionLanguage();
    strictEqual(requestedLanguage().value, 'bs');
    setLanguageFallback(null);
  });

  it('picks the language of a user without one before the user is stored', async () => {
    setLanguageFallback((user) => (user ? 'de' : undefined));
    const seen: string[] = [];
    effect(() => {
      if (sessionUser()) seen.push(requestedLanguage().value);
    });
    while (!sessionUser()) await new Promise((resolve) => setTimeout(resolve, 1));
    flush();
    deepStrictEqual(seen, ['de']);
    setLanguageFallback(null);
  });

  it('switches a resolved user without a language to a fallback set later', async () => {
    setLanguageFallback(() => 'bs');
    settleSessionLanguage();
    strictEqual(requestedLanguage().value, 'bs');
    setLanguageFallback(null);
  });

  it('picks the language of a signed-out visitor on sign-out', async () => {
    setLanguageFallback((user) => (user ? undefined : 'bs'));
    await logout();
    strictEqual(requestedLanguage().value, 'bs');
    setLanguageFallback(null);
  });
});

describe('signInCount', () => {
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
