import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { TurnBatch } from '../../../src/ai/turns/state.ts';

import {
  batchReported,
  claimStep,
  closeTurn,
  loadTurn,
  openTurn,
  saveTurn,
  turnGone,
  unknownBatch,
} from '../../../src/ai/turns/state.ts';
import { signIn } from '../_fixture.ts';

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

  it('closes a turn whatever step it sits at', async () => {
    const turn = await openTurn({ user: owner.uuid, model: 'smart', page: '/', transcript: [] });
    await closeTurn(turn);
    ok(turn.closedAt !== null);
    strictEqual((await loadTurn(turn.UUID))?.closedAt, turn.closedAt);
  });

  it('names its conflicts', () => {
    deepStrictEqual([turnGone().status, turnGone().data], [409, { code: 'turnGone' }]);
    deepStrictEqual(batchReported().data, { code: 'batchReported' });
    deepStrictEqual(unknownBatch('b9').data, { code: 'unknownBatch' });
    strictEqual(unknownBatch('b9').message, 'Unknown batch `b9`');
  });
});
