import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import type { Config } from '../../../src/ohne/layers/config.ts';
import type { StreamedEvent } from '../api/ai/turns/_stand-in.ts';
import type { ProviderServer } from '../providers/_server.ts';

import resultsPost from '../../../src/ai/api/ai/turns/[id]/results.post.ts';
import turnsPost from '../../../src/ai/api/ai/turns/index.post.ts';
import { flowModels, routeAnswers, startableFlows } from '../../../src/ai/turns/run-flow.ts';
import { loadTurn } from '../../../src/ai/turns/state.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { useFlows } from '../../../src/ohne/flows/use-flows.ts';
import { useSkills } from '../../../src/ohne/skills/use-skills.ts';
import { call, route, signIn, userWith, withAI } from '../_fixture.ts';
import { calls, readEvents, says } from '../api/ai/turns/_stand-in.ts';
import { startProviderServer } from '../providers/_server.ts';

const TURNS = route('POST', '/ai/turns', turnsPost);
const RESULTS = route('POST', '/ai/turns/[id]/results', resultsPost);
const KEY = 'AI_FLOWS_TEST_KEY';
const UNSET = 'AI_FLOWS_UNSET_KEY';
const UUID = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';

useEnv().define(KEY as never, { default: undefined as never });
useEnv().define(UNSET as never, { default: undefined as never });

useSkills().register('translate-items', {
  name: 'translate-items',
  skill: {
    description: 'Translate items.',
    prompt: '\nTranslate every item.\n',
    capability: 'collection.Items.update',
  },
});
useFlows().register('raid-officer', {
  name: 'raid-officer',
  flow: {
    description: 'Routes a request.',
    start: 'triage',
    nodes: {
      triage: {
        decide: {
          model: 'router',
          questions: {
            intent: { choice: { translate: 'Translate records.', roster: 'Ask about members.' } },
          },
        },
        next: {
          on: 'intent',
          cases: { translate: 'translate', roster: 'roster' },
          below: { confidence: 0.6, to: 'general' },
        },
      },
      translate: { act: { skill: 'translate-items' } },
      roster: { act: { prompt: 'Answer from Characters.', tiers: ['read'], model: 'fast' } },
      general: { act: {} },
    },
  },
});
useFlows().register('chain', {
  name: 'chain',
  flow: {
    description: 'Two nodes in a row.',
    start: 'first',
    nodes: {
      first: { act: { prompt: 'Count.' }, next: 'second' },
      second: { act: { prompt: 'Report.', model: 'fast' } },
    },
  },
});
useFlows().register('back', {
  name: 'back',
  flow: {
    description: 'Leaves the turn model and comes back.',
    start: 'first',
    nodes: {
      first: { act: { prompt: 'Count.', model: 'fast' }, next: 'second' },
      second: { act: { prompt: 'Report.' } },
    },
  },
});
useFlows().register('twins', {
  name: 'twins',
  flow: {
    description: 'Two nodes side by side.',
    start: 'split',
    nodes: {
      split: {
        decide: { questions: { go: { yesNo: 'Go?' } } },
        next: { on: 'go', cases: { yes: ['a', 'b'] } },
      },
      a: { act: { prompt: 'A.' } },
      b: { act: { prompt: 'B.' } },
    },
  },
});
useFlows().register('unkeyed', {
  name: 'unkeyed',
  flow: {
    description: 'Runs on a model without its key.',
    start: 'only',
    nodes: { only: { act: { model: 'keyless' } } },
  },
});

const server: ProviderServer = await startProviderServer();
const officer = await signIn('officer@flows.example.com', ['officer']);
const asker = await signIn('asker@flows.example.com', ['asker']);

/**
 * The app's `ai` settings, every model pointed at the stand-in, with `extra` on top.
 */
function ai(extra: Partial<NonNullable<Config['ai']>> = {}): Config['ai'] {
  return {
    model: 'smart',
    models: {
      smart: { provider: 'anthropic', model: 'claude-test', key: KEY, baseURL: server.url },
      fast: { provider: 'anthropic', model: 'claude-fast', key: KEY, baseURL: server.url },
      router: { provider: 'jev', model: 'jev-test', key: KEY, baseURL: server.url },
      keyless: { provider: 'anthropic', model: 'claude-none', key: UNSET, baseURL: server.url },
    },
    ...extra,
  };
}

/**
 * A Jev answer routing `intent` to `choice` with `confidence`.
 */
function decided(choice: string, confidence: number): string {
  return JSON.stringify({
    model: 'jev-1',
    answers: { intent: { type: 'choice', choice, confidence } },
    usage: { input_tokens: 40, output_tokens: 2 },
  });
}

interface Opened {
  status: number;
  events: StreamedEvent[];
  body: Record<string, unknown>;
}

/**
 * Reads a turn route's answer: its stream when it opened one, its JSON body otherwise.
 */
async function answered(response: Response, drain: () => Promise<void>): Promise<Opened> {
  const opened: Opened = { status: response.status, events: [], body: {} };
  if (response.headers.get('content-type') === 'text/event-stream') {
    opened.events = await readEvents(response);
  } else {
    opened.body = (await response.json()) as Record<string, unknown>;
  }
  await drain();
  return opened;
}

/**
 * Opens a turn with `body` as the person `token` signs in.
 */
async function open(body: unknown, token: string = officer.token): Promise<Opened> {
  const { response, drain } = await call(TURNS, { path: '/ai/turns', body, token });
  return answered(response, drain);
}

/**
 * Reports `results` for the batch of the turn `id`.
 */
async function report(id: string, batch: string, results: unknown[]): Promise<Opened> {
  const { response, drain } = await call(RESULTS, {
    path: `/ai/turns/${id}/results`,
    body: { batch, results },
    token: officer.token,
    params: { id },
  });
  return answered(response, drain);
}

/**
 * The events after `turn`, each as `[event, data]`.
 */
function trail(events: StreamedEvent[]): [string, Record<string, unknown>][] {
  return events.slice(1).map(({ event, data }) => [event, data]);
}

/**
 * The messages the stand-in saw in request `index`.
 */
function messages(index: number): { role: string; content: unknown }[] {
  return server.requests[index]?.body.messages as { role: string; content: unknown }[];
}

const ask = { input: 'Who is level 60?', page: '/collections/characters', flow: 'raid-officer' };

describe('routeAnswers', () => {
  const answers = { intent: { answer: 'roster', confidence: 0.7 } };

  it('takes a plain target, a list, a case, the below branch, and nothing for a missing case', () => {
    deepStrictEqual(routeAnswers('roster', answers), ['roster']);
    deepStrictEqual(routeAnswers(['a', 'b'], answers), ['a', 'b']);
    const branch = {
      on: 'intent',
      cases: { roster: ['roster', 'general'] },
      below: { confidence: 0.8, to: 'general' },
    };
    deepStrictEqual(routeAnswers({ ...branch, below: undefined }, answers), ['roster', 'general']);
    deepStrictEqual(routeAnswers(branch, answers), ['general']);
    deepStrictEqual(routeAnswers({ on: 'intent', cases: { translate: 'translate' } }, answers), []);
  });
});

describe('startableFlows and flowModels', () => {
  it('lists a flow for a person who may run every skill its nodes name', async () => {
    await withAI(ai(), () => {
      deepStrictEqual(
        startableFlows(userWith('officer')).map(({ name }) => name),
        ['raid-officer', 'chain', 'back', 'twins', 'unkeyed'],
      );
      deepStrictEqual(
        startableFlows(userWith('asker')).map(({ name }) => name),
        ['chain', 'back', 'twins', 'unkeyed'],
      );
    });
  });

  it('names every model a flow runs on, the defaults for nodes naming none', async () => {
    const raid = useFlows().get('raid-officer')!.flow;
    const twins = useFlows().get('twins')!.flow;
    await withAI(ai(), () => {
      deepStrictEqual(flowModels(raid, 'smart'), ['router', 'smart', 'fast']);
      deepStrictEqual(flowModels(twins, 'smart'), ['smart']);
    });
    await withAI(ai({ decide: 'router' }), () => {
      deepStrictEqual(flowModels(twins, 'fast'), ['router', 'fast']);
    });
  });
});

describe('POST /ai/turns with a flow', () => {
  beforeEach(() => {
    useEnv().set(KEY as never, 'sk-test' as never);
    server.requests.length = 0;
  });
  afterEach(() => useEnv().unset(KEY as never));
  after(() => server.close());

  it('refuses a flow the person may not start, one beside a skill or a follow-up, and an unkeyed model', async () => {
    await withAI(ai(), async () => {
      const unknown = await open({ ...ask, flow: 'nope' });
      deepStrictEqual([unknown.status, unknown.body.message], [400, 'Unknown flow `nope`']);
      strictEqual((await open(ask, asker.token)).status, 400);
      strictEqual((await open({ ...ask, skill: 'translate-items' })).status, 400);
      strictEqual((await open({ ...ask, after: UUID })).status, 400);
      const unkeyed = await open({ ...ask, flow: 'unkeyed' });
      deepStrictEqual(
        [unkeyed.status, unkeyed.body.message],
        [503, 'The model `keyless` is unavailable'],
      );
    });
    strictEqual(server.requests.length, 0);
  });

  it('decides on the typed message alone, then runs the node on its model within its tiers', async () => {
    server.answer(
      { body: decided('roster', 0.9) },
      {
        body: calls('Checking.', [
          {
            id: 'toolu_1',
            name: 'request',
            input: {
              requests: [
                { route: 'POST /collections/characters/query', body: { where: { level: 60 } } },
                {
                  route: 'PATCH /collections/characters/[uuid]',
                  params: { uuid: UUID },
                  body: { status: 'retired' },
                },
              ],
            },
          },
        ]),
      },
    );
    await withAI(ai(), async () => {
      const { status, events } = await open(ask);
      strictEqual(status, 200);
      const id = events[0]?.data.id as string;
      const batch = events[3]?.data;
      deepStrictEqual(trail(events), [
        ['node', { flow: 'raid-officer', node: 'roster' }],
        ['text', { text: 'Checking.' }],
        [
          'batch',
          {
            id: batch?.id,
            kind: 'read',
            proposals: [
              {
                route: 'POST /collections/characters/query',
                tier: 'read',
                body: { where: { level: 60 }, page: 1 },
              },
            ],
            pinned: 'fast',
          },
        ],
        ['done', { reason: 'batch' }],
      ]);
      const [decide, step] = server.requests;
      strictEqual(decide?.path, '/v1/systemone');
      strictEqual(decide?.body.state, 'Who is level 60?');
      strictEqual(step?.body.model, 'claude-fast');
      const system = (step.body.system as { text: string }[]).map(({ text }) => text).join('\n');
      ok(system.includes('POST /collections/characters/query'));
      ok(!system.includes('PATCH /collections/characters/[uuid]'));
      deepStrictEqual(messages(1), [
        {
          role: 'user',
          content:
            '<flow name="raid-officer" node="roster">\nAnswer from Characters.\n</flow>\n\nWho is level 60?',
        },
      ]);
      const turn = await loadTurn(id);
      deepStrictEqual(turn?.flow, {
        name: 'raid-officer',
        input: 'Who is level 60?',
        node: 'roster',
        model: 'fast',
        queue: [],
      });
      strictEqual(turn?.model, 'smart');
      deepStrictEqual(turn?.usage, { fresh: 65, cacheRead: 0, cacheWrite: 0, output: 14 });
      deepStrictEqual(turn?.batches[0]?.calls[0]?.receipts?.[1], {
        route: 'PATCH /collections/characters/[uuid]',
        status: 400,
        code: 'unknownRoute',
        path: 'route',
      });

      server.answer({ body: says('Nobody yet.') });
      const next = await report(id, batch?.id as string, [
        { status: 200, body: { records: [], total: 0 } },
      ]);
      deepStrictEqual(trail([events[0], ...next.events]), [
        ['node', { flow: 'raid-officer', node: 'roster' }],
        ['text', { text: 'Nobody yet.' }],
        ['done', { reason: 'end' }],
      ]);
      strictEqual(server.requests[2]?.body.model, 'claude-fast');
      const closed = await loadTurn(id);
      strictEqual(closed?.reason, 'end');
      deepStrictEqual(closed?.flow, {
        name: 'raid-officer',
        input: 'Who is level 60?',
        node: null,
        model: 'fast',
        queue: [],
      });
    });
  });

  it('takes the below branch on a shaky answer, and a skill node fences its skill', async () => {
    server.answer({ body: decided('translate', 0.3) }, { body: says('Sure.') });
    await withAI(ai(), async () => {
      const { events } = await open(ask);
      deepStrictEqual(trail(events)[0], ['node', { flow: 'raid-officer', node: 'general' }]);
      strictEqual(
        messages(1)[0]?.content,
        '<flow name="raid-officer" node="general"></flow>\n\nWho is level 60?',
      );
      strictEqual(server.requests[1]?.body.model, 'claude-test');
    });
    server.requests.length = 0;
    server.answer({ body: decided('translate', 0.95) }, { body: says('Translating.') });
    await withAI(ai(), async () => {
      await open({ ...ask, input: 'Translate the epics' });
      strictEqual(
        messages(1)[0]?.content,
        [
          '<flow name="raid-officer" node="translate">',
          '<skill name="translate-items">\nTranslate every item.\n</skill>',
          '</flow>',
          '',
          'Translate the epics',
        ].join('\n'),
      );
    });
  });

  it('steps through chained nodes in one stream, a node on another model starting over', async () => {
    server.answer({ body: says('One.') }, { body: says('Two.') });
    await withAI(ai(), async () => {
      const { events } = await open({ ...ask, flow: 'chain' });
      deepStrictEqual(trail(events), [
        ['node', { flow: 'chain', node: 'first' }],
        ['text', { text: 'One.' }],
        ['node', { flow: 'chain', node: 'second' }],
        ['text', { text: 'Two.' }],
        ['done', { reason: 'end' }],
      ]);
      strictEqual(server.requests[0]?.body.model, 'claude-test');
      strictEqual(server.requests[1]?.body.model, 'claude-fast');
      deepStrictEqual(messages(1), [
        {
          role: 'user',
          content: '<flow name="chain" node="second">\nReport.\n</flow>\n\nWho is level 60?',
        },
      ]);
      const turn = await loadTurn(events[0]?.data.id as string);
      strictEqual(turn?.step, 2);
      strictEqual(turn?.reason, 'end');
      deepStrictEqual(turn?.transcript, [
        ...messages(1),
        { role: 'assistant', content: [{ type: 'text', text: 'Two.' }] },
      ]);
    });
  });

  it("follows up on the model the flow's transcript ended in, and starts over on another", async () => {
    server.answer({ body: says('One.') }, { body: says('Two.') });
    await withAI(ai(), async () => {
      const { events } = await open({ ...ask, flow: 'chain' });
      const id = events[0]?.data.id as string;
      server.answer({ body: says('Fresh.') }, { body: says('Kept.') });
      await open({ input: 'And now?', page: '/', after: id });
      strictEqual(server.requests[2]?.body.model, 'claude-test');
      deepStrictEqual(messages(2), [{ role: 'user', content: 'And now?' }]);
      await open({ input: 'And now?', page: '/', after: id, model: 'fast' });
      strictEqual(server.requests[3]?.body.model, 'claude-fast');
      strictEqual(messages(3).length, 3);
    });
  });

  it("decides on the person's picked model when neither the node nor `ai.decide` names one", async () => {
    server.answer({ body: says('{"go":{"probability":0.1}}') });
    await withAI(ai(), async () => {
      const { events } = await open({ ...ask, flow: 'twins', model: 'fast' });
      deepStrictEqual(trail(events), [['done', { reason: 'end' }]]);
      strictEqual(server.requests[0]?.body.model, 'claude-fast');
    });
  });

  it("comes back to the turn's model on a node naming none, starting over there", async () => {
    server.answer({ body: says('One.') }, { body: says('Two.') });
    await withAI(ai(), async () => {
      const { events } = await open({ ...ask, flow: 'back' });
      deepStrictEqual(trail(events).at(-1), ['done', { reason: 'end' }]);
      strictEqual(server.requests[0]?.body.model, 'claude-fast');
      strictEqual(server.requests[1]?.body.model, 'claude-test');
      strictEqual(messages(1).length, 1);
      strictEqual((await loadTurn(events[0]?.data.id as string))?.transcript.length, 2);
    });
  });

  it('runs sibling nodes in order on one transcript, deciding by structured output on the turn model', async () => {
    server.answer(
      { body: says('{"go":{"probability":0.9}}') },
      { body: says('A done.') },
      { body: says('B done.') },
    );
    await withAI(ai(), async () => {
      const { events } = await open({ ...ask, flow: 'twins' });
      deepStrictEqual(
        trail(events).map(([event, data]) => [event, data.node ?? data.text ?? data.reason]),
        [
          ['node', 'a'],
          ['text', 'A done.'],
          ['node', 'b'],
          ['text', 'B done.'],
          ['done', 'end'],
        ],
      );
      const decide = server.requests[0]?.body as { output_config?: unknown; messages: unknown[] };
      ok(decide.output_config);
      deepStrictEqual(messages(2), [
        { role: 'user', content: '<flow name="twins" node="a">\nA.\n</flow>\n\nWho is level 60?' },
        { role: 'assistant', content: [{ type: 'text', text: 'A done.' }] },
        { role: 'user', content: '<flow name="twins" node="b">\nB.\n</flow>' },
      ]);
    });
  });

  it('closes at the steps limit, or the token budget, before a chained node steps', async () => {
    server.answer({ body: says('One.') });
    await withAI(ai({ limits: { steps: 1 } }), async () => {
      const { events } = await open({ ...ask, flow: 'chain' });
      deepStrictEqual(trail(events).at(-1), ['done', { reason: 'steps' }]);
      const turn = await loadTurn(events[0]?.data.id as string);
      strictEqual(turn?.reason, 'steps');
      deepStrictEqual(turn?.flow?.queue, ['second']);
      strictEqual(turn?.transcript.length, 2);
    });
    server.answer({ body: says('One.') });
    await withAI(ai({ limits: { tokens: { limit: 30, window: '1h' } } }), async () => {
      const { events } = await open({ ...ask, flow: 'chain' });
      deepStrictEqual(trail(events).at(-1), ['done', { reason: 'limit' }]);
      strictEqual((await loadTurn(events[0]?.data.id as string))?.reason, 'limit');
    });
    strictEqual(server.requests.length, 2);
  });
});
