import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { HTTPError } from '../../../../src/ohne/http/http-error.ts';
import { type Event, runWithEvent } from '../../../../src/ohne/index.ts';
import { type ReadQueryBodyOptions, readQueryBody } from '../../../../src/ohne/query/wire/body.ts';

function event(body: string, contentType = 'application/json'): Event {
  return {
    request: new Request('http://localhost/posts', {
      method: 'POST',
      body,
      headers: new Headers({ 'content-type': contentType }),
    }),
    url: new URL('http://localhost/posts'),
    params: {},
    ip: '',
    response: { status: 200, headers: new Headers() },
    context: {},
    appliedMiddleware: [],
    waitUntil() {},
  };
}

function read(
  body: string,
  contentType?: string,
  options?: ReadQueryBodyOptions,
): Promise<Record<string, unknown>> {
  return runWithEvent(event(body, contentType), () => readQueryBody(options));
}

async function caught(
  body: string,
  contentType?: string,
  options?: ReadQueryBodyOptions,
): Promise<HTTPError> {
  try {
    await read(body, contentType, options);
  } catch (error) {
    if (error instanceof HTTPError) return error;
    throw error;
  }
  throw new Error('expected an HTTPError to throw');
}

function nestedObject(depth: number): string {
  return '{"a":'.repeat(depth) + '1' + '}'.repeat(depth);
}

describe('readQueryBody', () => {
  it('parses a JSON object body into query params', async () => {
    deepStrictEqual(await read('{"where":{"status":"published"},"select":["title"]}'), {
      where: { status: 'published' },
      select: ['title'],
    });
  });

  it('accepts a `+json` content type', async () => {
    deepStrictEqual(await read('{"limit":10}', 'application/vnd.api+json'), { limit: 10 });
  });

  it('rejects a non-JSON content type with 415', async () => {
    strictEqual((await caught('{}', 'text/plain')).status, 415);
  });

  it('rejects an empty body with 400', async () => {
    strictEqual((await caught('')).status, 400);
  });

  it('rejects malformed JSON with 400', async () => {
    strictEqual((await caught('{not json')).status, 400);
  });

  it('rejects a non-object body with 400', async () => {
    strictEqual((await caught('[1,2,3]')).status, 400);
    strictEqual((await caught('42')).status, 400);
  });

  it('rejects a depth bomb with 400 before parsing, naming the depth', async () => {
    const bomb = '['.repeat(40) + ']'.repeat(40);
    const error = await caught(bomb);
    strictEqual(error.status, 400);
    strictEqual(error.message, 'api.body.tooNested');
  });

  it('rejects a body deeper than a custom maxDepth', async () => {
    const error = await caught(nestedObject(3), undefined, { maxDepth: 2 });
    strictEqual(error.status, 400);
    strictEqual(error.message, 'api.body.tooNested');
  });

  it('accepts nesting the default cap would refuse when maxDepth is raised', async () => {
    strictEqual((await caught(nestedObject(40))).message, 'api.body.tooNested');
    strictEqual(typeof (await read(nestedObject(40), undefined, { maxDepth: 64 })).a, 'object');
  });
});
