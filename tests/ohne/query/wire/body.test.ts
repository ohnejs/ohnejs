import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { HTTPError } from '../../../../src/ohne/http/http-error.ts';
import { type Event, runWithEvent } from '../../../../src/ohne/index.ts';
import {
  type ReadRecordBodyOptions,
  readQueryBody,
  readRecordBody,
} from '../../../../src/ohne/query/wire/body.ts';

type Reader = (options?: ReadRecordBodyOptions) => Promise<Record<string, unknown>>;

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
  reader: Reader,
  body: string,
  contentType?: string,
  options?: ReadRecordBodyOptions,
): Promise<Record<string, unknown>> {
  return runWithEvent(event(body, contentType), () => reader(options));
}

async function caught(
  reader: Reader,
  body: string,
  contentType?: string,
  options?: ReadRecordBodyOptions,
): Promise<HTTPError> {
  try {
    await read(reader, body, contentType, options);
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
    deepStrictEqual(
      await read(readQueryBody, '{"where":{"status":"published"},"select":["title"]}'),
      { where: { status: 'published' }, select: ['title'] },
    );
  });

  it('accepts a `+json` content type', async () => {
    deepStrictEqual(await read(readQueryBody, '{"limit":10}', 'application/vnd.api+json'), {
      limit: 10,
    });
  });

  it('rejects a non-JSON content type with 415', async () => {
    strictEqual((await caught(readQueryBody, '{}', 'text/plain')).status, 415);
  });

  it('rejects an empty body with 400', async () => {
    strictEqual((await caught(readQueryBody, '')).status, 400);
  });

  it('rejects malformed JSON with 400', async () => {
    strictEqual((await caught(readQueryBody, '{not json')).status, 400);
  });

  it('rejects a non-object body with 400', async () => {
    strictEqual((await caught(readQueryBody, '[1,2,3]')).status, 400);
    strictEqual((await caught(readQueryBody, '42')).status, 400);
  });

  it('rejects a depth bomb with 400 before parsing, naming the depth', async () => {
    const bomb = '['.repeat(40) + ']'.repeat(40);
    const error = await caught(readQueryBody, bomb);
    strictEqual(error.status, 400);
    strictEqual(error.message, 'api.body.tooNested');
  });

  it('rejects a body deeper than a custom maxDepth', async () => {
    const error = await caught(readQueryBody, nestedObject(3), undefined, { maxDepth: 2 });
    strictEqual(error.status, 400);
    strictEqual(error.message, 'api.body.tooNested');
  });

  it('accepts nesting the default cap would refuse when maxDepth is raised', async () => {
    strictEqual((await caught(readQueryBody, nestedObject(40))).message, 'api.body.tooNested');
    strictEqual(
      typeof (await read(readQueryBody, nestedObject(40), undefined, { maxDepth: 64 })).a,
      'object',
    );
  });
});

describe('readRecordBody', () => {
  it('parses a JSON object body into a record', async () => {
    deepStrictEqual(await read(readRecordBody, '{"title":"Hello","tags":["a","b"]}'), {
      title: 'Hello',
      tags: ['a', 'b'],
    });
  });

  it('accepts a `+json` content type', async () => {
    deepStrictEqual(await read(readRecordBody, '{"title":"Hi"}', 'application/vnd.api+json'), {
      title: 'Hi',
    });
  });

  it('rejects a non-JSON content type with 415', async () => {
    strictEqual((await caught(readRecordBody, '{}', 'text/plain')).status, 415);
  });

  it('rejects an empty body with 400', async () => {
    const error = await caught(readRecordBody, '');
    strictEqual(error.status, 400);
    strictEqual(error.message, 'api.body.empty');
  });

  it('rejects malformed JSON with 400', async () => {
    const error = await caught(readRecordBody, '{not json');
    strictEqual(error.status, 400);
    strictEqual(error.message, 'api.body.invalidJSON');
  });

  it('rejects a non-object body with 400', async () => {
    strictEqual((await caught(readRecordBody, '[1,2,3]')).status, 400);
    strictEqual((await caught(readRecordBody, '"title"')).status, 400);
    strictEqual((await caught(readRecordBody, 'null')).status, 400);
  });

  it('rejects a body nested past the default cap with 400', async () => {
    const error = await caught(readRecordBody, nestedObject(40));
    strictEqual(error.status, 400);
    strictEqual(error.message, 'api.body.tooNested');
  });

  it('rejects a body deeper than a custom maxDepth', async () => {
    const error = await caught(readRecordBody, nestedObject(3), undefined, { maxDepth: 2 });
    strictEqual(error.status, 400);
    strictEqual(error.message, 'api.body.tooNested');
  });

  it('accepts nesting the default cap would refuse when maxDepth is raised', async () => {
    strictEqual(
      typeof (await read(readRecordBody, nestedObject(40), undefined, { maxDepth: 64 })).a,
      'object',
    );
  });
});
