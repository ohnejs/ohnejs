import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, runWithEvent, waitUntil } from '../../../src/ohne/index.ts';

function makeEvent(collected: Promise<unknown>[]): Event {
  return {
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil: (promise) => collected.push(promise),
  };
}

describe('waitUntil', () => {
  it('forwards the promise to the event', () => {
    const collected: Promise<unknown>[] = [];
    const promise = Promise.resolve('done');
    runWithEvent(makeEvent(collected), () => waitUntil(promise));
    deepStrictEqual(collected, [promise]);
  });
});
