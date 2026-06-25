import { deepStrictEqual, rejects } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, HTTPError, readJSONBody, runWithEvent } from '../../../src/ohne/index.ts';

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

function post(contentType: string | undefined, body?: string): Request {
  const headers = new Headers();
  if (contentType !== undefined) headers.set('content-type', contentType);
  return new Request('http://localhost/', { method: 'POST', headers, body });
}

function isStatus(status: number) {
  return (error: unknown): boolean => error instanceof HTTPError && error.status === status;
}

describe('readJSONBody', () => {
  it('parses a JSON body', async () => {
    await runWithEvent(makeEvent(post('application/json', '{"email":"a@b.c"}')), async () => {
      deepStrictEqual(await readJSONBody(), { email: 'a@b.c' });
    });
  });

  it('accepts a +json suffix', async () => {
    await runWithEvent(makeEvent(post('application/ld+json', '{"a":1}')), async () => {
      deepStrictEqual(await readJSONBody(), { a: 1 });
    });
  });

  it('rejects a non-JSON content type with 415', async () => {
    await runWithEvent(makeEvent(post('text/plain', '{}')), async () => {
      await rejects(readJSONBody(), isStatus(415));
    });
  });

  it('rejects an empty body with 400', async () => {
    await runWithEvent(makeEvent(post('application/json')), async () => {
      await rejects(readJSONBody(), isStatus(400));
    });
  });

  it('rejects malformed JSON with 400', async () => {
    await runWithEvent(makeEvent(post('application/json', '{bad')), async () => {
      await rejects(readJSONBody(), isStatus(400));
    });
  });
});
