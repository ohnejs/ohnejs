import { deepStrictEqual, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, setSignedCookie, useEnv } from '../../../src/ohne/index.ts';
import { signValue } from '../../../src/utils/crypto/index.ts';

function makeEvent(): Event {
  return {
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('setSignedCookie', () => {
  it('writes a name-bound signed cookie with secure defaults', () => {
    useEnv().set('COOKIE_SECRET', 'k');
    const event = makeEvent();
    runWithEvent(event, () => {
      setSignedCookie('session', 'abc');
    });
    const signed = signValue('abc', 'k', 'session');
    deepStrictEqual(event.response.headers.getSetCookie(), [
      `session=${signed}; Secure; HttpOnly; SameSite=Lax`,
    ]);
  });

  it('lets options override the secure defaults', () => {
    useEnv().set('COOKIE_SECRET', 'k');
    const event = makeEvent();
    runWithEvent(event, () => {
      setSignedCookie('s', 'v', { secure: false });
    });
    const header = event.response.headers.getSetCookie()[0];
    strictEqual(header.includes('; Secure'), false);
    strictEqual(header.includes('; HttpOnly'), true);
  });

  it('throws when COOKIE_SECRET is unset', () => {
    useEnv().unset('COOKIE_SECRET');
    const event = makeEvent();
    throws(() => runWithEvent(event, () => setSignedCookie('s', 'v')));
  });
});
