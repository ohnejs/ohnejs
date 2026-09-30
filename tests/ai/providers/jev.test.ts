import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';

import type { Decider, DecideRequest } from '../../../src/ai/providers/provider.ts';
import type { ProviderServer } from './_server.ts';

import { createJevProvider } from '../../../src/ai/providers/jev.ts';
import { startProviderServer } from './_server.ts';

const request: DecideRequest = {
  input: 'Translate the epics to German',
  questions: {
    intent: {
      choice: { translate: 'Translate records.', roster: 'Ask about members.' },
    },
    urgency: { score: ['low', 'medium', 'high'] },
    locale: { yesNo: 'Does the message name a language?' },
  },
};

/**
 * A wire answer with `patch` merged over its answers.
 */
function answered(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: 'jev-1.13.0',
    answers: {
      intent: {
        type: 'choice',
        choice: 'translate',
        probabilities: { translate: 0.91, roster: 0.09 },
        confidence: 0.82,
      },
      urgency: {
        type: 'score',
        score: 1.4,
        legend: { '0': 'low', '1': 'medium', '2': 'high' },
        probabilities: { low: 0.1, medium: 0.5, high: 0.4 },
        confidence: 0.35,
      },
      locale: { type: 'noul', noul: 0.75 },
      ...patch,
    },
    usage: { input_tokens: 296, output_tokens: 20 },
  });
}

describe('createJevProvider', () => {
  let server: ProviderServer;
  let jev: Decider;
  const signal = new AbortController().signal;

  before(async () => {
    server = await startProviderServer();
    jev = createJevProvider({
      model: 'jev-latest',
      key: 'k',
      baseURL: server.url,
      options: { trace: 'on' },
    });
  });
  after(() => server.close());
  beforeEach(() => {
    server.requests.length = 0;
  });

  it('posts every question in one call, as the wire takes them', async () => {
    server.answer({ body: answered() });
    await jev.decide(request, signal);
    const [seen] = server.requests;
    strictEqual(seen?.path, '/v1/systemone');
    strictEqual(seen?.headers.authorization, 'Bearer k');
    strictEqual(seen?.headers['content-type'], 'application/json');
    deepStrictEqual(seen?.body, {
      trace: 'on',
      model: 'jev-latest',
      state: 'Translate the epics to German',
      questions: {
        intent: {
          type: 'choice',
          instructions: 'Which option describes the message best?',
          criteria: { translate: 'Translate records.', roster: 'Ask about members.' },
        },
        urgency: {
          type: 'score',
          instructions: 'Where on this scale does the message fall, lowest level first?',
          criteria: ['low', 'medium', 'high'],
        },
        locale: { type: 'noul', instructions: 'Does the message name a language?' },
      },
    });
  });

  it('reads each answer: the choice, the nearest score level, and yes or no with its confidence', async () => {
    server.answer({ body: answered() });
    deepStrictEqual(await jev.decide(request, signal), {
      answers: {
        intent: { answer: 'translate', confidence: 0.82 },
        urgency: { answer: 'medium', confidence: 0.35 },
        locale: { answer: 'yes', confidence: 0.5 },
      },
      usage: { fresh: 296, cacheRead: 0, cacheWrite: 0, output: 20 },
      model: 'jev-1.13.0',
    });
  });

  it('reads a no from a probability under a half, even as no confidence at all', async () => {
    server.answer({ body: answered({ locale: { type: 'noul', noul: 0.5 } }) });
    deepStrictEqual((await jev.decide(request, signal)).answers.locale, {
      answer: 'yes',
      confidence: 0,
    });
    server.answer({ body: answered({ locale: { type: 'noul', noul: 0.25 } }) });
    deepStrictEqual((await jev.decide(request, signal)).answers.locale, {
      answer: 'no',
      confidence: 0.5,
    });
  });

  it('clamps a score past the last level to it', async () => {
    server.answer({ body: answered({ urgency: { type: 'score', score: 2.6, confidence: 0.7 } }) });
    strictEqual((await jev.decide(request, signal)).answers.urgency.answer, 'high');
  });

  it('throws `malformed` for an answer outside its options, or a question left unanswered', async () => {
    server.answer({
      body: answered({ intent: { type: 'choice', choice: 'loot', confidence: 0.8 } }),
    });
    await rejects(jev.decide(request, signal), { code: 'malformed' });
    server.answer({ body: answered({ locale: undefined }) });
    await rejects(jev.decide(request, signal), { code: 'malformed' });
    server.answer({ body: 'not json' });
    await rejects(jev.decide(request, signal), { code: 'malformed' });
  });

  it('reruns a `429` after its `Retry-After`, and a `529`, but never a `401`', async () => {
    server.answer(
      { status: 429, headers: { 'retry-after': '0' }, body: '{"error":{"message":"Slow down"}}' },
      { status: 529, body: '{"error":{"message":"Overloaded"}}' },
      { body: answered() },
    );
    strictEqual((await jev.decide(request, signal)).model, 'jev-1.13.0');
    strictEqual(server.requests.length, 3);

    server.requests.length = 0;
    server.answer({ status: 401, body: '{"error":{"message":"Missing or invalid API key"}}' });
    await rejects(jev.decide(request, signal), {
      code: 'status',
      status: 401,
      retry: false,
      message: 'Missing or invalid API key',
    });
    strictEqual(server.requests.length, 1);
  });

  it('throws `network` on a dropped connection, and the reason of an aborted signal', async () => {
    server.answer({ drop: true }, { drop: true }, { drop: true });
    await rejects(jev.decide(request, signal), { code: 'network' });

    const controller = new AbortController();
    server.answer({ body: answered(), hold: true });
    const pending = jev.decide(request, controller.signal);
    controller.abort(new Error('left'));
    await rejects(pending, { message: 'left' });
  });
});
