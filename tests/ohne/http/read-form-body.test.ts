import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { type Event, HTTPError, readFormBody, runWithEvent } from '../../../src/ohne/index.ts';

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

describe('readFormBody', () => {
  it('parses urlencoded into FormData, keeping repeated keys', async () => {
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'a=1&a=2&b=x',
    });
    await runWithEvent(makeEvent(request), async () => {
      const form = await readFormBody();
      deepStrictEqual(form.getAll('a'), ['1', '2']);
      strictEqual(form.get('b'), 'x');
    });
  });

  it('parses multipart into FormData with file parts', async () => {
    const form = new FormData();
    form.set('email', 'a@b.c');
    form.set('avatar', new File(['data'], 'a.txt', { type: 'text/plain' }));
    const request = new Request('http://localhost/', { method: 'POST', body: form });

    await runWithEvent(makeEvent(request), async () => {
      const parsed = await readFormBody();
      strictEqual(parsed.get('email'), 'a@b.c');
      const file = parsed.get('avatar');
      ok(file instanceof File);
      strictEqual(await file.text(), 'data');
    });
  });

  it('rejects a non-form content type with 415', async () => {
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    await runWithEvent(makeEvent(request), async () => {
      await rejects(readFormBody(), (error) => error instanceof HTTPError && error.status === 415);
    });
  });

  it('yields empty FormData for an absent body', async () => {
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    await runWithEvent(makeEvent(request), async () => {
      deepStrictEqual([...(await readFormBody())], []);
    });
  });
});
