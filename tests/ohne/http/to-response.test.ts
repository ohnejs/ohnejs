import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { ResponseInit } from '../../../src/ohne/index.ts';

import { HTTPError, toResponse } from '../../../src/ohne/index.ts';

function init(status = 200): ResponseInit {
  return { status, headers: new Headers() };
}

describe('toResponse', () => {
  it('returns a Response verbatim', () => {
    const response = new Response('body', { status: 201 });
    strictEqual(toResponse(response, init()), response);
  });

  it('serializes an object as JSON', async () => {
    const response = toResponse({ id: 1 }, init());
    strictEqual(response.headers.get('content-type'), 'application/json; charset=utf-8');
    deepStrictEqual(await response.json(), { id: 1 });
  });

  it('serializes a string as html', async () => {
    const response = toResponse('<h1>ohne</h1>', init());
    strictEqual(response.headers.get('content-type'), 'text/html; charset=utf-8');
    strictEqual(await response.text(), '<h1>ohne</h1>');
  });

  it('sends 204 for a nullish value', async () => {
    const response = toResponse(null, init());
    strictEqual(response.status, 204);
    strictEqual(await response.text(), '');
    strictEqual(toResponse(undefined, init()).status, 204);
  });

  it('honors an explicit status for a nullish value', () => {
    strictEqual(toResponse(null, init(205)).status, 205);
  });

  it('reads status from the event response', () => {
    strictEqual(toResponse({ ok: true }, init(202)).status, 202);
  });

  it('streams binary as octet-stream', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const response = toResponse(bytes, init());
    strictEqual(response.headers.get('content-type'), 'application/octet-stream');
    deepStrictEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  });

  it('leaves an existing content-type untouched', () => {
    const headers = new Headers({ 'content-type': 'text/plain' });
    const response = toResponse('plain', { status: 200, headers });
    strictEqual(response.headers.get('content-type'), 'text/plain');
  });

  it('maps an HTTPError to its status with a JSON body', async () => {
    const response = toResponse(new HTTPError(404, 'No such user'), init());
    strictEqual(response.status, 404);
    strictEqual(response.headers.get('content-type'), 'application/json; charset=utf-8');
    deepStrictEqual(await response.json(), { statusCode: 404, message: 'No such user' });
  });

  it('includes data on an HTTPError when present', async () => {
    const response = toResponse(new HTTPError(422, 'Invalid', { field: 'email' }), init());
    deepStrictEqual(await response.json(), {
      statusCode: 422,
      message: 'Invalid',
      data: { field: 'email' },
    });
  });
});
