import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, useAuthorization } from '../../../src/ohne/index.ts';

function makeEvent(authorization?: string): Event {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('authorization', authorization);
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

describe('useAuthorization', () => {
  it('parses the live Authorization header', () => {
    runWithEvent(makeEvent('Bearer abc.def'), () => {
      deepStrictEqual(useAuthorization(), { scheme: 'bearer', token: 'abc.def' });
    });
  });

  it('returns null when no Authorization header is sent', () => {
    runWithEvent(makeEvent(), () => {
      strictEqual(useAuthorization(), null);
    });
  });
});
