import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, useRouteParams } from '../../../src/ohne/index.ts';

function makeEvent(params: Record<string, string>): Event {
  return {
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params,
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('useRouteParams', () => {
  it('returns the matched params', () => {
    runWithEvent(makeEvent({ id: '42', path: 'a/b' }), () => {
      const params = useRouteParams();
      strictEqual(params.id, '42');
      strictEqual(params.path, 'a/b');
    });
  });

  it('returns an empty map when nothing was captured', () => {
    runWithEvent(makeEvent({}), () => deepStrictEqual(useRouteParams(), {}));
  });
});
