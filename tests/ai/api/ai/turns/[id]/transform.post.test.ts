import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Config } from '../../../../../../src/ohne/layers/config.ts';
import type { ProviderServer } from '../../../../providers/_server.ts';
import type { StreamedEvent } from '../_stand-in.ts';

import transformPost from '../../../../../../src/ai/api/ai/turns/[id]/transform.post.ts';
import turnsPost from '../../../../../../src/ai/api/ai/turns/index.post.ts';
import { closeTurn, loadTurn } from '../../../../../../src/ai/turns/state.ts';
import { useEnv } from '../../../../../../src/ohne/env/use-env.ts';
import { useFlows } from '../../../../../../src/ohne/flows/use-flows.ts';
import { queryUntyped } from '../../../../../../src/ohne/query/query.ts';
import { call, route, signIn, withAI } from '../../../../_fixture.ts';
import { startProviderServer } from '../../../../providers/_server.ts';
import { calls, readEvents, says } from '../_stand-in.ts';

const TURNS = route('POST', '/ai/turns', turnsPost);
const TRANSFORM = route('POST', '/ai/turns/[id]/transform', transformPost);
const KEY = 'AI_TRANSFORM_TEST_KEY';
const UUID = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';

useEnv().define(KEY as never, { default: undefined as never });

for (const model of ['fast', 'blind']) {
  useFlows().register(`rewrite-${model}`, {
    name: `rewrite-${model}`,
    flow: { description: 'Rewrites.', start: 'only', nodes: { only: { act: { model } } } },
  });
}

const server: ProviderServer = await startProviderServer();
const officer = await signIn('officer@transform.example.com', ['officer']);
const other = await signIn('other@transform.example.com', ['officer']);

const entry = {
  provider: 'anthropic',
  model: 'claude-test',
  key: KEY,
  baseURL: server.url,
} as const;

/**
 * The app's `ai` settings: every model pointed at the stand-in, `Items` opened, with `extra` on top.
 */
function ai(extra: Partial<NonNullable<Config['ai']>> = {}): Config['ai'] {
  return {
    model: 'smart',
    models: {
      smart: entry,
      fast: { ...entry, model: 'claude-fast' },
      blind: { ...entry, model: 'claude-blind', data: false },
      router: { provider: 'jev', model: 'jev-test', key: false, baseURL: server.url },
    },
    data: { Items: true },
    ...extra,
  };
}

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
 * A step that proposes to shout every item's name and tooltip, and to read one character.
 */
const SHOUT_STEP = calls('Rewriting.', [
  {
    id: 'toolu_1',
    name: 'request',
    input: {
      requests: [
        { route: 'POST /collections/characters/query', body: { where: { UUID } } },
        {
          route: 'PATCH /collections/items/[uuid]',
          where: {},
          transform: { fields: ['name', 'tooltip'], instruction: 'Shout it.' },
        },
      ],
    },
  },
]);

/**
 * Opens a turn whose first step the stand-in answers with `answer`, and returns its id and pending batch.
 */
async function open(answer: string): Promise<{ id: string; batch: string }> {
  server.answer({ body: answer });
  const { response, drain } = await call(TURNS, {
    path: '/ai/turns',
    body: { input: 'Shout every item.', page: '/collections/items' },
    token: officer.token,
  });
  const { status, events } = await answered(response, drain);
  strictEqual(status, 200);
  const id = events[0]?.data.id as string;
  const batch = (events.find((event) => event.event === 'batch')?.data.id as string) ?? '';
  return { id, batch };
}

/**
 * Opens a turn walking `flow`, whose only node the stand-in answers with `SHOUT_STEP`.
 */
async function openFlow(flow: string): Promise<{ id: string; batch: string }> {
  server.answer({ body: SHOUT_STEP });
  const { response, drain } = await call(TURNS, {
    path: '/ai/turns',
    body: { input: 'Shout every item.', page: '/collections/items', flow },
    token: officer.token,
  });
  const { events } = await answered(response, drain);
  const batch = events.find((event) => event.event === 'batch')?.data;
  strictEqual(batch?.pinned, flow.slice('rewrite-'.length));
  return { id: events[0]?.data.id as string, batch: batch?.id as string };
}

/**
 * Runs a transform of the turn `id` with `body`, as the person `token` signs in.
 */
async function transform(
  id: string,
  body: unknown,
  token: string | null = officer.token,
): Promise<Answered> {
  const { response, drain } = await call(TRANSFORM, {
    path: `/ai/turns/${id}/transform`,
    body,
    token: token ?? undefined,
    params: { id },
  });
  return answered(response, drain);
}

/**
 * The stand-in's answer that upper-cases every value of the records it was sent.
 */
function shouted(): string {
  const sent = server.requests.at(-1)?.body.messages as { content: string }[];
  const input = JSON.parse(sent[0].content) as { records: Record<string, string>[] };
  return says(
    JSON.stringify({
      records: input.records.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            key === 'UUID' ? value : value.toUpperCase(),
          ]),
        ),
      ),
    }),
  );
}

/**
 * Records keyed by their `UUID`, so an assertion reads the same whatever order they came in.
 */
function byUUID(records: unknown): Record<string, unknown> {
  return Object.fromEntries((records as { UUID: string }[]).map((record) => [record.UUID, record]));
}

await queryUntyped('Items').where({}).delete();
const items: string[] = [];
for (const name of ['Ashbringer', 'Thunderfury']) {
  const record = await queryUntyped('Items').createOrThrow({ name, tooltip: 'Slays', secret: 's' });
  items.push(record.UUID as string);
}

describe('POST /ai/turns/[id]/transform', () => {
  beforeEach(() => {
    useEnv().set(KEY as never, 'sk-test' as never);
    server.requests.length = 0;
  });
  afterEach(() => useEnv().unset(KEY as never));
  after(() => server.close());

  it("reads the records as the person, rewrites them on the turn's model, and streams them", async () => {
    await withAI(ai(), async () => {
      const { id, batch } = await open(SHOUT_STEP);
      const proposal = (await loadTurn(id))?.batches[0]?.proposals[1]?.proposal;
      deepStrictEqual(proposal, {
        route: 'PATCH /collections/items/[uuid]',
        tier: 'write',
        where: {},
        transform: { fields: ['name', 'tooltip'], instruction: 'Shout it.' },
      });
      // The stand-in reads the request that just arrived, so the answer is scripted one request late.
      server.answer({ body: says('{"records":[]}') });
      const first = await transform(id, { batch, proposal: 1 });
      strictEqual(first.status, 200);
      deepStrictEqual(first.events[0], { event: 'start', data: { matched: 2, reached: 2 } });
      deepStrictEqual(first.events.at(-1), { event: 'done', data: { transformed: 0, skipped: 2 } });
      const sent = server.requests.at(-1)?.body as Record<string, unknown>;
      strictEqual(sent.model, 'claude-test');
      deepStrictEqual(sent.output_config, {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              records: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    UUID: { type: 'string' },
                    name: { type: 'string' },
                    tooltip: { type: 'string' },
                  },
                  required: ['UUID', 'name', 'tooltip'],
                  additionalProperties: false,
                },
              },
            },
            required: ['records'],
            additionalProperties: false,
          },
        },
      });
      const system = sent.system as { text: string }[];
      ok(system[0].text.startsWith('# Rewriting'));
      strictEqual(
        system[1].text,
        '# Instruction\nShout it.\nLocale: `en`. Every value you answer is in this locale.',
      );
      const [message] = sent.messages as { role: string; content: string }[];
      strictEqual(message.role, 'user');
      deepStrictEqual(byUUID(JSON.parse(message.content).records), {
        [items[0]]: { UUID: items[0], name: 'Ashbringer', tooltip: 'Slays' },
        [items[1]]: { UUID: items[1], name: 'Thunderfury', tooltip: 'Slays' },
      });
      ok(!JSON.stringify(sent).includes('secret'));
      server.answer({ body: shouted() });
      const second = await transform(id, { batch, proposal: 1, model: 'fast' });
      strictEqual(second.status, 200);
      deepStrictEqual(second.events[0], { event: 'start', data: { matched: 2, reached: 2 } });
      deepStrictEqual(second.events.at(-1), {
        event: 'done',
        data: { transformed: 2, skipped: 0 },
      });
      strictEqual(second.events.length, 3);
      deepStrictEqual(byUUID(second.events[1].data.records), {
        [items[0]]: {
          UUID: items[0],
          source: { name: 'Ashbringer', tooltip: 'Slays' },
          proposed: { name: 'ASHBRINGER', tooltip: 'SLAYS' },
        },
        [items[1]]: {
          UUID: items[1],
          source: { name: 'Thunderfury', tooltip: 'Slays' },
          proposed: { name: 'THUNDERFURY', tooltip: 'SLAYS' },
        },
      });
      strictEqual(server.requests.at(-1)?.body.model, 'claude-fast');
      strictEqual((await loadTurn(id))?.closedAt, null);
    });
  });

  it("charges every chunk against the person's tokens", async () => {
    await withAI(ai({ limits: { tokens: { limit: 70, window: '1h' } } }), async () => {
      const { id, batch } = await open(SHOUT_STEP);
      server.answer({ body: says('{"records":[]}') });
      strictEqual((await transform(id, { batch, proposal: 1 })).status, 200);
      const spent = await transform(id, { batch, proposal: 1 });
      strictEqual(spent.status, 429);
    });
  });

  it('refuses a model that is unknown, a `jev` one, or one that cannot see values', async () => {
    await withAI(ai(), async () => {
      const { id, batch } = await open(SHOUT_STEP);
      strictEqual((await transform(id, { batch, proposal: 1, model: 'gpt' })).status, 400);
      strictEqual((await transform(id, { batch, proposal: 1, model: 'router' })).status, 400);
      const blind = await transform(id, { batch, proposal: 1, model: 'blind' });
      deepStrictEqual([blind.status, blind.body.data], [400, { code: 'blindModel' }]);
      strictEqual(server.requests.length, 1);
    });
  });

  it('runs on the pinned model, even under a blind turn, and refuses any pick while one is pinned', async () => {
    await withAI(ai({ model: 'blind', transform: { model: 'fast' } }), async () => {
      const { id, batch } = await open(SHOUT_STEP);
      strictEqual((await transform(id, { batch, proposal: 1, model: 'fast' })).status, 400);
      strictEqual((await transform(id, { batch, proposal: 1, model: 'smart' })).status, 400);
      server.answer({ body: says('{"records":[]}') });
      strictEqual((await transform(id, { batch, proposal: 1 })).status, 200);
      strictEqual(server.requests.at(-1)?.body.model, 'claude-fast');
    });
  });

  it("pins a flow node's model over `ai.transform.model`, and refuses a blind one", async () => {
    await withAI(ai({ transform: { model: 'smart' } }), async () => {
      const fast = await openFlow('rewrite-fast');
      const picked = await transform(fast.id, { batch: fast.batch, proposal: 1, model: 'fast' });
      strictEqual(picked.status, 400);
      server.answer({ body: says('{"records":[]}') });
      strictEqual((await transform(fast.id, { batch: fast.batch, proposal: 1 })).status, 200);
      strictEqual(server.requests.at(-1)?.body.model, 'claude-fast');
      const blind = await openFlow('rewrite-blind');
      const refused = await transform(blind.id, { batch: blind.batch, proposal: 1 });
      deepStrictEqual([refused.status, refused.body.data], [400, { code: 'blindModel' }]);
    });
  });

  it('answers `409` for a turn that is unknown, closed, or not theirs, and for a wrong batch', async () => {
    await withAI(ai(), async () => {
      for (const id of ['nope', '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6c']) {
        const gone = await transform(id, { batch: 'b', proposal: 1 });
        deepStrictEqual([gone.status, gone.body.data], [409, { code: 'turnGone' }]);
      }
      const { id, batch } = await open(SHOUT_STEP);
      const theirs = await transform(id, { batch, proposal: 1 }, other.token);
      deepStrictEqual([theirs.status, theirs.body.data], [409, { code: 'turnGone' }]);
      const unknown = await transform(id, { batch: 'b9', proposal: 1 });
      deepStrictEqual([unknown.status, unknown.body.data], [409, { code: 'unknownBatch' }]);
      await closeTurn((await loadTurn(id))!, 'idle');
      const closed = await transform(id, { batch, proposal: 1 });
      deepStrictEqual([closed.status, closed.body.data], [409, { code: 'turnGone' }]);
      strictEqual(server.requests.length, 1);
    });
  });

  it('closes a turn idle past `ai.limits.turnTimeout` and answers `409`', async () => {
    await withAI(ai({ limits: { turnTimeout: 1 } }), async () => {
      const { id, batch } = await open(SHOUT_STEP);
      await sleep(5);
      const idle = await transform(id, { batch, proposal: 1 });
      deepStrictEqual([idle.status, idle.body.data], [409, { code: 'turnGone' }]);
      strictEqual((await loadTurn(id))?.reason, 'idle');
      strictEqual(server.requests.length, 1);
    });
  });

  it('touches the turn as a run starts, so the idle time counts from the run', async () => {
    await withAI(ai(), async () => {
      const { id, batch } = await open(SHOUT_STEP);
      const opened = (await loadTurn(id))!.updatedAt;
      await sleep(5);
      server.answer({ body: says('{"records":[]}') });
      strictEqual((await transform(id, { batch, proposal: 1 })).status, 200);
      ok((await loadTurn(id))!.updatedAt > opened);
    });
  });

  it("refuses a malformed body, a proposal that is no transform, and needs the model's key", async () => {
    await withAI(ai(), async () => {
      const { id, batch } = await open(SHOUT_STEP);
      strictEqual((await transform(id, 'x')).status, 400);
      strictEqual((await transform(id, { batch, proposal: 1, extra: 1 })).status, 400);
      strictEqual((await transform(id, { batch: 1, proposal: 1 })).status, 400);
      strictEqual((await transform(id, { batch, proposal: '1' })).status, 400);
      strictEqual((await transform(id, { batch, proposal: -1 })).status, 400);
      strictEqual((await transform(id, { batch, proposal: 0 })).status, 400);
      strictEqual((await transform(id, { batch, proposal: 2 })).status, 400);
      strictEqual((await transform(id, { batch, proposal: 1, model: 1 })).status, 400);
      strictEqual((await transform(id, { batch, proposal: 1 }, null)).status, 401);
      useEnv().unset(KEY as never);
      strictEqual((await transform(id, { batch, proposal: 1 })).status, 503);
      strictEqual(server.requests.length, 1);
    });
  });
});
