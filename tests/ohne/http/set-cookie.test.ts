import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, setCookie } from '../../../src/ohne/index.ts';

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

describe('setCookie', () => {
  it('appends a serialized Set-Cookie header to the response', () => {
    const event = makeEvent();
    runWithEvent(event, () => {
      setCookie('session', 'abc', { httpOnly: true, sameSite: 'lax' });
    });
    deepStrictEqual(event.response.headers.getSetCookie(), ['session=abc; HttpOnly; SameSite=Lax']);
  });

  it('adds one header per call', () => {
    const event = makeEvent();
    runWithEvent(event, () => {
      setCookie('a', '1');
      setCookie('b', '2');
    });
    deepStrictEqual(event.response.headers.getSetCookie(), ['a=1', 'b=2']);
  });
});
