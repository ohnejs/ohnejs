import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, sendNotModified } from '../../../src/ohne/index.ts';

function makeEvent(): Event {
  return {
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers({ etag: '"a"' }) },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

describe('sendNotModified', () => {
  it('sets the response status to 304', () => {
    const event = makeEvent();
    runWithEvent(event, () => sendNotModified());
    strictEqual(event.response.status, 304);
  });

  it('preserves validators already on the response', () => {
    const event = makeEvent();
    runWithEvent(event, () => sendNotModified());
    strictEqual(event.response.headers.get('etag'), '"a"');
  });
});
