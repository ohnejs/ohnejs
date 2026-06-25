import { rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, HTTPError, readTextBody, runWithEvent } from '../../../src/ohne/index.ts';

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

function post(body?: string | Uint8Array): Request {
  return new Request('http://localhost/', { method: 'POST', body });
}

describe('readTextBody', () => {
  it('reads the body as text', async () => {
    await runWithEvent(makeEvent(post('hello')), async () => {
      strictEqual(await readTextBody(), 'hello');
    });
  });

  it('is empty when there is no body', async () => {
    await runWithEvent(makeEvent(new Request('http://localhost/')), async () => {
      strictEqual(await readTextBody(), '');
    });
  });

  it('rejects invalid UTF-8 with 400', async () => {
    await runWithEvent(makeEvent(post(new Uint8Array([0xff]))), async () => {
      await rejects(readTextBody(), (error) => error instanceof HTTPError && error.status === 400);
    });
  });
});
