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

import { createGeminiProvider } from '../../../src/ai/providers/gemini.ts';
import { sse, startProviderServer } from './_server.ts';

const schema = { type: 'object', properties: { route: { type: 'string' } } };

const request: StepRequest = {
  system: [{ text: 'Be brief.', cache: true }, { text: 'Now.' }],
  tools: [{ name: 'request', description: 'Send a request.', input: schema }],
  transcript: [{ role: 'user', parts: [{ text: 'Hi' }] }],
};

const usage = {
  promptTokenCount: 125,
  cachedContentTokenCount: 100,
  candidatesTokenCount: 30,
  thoughtsTokenCount: 10,
  totalTokenCount: 165,
};

const chunk = (
  parts: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
): { data: unknown } => ({
  data: {
    candidates: [{ content: { role: 'model', parts }, index: 0, ...extra }],
    modelVersion: 'gemini-test-001',
    responseId: 'r1',
  },
});

const tail = (
  finishReason: string,
  parts: Record<string, unknown>[] = [{ text: '' }],
): { data: unknown } => {
  const { data } = chunk(parts, { finishReason });
  return { data: { ...(data as Record<string, unknown>), usageMetadata: usage } };
};

const hello = (): string => sse([chunk([{ text: 'Hel' }]), chunk([{ text: 'lo' }]), tail('STOP')]);

const failure = (
  code: number,
  message: string,
  status: string,
  headers?: Record<string, string>,
): { status: number; headers?: Record<string, string>; body: string } => ({
  status: code,
  headers,
  body: JSON.stringify({ error: { code, message, status } }),
});

const call = (
  name: string,
  args: unknown,
  id?: string,
): { functionCall: Record<string, unknown> } => ({
  functionCall: { ...(id ? { id } : {}), name, args },
});

const isDone = (event: StepEvent): event is DoneEvent => event.type === 'done';

describe('createGeminiProvider', () => {
  let server: ProviderServer;
  let provider: Provider;
  const signal = new AbortController().signal;
  const run = (steps: StepRequest = request): Promise<StepEvent[]> =>
    Array.fromAsync(provider.step(steps, signal));

  before(async () => {
    server = await startProviderServer();
    provider = createGeminiProvider({ model: 'gemini-test', key: 'k', baseURL: server.url });
  });
  after(() => server.close());
  beforeEach(() => {
    server.requests.length = 0;
  });

  it('streams text and ends with calls, usage, the model and the model content', async () => {
    server.answer({
      body: sse([
        chunk([{ text: 'Send' }]),
        {
          data: {
            ...(chunk([{ text: 'ing.' }]).data as Record<string, unknown>),
            usageMetadata: { promptTokenCount: 125 },
          },
        },
        chunk([
          { ...call('request', { route: 'GET /x' }, 'fc1'), thoughtSignature: 'sig' },
          call('request', {}, 'fc2'),
        ]),
        tail('STOP'),
      ]),
    });
    deepStrictEqual(await run(), [
      { type: 'text', text: 'Send' },
      { type: 'text', text: 'ing.' },
      {
        type: 'done',
        calls: [
          { id: 'fc1', name: 'request', input: { route: 'GET /x' } },
          { id: 'fc2', name: 'request', input: {} },
        ],
        stop: 'calls',
        usage: { fresh: 25, cacheRead: 100, cacheWrite: 0, output: 40 },
        model: 'gemini-test-001',
        items: [
          {
            role: 'model',
            parts: [
              { text: 'Sending.' },
              { ...call('request', { route: 'GET /x' }, 'fc1'), thoughtSignature: 'sig' },
              call('request', {}, 'fc2'),
            ],
          },
        ],
      },
    ]);
  });

  it('posts the generateContent body with the key header and no cache markers', async () => {
    server.answer({ body: hello() });
    await run();
    const [seen] = server.requests;
    strictEqual(seen?.path, '/v1beta/models/gemini-test:streamGenerateContent?alt=sse');
    strictEqual(seen?.headers['x-goog-api-key'], 'k');
    strictEqual(seen?.headers.authorization, undefined);
    strictEqual(seen?.headers['content-type'], 'application/json');
    deepStrictEqual(seen?.body, {
      systemInstruction: { parts: [{ text: 'Be brief.' }, { text: 'Now.' }] },
      contents: request.transcript,
      tools: [
        {
          functionDeclarations: [
            { name: 'request', description: 'Send a request.', parametersJsonSchema: schema },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: 8192 },
    });
  });

  it('leaves out an empty tool list and an empty system prompt', async () => {
    server.answer({ body: hello() });
    await run({ ...request, system: [], tools: [] });
    const body = server.requests[0]?.body ?? {};
    for (const field of ['tools', 'toolConfig', 'systemInstruction']) {
      strictEqual(Object.hasOwn(body, field), false, field);
    }
  });

  it('leaves the calling mode to the model, strict tools included', async () => {
    server.answer({ body: hello() });
    const tools = [
      { name: 'request', description: 'Send a request.', input: schema, strict: true },
    ];
    await run({ ...request, tools });
    const body = server.requests[0]?.body ?? {};
    strictEqual(Object.hasOwn(body, 'toolConfig'), false);
    deepStrictEqual(body.tools, [
      {
        functionDeclarations: [
          { name: 'request', description: 'Send a request.', parametersJsonSchema: schema },
        ],
      },
    ]);
  });

  it('merges provider-native options under its own fields and sends extra headers', async () => {
    const safetySettings = [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }];
    const toolConfig = { functionCallingConfig: { mode: 'VALIDATED' } };
    const own = createGeminiProvider({
      model: 'gemini-test',
      key: 'k',
      baseURL: server.url,
      headers: { 'x-extra': '1' },
      options: {
        generationConfig: { maxOutputTokens: 1, thinkingConfig: { thinkingLevel: 'low' } },
        safetySettings,
        toolConfig,
      },
    });
    server.answer({ body: hello() });
    await Array.fromAsync(own.step(request, signal));
    const [seen] = server.requests;
    strictEqual(seen?.headers['x-extra'], '1');
    deepStrictEqual(seen?.body.generationConfig, {
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: 'low' },
    });
    deepStrictEqual(seen?.body.safetySettings, safetySettings);
    deepStrictEqual(seen?.body.toolConfig, toolConfig);
  });

  it('sends no key without one and trims a trailing slash off baseURL', async () => {
    const own = createGeminiProvider({ model: 'gemini-test', baseURL: `${server.url}/` });
    server.answer({ body: hello() });
    await Array.fromAsync(own.step(request, signal));
    const [seen] = server.requests;
    strictEqual(seen?.path, '/v1beta/models/gemini-test:streamGenerateContent?alt=sse');
    strictEqual(seen?.headers['x-goog-api-key'], undefined);
  });

  it("sends the model's maxOutput as its cap", async () => {
    const own = createGeminiProvider({
      model: 'gemini-test',
      key: 'k',
      baseURL: server.url,
      maxOutput: 32000,
    });
    server.answer({ body: hello() }, { body: sse([tail('STOP', [{ text: '{}' }])]) });
    await Array.fromAsync(own.step(request, signal));
    await own.complete({ system: request.system, input: 'Translate', schema }, signal);
    deepStrictEqual(
      server.requests.map(
        ({ body }) => (body.generationConfig as Record<string, unknown>).maxOutputTokens,
      ),
      [32000, 32000],
    );
  });

  it('keeps thought summaries out of the text and on the parts they came in, signature included', async () => {
    server.answer({
      body: sse([
        chunk([{ text: 'Plan', thought: true }]),
        chunk([{ text: 'ning', thought: true }]),
        chunk([{ text: 'Hel' }]),
        chunk([{ text: 'lo' }]),
        tail('STOP', [{ text: '', thoughtSignature: 'sig' }]),
      ]),
    });
    const events = await run();
    deepStrictEqual(
      events.filter((event) => event.type === 'text'),
      [
        { type: 'text', text: 'Hel' },
        { type: 'text', text: 'lo' },
      ],
    );
    deepStrictEqual(events.filter(isDone)[0]?.items, [
      {
        role: 'model',
        parts: [
          { text: 'Planning', thought: true },
          { text: 'Hello' },
          { text: '', thoughtSignature: 'sig' },
        ],
      },
    ]);
  });

  it('never joins a signed part with the text around it, and still streams its text', async () => {
    server.answer({
      body: sse([
        chunk([{ text: 'Hel', thoughtSignature: 's' }]),
        chunk([{ text: 'lo' }]),
        chunk([{ text: '!' }]),
        tail('STOP'),
      ]),
    });
    const events = await run();
    deepStrictEqual(
      events.filter((event) => event.type === 'text'),
      [
        { type: 'text', text: 'Hel' },
        { type: 'text', text: 'lo' },
        { type: 'text', text: '!' },
      ],
    );
    deepStrictEqual(events.filter(isDone)[0]?.items, [
      { role: 'model', parts: [{ text: 'Hel', thoughtSignature: 's' }, { text: 'lo!' }] },
    ]);
  });

  it('drops empty unsigned text', async () => {
    server.answer({ body: sse([chunk([{ text: '' }]), tail('STOP')]) });
    const [done] = (await run()).filter(isDone);
    strictEqual(done?.stop, 'end');
    deepStrictEqual(done?.items, []);
  });

  it('gives a call without an id an empty one, which its response leaves out', async () => {
    server.answer({ body: sse([tail('STOP', [call('request', { route: 'GET /x' })])]) });
    const [done] = (await run()).filter(isDone);
    deepStrictEqual(done?.calls, [{ id: '', name: 'request', input: { route: 'GET /x' } }]);
    deepStrictEqual(provider.transcript.results([{ id: '', name: 'request', content: 'x' }]), [
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'request', response: { output: 'x' } } }],
      },
    ]);
  });

  it('reads a call without args as an empty input and fails one whose args are not an object', async () => {
    server.answer({
      body: sse([tail('STOP', [{ functionCall: { id: 'fc1', name: 'request' } }])]),
    });
    const [done] = (await run()).filter(isDone);
    deepStrictEqual(done?.calls, [{ id: 'fc1', name: 'request', input: {} }]);

    server.requests.length = 0;
    server.answer({ body: sse([tail('STOP', [call('request', [1], 'fc1')])]) });
    await rejects(run(), { code: 'malformed', retry: false });
    strictEqual(server.requests.length, 1);
  });

  it("fails a malformed finish without a rerun, with the API's message", async () => {
    const fixed: Record<string, string> = {
      MALFORMED_FUNCTION_CALL: 'A call is malformed',
      UNEXPECTED_TOOL_CALL: 'A call names no declared tool',
      MALFORMED_RESPONSE: 'The answer is malformed',
      MISSING_THOUGHT_SIGNATURE: 'A thought signature is missing',
    };
    for (const [finishReason, message] of Object.entries(fixed)) {
      server.requests.length = 0;
      server.answer({ body: sse([tail(finishReason)]) });
      await rejects(run(), { code: 'malformed', retry: false, message });
      strictEqual(server.requests.length, 1, finishReason);

      server.requests.length = 0;
      const { data } = tail(finishReason);
      const said = { ...(data as Record<string, unknown>) };
      said.candidates = [
        { content: { role: 'model', parts: [] }, finishReason, finishMessage: 'Bad call' },
      ];
      server.answer({ body: sse([{ data: said }]) });
      await rejects(run(), { code: 'malformed', retry: false, message: 'Bad call' });
      strictEqual(server.requests.length, 1, finishReason);
    }
  });

  it('reruns after an error chunk past the 200', async () => {
    server.answer(
      {
        body: sse([
          chunk([{ text: 'Ov' }]),
          { data: { error: { code: 500, message: 'Boom', status: 'INTERNAL' } } },
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
    strictEqual(events.at(-1)?.type, 'done');
    strictEqual(server.requests.length, 2);
  });

  it("fails with the error chunk's message once the reruns run out", async () => {
    const broken = {
      body: sse([{ data: { error: { code: 500, message: 'Boom', status: 'INTERNAL' } } }]),
    };
    server.answer(broken, broken, broken);
    await rejects(run(), { code: 'stream', retry: true, message: 'Boom' });
    strictEqual(server.requests.length, 3);
  });

  it('waits a Retry-After out before rerunning a 429', async () => {
    server.answer(failure(429, 'Slow down', 'RESOURCE_EXHAUSTED', { 'retry-after': '0' }), {
      body: hello(),
    });
    const events = await run();
    deepStrictEqual(events[0], { type: 'retry', wait: 0 });
    strictEqual(events.at(-1)?.type, 'done');
    strictEqual(server.requests.length, 2);
  });

  it('backs off when a 429 names no wait', async () => {
    server.answer(failure(429, 'Slow down', 'RESOURCE_EXHAUSTED'), { body: hello() });
    const events = await run();
    deepStrictEqual(events[0], { type: 'retry', wait: 500 });
    strictEqual(server.requests.length, 2);
  });

  it('reruns a 503 for an overloaded model', async () => {
    server.answer(failure(503, 'The model is overloaded', 'UNAVAILABLE'), { body: hello() });
    const events = await run();
    deepStrictEqual(events[0], { type: 'retry', wait: 500 });
    strictEqual(events.at(-1)?.type, 'done');
    strictEqual(server.requests.length, 2);
  });

  it('never reruns a depleted prepaid balance', async () => {
    const message = 'Your prepayment credits are depleted';
    server.answer(failure(402, message, 'RESOURCE_EXHAUSTED'));
    await rejects(run(), { code: 'status', status: 402, retry: false, message });
    strictEqual(server.requests.length, 1);
  });

  it('never reruns a 400 or a 403', async () => {
    for (const [code, status] of [
      [400, 'INVALID_ARGUMENT'],
      [403, 'PERMISSION_DENIED'],
    ] as const) {
      server.requests.length = 0;
      server.answer(failure(code, 'Bad', status));
      await rejects(run(), { code: 'status', status: code, retry: false, message: 'Bad' });
      strictEqual(server.requests.length, 1);
    }
  });

  it('gives up after two reruns', async () => {
    const limited = failure(429, 'Slow down', 'RESOURCE_EXHAUSTED', { 'retry-after': '0' });
    server.answer(limited, limited, limited);
    await rejects(run(), { code: 'status', status: 429, retry: true, wait: 0 });
    strictEqual(server.requests.length, 3);
  });

  it('reruns a request that got no answer', async () => {
    server.answer({ drop: true }, { body: hello() });
    const events = await run();
    deepStrictEqual(events[0], { type: 'retry', wait: 500 });
    strictEqual(events.at(-1)?.type, 'done');
    strictEqual(server.requests.length, 2);
  });

  it('reruns a stream that closes before its finish', async () => {
    for (const early of [
      { cut: true, body: sse([chunk([{ text: 'Ov' }])]) },
      { body: sse([chunk([{ text: 'Ov' }])]) },
    ]) {
      server.requests.length = 0;
      server.answer(early, { body: hello() });
      const events = await run();
      deepStrictEqual(events.slice(0, 2), [
        { type: 'text', text: 'Ov' },
        { type: 'retry', wait: 500 },
      ]);
      strictEqual(events.at(-1)?.type, 'done');
      strictEqual(server.requests.length, 2);
    }
  });

  it('rejects with the reason of an abort and lets the connection go', async () => {
    server.answer({ hold: true, body: sse([chunk([{ text: 'Hel' }])]) });
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

  it('reports a refusal, filtered or blocked, an answer cut short, and an unknown finish as its end', async () => {
    server.answer({ body: sse([chunk([{ text: 'I' }]), tail('SAFETY')]) });
    const [filtered] = (await run()).filter(isDone);
    strictEqual(filtered?.stop, 'refusal');

    server.answer({
      body: sse([
        {
          data: {
            promptFeedback: { blockReason: 'SAFETY' },
            usageMetadata: usage,
            modelVersion: 'gemini-test-001',
          },
        },
      ]),
    });
    const [blocked] = (await run()).filter(isDone);
    strictEqual(blocked?.stop, 'refusal');
    deepStrictEqual(blocked?.items, []);

    for (const finishReason of ['MAX_TOKENS', 'CONTINUATION']) {
      server.answer({ body: sse([chunk([{ text: 'Lo' }]), tail(finishReason)]) });
      const [cut] = (await run()).filter(isDone);
      strictEqual(cut?.stop, 'length', finishReason);
    }

    server.answer({ body: sse([chunk([{ text: 'Hm' }]), tail('OTHER')]) });
    const [other] = (await run()).filter(isDone);
    strictEqual(other?.stop, 'end');

    server.answer({ body: sse([tail('TOO_MANY_TOOL_CALLS')]) });
    const [many] = (await run()).filter(isDone);
    strictEqual(many?.stop, 'end');
  });

  it('replays the transcript byte for byte, signatures and responses included', async () => {
    const parts = [
      { ...call('request', { route: 'GET /x' }, 'fc1'), thoughtSignature: 'sig' },
      call('request', { route: 'GET /y' }, 'fc2'),
    ];
    server.answer({ body: sse([chunk(parts), tail('STOP')]) }, { body: hello() });
    const transcript: TranscriptItem[] = provider.transcript.user('Hi');
    const [done] = (await run({ ...request, transcript })).filter(isDone);
    transcript.push(
      ...(done?.items ?? []),
      ...provider.transcript.results([
        { id: 'fc1', name: 'request', content: '{"status":200}' },
        { id: 'fc2', name: 'request', content: 'Refused', error: true },
      ]),
    );
    await run({ ...request, transcript });
    deepStrictEqual(transcript, [
      { role: 'user', parts: [{ text: 'Hi' }] },
      { role: 'model', parts },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'fc1',
              name: 'request',
              response: { output: '{"status":200}' },
            },
          },
          { functionResponse: { id: 'fc2', name: 'request', response: { error: 'Refused' } } },
        ],
      },
    ]);
    strictEqual(JSON.stringify(server.requests[1]?.body.contents), JSON.stringify(transcript));
  });

  it('reads an answer framed with CRLF', async () => {
    server.answer({ body: hello().replaceAll('\n', '\r\n') });
    const events = await run();
    deepStrictEqual(events.slice(0, 2), [
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
    ]);
    strictEqual(events.at(-1)?.type, 'done');
  });

  describe('complete', () => {
    const answer = { system: request.system, input: 'Translate', schema };

    it('parses a structured answer without tools', async () => {
      server.answer({
        body: sse([
          chunk([{ text: 'Think', thought: true }]),
          chunk([{ text: '{"ok":' }]),
          tail('STOP', [{ text: 'true}', thoughtSignature: 'sig' }]),
        ]),
      });
      deepStrictEqual(await provider.complete(answer, signal), {
        value: { ok: true },
        usage: { fresh: 25, cacheRead: 100, cacheWrite: 0, output: 40 },
        model: 'gemini-test-001',
      });
      deepStrictEqual(server.requests[0]?.body, {
        systemInstruction: { parts: [{ text: 'Be brief.' }, { text: 'Now.' }] },
        contents: [{ role: 'user', parts: [{ text: 'Translate' }] }],
        generationConfig: {
          maxOutputTokens: 8192,
          responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } },
        },
      });
    });

    it('throws on a refusal, a blocked prompt, a cut answer and an answer that is not JSON', async () => {
      server.answer({ body: sse([tail('SAFETY')]) });
      await rejects(provider.complete(answer, signal), { code: 'refusal' });
      server.answer({ body: sse([{ data: { promptFeedback: { blockReason: 'OTHER' } } }]) });
      await rejects(provider.complete(answer, signal), { code: 'refusal' });
      server.answer({ body: sse([chunk([{ text: '{"ok"' }]), tail('MAX_TOKENS')]) });
      await rejects(provider.complete(answer, signal), { code: 'truncated' });
      server.answer({ body: sse([chunk([{ text: 'yes' }]), tail('STOP')]) });
      await rejects(provider.complete(answer, signal), { code: 'malformed' });
    });

    it('reruns a transient failure', async () => {
      server.answer(failure(429, 'Slow down', 'RESOURCE_EXHAUSTED', { 'retry-after': '0' }), {
        body: sse([tail('STOP', [{ text: '{}' }])]),
      });
      deepStrictEqual((await provider.complete(answer, signal)).value, {});
      strictEqual(server.requests.length, 2);
    });
  });
});
