import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import type { TurnBatch } from '../../../src/ai/turns/state.ts';

import {
  activeModel,
  batchReported,
  claimStep,
  closeTurn,
  expireTurn,
  loadTurn,
  openTurn,
  saveTurn,
  touchTurn,
  turnGone,
  unknownBatch,
} from '../../../src/ai/turns/state.ts';
import { useFlows } from '../../../src/ohne/flows/use-flows.ts';
import { isNull } from '../../../src/utils/is/is-null.ts';
import { signIn, withAI } from '../_fixture.ts';

useFlows().register('state-flow', {
  name: 'state-flow',
  flow: {
    description: 'A flow.',
    start: 'fast',
    nodes: { fast: { act: { model: 'fast' }, next: 'plain' }, plain: { act: {} } },
  },
});

const owner = await signIn('state@example.com', ['asker']);

const batch: TurnBatch = {
  id: 'b1',
  step: 1,
  kind: 'read',
  calls: [{ id: 'toolu_1', name: 'request', receipts: [null] }],
  proposals: [
    {
      call: 0,
      index: 0,
      route: { method: 'POST', pattern: '/collections/[collection]/query', body: 'query' },
      proposal: { route: 'POST /collections/items/query', tier: 'read', body: { page: 1 } },
      identity: true,
    },
  ],
};

describe('the turn state', () => {
  it('opens a turn with its first step claimed and the first message, and reads it back', async () => {
    const turn = await openTurn({
      user: owner.uuid,
      model: 'smart',
      page: '/collections/items',
      transcript: [{ role: 'user', content: 'Hi' }],
    });
    deepStrictEqual(await loadTurn(turn.UUID), turn);
    strictEqual(turn.user, owner.uuid);
    strictEqual(turn.page, '/collections/items');
    deepStrictEqual(turn.transcript, [{ role: 'user', content: 'Hi' }]);
    deepStrictEqual(turn.batches, []);
    strictEqual(turn.step, 1);
    strictEqual(turn.closedAt, null);
    ok(turn.updatedAt > 0);
  });

  it("keeps a flow turn's walk and runs on its transcript's model", async () => {
    const flow = { name: 'state-flow', input: 'Hi', node: null, model: 'smart', queue: ['fast'] };
    const turn = await openTurn({
      user: owner.uuid,
      model: 'smart',
      page: '/',
      transcript: [],
      flow,
    });
    deepStrictEqual((await loadTurn(turn.UUID))?.flow, flow);
    strictEqual(activeModel(turn), 'smart');
    turn.flow = { ...flow, node: 'fast', model: 'fast', queue: [] };
    strictEqual(activeModel(turn), 'fast');
    strictEqual(await saveTurn(turn, 1), true);
    deepStrictEqual((await loadTurn(turn.UUID))?.flow, turn.flow);
    turn.flow.node = null;
    strictEqual(activeModel(turn), 'fast');
    const plain = await openTurn({ user: owner.uuid, model: 'smart', page: '/', transcript: [] });
    strictEqual(plain.flow, null);
    strictEqual(activeModel(plain), 'smart');
  });

  it('answers `undefined` for a turn nobody opened', async () => {
    strictEqual(await loadTurn('019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b'), undefined);
  });

  it('writes the state back only while the row still sits at the expected step', async () => {
    const turn = await openTurn({ user: owner.uuid, model: 'smart', page: '/', transcript: [] });
    turn.transcript = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Yo' },
    ];
    turn.batches = [batch];
    turn.usage = { fresh: 10, cacheRead: 0, cacheWrite: 0, output: 5 };
    strictEqual(await saveTurn(turn, 1), true);
    const stored = await loadTurn(turn.UUID);
    deepStrictEqual(stored?.transcript, turn.transcript);
    deepStrictEqual(stored?.batches, [batch]);
    strictEqual(stored?.step, 1);
    deepStrictEqual(stored?.usage, turn.usage);
    strictEqual(stored?.updatedAt, turn.updatedAt);

    turn.step = 2;
    strictEqual(await saveTurn(turn, 0), false);
    strictEqual((await loadTurn(turn.UUID))?.step, 1);
  });

  it('claims the next step once, so a stale copy of the turn is refused', async () => {
    const turn = await openTurn({ user: owner.uuid, model: 'smart', page: '/', transcript: [] });
    const stale = { ...turn };
    strictEqual(await claimStep(turn), true);
    strictEqual(turn.step, 2);
    strictEqual((await loadTurn(turn.UUID))?.step, 2);
    strictEqual(await claimStep(stale), false);
    strictEqual(stale.step, 1);
  });

  it('closes a turn whatever step it sits at, with its reason', async () => {
    const turn = await openTurn({ user: owner.uuid, model: 'smart', page: '/', transcript: [] });
    strictEqual(turn.reason, null);
    await closeTurn(turn, 'timeout');
    ok(!isNull(turn.closedAt));
    strictEqual(turn.reason, 'timeout');
    const stored = await loadTurn(turn.UUID);
    deepStrictEqual([stored?.closedAt, stored?.reason], [turn.closedAt, 'timeout']);
  });

  it('keeps the first close, and hands it to a later closer', async () => {
    const turn = await openTurn({ user: owner.uuid, model: 'smart', page: '/', transcript: [] });
    const late = { ...turn };
    await closeTurn(turn, 'provider');
    await closeTurn(late, 'left');
    deepStrictEqual([late.closedAt, late.reason], [turn.closedAt, 'provider']);
    strictEqual((await loadTurn(turn.UUID))?.reason, 'provider');
  });

  it('writes no step into a closed row', async () => {
    const turn = await openTurn({ user: owner.uuid, model: 'smart', page: '/', transcript: [] });
    await closeTurn({ ...turn }, 'idle');
    turn.transcript = [{ role: 'user', content: 'Hi' }];
    strictEqual(await saveTurn(turn, 1), false);
    deepStrictEqual((await loadTurn(turn.UUID))?.transcript, []);
  });

  it('touches an open turn, so its idle time starts over, and leaves a closed one', async () => {
    const turn = await openTurn({ user: owner.uuid, model: 'smart', page: '/', transcript: [] });
    const opened = turn.updatedAt;
    await sleep(5);
    await touchTurn(turn);
    ok(turn.updatedAt > opened);
    strictEqual((await loadTurn(turn.UUID))?.updatedAt, turn.updatedAt);
    await closeTurn(turn, 'end');
    const closed = turn.updatedAt;
    await sleep(5);
    await touchTurn(turn);
    strictEqual(turn.updatedAt, closed);
    strictEqual((await loadTurn(turn.UUID))?.updatedAt, closed);
  });

  it('closes a turn as `idle` once its batch waited past `ai.limits.turnTimeout`', async () => {
    await withAI({ limits: { turnTimeout: 1, step: '1h' } }, async () => {
      const turn = await openTurn({ user: owner.uuid, model: 'smart', page: '/', transcript: [] });
      turn.batches = [batch];
      strictEqual(await saveTurn(turn, 1), true);
      strictEqual(await expireTurn(turn), false);
      await sleep(5);
      strictEqual(await expireTurn(turn), true);
      strictEqual((await loadTurn(turn.UUID))?.reason, 'idle');
    });
  });

  it('closes a turn as `lost` once its step stayed unwritten for twice `ai.limits.step`', async () => {
    await withAI({ limits: { turnTimeout: '1h', step: 1000 } }, async () => {
      const turn = await openTurn({ user: owner.uuid, model: 'smart', page: '/', transcript: [] });
      strictEqual(await expireTurn({ ...turn, updatedAt: Date.now() - 1000 }), false);
      strictEqual(await expireTurn({ ...turn, updatedAt: Date.now() - 3000 }), true);
      strictEqual((await loadTurn(turn.UUID))?.reason, 'lost');
    });
  });

  it('names its conflicts', () => {
    deepStrictEqual([turnGone().status, turnGone().data], [409, { code: 'turnGone' }]);
    deepStrictEqual(batchReported().data, { code: 'batchReported' });
    deepStrictEqual(unknownBatch('b9').data, { code: 'unknownBatch' });
    strictEqual(unknownBatch('b9').message, 'Unknown batch `b9`');
  });
});
