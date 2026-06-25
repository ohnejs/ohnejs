import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, readRawBody, runWithEvent } from '../../../src/ohne/index.ts';

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

describe('readRawBody', () => {
  it('reads the body as bytes', async () => {
    await runWithEvent(makeEvent(post('hello')), async () => {
      deepStrictEqual(await readRawBody(), new TextEncoder().encode('hello'));
    });
  });

  it('is undefined when there is no body', async () => {
    await runWithEvent(makeEvent(new Request('http://localhost/')), async () => {
      strictEqual(await readRawBody(), undefined);
    });
  });

  it('is undefined for an empty body', async () => {
    await runWithEvent(makeEvent(post('')), async () => {
      strictEqual(await readRawBody(), undefined);
    });
  });

  it('consumes the stream once and shares it across concurrent reads', async () => {
    await runWithEvent(makeEvent(post('once')), async () => {
      const [a, b] = await Promise.all([readRawBody(), readRawBody()]);
      strictEqual(a, b);
      deepStrictEqual(a, new TextEncoder().encode('once'));
    });
  });
});
