import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Proposal, TurnBatch } from '../../../../src/ai/dashboard/components/turn-store.ts';

import {
  foldSet,
  postResults,
  requestOf,
  sendBatch,
  type SendTransport,
  shapeResult,
} from '../../../../src/ai/dashboard/components/send-queue.ts';

interface Call {
  route: string;
  body: unknown;
}

interface Stub extends SendTransport {
  calls: Call[];
  waits: number[];
}

type Reply = { status: number; body?: unknown; retryAfter?: string } | Error;

const json = (status: number, body?: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

/**
 * A transport answering `replies` in order, one per call, and recording every call and wait.
 */
function stub(replies: readonly Reply[]): Stub {
  const queue = [...replies];
  const transport: Stub = {
    calls: [],
    waits: [],
    api: (route, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      transport.calls.push({ route, body });
      const reply = queue.shift() ?? { status: 200 };
      if (reply instanceof Error) return Promise.reject(reply);
      const headers: Record<string, string> =
        reply.retryAfter === undefined ? {} : { 'retry-after': reply.retryAfter };
      return Promise.resolve(json(reply.status, reply.body, headers));
    },
    sleep: (ms) => {
      transport.waits.push(ms);
      return Promise.resolve();
    },
  };
  return transport;
}

const UPDATE: Proposal = {
  route: 'PATCH /collections/items/[uuid]',
  tier: 'write',
  params: { uuid: 'a' },
  query: { locale: 'de' },
  body: { name: 'Aschenbringer' },
};

const RETIRE: Proposal = {
  route: 'PATCH /collections/characters/[uuid]',
  tier: 'write',
  where: { level: { lessThan: 10 } },
  body: { status: 'retired' },
};

const READ: Proposal = {
  route: 'POST /collections/items/query',
  tier: 'read',
  body: { where: { rarity: 'epic' }, page: 1 },
};

const batch = (proposals: Proposal[], id = 'b1'): TurnBatch => ({
  id,
  kind: 'write',
  proposals,
  results: null,
});

describe('requestOf', () => {
  it('fills the params, attaches the query, and sends the body as JSON', () => {
    const { route, init } = requestOf(UPDATE);
    strictEqual(route, 'PATCH /collections/items/a?locale=de');
    strictEqual(init.body, '{"name":"Aschenbringer"}');
    deepStrictEqual(init.headers, { 'content-type': 'application/json' });
  });

  it('fills the uuid of a write by set from the row', () => {
    strictEqual(requestOf(RETIRE, 'c-1').route, 'PATCH /collections/characters/c-1');
  });

  it('sends a proposal without a body with no headers', () => {
    const { route, init } = requestOf({
      route: 'DELETE /collections/items/[uuid]',
      tier: 'destructive',
      params: { uuid: 'a' },
    });
    strictEqual(route, 'DELETE /collections/items/a');
    deepStrictEqual(init, {});
  });
});

describe('shapeResult', () => {
  it('keeps a 2xx body and drops the trailing records that overflow the limit', () => {
    const body = { total: 3, records: [{ UUID: 'a' }, { UUID: 'b' }, { UUID: 'c' }] };
    deepStrictEqual(shapeResult(200, body, 10_000), { status: 200, body });
    const cut = shapeResult(
      200,
      body,
      JSON.stringify({ total: 3, records: [{ UUID: 'a' }] }).length,
    );
    deepStrictEqual(cut, { status: 200, body: { total: 3, records: [{ UUID: 'a' }] } });
  });

  it('cuts a bare list the same way', () => {
    deepStrictEqual(shapeResult(200, [{ UUID: 'a' }, { UUID: 'b' }], 16), {
      status: 200,
      body: [{ UUID: 'a' }],
    });
  });

  it('counts the limit in UTF-8 bytes, not characters', () => {
    const records = [{ name: 'Äö' }, { name: 'Üß' }];
    const one = JSON.stringify([records[0]]);
    deepStrictEqual(shapeResult(200, records, one.length), { status: 200, body: [] });
    deepStrictEqual(shapeResult(200, records, Buffer.byteLength(one)), {
      status: 200,
      body: [records[0]],
    });
  });

  it('answers a 204 without a body', () => {
    deepStrictEqual(shapeResult(204, undefined, 100), { status: 204 });
  });

  it('keeps only the message and the code, path and errors of a failure', () => {
    const body = {
      statusCode: 422,
      message: 'Validation failed',
      data: { errors: { name: 'Required' }, extra: 'dropped' },
    };
    deepStrictEqual(shapeResult(422, body, 100), {
      status: 422,
      body: { message: 'Validation failed', data: { errors: { name: 'Required' } } },
    });
    deepStrictEqual(shapeResult(400, { data: { code: 'invalidField', path: 'body.x' } }, 100), {
      status: 400,
      body: { data: { code: 'invalidField', path: 'body.x' } },
    });
    deepStrictEqual(shapeResult(500, 'boom', 100), { status: 500 });
  });
});

describe('foldSet', () => {
  it('counts the rows written and leads with the first failure', () => {
    deepStrictEqual(foldSet([{ status: 200 }, { status: 200 }]), {
      status: 200,
      body: { total: 2, failed: 0 },
    });
    deepStrictEqual(
      foldSet([
        { status: 200 },
        { status: 404, body: { message: 'Not found' } },
        { status: 422, body: { message: 'Invalid' } },
      ]),
      { status: 404, body: { message: 'Not found', total: 1, failed: 2 } },
    );
    deepStrictEqual(foldSet([]), { status: 200, body: { total: 0, failed: 0 } });
  });
});

describe('sendBatch', () => {
  it('sends the approved proposals in order and answers one result each, declines included', async () => {
    const transport = stub([
      { status: 200, body: { records: [{ UUID: 'x' }], total: 1 } },
      { status: 200, body: { UUID: 'a', name: 'Aschenbringer' } },
    ]);
    const progress: [number, number][] = [];
    const results = await sendBatch(
      batch([READ, UPDATE, { ...UPDATE, params: { uuid: 'b' } }]),
      [{ send: true }, { send: true }, { send: false, note: 'not that one' }],
      transport,
      { limit: 10_000, onProgress: (sent, total) => void progress.push([sent, total]) },
    );
    deepStrictEqual(
      transport.calls.map((call) => call.route),
      ['POST /collections/items/query', 'PATCH /collections/items/a?locale=de'],
    );
    deepStrictEqual(results, [
      { status: 200, body: { records: [{ UUID: 'x' }], total: 1 } },
      { status: 200, body: { UUID: 'a', name: 'Aschenbringer' } },
      { declined: true, note: 'not that one' },
    ]);
    deepStrictEqual(progress, [
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it('expands a write by set into one request per row and folds the answers', async () => {
    const transport = stub([{ status: 200 }, { status: 404 }, { status: 200 }]);
    const results = await sendBatch(
      batch([RETIRE]),
      [{ send: true, UUIDs: ['c-1', 'c-2', 'c-3'] }],
      transport,
      {
        limit: 100,
      },
    );
    deepStrictEqual(
      transport.calls.map((call) => call.route),
      [
        'PATCH /collections/characters/c-1',
        'PATCH /collections/characters/c-2',
        'PATCH /collections/characters/c-3',
      ],
    );
    deepStrictEqual(results, [{ status: 404, body: { total: 2, failed: 1 } }]);
  });

  it('waits for Retry-After on a 429 and a 503, then takes the last answer', async () => {
    const transport = stub([
      { status: 429, retryAfter: '2' },
      { status: 503 },
      { status: 200, body: { UUID: 'a' } },
    ]);
    const results = await sendBatch(batch([UPDATE]), [{ send: true }], transport, { limit: 100 });
    deepStrictEqual(transport.waits, [2000, 1000]);
    deepStrictEqual(results, [{ status: 200, body: { UUID: 'a' } }]);
    strictEqual(transport.calls.length, 3);
  });

  it('lets a 429 stand once the tries are spent or the wait is too long', async () => {
    const spent = stub([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 200 }]);
    deepStrictEqual(await sendBatch(batch([UPDATE]), [{ send: true }], spent, { limit: 100 }), [
      { status: 429 },
    ]);
    strictEqual(spent.calls.length, 3);
    const long = stub([{ status: 429, retryAfter: '3600' }, { status: 200 }]);
    deepStrictEqual(await sendBatch(batch([UPDATE]), [{ send: true }], long, { limit: 100 }), [
      { status: 429 },
    ]);
    deepStrictEqual(long.waits, []);
  });

  it('never sends a request again after a dropped connection', async () => {
    const transport = stub([new Error('offline'), { status: 200 }]);
    await rejects(
      sendBatch(batch([UPDATE]), [{ send: true }], transport, { limit: 100 }),
      /offline/,
    );
    strictEqual(transport.calls.length, 1);
    deepStrictEqual(transport.waits, []);
  });
});

describe('postResults', () => {
  it('posts a batch once and answers undefined for the same batch again', async () => {
    const transport = stub([{ status: 200 }, { status: 200 }]);
    const results = [{ status: 200 }];
    const first = await postResults(transport, 'turn-1', 'once', results);
    strictEqual(first?.status, 200);
    strictEqual(await postResults(transport, 'turn-1', 'once', results), undefined);
    strictEqual(transport.calls.length, 1);
    deepStrictEqual(transport.calls[0], {
      route: 'POST /ai/turns/turn-1/results',
      body: { batch: 'once', results },
    });
  });

  it('never posts a batch again after the connection dropped', async () => {
    const transport = stub([new Error('offline'), { status: 200 }]);
    await rejects(postResults(transport, 'turn-1', 'dropped', []), /offline/);
    strictEqual(await postResults(transport, 'turn-1', 'dropped', []), undefined);
    strictEqual(transport.calls.length, 1);
  });

  it('waits for Retry-After on the post itself', async () => {
    const transport = stub([{ status: 429, retryAfter: '1' }, { status: 200 }]);
    strictEqual((await postResults(transport, 'turn-1', 'throttled', []))?.status, 200);
    deepStrictEqual(transport.waits, [1000]);
  });
});
