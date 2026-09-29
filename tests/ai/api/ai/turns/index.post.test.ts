import { deepStrictEqual, match, ok, strictEqual } from 'node:assert';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import type { Config } from '../../../../../src/ohne/layers/config.ts';
import type { ProviderServer } from '../../../providers/_server.ts';
import type { StreamedEvent } from './_stand-in.ts';

import turnsPost from '../../../../../src/ai/api/ai/turns/index.post.ts';
import { loadTurn } from '../../../../../src/ai/turns/state.ts';
import { useEnv } from '../../../../../src/ohne/env/use-env.ts';
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
      ['request', 'describe', 'skill'],
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
      deepStrictEqual(turn?.batches, []);
    });
  });

  it('closes the turn on a cut answer, and on a provider failure with an `error`', async () => {
    server.answer({ body: cut('Well') }, REFUSED);
    await withAI(ai(), async () => {
      const first = await open(ask);
      deepStrictEqual(first.events.at(-1), { event: 'done', data: { reason: 'length' } });
      ok((await loadTurn(first.events[0]?.data.id as string))?.closedAt !== null);
      const second = await open(ask);
      deepStrictEqual(second.events.slice(1), [{ event: 'error', data: { code: 'provider' } }]);
      ok((await loadTurn(second.events[0]?.data.id as string))?.closedAt !== null);
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
});
