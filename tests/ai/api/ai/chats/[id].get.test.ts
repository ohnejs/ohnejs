import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import type { Config } from '../../../../../src/ohne/layers/config.ts';

import chatGet from '../../../../../src/ai/api/ai/chats/[id].get.ts';
import resultsPost from '../../../../../src/ai/api/ai/turns/[id]/results.post.ts';
import turnsPost from '../../../../../src/ai/api/ai/turns/index.post.ts';
import { loadTurn } from '../../../../../src/ai/turns/state.ts';
import { useEnv } from '../../../../../src/ohne/env/use-env.ts';
import { call, route, signIn, withAI } from '../../../_fixture.ts';
import { startProviderServer } from '../../../providers/_server.ts';
import { calls, readEvents, says } from '../turns/_stand-in.ts';

const CHAT = route('GET', '/ai/chats/[id]', chatGet);
const TURNS = route('POST', '/ai/turns', turnsPost);
const RESULTS = route('POST', '/ai/turns/[id]/results', resultsPost);
const KEY = 'AI_CHAT_OPEN_TEST_KEY';
const UUID = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';
const QUERY = 'POST /collections/characters/query';

useEnv().define(KEY as never, { default: undefined as never });

const server = await startProviderServer();
const officer = await signIn('officer@chat-open.example.com', ['officer']);
const other = await signIn('other@chat-open.example.com', ['officer']);
const reader = await signIn('reader@chat-open.example.com', ['reader']);

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
 * Asks `input` as the officer, following up on `after`, and returns the turn's id.
 */
async function ask(input: string, after?: string): Promise<string> {
  const { response, drain } = await call(TURNS, {
    path: '/ai/turns',
    body: { input, page: '/', ...(after === undefined ? {} : { after }) },
    token: officer.token,
  });
  const events = await readEvents(response);
  await drain();
  return events[0]?.data.id as string;
}

/**
 * Opens the chat `id` as the person `token` signs in.
 */
async function open(
  id: string,
  token?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { response, drain } = await call(CHAT, { path: `/ai/chats/${id}`, token, params: { id } });
  const body = (await response.json()) as Record<string, unknown>;
  await drain();
  return { status: response.status, body };
}

describe('GET /ai/chats/[id]', () => {
  beforeEach(() => useEnv().set(KEY as never, 'sk-test' as never));
  afterEach(() => useEnv().unset(KEY as never));
  after(() => server.close());

  it('needs `ai.use` and a configured model', async () => {
    await withAI(ai(), async () => {
      strictEqual((await open(UUID)).status, 401);
      strictEqual((await open(UUID, reader.token)).status, 403);
    });
    await withAI(ai({ model: undefined }), async () => {
      strictEqual((await open(UUID, officer.token)).status, 404);
    });
  });

  it("answers someone else's chat as it answers an unknown one", async () => {
    server.answer({ body: says('Hi.') });
    await withAI(ai(), async () => {
      const id = await ask('Who is level 60?');
      const unknown = await open(UUID, other.token);
      strictEqual(unknown.status, 404);
      deepStrictEqual(await open(id, other.token), unknown);
      deepStrictEqual((await open('nope', officer.token)).status, 404);
    });
  });

  it('replays the chat, oldest first, without a transcript, usage, model or record value', async () => {
    server.answer(
      {
        body: calls('Reading.', [
          {
            id: 'toolu_1',
            name: 'request',
            input: { requests: [{ route: QUERY, body: { where: { UUID } } }] },
          },
        ]),
      },
      { body: says('That is Thrall.') },
      { body: says('Level 59 has nobody.') },
    );
    await withAI(ai(), async () => {
      const first = await ask('Who is level 60?');
      const batch = (await loadTurn(first))?.batches[0]?.id;
      const reported = await call(RESULTS, {
        path: `/ai/turns/${first}/results`,
        body: {
          batch,
          results: [{ status: 200, body: { records: [{ UUID, name: 'Secret' }], total: 1 } }],
        },
        token: officer.token,
        params: { id: first },
      });
      await readEvents(reported.response);
      await reported.drain();
      const second = await ask('And level 59?', first);
      const { status, body } = await open(first, officer.token);
      strictEqual(status, 200);
      const turns = body.turns as Record<string, unknown>[];
      deepStrictEqual(
        turns.map(({ id, input, status }) => ({ id, input, status })),
        [
          { id: first, input: 'Who is level 60?', status: 'closed' },
          { id: second, input: 'And level 59?', status: 'closed' },
        ],
      );
      deepStrictEqual(turns[0].steps, [
        {
          text: 'Reading.',
          batch: {
            id: batch,
            kind: 'read',
            proposals: [{ route: QUERY, tier: 'read', body: { where: { UUID }, page: 1 } }],
            results: [{ status: 200, body: { total: 1, records: [{ UUID }] } }],
          },
        },
        { text: 'That is Thrall.', batch: null },
      ]);
      const sent = JSON.stringify(body);
      for (const leak of ['transcript', 'usage', 'smart', 'Secret']) ok(!sent.includes(leak), leak);
    });
  });
});
