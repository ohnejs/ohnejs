import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, useAccepts } from '../../../src/ohne/index.ts';

function makeEvent(accept?: string): Event {
  const headers = new Headers();
  if (accept !== undefined) headers.set('accept', accept);
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

describe('useAccepts', () => {
  it('picks the best media type the client accepts', () => {
    runWithEvent(makeEvent('text/html, application/json;q=0.9'), () => {
      strictEqual(useAccepts(['application/json', 'text/html']), 'text/html');
    });
  });

  it('returns undefined when the client accepts none of the offers', () => {
    runWithEvent(makeEvent('image/png'), () => {
      strictEqual(useAccepts(['text/html']), undefined);
    });
  });

  it('returns the first offer when no Accept header is sent', () => {
    runWithEvent(makeEvent(), () => {
      strictEqual(useAccepts(['application/json', 'text/html']), 'application/json');
    });
  });
});
