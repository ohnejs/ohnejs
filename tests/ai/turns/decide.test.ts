import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';

import type { Config } from '../../../src/ohne/layers/config.ts';
import type { ProviderServer } from '../providers/_server.ts';

import { decideModel, useDecider } from '../../../src/ai/turns/decide.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { userWith, withAI } from '../_fixture.ts';
import { sse, startProviderServer } from '../providers/_server.ts';

const KEY = 'AI_DECIDE_TEST_KEY';
const user = userWith('asker');
useEnv().define(KEY as never, { default: undefined as never });
useEnv().set(KEY as never, 'sk-test' as never);

const server: ProviderServer = await startProviderServer();
const signal = new AbortController().signal;

const questions = {
  intent: { choice: { translate: 'Translate records.', roster: 'Ask about members.' } },
  urgency: { score: ['low', 'high'] },
  locale: { yesNo: 'Does the message name a language?' },
};
const request = { input: 'Translate the epics to German', questions };

/**
 * The app's `ai` settings, every model pointed at the stand-in.
 */
function ai(extra: Partial<NonNullable<Config['ai']>> = {}): Config['ai'] {
  return {
    model: 'smart',
    models: {
      smart: { provider: 'anthropic', model: 'claude-test', key: KEY, baseURL: server.url },
      local: { provider: 'openai-compatible', model: 'qwen', key: false, baseURL: server.url },
      router: { provider: 'jev', model: 'jev-test', key: KEY, baseURL: server.url },
    },
    ...extra,
  };
}

/**
 * A Chat Completions answer saying `text`, usage of 10 in and 5 out.
 */
function completion(text: string): string {
  const chunk = (delta: object, finish_reason: string | null = null): { data: unknown } => ({
    data: { model: 'qwen', choices: [{ index: 0, delta, finish_reason }] },
  });
  return (
    sse([
      chunk({ role: 'assistant', content: text }),
      chunk({}, 'stop'),
      { data: { model: 'qwen', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } } },
    ]) + 'data: [DONE]\n\n'
  );
}

const answer = JSON.stringify({
  intent: { answer: 'translate', confidence: 0.8 },
  urgency: { answer: 'high', confidence: 0.6 },
  locale: { probability: 0.9 },
});

describe('decideModel', () => {
  it("takes the node's model, else `ai.decide`, else the turn's model", async () => {
    await withAI(ai({ decide: 'router' }), () => {
      strictEqual(decideModel({ model: 'local', questions }, 'smart'), 'local');
      strictEqual(decideModel({ questions }, 'smart'), 'router');
    });
    await withAI(ai(), () => strictEqual(decideModel({ questions }, 'fast'), 'fast'));
  });
});

describe('useDecider', () => {
  beforeEach(() => {
    server.requests.length = 0;
  });
  after(() => server.close());

  it('answers natively on a `jev` model', async () => {
    server.answer({
      body: JSON.stringify({
        model: 'jev-1',
        answers: {
          intent: { choice: 'roster', confidence: 0.7 },
          urgency: { score: 0.2, confidence: 0.5 },
          locale: { noul: 0.25 },
        },
      }),
    });
    await withAI(ai(), async () => {
      const decision = await (await useDecider('router', user)).decide(request, signal);
      deepStrictEqual(decision.answers, {
        intent: { answer: 'roster', confidence: 0.7 },
        urgency: { answer: 'low', confidence: 0.5 },
        locale: { answer: 'no', confidence: 0.5 },
      });
    });
    strictEqual(server.requests[0]?.path, '/v1/systemone');
  });

  it('asks a chat model by structured output, with the decide prompt, the questions and the message', async () => {
    server.answer({ body: completion(answer) });
    await withAI(ai(), async () => {
      const decision = await (await useDecider('local', user)).decide(request, signal);
      deepStrictEqual(decision, {
        answers: {
          intent: { answer: 'translate', confidence: 0.8 },
          urgency: { answer: 'high', confidence: 0.6 },
          locale: { answer: 'yes', confidence: 0.8 },
        },
        usage: { fresh: 10, cacheRead: 0, cacheWrite: 0, output: 5 },
        model: 'qwen',
      });
    });
    const body = server.requests[0]?.body as {
      messages: { role: string; content: string }[];
      response_format: { json_schema: { schema: Record<string, unknown> } };
    };
    strictEqual(body.messages[0].role, 'system');
    strictEqual(body.messages[0].content.split('\n')[0], '# Deciding');
    strictEqual(
      body.messages[1].content,
      [
        '# Questions',
        '- intent (choice): translate: Translate records.; roster: Ask about members.',
        '- urgency (score, lowest first): low, high',
        '- locale (yes or no): Does the message name a language?',
        '',
        '# Message',
        'Translate the epics to German',
      ].join('\n'),
    );
    deepStrictEqual(body.response_format.json_schema.schema, {
      type: 'object',
      properties: {
        intent: {
          type: 'object',
          properties: {
            answer: { type: 'string', enum: ['translate', 'roster'] },
            confidence: { type: 'number' },
          },
          required: ['answer', 'confidence'],
          additionalProperties: false,
        },
        urgency: {
          type: 'object',
          properties: {
            answer: { type: 'string', enum: ['low', 'high'] },
            confidence: { type: 'number' },
          },
          required: ['answer', 'confidence'],
          additionalProperties: false,
        },
        locale: {
          type: 'object',
          properties: { probability: { type: 'number' } },
          required: ['probability'],
          additionalProperties: false,
        },
      },
      required: ['intent', 'urgency', 'locale'],
      additionalProperties: false,
    });
  });

  it('asks once more when the answer drifts, summing the usage, then gives up as `malformed`', async () => {
    const drifted = JSON.stringify({
      intent: { answer: 'loot', confidence: 0.8 },
      urgency: { answer: 'high', confidence: 0.6 },
      locale: { probability: 0.9 },
    });
    server.answer({ body: completion(drifted) }, { body: completion(answer) });
    await withAI(ai(), async () => {
      const decision = await (await useDecider('local', user)).decide(request, signal);
      strictEqual(decision.answers.intent.answer, 'translate');
      deepStrictEqual(decision.usage, { fresh: 20, cacheRead: 0, cacheWrite: 0, output: 10 });
    });
    strictEqual(server.requests.length, 2);

    server.requests.length = 0;
    const over = JSON.stringify({
      intent: { answer: 'translate', confidence: 1.5 },
      urgency: { answer: 'high', confidence: 0.6 },
      locale: { probability: 0.9 },
    });
    server.answer({ body: completion(over) }, { body: completion('{"intent":{}}') });
    await withAI(ai(), async () =>
      rejects((await useDecider('local', user)).decide(request, signal), { code: 'malformed' }),
    );
    strictEqual(server.requests.length, 2);
  });

  it('drops the decide prompt the config empties', async () => {
    server.answer({ body: completion(answer) });
    await withAI(ai({ prompts: { decide: '' } }), async () => {
      await (await useDecider('local', user)).decide(request, signal);
    });
    const body = server.requests[0]?.body as { messages: { role: string; content: string }[] };
    strictEqual(body.messages[0].content, '');
  });
});
