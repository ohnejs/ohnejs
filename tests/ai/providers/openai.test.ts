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

import { createOpenAIProvider } from '../../../src/ai/providers/openai.ts';
import { sse, startProviderServer } from './_server.ts';

const schema = { type: 'object', properties: { route: { type: 'string' } } };

const request: StepRequest = {
  system: [{ text: 'Be brief.', cache: true }, { text: 'Now.' }],
  tools: [{ name: 'request', description: 'Send a request.', input: schema }],
  transcript: [{ role: 'user', content: 'Hi' }],
};

const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'enc' };
const message = (content: Record<string, unknown>[]): Record<string, unknown> => ({
  type: 'message',
  id: 'msg_1',
  role: 'assistant',
  status: 'completed',
  content,
});
const outputText = (text: string): Record<string, unknown> => ({
  type: 'output_text',
  text,
  annotations: [],
});
const call = (call_id: string, args: string): Record<string, unknown> => ({
  type: 'function_call',
  id: `fc_${call_id}`,
  call_id,
  name: 'request',
  arguments: args,
  status: 'completed',
});

const usage = {
  input_tokens: 125,
  input_tokens_details: { cached_tokens: 100 },
  output_tokens: 40,
  output_tokens_details: { reasoning_tokens: 20 },
  total_tokens: 165,
};

const response = (
  output: Record<string, unknown>[],
  rest: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: 'resp_1',
  object: 'response',
  model: 'gpt-test',
  status: 'completed',
  output,
  usage,
  incomplete_details: null,
  error: null,
  ...rest,
});

const delta = (text: string): { event: string; data: unknown } => ({
  event: 'response.output_text.delta',
  data: {
    type: 'response.output_text.delta',
    item_id: 'msg_1',
    output_index: 1,
    content_index: 0,
    delta: text,
    sequence_number: 3,
  },
});

const stream = (
  deltas: string[],
  output: Record<string, unknown>[],
  ending: 'response.completed' | 'response.incomplete' = 'response.completed',
  rest: Record<string, unknown> = {},
): string =>
  sse([
    {
      event: 'response.created',
      data: { type: 'response.created', response: response([]), sequence_number: 0 },
    },
    ...deltas.map(delta),
    { event: ending, data: { type: ending, response: response(output, rest), sequence_number: 9 } },
  ]);

const hello = (): string => stream(['Hel', 'lo'], [message([outputText('Hello')])]);

const isDone = (event: StepEvent): event is DoneEvent => event.type === 'done';

describe('createOpenAIProvider', () => {
  let server: ProviderServer;
  let provider: Provider;
  const signal = new AbortController().signal;
  const run = (steps: StepRequest = request): Promise<StepEvent[]> =>
    Array.fromAsync(provider.step(steps, signal));

  before(async () => {
    server = await startProviderServer();
    provider = createOpenAIProvider({ model: 'gpt-test', key: 'k', baseURL: server.url });
  });
  after(() => server.close());
  beforeEach(() => {
    server.requests.length = 0;
  });

  it('streams text and ends with calls, usage, the model and the output items', async () => {
    const output = [
      reasoning,
      message([outputText('Sending.')]),
      call('call_1', '{"route":"GET /x"}'),
    ];
    server.answer({ body: stream(['Send', 'ing.'], output) });
    deepStrictEqual(await run(), [
      { type: 'text', text: 'Send' },
      { type: 'text', text: 'ing.' },
      {
        type: 'done',
        calls: [{ id: 'call_1', name: 'request', input: { route: 'GET /x' } }],
        stop: 'calls',
        usage: { fresh: 25, cacheRead: 100, cacheWrite: 0, output: 40 },
        model: 'gpt-test',
        items: output,
      },
    ]);
  });

  it('posts the Responses API body, stored nowhere, with strict off unless asked', async () => {
    server.answer({ body: hello() });
    await run();
    const [seen] = server.requests;
    strictEqual(seen?.path, '/responses');
    strictEqual(seen?.headers.authorization, 'Bearer k');
    deepStrictEqual(seen?.body, {
      model: 'gpt-test',
      max_output_tokens: 8192,
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
      instructions: 'Be brief.\n\nNow.',
      tools: [
        {
          type: 'function',
          name: 'request',
          description: 'Send a request.',
          parameters: schema,
          strict: false,
        },
      ],
      input: [{ role: 'user', content: 'Hi' }],
    });
  });

  it('reruns after a failed response past the 200', async () => {
    server.answer(
      {
        body: sse([
          delta('Ov'),
          {
            event: 'response.failed',
            data: {
              type: 'response.failed',
              response: response([], {
                status: 'failed',
                error: { code: 'server_error', message: 'Boom' },
              }),
            },
          },
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

  it('reruns after an error event past the 200', async () => {
    server.answer(
      {
        body: sse([
          { event: 'error', data: { type: 'error', code: null, message: 'Boom', param: null } },
        ]),
      },
      { body: hello() },
    );
    const events = await run();
    deepStrictEqual(events[0], { type: 'retry', wait: 500 });
    strictEqual(events.at(-1)?.type, 'done');
  });

  it('reports a refusal, filtered or refused, and an answer cut short', async () => {
    server.answer({ body: stream([], [message([{ type: 'refusal', refusal: 'No.' }])]) });
    const [refused] = (await run()).filter(isDone);
    strictEqual(refused?.stop, 'refusal');

    server.answer({
      body: stream([], [], 'response.incomplete', {
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
      }),
    });
    const [filtered] = (await run()).filter(isDone);
    strictEqual(filtered?.stop, 'refusal');

    server.answer({
      body: stream(['Lo'], [message([outputText('Lo')])], 'response.incomplete', {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      }),
    });
    const [cut] = (await run()).filter(isDone);
    strictEqual(cut?.stop, 'length');
  });

  it('never reruns an exhausted quota', async () => {
    server.answer({
      status: 429,
      body: JSON.stringify({
        error: {
          message: 'You exceeded your current quota',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
        },
      }),
    });
    await rejects(run(), { code: 'status', status: 429, retry: false });
    strictEqual(server.requests.length, 1);
  });

  it('replays the transcript byte for byte, reasoning included', async () => {
    const output = [reasoning, call('call_1', '{"route":"GET /x"}'), call('call_2', '{}')];
    server.answer({ body: stream([], output) }, { body: hello() });
    const transcript: TranscriptItem[] = provider.transcript.user('Hi');
    const [done] = (await run({ ...request, transcript })).filter(isDone);
    transcript.push(
      ...(done?.items ?? []),
      ...provider.transcript.results([
        { id: 'call_1', content: '{"status":200}' },
        { id: 'call_2', content: 'Refused', error: true },
      ]),
    );
    await run({ ...request, transcript });
    deepStrictEqual(transcript, [
      { role: 'user', content: 'Hi' },
      ...output,
      { type: 'function_call_output', call_id: 'call_1', output: '{"status":200}' },
      { type: 'function_call_output', call_id: 'call_2', output: 'Refused' },
    ]);
    strictEqual(JSON.stringify(server.requests[1]?.body.input), JSON.stringify(transcript));
  });

  describe('complete', () => {
    const answer = { system: request.system, input: 'Translate', schema };

    it('parses a structured answer without tools', async () => {
      server.answer({ body: stream(['{"ok":', 'true}'], [message([outputText('{"ok":true}')])]) });
      deepStrictEqual(await provider.complete(answer, signal), {
        value: { ok: true },
        usage: { fresh: 25, cacheRead: 100, cacheWrite: 0, output: 40 },
        model: 'gpt-test',
      });
      deepStrictEqual(server.requests[0]?.body, {
        model: 'gpt-test',
        max_output_tokens: 8192,
        stream: true,
        store: false,
        instructions: 'Be brief.\n\nNow.',
        input: [{ role: 'user', content: 'Translate' }],
        text: { format: { type: 'json_schema', name: 'answer', schema, strict: true } },
      });
    });

    it('throws on a refusal and a cut answer', async () => {
      server.answer({ body: stream([], [message([{ type: 'refusal', refusal: 'No.' }])]) });
      await rejects(provider.complete(answer, signal), { code: 'refusal' });
      server.answer({
        body: stream([], [message([outputText('{"ok"')])], 'response.incomplete', {
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
        }),
      });
      await rejects(provider.complete(answer, signal), { code: 'truncated' });
    });
  });
});
