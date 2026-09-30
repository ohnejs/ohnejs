import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Turn, TurnBatch } from '../../../src/ai/turns/state.ts';
import type { User } from '../../../src/base/auth/types.ts';

import { chatTurn, listChats, loadChat } from '../../../src/ai/turns/chats.ts';
import { closeTurn, openTurn } from '../../../src/ai/turns/state.ts';
import { useFlows } from '../../../src/ohne/flows/use-flows.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { signIn, userWith, withAI } from '../_fixture.ts';

const UUID = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';

const proposal = {
  route: 'POST /collections/items/query',
  tier: 'read',
  body: { page: 1 },
} as const;

/**
 * A batch of one read at `step`, with `reported` when the browser answered it.
 */
function batch(step: number, reported?: TurnBatch['reported']): TurnBatch {
  return {
    id: `b${step}`,
    step,
    kind: 'read',
    calls: [{ id: 'toolu_1', name: 'request', receipts: [null] }],
    proposals: [
      {
        call: 0,
        index: 0,
        route: { method: 'POST', pattern: '/collections/[collection]/query', body: 'query' },
        proposal,
        identity: true,
      },
    ],
    ...(reported === undefined ? {} : { reported }),
  };
}

const stored: Turn = {
  UUID,
  user: 'u',
  model: 'smart',
  page: '/',
  input: 'Who is level 60?',
  skill: null,
  chat: null,
  flow: null,
  transcript: [{ role: 'user', content: 'secret transcript' }],
  batches: [],
  texts: [],
  step: 1,
  usage: { fresh: 1, cacheRead: 0, cacheWrite: 0, output: 1 },
  closedAt: 1,
  reason: 'end',
  updatedAt: 1,
};

/**
 * Opens a turn for the person `user` and closes it, a millisecond apart from the one before.
 */
async function asked(user: string, input: string, chat?: string): Promise<string> {
  await sleep(2);
  const turn = await openTurn({ user, model: 'smart', page: '/', input, chat, transcript: [] });
  await closeTurn(turn, 'end');
  return turn.UUID;
}

/**
 * The person `UUID` as a session holds them.
 */
function person(UUID: string): User {
  return { ...userWith('asker'), UUID };
}

describe('chatTurn', () => {
  it('builds each step from its text and batch, and drops a step with neither', () => {
    const reported = [{ status: 200, body: { total: 1, records: [{ UUID }] } }];
    const turn = chatTurn({
      ...stored,
      step: 4,
      texts: ['Reading.', '', 'Found one.'],
      batches: [batch(1, reported), batch(3)],
    });
    deepStrictEqual(turn, {
      id: UUID,
      input: 'Who is level 60?',
      skill: null,
      flow: null,
      status: 'closed',
      reason: 'end',
      steps: [
        {
          text: 'Reading.',
          batch: { id: 'b1', kind: 'read', proposals: [proposal], results: reported },
        },
        {
          text: 'Found one.',
          batch: { id: 'b3', kind: 'read', proposals: [proposal], results: null },
        },
      ],
      wait: null,
    });
  });

  it('carries the page a batch opened and what became of it, and one never answered', () => {
    const opens = (path: string): TurnBatch => ({
      id: `b-${path}`,
      step: 1,
      kind: 'read',
      calls: [{ id: 'toolu_1', name: 'open' }],
      proposals: [],
      open: { call: 0, path },
    });
    const answered = { ...opens('/overview'), reported: [], opened: 'stayed' as const };
    const [first] = chatTurn({ ...stored, batches: [answered] }).steps;
    deepStrictEqual(first?.batch, {
      id: 'b-/overview',
      kind: 'read',
      proposals: [],
      results: [],
      open: '/overview',
      opened: 'stayed',
    });
    const [waiting] = chatTurn({ ...stored, batches: [opens('/account')] }).steps;
    deepStrictEqual(waiting?.batch, {
      id: 'b-/account',
      kind: 'read',
      proposals: [],
      results: null,
      open: '/account',
    });
  });

  it('reads a failure as an error, anything else as closed', () => {
    for (const reason of ['timeout', 'provider', 'internal'] as const) {
      strictEqual(chatTurn({ ...stored, reason }).status, 'error');
    }
    for (const reason of ['left', 'idle', 'lost', null] as const) {
      strictEqual(chatTurn({ ...stored, reason }).status, 'closed');
    }
  });

  it('reads an open turn waiting on the person as waiting from its last write, and one stepping as running', () => {
    const open = { ...stored, closedAt: null, reason: null, updatedAt: 42 };
    const waiting = chatTurn({ ...open, batches: [batch(1)] });
    deepStrictEqual([waiting.status, waiting.steps[0]?.batch?.since], ['waiting', 42]);
    const running = chatTurn({ ...open, batches: [batch(1, [{ status: 200 }])] });
    deepStrictEqual([running.status, running.reason], ['closed', 'running']);
    strictEqual(chatTurn({ ...stored, batches: [batch(1)] }).status, 'closed');
  });

  it("pins a waiting flow batch to its running node's model, as the live batch does", () => {
    useFlows().register('chats-flow', {
      name: 'chats-flow',
      flow: { description: 'A flow.', start: 'fast', nodes: { fast: { act: { model: 'fast' } } } },
    });
    const flow = { name: 'chats-flow', input: 'Hi', node: 'fast', model: 'fast', queue: [] };
    const open = { ...stored, flow, closedAt: null, reason: null };
    strictEqual(chatTurn({ ...open, batches: [batch(1)] }).steps[0]?.batch?.pinned, 'fast');
    const answered = { ...open, batches: [batch(1, [{ status: 200 }])] };
    strictEqual(chatTurn(answered).steps[0]?.batch?.pinned, undefined);
  });

  it('names the flow, and reads a row without input as empty', () => {
    const flow = { name: 'raid', input: 'Hi', node: null, model: 'smart', queue: [] };
    const turn = chatTurn({ ...stored, input: null, flow });
    deepStrictEqual([turn.input, turn.flow], ['', 'raid']);
  });
});

describe('listChats', () => {
  it('groups follow-ups under their first turn, newest activity first, titled by the first input', async () => {
    const { uuid } = await signIn('lister@chats.example.com', ['asker']);
    const { uuid: other } = await signIn('other@chats.example.com', ['asker']);
    const first = await asked(uuid, 'Who is level 60?');
    const second = await asked(uuid, 'Rename the guild');
    await asked(other, 'Not yours');
    await queryUntyped('AITurns').createOrThrow({ user: uuid, model: 'smart', page: '/' });
    const followed = await asked(uuid, 'And level 59?', first);
    const chats = await listChats(person(uuid));
    deepStrictEqual(
      chats.map(({ id, title }) => ({ id, title })),
      [
        { id: first, title: 'Who is level 60?' },
        { id: second, title: 'Rename the guild' },
      ],
    );
    const latest = await queryUntyped('AITurns').where({ UUID: followed }).findFirst();
    strictEqual(chats[0].updatedAt, latest?._updatedAt);
  });

  it('orders by the latest write, not by when the turn opened', async () => {
    const { uuid } = await signIn('active@chats.example.com', ['asker']);
    const waiting = await openTurn({
      user: uuid,
      model: 'smart',
      page: '/',
      input: 'Rename them all',
      transcript: [],
    });
    const later = await asked(uuid, 'Who is level 60?');
    await sleep(2);
    await closeTurn(waiting, 'idle');
    const chats = await listChats(person(uuid));
    deepStrictEqual(
      chats.map((chat) => chat.id),
      [waiting.UUID, later],
    );
  });

  it('stops at `limit`', async () => {
    const { uuid } = await signIn('limit@chats.example.com', ['asker']);
    await asked(uuid, 'One');
    await asked(uuid, 'Two');
    const chats = await listChats(person(uuid), 1);
    deepStrictEqual(
      chats.map((chat) => chat.title),
      ['Two'],
    );
  });
});

describe('loadChat', () => {
  it("opens the person's chat oldest first, and reads someone else's as none", async () => {
    const { uuid } = await signIn('loader@chats.example.com', ['asker']);
    const first = await asked(uuid, 'Who is level 60?');
    const followed = await asked(uuid, 'And level 59?', first);
    const turns = await loadChat(person(uuid), first);
    deepStrictEqual(
      turns?.map((turn) => [turn.id, turn.input]),
      [
        [first, 'Who is level 60?'],
        [followed, 'And level 59?'],
      ],
    );
    strictEqual(await loadChat(person('someone-else'), first), undefined);
    strictEqual(await loadChat(person(uuid), UUID), undefined);
    strictEqual(await loadChat(person(uuid), followed), undefined);
  });

  it('replays a waiting turn past `turnTimeout` as idle, and leaves its row open', async () => {
    const ai = {
      model: 'smart',
      models: {
        smart: { provider: 'openai-compatible', model: 'm', key: false, baseURL: 'http://x' },
      },
      limits: { turnTimeout: '1ms' },
    } as const;
    await withAI(ai, async () => {
      const { uuid } = await signIn('idle@chats.example.com', ['asker']);
      const turn = await openTurn({
        user: uuid,
        model: 'smart',
        page: '/',
        input: 'Rename',
        transcript: [],
      });
      const turns = queryUntyped('AITurns').unscoped().where({ UUID: turn.UUID });
      await turns.updateOrThrow({ batches: JSON.stringify([batch(1)]) });
      await sleep(5);
      const [replayed] = (await loadChat(person(uuid), turn.UUID)) ?? [];
      deepStrictEqual([replayed?.status, replayed?.reason], ['closed', 'idle']);
      strictEqual((await turns.findFirst())?.closedAt, null);
    });
  });
});
