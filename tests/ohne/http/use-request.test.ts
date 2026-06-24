import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, useRequest } from '../../../src/ohne/index.ts';

function makeEvent(request: Request): Event {
  return {
    request,
    url: new URL(request.url),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('useRequest', () => {
  it('returns the bound request', () => {
    const request = new Request('http://localhost/', { method: 'POST' });
    runWithEvent(makeEvent(request), () => {
      strictEqual(useRequest(), request);
      strictEqual(useRequest().method, 'POST');
    });
  });
});
