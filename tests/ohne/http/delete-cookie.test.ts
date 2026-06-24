import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, deleteCookie, runWithEvent } from '../../../src/ohne/index.ts';

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

describe('deleteCookie', () => {
  it('expires the cookie immediately, scoped to the given path', () => {
    const event = makeEvent();
    runWithEvent(event, () => {
      deleteCookie('session', { path: '/' });
    });
    deepStrictEqual(event.response.headers.getSetCookie(), ['session=; Max-Age=0; Path=/']);
  });
});
