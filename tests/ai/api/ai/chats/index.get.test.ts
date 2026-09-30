import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import type { Config } from '../../../../../src/ohne/layers/config.ts';

import chatsGet from '../../../../../src/ai/api/ai/chats/index.get.ts';
import turnsPost from '../../../../../src/ai/api/ai/turns/index.post.ts';
import { useEnv } from '../../../../../src/ohne/env/use-env.ts';
import { call, route, signIn, withAI } from '../../../_fixture.ts';
import { startProviderServer } from '../../../providers/_server.ts';
import { readEvents, says } from '../turns/_stand-in.ts';

const CHATS = route('GET', '/ai/chats', chatsGet);
const TURNS = route('POST', '/ai/turns', turnsPost);
const KEY = 'AI_CHATS_LIST_TEST_KEY';

useEnv().define(KEY as never, { default: undefined as never });

const server = await startProviderServer();
const officer = await signIn('officer@chats-list.example.com', ['officer']);
const other = await signIn('other@chats-list.example.com', ['officer']);
const reader = await signIn('reader@chats-list.example.com', ['reader']);

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
 * Asks `input` as the person `token` signs in, following up on `after`, and returns the turn's id.
 */
async function ask(input: string, token: string, after?: string): Promise<string> {
  const { response, drain } = await call(TURNS, {
    path: '/ai/turns',
    body: { input, page: '/', ...(after === undefined ? {} : { after }) },
    token,
  });
  const events = await readEvents(response);
  await drain();
  return events[0]?.data.id as string;
}

/**
 * Lists the chats of the person `token` signs in.
 */
async function list(token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const { response, drain } = await call(CHATS, { path: '/ai/chats', token });
  const body = (await response.json()) as Record<string, unknown>;
  await drain();
  return { status: response.status, body };
}

describe('GET /ai/chats', () => {
  beforeEach(() => useEnv().set(KEY as never, 'sk-test' as never));
  afterEach(() => useEnv().unset(KEY as never));
  after(() => server.close());

  it('needs `ai.use` and a configured model', async () => {
    await withAI(ai(), async () => {
      strictEqual((await list()).status, 401);
      strictEqual((await list(reader.token)).status, 403);
    });
    await withAI(ai({ model: undefined }), async () => {
      strictEqual((await list(officer.token)).status, 404);
    });
  });

  it("lists the person's own chats, newest first, without a transcript, usage or model", async () => {
    server.answer({ body: says('One.') }, { body: says('Two.') }, { body: says('Three.') });
    await withAI(ai(), async () => {
      const first = await ask('Who is level 60?', officer.token);
      await ask('Not yours', other.token);
      await ask('And level 59?', officer.token, first);
      const { status, body } = await list(officer.token);
      strictEqual(status, 200);
      const chats = body.chats as Record<string, unknown>[];
      deepStrictEqual(
        chats.map(({ id, title }) => ({ id, title })),
        [{ id: first, title: 'Who is level 60?' }],
      );
      deepStrictEqual(Object.keys(chats[0]).sort(), ['id', 'title', 'updatedAt']);
      const sent = JSON.stringify(body);
      ok(!sent.includes('transcript') && !sent.includes('usage') && !sent.includes('smart'));
    });
  });
});
