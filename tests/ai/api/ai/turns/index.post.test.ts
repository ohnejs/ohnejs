import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Config } from '../../../../../src/ohne/layers/config.ts';
import type { ProviderServer } from '../../../providers/_server.ts';
import type { StreamedEvent } from './_stand-in.ts';

import turnsPost from '../../../../../src/ai/api/ai/turns/index.post.ts';
import { closeTurn, loadTurn, openTurn } from '../../../../../src/ai/turns/state.ts';
import { useEnv } from '../../../../../src/ohne/env/use-env.ts';
import { hook } from '../../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../../src/ohne/hooks/use-hooks.ts';
import { queryUntyped } from '../../../../../src/ohne/query/query.ts';
import { useSkills } from '../../../../../src/ohne/skills/use-skills.ts';
import { call, route, signIn, withAI } from '../../../_fixture.ts';
import { startProviderServer } from '../../../providers/_server.ts';
import { calls, cut, readEvents, REFUSED, says } from './_stand-in.ts';

const TURNS = route('POST', '/ai/turns', turnsPost);
const KEY = 'AI_TURNS_TEST_KEY';
const UUID = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';

useEnv().define(KEY as never, { default: undefined as never });
useSkills().register('retire-characters', {
  name: 'retire-characters',
  skill: {
    description: 'Retire.',
    prompt: 'Retire the old ones.',
    capability: 'collection.Characters.update',
  },
});
useSkills().register('weekly-report', {
  name: 'weekly-report',
  skill: { description: 'Report.', prompt: '\nSum up the week.\n' },
});

const server: ProviderServer = await startProviderServer();
const officer = await signIn('officer@turns.example.com', ['officer']);
const asker = await signIn('asker@turns.example.com', ['asker']);
const reader = await signIn('reader@turns.example.com', ['reader']);

/**
 * The app's `ai` settings, every model pointed at the stand-in, with `extra` on top.
 */
function ai(extra: Partial<NonNullable<Config['ai']>> = {}): Config['ai'] {
  return {
    model: 'smart',
    models: {
      smart: { provider: 'anthropic', model: 'claude-test', key: KEY, baseURL: server.url },
      fast: { provider: 'anthropic', model: 'claude-fast', key: KEY, baseURL: server.url },
      router: { provider: 'jev', model: 'jev-test', key: false, baseURL: server.url },
    },
    ...extra,
  };
}

interface Opened {
  status: number;
  events: StreamedEvent[];
  body: Record<string, unknown>;
}

/**
 * Opens a turn with `body` as the person `token` signs in, reading the whole stream when it opens.
 */
async function open(body: unknown, token: string | null = officer.token): Promise<Opened> {
  const { response, drain } = await call(TURNS, {
    path: '/ai/turns',
    body,
    token: token ?? undefined,
  });
  const opened: Opened = { status: response.status, events: [], body: {} };
  if (response.headers.get('content-type') === 'text/event-stream') {
    opened.events = await readEvents(response);
  } else {
    opened.body = (await response.json()) as Record<string, unknown>;
  }
  await drain();
  return opened;
}

const ask = { input: 'Who is level 60?', page: '/collections/characters' };

describe('POST /ai/turns', () => {
  beforeEach(() => {
    useEnv().set(KEY as never, 'sk-test' as never);
    server.requests.length = 0;
  });
  afterEach(() => useEnv().unset(KEY as never));
  after(() => server.close());

  it('needs `ai.use`, a configured model with its key, and a well-formed body', async () => {
    await withAI(ai(), async () => {
      strictEqual((await open(ask, null)).status, 401);
      strictEqual((await open(ask, reader.token)).status, 403);
      strictEqual((await open('x')).status, 400);
      strictEqual((await open({ ...ask, flow: 'x' })).status, 400);
      strictEqual((await open({ page: '/' })).status, 400);
      strictEqual((await open({ ...ask, input: '   ' })).status, 400);
      strictEqual((await open({ ...ask, page: 'collections' })).status, 400);
      strictEqual((await open({ ...ask, page: '/x\n# Instructions' })).status, 400);
      strictEqual((await open({ ...ask, model: 'gpt' })).status, 400);
      strictEqual((await open({ ...ask, model: 'router' })).status, 400);
      strictEqual((await open({ ...ask, skill: 'nope' })).status, 400);
      strictEqual((await open({ ...ask, skill: 'retire-characters' }, asker.token)).status, 400);
      hook('ai:credentials', () => false);
      try {
        strictEqual((await open(ask)).status, 503);
      } finally {
        useHooks().delete('ai:credentials');
      }
      useEnv().unset(KEY as never);
      strictEqual((await open(ask)).status, 503);
    });
    await withAI(ai({ model: undefined }), async () => {
      strictEqual((await open(ask)).status, 404);
    });
    strictEqual(server.requests.length, 0);
  });

  it('streams the first step: the turn, its text, then `done`, and closes an answered turn', async () => {
    server.answer({ body: says('Nobody yet.') });
    await withAI(ai(), async () => {
      const { status, events } = await open(ask);
      strictEqual(status, 200);
      const id = events[0]?.data.id as string;
      match(id, /^[0-9a-f-]{36}$/);
      deepStrictEqual(events.slice(1), [
        { event: 'text', data: { text: 'Nobody yet.' } },
        { event: 'done', data: { reason: 'end' } },
      ]);
      const turn = await loadTurn(id);
      strictEqual(turn?.user, officer.uuid);
      strictEqual(turn?.model, 'smart');
      strictEqual(turn?.page, '/collections/characters');
      strictEqual(turn?.step, 1);
      ok(turn?.closedAt !== null);
      strictEqual(turn?.reason, 'end');
      deepStrictEqual(turn?.usage, { fresh: 25, cacheRead: 0, cacheWrite: 0, output: 12 });
      deepStrictEqual(turn?.transcript, [
        { role: 'user', content: 'Who is level 60?' },
        { role: 'assistant', content: [{ type: 'text', text: 'Nobody yet.' }] },
      ]);
    });
  });

  it('sends the prompt stack, the tools and the transcript to the provider', async () => {
    server.answer({ body: says('Ok.') });
    await withAI(ai({ instructions: ['Never delete a Character.'] }), async () => {
      await open({ ...ask, skill: 'weekly-report' });
    });
    const [seen] = server.requests;
    strictEqual(seen?.path, '/v1/messages');
    const system = seen?.body.system as { text: string; cache_control?: unknown }[];
    deepStrictEqual(
      system.map((block) => [block.text.split('\n')[0], block.cache_control !== undefined]),
      [
        ['# Rules', false],
        ['# The API', false],
        ['# Instructions', true],
        ['# This app', true],
        ['# Person', false],
      ],
    );
    ok(system[3].text.includes('POST /collections/characters/query'));
    ok(system[4].text.includes('Page: /collections/characters'));
    const tools = seen?.body.tools as { name: string }[] | undefined;
    deepStrictEqual(
      tools?.map((tool) => tool.name),
      ['request', 'describe', 'skill', 'open'],
    );
    deepStrictEqual(seen?.body.messages, [
      {
        role: 'user',
        content: '<skill name="weekly-report">\nSum up the week.\n</skill>\n\nWho is level 60?',
      },
    ]);
  });

  it('turns a step that ends in calls into a batch, answering the calls the server can', async () => {
    server.answer({
      body: calls('Reading.', [
        {
          id: 'toolu_1',
          name: 'request',
          input: {
            requests: [
              { route: 'POST /collections/characters/query', body: { where: { UUID } } },
              { route: 'GET /reports' },
            ],
          },
        },
        { id: 'toolu_2', name: 'describe', input: { collection: 'Characters' } },
        { id: 'toolu_3', name: 'skill', input: { name: 'retire-characters' } },
        { id: 'toolu_4', name: 'skill', input: { name: 'nope' } },
      ]),
    });
    await withAI(ai(), async () => {
      const { events } = await open(ask);
      const id = events[0]?.data.id as string;
      const batch = events[2]?.data;
      match(batch?.id as string, /^[A-Za-z0-9_-]{22}$/);
      deepStrictEqual(events.slice(1), [
        { event: 'text', data: { text: 'Reading.' } },
        {
          event: 'batch',
          data: {
            id: batch?.id,
            kind: 'read',
            proposals: [
              {
                route: 'POST /collections/characters/query',
                tier: 'read',
                body: { where: { UUID }, page: 1 },
              },
            ],
          },
        },
        { event: 'done', data: { reason: 'batch' } },
      ]);
      const turn = await loadTurn(id);
      strictEqual(turn?.closedAt, null);
      strictEqual(turn?.step, 1);
      const [pending] = turn?.batches ?? [];
      strictEqual(pending?.id, batch?.id);
      strictEqual(pending?.step, 1);
      strictEqual(pending?.reported, undefined);
      deepStrictEqual(
        pending?.calls.map(({ id, name, receipts, content, error }) => [
          id,
          name,
          receipts,
          content?.split('\n')[0],
          error,
        ]),
        [
          [
            'toolu_1',
            'request',
            [null, { route: 'GET /reports', status: 400, code: 'unknownRoute', path: 'route' }],
            undefined,
            undefined,
          ],
          [
            'toolu_2',
            'describe',
            undefined,
            '## Characters (`characters`): query, create, update, delete.',
            undefined,
          ],
          ['toolu_3', 'skill', undefined, '<skill name="retire-characters">', undefined],
          ['toolu_4', 'skill', undefined, '{"error":"unknownSkill"}', true],
        ],
      );
      deepStrictEqual(
        pending?.proposals.map((entry) => [entry.call, entry.index, entry.identity]),
        [[0, 0, true]],
      );
    });
  });

  it('marks the batch by its highest tier, and refuses a call that takes the step over `ai.limits.requests`', async () => {
    const retire = {
      route: 'PATCH /collections/characters/[uuid]',
      where: { level: { lessThan: 10 } },
      body: { status: 'retired' },
    };
    const read = {
      route: 'POST /collections/characters/verdicts',
      body: { where: { level: { lessThan: 10 } } },
    };
    server.answer({
      body: calls('Retiring.', [
        { id: 'toolu_1', name: 'request', input: { requests: [read, retire] } },
        { id: 'toolu_2', name: 'request', input: { requests: [read] } },
      ]),
    });
    await withAI(ai({ limits: { requests: 2 } }), async () => {
      const { events } = await open(ask);
      const batch = events[2]?.data as { kind: string; proposals: unknown[] };
      strictEqual(batch.kind, 'write');
      strictEqual(batch.proposals.length, 2);
      const turn = await loadTurn(events[0]?.data.id as string);
      deepStrictEqual(turn?.batches[0]?.calls[1], {
        id: 'toolu_2',
        name: 'request',
        content: '{"error":"tooManyRequests","max":2}',
        error: true,
      });
    });
  });

  it('closes the turn at `ai.limits.steps` instead of sending a batch', async () => {
    server.answer({
      body: calls('Reading.', [
        { id: 'toolu_1', name: 'describe', input: { collection: 'Items' } },
      ]),
    });
    await withAI(ai({ limits: { steps: 1 } }), async () => {
      const { events } = await open(ask);
      deepStrictEqual(events.slice(1), [
        { event: 'text', data: { text: 'Reading.' } },
        { event: 'done', data: { reason: 'steps' } },
      ]);
      const turn = await loadTurn(events[0]?.data.id as string);
      ok(turn?.closedAt !== null);
      strictEqual(turn?.reason, 'steps');
      deepStrictEqual(turn?.batches, []);
      deepStrictEqual(turn?.transcript.at(-1), {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: '{"error":"turnClosed"}',
            is_error: true,
          },
        ],
      });
    });
  });

  it('closes the turn on a cut answer, and on a provider failure with an `error`', async () => {
    server.answer({ body: cut('Well') }, REFUSED);
    await withAI(ai(), async () => {
      const first = await open(ask);
      deepStrictEqual(first.events.at(-1), { event: 'done', data: { reason: 'length' } });
      strictEqual((await loadTurn(first.events[0]?.data.id as string))?.reason, 'length');
      const second = await open(ask);
      deepStrictEqual(second.events.slice(1), [{ event: 'error', data: { code: 'provider' } }]);
      strictEqual((await loadTurn(second.events[0]?.data.id as string))?.reason, 'provider');
    });
  });

  it('counts turns and tokens per person', async () => {
    server.answer({ body: says('One.') }, { body: says('Two.') });
    await withAI(ai({ limits: { turns: { limit: 1, window: '1h' } } }), async () => {
      strictEqual((await open(ask)).status, 200);
      strictEqual((await open(ask)).status, 429);
      strictEqual((await open(ask, asker.token)).status, 200);
    });
    server.answer({ body: says('Three.') });
    await withAI(ai({ limits: { tokens: { limit: 10, window: '1h' } } }), async () => {
      strictEqual((await open(ask)).status, 200);
      const { status, body } = await open(ask);
      strictEqual(status, 429);
      strictEqual(body.statusCode, 429);
    });
  });

  it('follows up on a closed turn: the new turn starts from its transcript', async () => {
    server.answer({ body: says('Nobody yet.') }, { body: says('Still nobody.') });
    await withAI(ai(), async () => {
      const first = await open(ask);
      const id = first.events[0]?.data.id as string;
      const next = await open({ ...ask, input: 'And level 59?', after: id });
      strictEqual(next.status, 200);
      const follow = next.events[0]?.data.id as string;
      ok(follow !== id);
      const conversation = [
        { role: 'user', content: 'Who is level 60?' },
        { role: 'assistant', content: [{ type: 'text', text: 'Nobody yet.' }] },
        { role: 'user', content: 'And level 59?' },
      ];
      deepStrictEqual(server.requests[1]?.body.messages, conversation);
      const turn = await loadTurn(follow);
      deepStrictEqual(turn?.transcript, [
        ...conversation,
        { role: 'assistant', content: [{ type: 'text', text: 'Still nobody.' }] },
      ]);
      strictEqual(turn?.step, 1);
      strictEqual((await loadTurn(id))?.transcript.length, 2);
    });
  });

  it('closes the calls a turn left waiting before it follows up on it', async () => {
    server.answer(
      {
        body: calls('Reading.', [
          { id: 'toolu_1', name: 'describe', input: { collection: 'Items' } },
        ]),
      },
      { body: says('Fine.') },
    );
    await withAI(ai(), async () => {
      const first = await open(ask);
      const id = first.events[0]?.data.id as string;
      await closeTurn((await loadTurn(id))!, 'idle');
      strictEqual((await open({ ...ask, input: 'Never mind.', after: id })).status, 200);
      const messages = server.requests[1]?.body.messages as unknown[];
      deepStrictEqual(messages.slice(2), [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: '{"error":"turnClosed"}',
              is_error: true,
            },
          ],
        },
        { role: 'user', content: 'Never mind.' },
      ]);
    });
  });

  it('starts fresh when the follow-up picks another model', async () => {
    server.answer({ body: says('Nobody yet.') }, { body: says('Hello.') });
    await withAI(ai(), async () => {
      const first = await open(ask);
      const id = first.events[0]?.data.id as string;
      const next = await open({ ...ask, input: 'Hi', model: 'fast', after: id });
      strictEqual(next.status, 200);
      deepStrictEqual(server.requests[1]?.body.messages, [{ role: 'user', content: 'Hi' }]);
      strictEqual((await loadTurn(next.events[0]?.data.id as string))?.model, 'fast');
    });
  });

  it('refuses to follow up on a turn unknown or not theirs, and takes over one still open', async () => {
    server.answer(
      {
        body: calls('Reading.', [
          { id: 'toolu_1', name: 'describe', input: { collection: 'Items' } },
        ]),
      },
      { body: says('Done.') },
      { body: says('Again.') },
    );
    await withAI(ai(), async () => {
      const waiting = (await open(ask)).events[0]?.data.id as string;
      const closed = (await open(ask)).events[0]?.data.id as string;
      server.requests.length = 0;
      strictEqual((await open({ ...ask, after: 1 })).status, 400);
      for (const after of [UUID, 'nope']) {
        const refused = await open({ ...ask, after });
        deepStrictEqual([refused.status, refused.body.data], [409, { code: 'turnGone' }]);
      }
      const theirs = await open({ ...ask, after: closed }, asker.token);
      deepStrictEqual([theirs.status, theirs.body.data], [409, { code: 'turnGone' }]);
      strictEqual(server.requests.length, 0);
      const retry = await open({ ...ask, input: 'retry', after: waiting });
      strictEqual(retry.status, 200);
      strictEqual((await loadTurn(waiting))?.reason, 'left');
      strictEqual((await loadTurn(retry.events[0]?.data.id as string))?.chat, waiting);
      const messages = server.requests[0]?.body.messages as { role: string; content: unknown }[];
      deepStrictEqual(messages.at(-1), { role: 'user', content: 'retry' });
    });
  });

  it('follows up on a turn older than `ai.limits.turnTimeout`, and continues an idle one', async () => {
    server.answer(
      {
        body: calls('Reading.', [
          { id: 'toolu_1', name: 'describe', input: { collection: 'Items' } },
        ]),
      },
      { body: says('Done.') },
      { body: says('Still here.') },
      { body: says('Picked up.') },
    );
    await withAI(ai({ limits: { turnTimeout: 300 } }), async () => {
      const waiting = (await open(ask)).events[0]?.data.id as string;
      const closed = (await open(ask)).events[0]?.data.id as string;
      await sleep(350);
      strictEqual((await open({ ...ask, after: closed })).status, 200);
      const idle = await open({ ...ask, after: waiting });
      strictEqual(idle.status, 200);
      strictEqual((await loadTurn(waiting))?.reason, 'idle');
      strictEqual((await loadTurn(idle.events[0]?.data.id as string))?.chat, waiting);
    });
  });

  it('keeps what the person typed and the skill, and the first turn of the chat on every follow-up', async () => {
    server.answer({ body: says('One.') }, { body: says('Two.') }, { body: says('Three.') });
    await withAI(ai(), async () => {
      const first = (await open({ ...ask, skill: 'weekly-report' })).events[0]?.data.id as string;
      const second = (await open({ ...ask, input: 'And 59?', after: first })).events[0]?.data
        .id as string;
      const third = (await open({ ...ask, input: 'And 58?', after: second })).events[0]?.data
        .id as string;
      const root = await loadTurn(first);
      deepStrictEqual([root?.input, root?.skill, root?.chat], [ask.input, 'weekly-report', null]);
      const next = await loadTurn(second);
      deepStrictEqual([next?.input, next?.skill, next?.chat], ['And 59?', null, first]);
      strictEqual((await loadTurn(third))?.chat, first);
    });
  });

  it('prunes the turns `ai.audit.retain` no longer keeps once a turn starts', async () => {
    server.answer({ body: says('Done.') });
    await withAI(ai({ audit: { retain: '1d' } }), async () => {
      const old = await openTurn({
        user: officer.uuid,
        model: 'smart',
        page: '/',
        input: 'Hi',
        transcript: [],
      });
      await closeTurn(old, 'end');
      await queryUntyped('AITurns')
        .where({ UUID: old.UUID })
        .updateOrThrow({ closedAt: Date.now() - 2 * 86_400_000 });
      strictEqual((await open(ask)).status, 200);
      strictEqual(await loadTurn(old.UUID), undefined);
    });
  });
});
