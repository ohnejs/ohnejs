import { strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, sendRedirect, useEvent } from '../../../src/ohne/index.ts';

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

describe('sendRedirect', () => {
  it('sets a 302 and the Location header by default', () => {
    runWithEvent(makeEvent(), () => {
      sendRedirect('/login');
      strictEqual(useEvent().response.status, 302);
      strictEqual(useEvent().response.headers.get('location'), '/login');
    });
  });

  it('honors an explicit status', () => {
    runWithEvent(makeEvent(), () => {
      sendRedirect('/moved', 301);
      strictEqual(useEvent().response.status, 301);
    });
  });

  it('rejects a location that smuggles a second header', () => {
    runWithEvent(makeEvent(), () => {
      throws(() => sendRedirect('/x\r\nSet-Cookie: sid=evil'));
    });
  });
});
