import { strictEqual } from 'node:assert';
import { after, describe, it } from 'node:test';

import turnsPost from '../../../src/ai/api/ai/turns/index.post.ts';
import { loadTurn } from '../../../src/ai/turns/state.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { parseSSE } from '../../../src/utils/sse/parse-sse.ts';
import { route, signIn, withAI } from '../_fixture.ts';
import { sse, startProviderServer } from '../providers/_server.ts';

const TURNS = route('POST', '/ai/turns', turnsPost);
const KEY = 'AI_STEP_TEST_KEY';
useEnv().define(KEY as never, { default: undefined as never });
useEnv().set(KEY as never, 'sk-test' as never);

const server = await startProviderServer();
const officer = await signIn('officer@step.example.com', ['officer']);

const partial = sse([
  {
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 25, output_tokens: 1 },
      },
    },
  },
  {
    event: 'content_block_start',
    data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  },
  {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Thinking' },
    },
  },
]);

async function open(signal?: AbortSignal): Promise<{
  status: number;
  drain: () => Promise<void>;
  body: ReadableStream<Uint8Array> | null;
}> {
  const url = 'http://x.test/ai/turns';
  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${officer.token}`,
  });
  const request = new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input: 'Who is that?', page: '/collections/characters' }),
    signal,
  });
  const { response, drain } = await dispatch(TURNS, request, new URL(url), {});
  return { status: response.status, drain, body: response.body };
}

describe('runStep', () => {
  after(() => server.close());

  it('charges a step the client leaves before `done` its estimated input', async () => {
    await withAI(
      {
        model: 'smart',
        models: {
          smart: { provider: 'anthropic', model: 'claude-test', key: KEY, baseURL: server.url },
        },
        limits: { tokens: { limit: 30, window: '1h' } },
      },
      async () => {
        server.answer({ body: partial, hold: true });
        const controller = new AbortController();
        const opened = await open(controller.signal);
        strictEqual(opened.status, 200);
        let id = '';
        for await (const message of parseSSE(opened.body as ReadableStream<Uint8Array>)) {
          if (message.event === 'turn') id = (JSON.parse(message.data) as { id: string }).id;
          if (message.event === 'text') controller.abort();
        }
        await opened.drain();
        strictEqual((await loadTurn(id))?.reason, 'left');
        const next = await open();
        strictEqual(next.status, 429);
        await next.drain();
      },
    );
  });
});
