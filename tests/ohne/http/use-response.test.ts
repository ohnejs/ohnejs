import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, useResponse } from '../../../src/ohne/index.ts';

function makeEvent(): Event {
  const request = new Request('http://localhost/');
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

describe('useResponse', () => {
  it('returns the bound response state', () => {
    const event = makeEvent();
    runWithEvent(event, () => {
      strictEqual(useResponse(), event.response);
    });
  });

  it('mutations reach the bound event', () => {
    const event = makeEvent();
    runWithEvent(event, () => {
      useResponse().status = 201;
      useResponse().headers.set('cache-control', 'no-store');
    });
    strictEqual(event.response.status, 201);
    strictEqual(event.response.headers.get('cache-control'), 'no-store');
  });
});
