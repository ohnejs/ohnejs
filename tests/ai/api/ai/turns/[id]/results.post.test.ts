import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Config } from '../../../../../../src/ohne/layers/config.ts';
import type { ProviderServer } from '../../../../providers/_server.ts';
import type { StreamedEvent } from '../_stand-in.ts';

import resultsPost from '../../../../../../src/ai/api/ai/turns/[id]/results.post.ts';
import turnsPost from '../../../../../../src/ai/api/ai/turns/index.post.ts';
import { loadTurn } from '../../../../../../src/ai/turns/state.ts';
import { useEnv } from '../../../../../../src/ohne/env/use-env.ts';
import { call, route, signIn, withAI } from '../../../../_fixture.ts';
import { startProviderServer } from '../../../../providers/_server.ts';
import { calls, readEvents, says } from '../_stand-in.ts';

const TURNS = route('POST', '/ai/turns', turnsPost);
const RESULTS = route('POST', '/ai/turns/[id]/results', resultsPost);
const KEY = 'AI_RESULTS_TEST_KEY';
const UUID = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';
const QUERY = 'POST /collections/characters/query';

useEnv().define(KEY as never, { default: undefined as never });

const server: ProviderServer = await startProviderServer();
const officer = await signIn('officer@results.example.com', ['officer']);
const other = await signIn('other@results.example.com', ['officer']);

/**
 * The app's `ai` settings, the model pointed at the stand-in, with `extra` on top.
 */
function ai(extra: Partial<NonNullable<Config['ai']>> = {}): Config['ai'] {
  return {
    model: 'smart',
    models: {
      smart: { provider: 'anthropic', model: 'claude-test', key: KEY, baseURL: server.url },
    },
    ...extra,
  };
}

/**
 * A step that reads one character by id and describes the collection.
 */
const READ_STEP = calls('Reading.', [
  {
    id: 'toolu_1',
    name: 'request',
    input: { requests: [{ route: QUERY, body: { where: { UUID } } }, { route: 'GET /nope' }] },
  },
  { id: 'toolu_2', name: 'describe', input: { collection: 'Guilds' } },
]);

interface Answered {
  status: number;
  events: StreamedEvent[];
  body: Record<string, unknown>;
}

/**
 * Reads a turn route's answer: its stream when it opened one, its JSON body otherwise.
 */
async function answered(response: Response, drain: () => Promise<void>): Promise<Answered> {
  const result: Answered = { status: response.status, events: [], body: {} };
  if (response.headers.get('content-type') === 'text/event-stream') {
    result.events = await readEvents(response);
  } else {
    result.body = (await response.json()) as Record<string, unknown>;
  }
  await drain();
  return result;
}

/**
 * Opens a turn whose first step the stand-in answers with `answer`, and returns its id and pending batch.
 */
async function open(
  answer: string,
): Promise<{ id: string; batch: string; events: StreamedEvent[] }> {
  server.answer({ body: answer });
  const { response, drain } = await call(TURNS, {
    path: '/ai/turns',
    body: { input: 'Who is that?', page: '/collections/characters' },
    token: officer.token,
  });
  const { status, events } = await answered(response, drain);
  strictEqual(status, 200);
  const id = events[0]?.data.id as string;
  const batch = (events.find((event) => event.event === 'batch')?.data.id as string) ?? '';
  return { id, batch, events };
}

/**
 * Reports `body` for the turn `id` as the person `token` signs in.
 */
async function report(
  id: string,
  body: unknown,
  token: string | null = officer.token,
): Promise<Answered> {
  const { response, drain } = await call(RESULTS, {
    path: `/ai/turns/${id}/results`,
    body,
    token: token ?? undefined,
    params: { id },
  });
  return answered(response, drain);
}

const found = { status: 200, body: { records: [{ UUID, name: 'Thrall', level: 60 }], total: 1 } };

const ITEMS_QUERY = 'POST /collections/items/query';

/**
 * A step that reads one item by id.
 */
const ITEM_STEP = calls('Reading.', [
  {
    id: 'toolu_1',
    name: 'request',
    input: { requests: [{ route: ITEMS_QUERY, body: { where: { UUID } } }] },
  },
]);

const item = {
  status: 200,
  body: {
    records: [{ UUID, name: 'Ashbringer', tooltip: 'Slays', rarity: 'epic', secret: 's' }],
    total: 1,
  },
};

/**
 * Reads the item as the officer, and returns the receipt the provider read and the whole request it came in.
 */
async function itemReceipt(): Promise<{ receipt: Record<string, unknown>; sent: string }> {
  const { id, batch } = await open(ITEM_STEP);
  server.answer({ body: says('Seen.') });
  strictEqual((await report(id, { batch, results: [item] })).status, 200);
  const sent = server.requests.at(-1)?.body;
  const messages = sent?.messages as { content: { content: string }[] }[];
  const content = messages.at(-1)?.content[0]?.content ?? '[]';
  return {
    receipt: (JSON.parse(content) as Record<string, unknown>[])[0],
    sent: JSON.stringify(sent),
  };
}

describe('POST /ai/turns/[id]/results', () => {
  beforeEach(() => {
    useEnv().set(KEY as never, 'sk-test' as never);
    server.requests.length = 0;
  });
  afterEach(() => useEnv().unset(KEY as never));
  after(() => server.close());

  it('shapes the results into receipts, appends them, and streams the next step', async () => {
    await withAI(ai(), async () => {
      const { id, batch } = await open(READ_STEP);
      server.answer({ body: says('Thrall is level 60.') });
      const { status, events } = await report(id, { batch, results: [found] });
      strictEqual(status, 200);
      deepStrictEqual(events, [
        { event: 'text', data: { text: 'Thrall is level 60.' } },
        { event: 'done', data: { reason: 'end' } },
      ]);
      const [, seen] = server.requests;
      const messages = seen?.body.messages as { role: string; content: unknown }[];
      strictEqual(messages.length, 3);
      deepStrictEqual(messages[2], {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: JSON.stringify([
              { route: QUERY, status: 200, total: 1, UUIDs: [UUID] },
              { route: 'GET /nope', status: 400, code: 'unknownRoute', path: 'route' },
            ]),
          },
          {
            type: 'tool_result',
            tool_use_id: 'toolu_2',
            content: '## Guilds (`guilds`): query.\nLabel: name.\n- name: text, required',
          },
        ],
      });
      ok(!JSON.stringify(seen?.body).includes('Thrall'));
      const turn = await loadTurn(id);
      strictEqual(turn?.step, 2);
      ok(turn?.closedAt !== null);
      deepStrictEqual(turn?.batches[0]?.reported, [{ status: 200 }]);
      deepStrictEqual(turn?.batches[0]?.calls[0]?.receipts?.[0], {
        route: QUERY,
        status: 200,
        total: 1,
        UUIDs: [UUID],
      });
      strictEqual(turn?.transcript.length, 4);
    });
  });

  it('carries the records of an opened collection, redacted, and nothing of a blind one', async () => {
    const blind = { route: ITEMS_QUERY, status: 200, total: 1, UUIDs: [UUID] };
    await withAI(ai({ data: { Items: true } }), async () => {
      const { receipt, sent } = await itemReceipt();
      deepStrictEqual(receipt, {
        ...blind,
        records: [{ UUID, name: 'Ashbringer', tooltip: 'Slays', rarity: 'epic' }],
      });
      ok(!sent.includes('secret'));
    });
    await withAI(ai({ data: { Items: ['name'] } }), async () => {
      const { receipt, sent } = await itemReceipt();
      deepStrictEqual(receipt, { ...blind, records: [{ UUID, name: 'Ashbringer' }] });
      ok(!sent.includes('Slays'));
    });
    await withAI(ai(), async () => {
      const { receipt, sent } = await itemReceipt();
      deepStrictEqual(receipt, blind);
      ok(!sent.includes('Ashbringer'));
    });
    const entry = {
      provider: 'anthropic',
      model: 'claude-test',
      key: KEY,
      baseURL: server.url,
    } as const;
    await withAI(
      ai({ data: { Items: true }, models: { smart: { ...entry, data: false } } }),
      async () => {
        const { receipt, sent } = await itemReceipt();
        deepStrictEqual(receipt, blind);
        ok(!sent.includes('Ashbringer'));
      },
    );
  });

  it('carries a decline as such, with its note', async () => {
    await withAI(ai(), async () => {
      const { id, batch } = await open(READ_STEP);
      server.answer({ body: says('Understood.') });
      strictEqual(
        (await report(id, { batch, results: [{ declined: true, note: 'not now' }] })).status,
        200,
      );
      const messages = server.requests[1]?.body.messages as
        | { content: { content: string }[] }[]
        | undefined;
      const content = messages?.[2]?.content[0]?.content ?? '';
      deepStrictEqual(JSON.parse(content)[0], { route: QUERY, declined: true, note: 'not now' });
    });
  });

  it('answers `409` for a turn that is unknown, closed, or not theirs', async () => {
    await withAI(ai(), async () => {
      const body = { batch: 'b', results: [] };
      for (const id of ['nope', '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6c']) {
        const gone = await report(id, body);
        strictEqual(gone.status, 409);
        deepStrictEqual(gone.body.data, { code: 'turnGone' });
      }
      const { id, batch } = await open(READ_STEP);
      const theirs = await report(id, { batch, results: [found] }, other.token);
      deepStrictEqual([theirs.status, theirs.body.data], [409, { code: 'turnGone' }]);
      const { id: closed } = await open(says('Done.'));
      const done = await report(closed, { batch, results: [found] });
      deepStrictEqual([done.status, done.body.data], [409, { code: 'turnGone' }]);
    });
  });

  it('answers `409` for a batch the turn never produced, or one already reported', async () => {
    await withAI(ai(), async () => {
      const { id, batch } = await open(READ_STEP);
      const unknown = await report(id, { batch: 'b9', results: [found] });
      deepStrictEqual([unknown.status, unknown.body.data], [409, { code: 'unknownBatch' }]);
      server.answer({ body: READ_STEP });
      strictEqual((await report(id, { batch, results: [found] })).status, 200);
      const again = await report(id, { batch, results: [found] });
      deepStrictEqual([again.status, again.body.data], [409, { code: 'batchReported' }]);
    });
  });

  it('closes a turn idle past `ai.limits.turnTimeout` and answers `409`', async () => {
    await withAI(ai({ limits: { turnTimeout: 1 } }), async () => {
      const { id, batch } = await open(READ_STEP);
      await sleep(5);
      const stale = await report(id, { batch, results: [found] });
      deepStrictEqual([stale.status, stale.body.data], [409, { code: 'turnGone' }]);
      ok((await loadTurn(id))?.closedAt !== null);
    });
  });

  it('refuses a malformed body, and the wrong number of results', async () => {
    await withAI(ai(), async () => {
      const { id, batch } = await open(READ_STEP);
      strictEqual((await report(id, 'x')).status, 400);
      strictEqual((await report(id, { batch, results: [found], extra: 1 })).status, 400);
      strictEqual((await report(id, { batch: 1, results: [found] })).status, 400);
      strictEqual((await report(id, { batch, results: [] })).status, 400);
      strictEqual((await report(id, { batch, results: [found, found] })).status, 400);
      strictEqual((await report(id, { batch, results: [{ status: 'ok' }] })).status, 400);
      strictEqual((await report(id, { batch, results: [{ status: 200, note: 'x' }] })).status, 400);
      strictEqual(
        (await report(id, { batch, results: [{ declined: true, status: 200 }] })).status,
        400,
      );
      strictEqual((await report(id, { batch, results: [{ declined: false }] })).status, 400);
      strictEqual((await report(id, { batch, results: [found] }, null)).status, 401);
      useEnv().unset(KEY as never);
      strictEqual((await report(id, { batch, results: [found] })).status, 503);
      strictEqual((await loadTurn(id))?.batches[0]?.reported, undefined);
    });
  });
});
