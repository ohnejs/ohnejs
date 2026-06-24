import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, useCookies } from '../../../src/ohne/index.ts';

function makeEvent(cookie?: string): Event {
  const headers = new Headers();
  if (cookie !== undefined) headers.set('cookie', cookie);
  return {
    request: new Request('http://localhost/', { headers }),
    url: new URL('http://localhost/'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('useCookies', () => {
  it('returns the request cookies parsed into a map', () => {
    runWithEvent(makeEvent('id=42; theme=dark'), () => {
      deepStrictEqual(useCookies(), { id: '42', theme: 'dark' });
    });
  });

  it('is empty when no Cookie header is sent', () => {
    runWithEvent(makeEvent(), () => {
      deepStrictEqual(useCookies(), {});
    });
  });

  it('memoizes the parsed map per request', () => {
    runWithEvent(makeEvent('a=1'), () => {
      strictEqual(useCookies(), useCookies());
    });
  });
});
