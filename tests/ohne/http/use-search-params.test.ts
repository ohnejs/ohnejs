import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, useSearchParams } from '../../../src/ohne/index.ts';

function makeEvent(url: string): Event {
  return {
    request: new Request(url),
    url: new URL(url),
    params: {},
    response: { status: 200, headers: new Headers() },
    context: {},
    waitUntil() {},
  };
}

describe('useSearchParams', () => {
  it('returns the URL query as URLSearchParams', () => {
    runWithEvent(makeEvent('http://localhost/search?q=ohne&page=2'), () => {
      const params = useSearchParams();
      strictEqual(params instanceof URLSearchParams, true);
      strictEqual(params.get('q'), 'ohne');
      strictEqual(params.get('page'), '2');
    });
  });
});
