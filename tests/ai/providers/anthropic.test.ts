import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';

import type {
  DoneEvent,
  Provider,
  StepEvent,
  StepRequest,
  TranscriptItem,
} from '../../../src/ai/providers/provider.ts';
import type { ProviderServer } from './_server.ts';

import { createAnthropicProvider } from '../../../src/ai/providers/anthropic.ts';
import { sse, startProviderServer } from './_server.ts';

const schema = { type: 'object', properties: { route: { type: 'string' } } };

const request: StepRequest = {
  system: [{ text: 'Be brief.', cache: true }, { text: 'Now.' }],
  tools: [{ name: 'request', description: 'Send a request.', input: schema }],
  transcript: [{ role: 'user', content: 'Hi' }],
};

const start = (usage: Record<string, number> = {}): { event: string; data: unknown } => ({
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
      usage: { input_tokens: 25, output_tokens: 1, ...usage },
    },
  },
});

const block = (
  index: number,
  content_block: Record<string, unknown>,
  deltas: Record<string, unknown>[],
): { event: string; data: unknown }[] => [
  { event: 'content_block_start', data: { type: 'content_block_start', index, content_block } },
  ...deltas.map((delta) => ({
    event: 'content_block_delta',
    data: { type: 'content_block_delta', index, delta },
  })),
  { event: 'content_block_stop', data: { type: 'content_block_stop', index } },
];

const text = (text: string): Record<string, unknown> => ({ type: 'text_delta', text });
const json = (partial_json: string): Record<string, unknown> => ({
  type: 'input_json_delta',
  partial_json,
});

const end = (stop_reason: string): { event: string; data: unknown }[] => [
  {
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: { stop_reason, stop_sequence: null },
      usage: { output_tokens: 12 },
    },
  },
  { event: 'message_stop', data: { type: 'message_stop' } },
];

const hello = (): string =>
  sse([
    start(),
    ...block(0, { type: 'text', text: '' }, [text('Hel'), text('lo')]),
    ...end('end_turn'),
  ]);

const rateLimited = (
  headers?: Record<string, string>,
): { status: number; headers?: Record<string, string>; body: string } => ({
  status: 429,
  headers,
  body: '{"type":"error","error":{"type":"rate_limit_error","message":"Slow down"}}',
});

const isDone = (event: StepEvent): event is DoneEvent => event.type === 'done';

describe('createAnthropicProvider', () => {
  let server: ProviderServer;
  let provider: Provider;
  const signal = new AbortController().signal;
  const run = (steps: StepRequest = request): Promise<StepEvent[]> =>
    Array.fromAsync(provider.step(steps, signal));

  before(async () => {
    server = await startProviderServer();
    provider = createAnthropicProvider({ model: 'claude-test', key: 'k', baseURL: server.url });
  });
  after(() => server.close());
  beforeEach(() => {
    server.requests.length = 0;
  });

  it('streams text and ends with usage, the model and the assistant item', async () => {
    server.answer({
      body: sse([
        start({ cache_read_input_tokens: 100, cache_creation_input_tokens: 10 }),
        ...block(0, { type: 'text', text: '' }, [text('Hel'), text('lo')]),
        ...end('end_turn'),
      ]),
    });
    deepStrictEqual(await run(), [
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      {
        type: 'done',
        calls: [],
        stop: 'end',
        usage: { fresh: 25, cacheRead: 100, cacheWrite: 10, output: 12 },
        model: 'claude-test',
        items: [{ role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }],
      },
    ]);
  });

  it('posts the Messages API body with cache markers on the marked blocks', async () => {
    server.answer({ body: hello() });
    await run();
    const [seen] = server.requests;
    strictEqual(seen?.path, '/v1/messages');
    strictEqual(seen?.headers['x-api-key'], 'k');
    strictEqual(seen?.headers['anthropic-version'], '2023-06-01');
    strictEqual(seen?.headers['content-type'], 'application/json');
    deepStrictEqual(seen?.body, {
      model: 'claude-test',
      max_tokens: 8192,
      stream: true,
      system: [
        { type: 'text', text: 'Be brief.', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Now.' },
      ],
      tools: [{ name: 'request', description: 'Send a request.', input_schema: schema }],
      messages: [{ role: 'user', content: 'Hi' }],
    });
  });

  it('merges provider-native options under its own fields and sends extra headers', async () => {
    const own = createAnthropicProvider({
      model: 'claude-test',
      key: 'k',
      baseURL: `${server.url}/`,
      headers: { 'anthropic-beta': 'x' },
      options: { temperature: 0, max_tokens: 1, tools: [] },
    });
    server.answer({ body: hello() });
    const tools = [
      { name: 'request', description: 'Send a request.', input: schema, strict: true },
    ];
    await Array.fromAsync(own.step({ ...request, tools, maxOutput: 64 }, signal));
    const [seen] = server.requests;
    strictEqual(seen?.path, '/v1/messages');
    strictEqual(seen?.headers['anthropic-beta'], 'x');
    strictEqual(seen?.body.temperature, 0);
    strictEqual(seen?.body.max_tokens, 64);
    deepStrictEqual(seen?.body.tools, [
      { name: 'request', description: 'Send a request.', input_schema: schema, strict: true },
    ]);
  });

  it('joins a call input from its fragments and keeps thinking blocks for replay', async () => {
    server.answer({
      body: sse([
        start(),
        ...block(0, { type: 'thinking', thinking: '', signature: '' }, [
          { type: 'thinking_delta', thinking: 'Hm' },
          { type: 'thinking_delta', thinking: 'm.' },
          { type: 'signature_delta', signature: 'sig' },
        ]),
        ...block(1, { type: 'text', text: '' }, [text('Sending.')]),
        ...block(2, { type: 'tool_use', id: 'toolu_1', name: 'request', input: {} }, [
          json(''),
          json('{"route"'),
          json(': "GET /x"}'),
        ]),
        ...block(3, { type: 'tool_use', id: 'toolu_2', name: 'request', input: {} }, []),
        ...end('tool_use'),
      ]),
    });
    const [done] = (await run()).filter(isDone);
    deepStrictEqual(done?.calls, [
      { id: 'toolu_1', name: 'request', input: { route: 'GET /x' } },
      { id: 'toolu_2', name: 'request', input: {} },
    ]);
    strictEqual(done?.stop, 'calls');
    deepStrictEqual(done?.items, [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Hmm.', signature: 'sig' },
          { type: 'text', text: 'Sending.' },
          { type: 'tool_use', id: 'toolu_1', name: 'request', input: { route: 'GET /x' } },
          { type: 'tool_use', id: 'toolu_2', name: 'request', input: {} },
        ],
      },
    ]);
  });

  it('fails a call whose input is not JSON', async () => {
    server.answer({
      body: sse([
        start(),
        ...block(0, { type: 'tool_use', id: 'toolu_1', name: 'request', input: {} }, [
          json('{"ro'),
        ]),
        ...end('max_tokens'),
      ]),
    });
    await rejects(run(), { code: 'malformed', retry: false });
  });

  it('reruns after an error event past the 200', async () => {
    server.answer(
      {
        body: sse([
          start(),
          ...block(0, { type: 'text', text: '' }, [text('Ov')]),
          {
            event: 'error',
            data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
          },
        ]),
      },
      { body: hello() },
    );
    const events = await run();
    deepStrictEqual(events.slice(0, 4), [
      { type: 'text', text: 'Ov' },
      { type: 'retry', wait: 500 },
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
    ]);
    strictEqual(events[4]?.type, 'done');
    strictEqual(server.requests.length, 2);
  });

  it('waits a Retry-After out before rerunning a 429', async () => {
    server.answer(rateLimited({ 'retry-after': '0' }), { body: hello() });
    const events = await run();
    deepStrictEqual(events[0], { type: 'retry', wait: 0 });
    strictEqual(events.at(-1)?.type, 'done');
    strictEqual(server.requests.length, 2);
  });

  it('backs off when a 429 names no wait', async () => {
    server.answer(rateLimited(), { body: hello() });
    const events = await run();
    deepStrictEqual(events[0], { type: 'retry', wait: 500 });
    strictEqual(server.requests.length, 2);
  });

  it('never reruns the spend-cap 429', async () => {
    server.answer({
      status: 429,
      body: JSON.stringify({
        type: 'error',
        error: {
          type: 'rate_limit_error',
          message: 'You have reached your API usage limits',
          details: { error_code: 'enforced_spend_limit_reached' },
        },
      }),
    });
    await rejects(run(), {
      code: 'status',
      status: 429,
      retry: false,
      message: 'You have reached your API usage limits',
    });
    strictEqual(server.requests.length, 1);
  });

  it('never reruns a 400', async () => {
    server.answer({
      status: 400,
      body: '{"error":{"type":"invalid_request_error","message":"Bad"}}',
    });
    await rejects(run(), { code: 'status', status: 400, retry: false, message: 'Bad' });
    strictEqual(server.requests.length, 1);
  });

  it('gives up after two reruns', async () => {
    const limited = rateLimited({ 'retry-after': '0' });
    server.answer(limited, limited, limited);
    await rejects(run(), { code: 'status', status: 429, retry: true, wait: 0 });
    strictEqual(server.requests.length, 3);
  });

  it('does not wait out a Retry-After beyond a minute', async () => {
    server.answer(rateLimited({ 'retry-after': '3600' }));
    await rejects(run(), { code: 'status', status: 429, wait: 3_600_000 });
    strictEqual(server.requests.length, 1);
  });

  it('reruns a request that got no answer', async () => {
    server.answer({ drop: true }, { body: hello() });
    const events = await run();
    deepStrictEqual(events[0], { type: 'retry', wait: 500 });
    strictEqual(events.at(-1)?.type, 'done');
    strictEqual(server.requests.length, 2);
  });

  it('reruns a stream whose connection drops', async () => {
    server.answer(
      { cut: true, body: sse([start(), ...block(0, { type: 'text', text: '' }, [text('Ov')])]) },
      { body: hello() },
    );
    const events = await run();
    deepStrictEqual(events.slice(0, 2), [
      { type: 'text', text: 'Ov' },
      { type: 'retry', wait: 500 },
    ]);
    strictEqual(events.at(-1)?.type, 'done');
    strictEqual(server.requests.length, 2);
  });

  it('rejects with the reason of an abort and lets the connection go', async () => {
    server.answer({
      hold: true,
      body: sse([
        start(),
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          },
        },
        {
          event: 'content_block_delta',
          data: { type: 'content_block_delta', index: 0, delta: text('Hel') },
        },
      ]),
    });
    const controller = new AbortController();
    const events: StepEvent[] = [];
    await rejects(
      async () => {
        for await (const event of provider.step(request, controller.signal)) {
          events.push(event);
          controller.abort(new Error('closed'));
        }
      },
      { message: 'closed' },
    );
    deepStrictEqual(events, [{ type: 'text', text: 'Hel' }]);
    while (server.left === 0) await setTimeout(5);
    strictEqual(server.requests.length, 1);
  });

  it('reports a refusal and an answer cut short', async () => {
    server.answer({ body: sse([start(), ...end('refusal')]) });
    const [refused] = (await run()).filter(isDone);
    strictEqual(refused?.stop, 'refusal');
    deepStrictEqual(refused?.items, [{ role: 'assistant', content: [] }]);

    server.answer({
      body: sse([
        start(),
        ...block(0, { type: 'text', text: '' }, [text('Long')]),
        ...end('max_tokens'),
      ]),
    });
    const [cut] = (await run()).filter(isDone);
    strictEqual(cut?.stop, 'length');
  });

  it('replays the transcript byte for byte', async () => {
    server.answer(
      {
        body: sse([
          start(),
          ...block(0, { type: 'tool_use', id: 'toolu_1', name: 'request', input: {} }, [
            json('{"route":"GET /x"}'),
          ]),
          ...block(1, { type: 'tool_use', id: 'toolu_2', name: 'request', input: {} }, [
            json('{"route":"GET /y"}'),
          ]),
          ...end('tool_use'),
        ]),
      },
      { body: hello() },
    );
    const transcript: TranscriptItem[] = provider.transcript.user('Hi');
    const [done] = (await run({ ...request, transcript })).filter(isDone);
    transcript.push(
      ...(done?.items ?? []),
      ...provider.transcript.results([
        { id: 'toolu_1', content: '{"status":200}' },
        { id: 'toolu_2', content: 'Refused', error: true },
      ]),
    );
    await run({ ...request, transcript });
    deepStrictEqual(transcript, [
      { role: 'user', content: 'Hi' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'request', input: { route: 'GET /x' } },
          { type: 'tool_use', id: 'toolu_2', name: 'request', input: { route: 'GET /y' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"status":200}' },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: 'Refused', is_error: true },
        ],
      },
    ]);
    strictEqual(JSON.stringify(server.requests[1]?.body.messages), JSON.stringify(transcript));
  });

  describe('complete', () => {
    const answer = { system: request.system, input: 'Translate', schema };

    it('parses a structured answer without tools', async () => {
      server.answer({
        body: sse([
          start(),
          ...block(0, { type: 'text', text: '' }, [text('{"ok":'), text('true}')]),
          ...end('end_turn'),
        ]),
      });
      deepStrictEqual(await provider.complete(answer, signal), {
        value: { ok: true },
        usage: { fresh: 25, cacheRead: 0, cacheWrite: 0, output: 12 },
        model: 'claude-test',
      });
      deepStrictEqual(server.requests[0]?.body, {
        model: 'claude-test',
        max_tokens: 8192,
        stream: true,
        system: [
          { type: 'text', text: 'Be brief.', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'Now.' },
        ],
        messages: [{ role: 'user', content: 'Translate' }],
        output_config: { format: { type: 'json_schema', schema } },
      });
    });

    it('throws on a refusal, a cut answer and an answer that is not JSON', async () => {
      server.answer({ body: sse([start(), ...end('refusal')]) });
      await rejects(provider.complete(answer, signal), { code: 'refusal' });
      server.answer({
        body: sse([
          start(),
          ...block(0, { type: 'text', text: '' }, [text('{"ok"')]),
          ...end('max_tokens'),
        ]),
      });
      await rejects(provider.complete(answer, signal), { code: 'truncated' });
      server.answer({
        body: sse([
          start(),
          ...block(0, { type: 'text', text: '' }, [text('yes')]),
          ...end('end_turn'),
        ]),
      });
      await rejects(provider.complete(answer, signal), { code: 'malformed' });
    });

    it('reruns a transient failure', async () => {
      server.answer(rateLimited({ 'retry-after': '0' }), {
        body: sse([
          start(),
          ...block(0, { type: 'text', text: '' }, [text('{}')]),
          ...end('end_turn'),
        ]),
      });
      deepStrictEqual((await provider.complete(answer, signal)).value, {});
      strictEqual(server.requests.length, 2);
    });
  });
});
