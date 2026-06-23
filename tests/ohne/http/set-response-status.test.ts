import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, setResponseStatus, useEvent } from '../../../src/ohne/index.ts';

function makeEvent(): Event {
  return {
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('setResponseStatus', () => {
  it('writes the status onto the event response', () => {
    runWithEvent(makeEvent(), () => {
      setResponseStatus(201);
      strictEqual(useEvent().response.status, 201);
    });
  });
});
