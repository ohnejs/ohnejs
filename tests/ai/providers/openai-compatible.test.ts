import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';

import type {
  DoneEvent,
  Provider,
  StepEvent,
  StepRequest,
  TranscriptItem,
} from '../../../src/ai/providers/provider.ts';
import type { ProviderServer } from './_server.ts';

import { createOpenAICompatibleProvider } from '../../../src/ai/providers/openai-compatible.ts';
import { sse, startProviderServer } from './_server.ts';

const schema = { type: 'object', properties: { route: { type: 'string' } } };

const request: StepRequest = {
  system: [{ text: 'Be brief.', cache: true }, { text: 'Now.' }],
  tools: [{ name: 'request', description: 'Send a request.', input: schema }],
  transcript: [{ role: 'user', content: 'Hi' }],
};

const usage = {
  prompt_tokens: 125,
  completion_tokens: 40,
  total_tokens: 165,
  prompt_tokens_details: { cached_tokens: 100 },
};

const chunk = (
  delta: Record<string, unknown>,
  finish_reason: string | null = null,
): { data: unknown } => ({
  data: {
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'llama-test',
    choices: [{ index: 0, delta, logprobs: null, finish_reason }],
  },
});

const piece = (index: number, fragment: Record<string, unknown>): Record<string, unknown> => ({
  index,
  ...fragment,
});

const tail = (finish_reason: string): { data: unknown }[] => [
  chunk({}, finish_reason),
  {
    data: {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'llama-test',
      choices: [],
      usage,
    },
  },
];

const done = (): string => 'data: [DONE]\n\n';

const hello = (): string =>
  sse([
    chunk({ role: 'assistant', content: '' }),
    chunk({ content: 'Hel' }),
    chunk({ content: 'lo' }),
    ...tail('stop'),
  ]) + done();

const isDone = (event: StepEvent): event is DoneEvent => event.type === 'done';

describe('createOpenAICompatibleProvider', () => {
  let server: ProviderServer;
  let provider: Provider;
  const signal = new AbortController().signal;
  const run = (steps: StepRequest = request): Promise<StepEvent[]> =>
    Array.fromAsync(provider.step(steps, signal));

  before(async () => {
    server = await startProviderServer();
    provider = createOpenAICompatibleProvider({
      model: 'llama-test',
      key: 'k',
      baseURL: server.url,
    });
  });
  after(() => server.close());
  beforeEach(() => {
    server.requests.length = 0;
  });

  it('streams text and gathers calls by index, then ends with usage and the assistant message', async () => {
    server.answer({
      body:
        sse([
          chunk({ role: 'assistant', content: '' }),
          chunk({ content: 'Send' }),
          chunk({ content: 'ing.' }),
          chunk({
            tool_calls: [
              piece(0, {
                id: 'call_1',
                type: 'function',
                function: { name: 'request', arguments: '' },
              }),
            ],
          }),
          chunk({ tool_calls: [piece(0, { function: { arguments: '{"route"' } })] }),
          chunk({
            tool_calls: [
              piece(1, {
                id: 'call_2',
                type: 'function',
                function: { name: 'request', arguments: '{}' },
              }),
            ],
          }),
          chunk({ tool_calls: [piece(0, { function: { arguments: ':"GET /x"}' } })] }),
          ...tail('tool_calls'),
        ]) + done(),
    });
    deepStrictEqual(await run(), [
      { type: 'text', text: 'Send' },
      { type: 'text', text: 'ing.' },
      {
        type: 'done',
        calls: [
          { id: 'call_1', name: 'request', input: { route: 'GET /x' } },
          { id: 'call_2', name: 'request', input: {} },
        ],
        stop: 'calls',
        usage: { fresh: 25, cacheRead: 100, cacheWrite: 0, output: 40 },
        model: 'llama-test',
        items: [
          {
            role: 'assistant',
            content: 'Sending.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'request', arguments: '{"route":"GET /x"}' },
              },
              { id: 'call_2', type: 'function', function: { name: 'request', arguments: '{}' } },
            ],
          },
        ],
      },
    ]);
  });

  it('posts the Chat Completions body with the system message first and usage asked for', async () => {
    server.answer({ body: hello() });
    await run();
    const [seen] = server.requests;
    strictEqual(seen?.path, '/chat/completions');
    strictEqual(seen?.headers.authorization, 'Bearer k');
    deepStrictEqual(seen?.body, {
      model: 'llama-test',
      max_tokens: 8192,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: 'Be brief.\n\nNow.' },
        { role: 'user', content: 'Hi' },
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'request', description: 'Send a request.', parameters: schema },
        },
      ],
    });
  });

  it('leaves out an empty tool list, which the API refuses', async () => {
    server.answer({ body: hello() });
    await run({ ...request, tools: [] });
    strictEqual(Object.hasOwn(server.requests[0]?.body ?? {}, 'tools'), false);
  });

  it('ends at the close of a stream that named its finish', async () => {
    server.answer({ body: sse([chunk({ content: 'Hi' }), ...tail('stop')]) });
    const [ended] = (await run()).filter(isDone);
    strictEqual(ended?.stop, 'end');
    deepStrictEqual(ended?.items, [{ role: 'assistant', content: 'Hi' }]);
  });

  it('reruns after an error chunk past the 200', async () => {
    server.answer(
      {
        body: sse([
          chunk({ content: 'Ov' }),
          { data: { error: { message: 'Boom', type: 'server_error' } } },
        ]),
      },
      { body: hello() },
    );
    const events = await run();
    deepStrictEqual(events.slice(0, 3), [
      { type: 'text', text: 'Ov' },
      { type: 'retry', wait: 500 },
      { type: 'text', text: 'Hel' },
    ]);
    strictEqual(server.requests.length, 2);
  });

  it('reports a refusal, said or filtered, and an answer cut short', async () => {
    server.answer({ body: sse([chunk({ refusal: 'No.' }), ...tail('stop')]) + done() });
    const [refused] = (await run()).filter(isDone);
    strictEqual(refused?.stop, 'refusal');

    server.answer({ body: sse([chunk({ content: 'I' }), ...tail('content_filter')]) + done() });
    const [filtered] = (await run()).filter(isDone);
    strictEqual(filtered?.stop, 'refusal');

    server.answer({ body: sse([chunk({ content: 'Lo' }), ...tail('length')]) + done() });
    const [cut] = (await run()).filter(isDone);
    strictEqual(cut?.stop, 'length');
  });

  it('never reruns an exhausted quota', async () => {
    server.answer({
      status: 429,
      body: JSON.stringify({
        error: {
          message: 'Quota exceeded',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
        },
      }),
    });
    await rejects(run(), { code: 'status', status: 429, retry: false });
    strictEqual(server.requests.length, 1);
  });

  it('replays the transcript byte for byte, a call-only turn with null content', async () => {
    server.answer(
      {
        body:
          sse([
            chunk({ role: 'assistant', content: null }),
            chunk({
              tool_calls: [
                piece(0, {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'request', arguments: '{"route":"GET /x"}' },
                }),
              ],
            }),
            ...tail('tool_calls'),
          ]) + done(),
      },
      { body: hello() },
    );
    const transcript: TranscriptItem[] = provider.transcript.user('Hi');
    const [first] = (await run({ ...request, transcript })).filter(isDone);
    transcript.push(
      ...(first?.items ?? []),
      ...provider.transcript.results([{ id: 'call_1', content: '{"status":200}', error: true }]),
    );
    await run({ ...request, transcript });
    deepStrictEqual(transcript, [
      { role: 'user', content: 'Hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'request', arguments: '{"route":"GET /x"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"status":200}' },
    ]);
    const system = { role: 'system', content: 'Be brief.\n\nNow.' };
    strictEqual(
      JSON.stringify(server.requests[1]?.body.messages),
      JSON.stringify([system, ...transcript]),
    );
  });

  it("sends max_completion_tokens, never max_tokens, to OpenAI's own API", async (t) => {
    const forward = globalThis.fetch;
    const urls: string[] = [];
    t.mock.method(globalThis, 'fetch', (url: string | URL, init?: RequestInit) => {
      urls.push(new URL(String(url)).href);
      return forward(server.url + new URL(String(url)).pathname.replace('/v1', ''), init);
    });
    const structured = sse([chunk({ content: '{}' }), ...tail('stop')]) + done();
    for (const baseURL of [undefined, 'https://api.openai.com/v1/']) {
      const own = createOpenAICompatibleProvider({ model: 'gpt-5', key: 'k', baseURL });
      server.answer({ body: hello() }, { body: structured });
      await Array.fromAsync(own.step(request, signal));
      await own.complete({ system: request.system, input: 'Translate', schema }, signal);
    }
    deepStrictEqual(urls, Array(4).fill('https://api.openai.com/v1/chat/completions'));
    for (const { body } of server.requests) {
      strictEqual(body.max_completion_tokens, 8192);
      strictEqual('max_tokens' in body, false);
    }
  });

  it("sends the model's maxOutput as its cap", async () => {
    const own = createOpenAICompatibleProvider({
      model: 'llama-test',
      key: 'k',
      baseURL: server.url,
      maxOutput: 32000,
    });
    const structured = sse([chunk({ content: '{}' }), ...tail('stop')]) + done();
    server.answer({ body: hello() }, { body: structured });
    await Array.fromAsync(own.step(request, signal));
    await own.complete({ system: request.system, input: 'Translate', schema }, signal);
    deepStrictEqual(
      server.requests.map(({ body }) => body.max_tokens),
      [32000, 32000],
    );
  });

  describe('complete', () => {
    const answer = { system: request.system, input: 'Translate', schema };

    it('parses a structured answer without tools', async () => {
      server.answer({
        body:
          sse([chunk({ content: '{"ok":' }), chunk({ content: 'true}' }), ...tail('stop')]) +
          done(),
      });
      deepStrictEqual(await provider.complete(answer, signal), {
        value: { ok: true },
        usage: { fresh: 25, cacheRead: 100, cacheWrite: 0, output: 40 },
        model: 'llama-test',
      });
      deepStrictEqual(server.requests[0]?.body, {
        model: 'llama-test',
        max_tokens: 8192,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: 'system', content: 'Be brief.\n\nNow.' },
          { role: 'user', content: 'Translate' },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'answer', schema, strict: true },
        },
      });
    });

    it('throws on a refusal and a cut answer', async () => {
      server.answer({ body: sse([chunk({ refusal: 'No.' }), ...tail('stop')]) + done() });
      await rejects(provider.complete(answer, signal), { code: 'refusal' });
      server.answer({ body: sse([chunk({ content: '{"ok"' }), ...tail('length')]) + done() });
      await rejects(provider.complete(answer, signal), { code: 'truncated' });
    });
  });
});
