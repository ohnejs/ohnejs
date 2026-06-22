import { deepStrictEqual, strictEqual } from 'node:assert';
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
  it('returns the URL query parsed into a structured object', () => {
    runWithEvent(makeEvent('http://localhost/search?q=ohne&page=2&tags=[new,sale]'), () => {
      deepStrictEqual(useSearchParams(), { q: 'ohne', page: 2, tags: ['new', 'sale'] });
    });
  });

  it('is empty when the URL has no query', () => {
    runWithEvent(makeEvent('http://localhost/search'), () => {
      deepStrictEqual(useSearchParams(), {});
    });
  });

  it('memoizes the parsed object per request', () => {
    runWithEvent(makeEvent('http://localhost/?a=1'), () => {
      strictEqual(useSearchParams(), useSearchParams());
    });
  });
});
