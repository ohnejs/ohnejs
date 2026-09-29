import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { SSEMessage } from '../../../../src/utils/index.ts';

import {
  applyTurnEvent,
  clearTurns,
  currentTurn,
  markTurn,
  nextStep,
  openTurn,
  pendingBatch,
  reduceTurn,
  settleBatch,
  type Turn,
  turns,
} from '../../../../src/ai/dashboard/components/turn-store.ts';

const event = (name: string, data: unknown): SSEMessage => ({
  event: name,
  data: JSON.stringify(data),
  id: '',
});

const fresh = (): Turn => ({
  input: 'retire every character below level 10',
  skill: null,
  id: null,
  status: 'streaming',
  steps: [{ text: '', batch: null }],
  reason: null,
  wait: null,
});

const PROPOSALS = [
  { route: 'POST /collections/characters/verdicts', tier: 'read', body: { where: {} } },
];

describe('reduceTurn', () => {
  it('names the turn, streams text into the last step, and waits on a batch', () => {
    let turn = reduceTurn(fresh(), event('turn', { id: 'turn-1' }));
    turn = reduceTurn(turn, event('text', { text: 'Let me ' }));
    turn = reduceTurn(turn, event('text', { text: 'check.' }));
    turn = reduceTurn(turn, event('batch', { id: 'b1', kind: 'read', proposals: PROPOSALS }));
    turn = reduceTurn(turn, event('done', { reason: 'batch' }));
    strictEqual(turn.id, 'turn-1');
    strictEqual(turn.status, 'waiting');
    strictEqual(turn.steps.length, 1);
    strictEqual(turn.steps[0].text, 'Let me check.');
    deepStrictEqual(turn.steps[0].batch, {
      id: 'b1',
      kind: 'read',
      proposals: PROPOSALS,
      results: null,
    });
  });

  it('records a retry wait and clears it once text streams again', () => {
    let turn = reduceTurn(fresh(), event('retry', { wait: 6000 }));
    strictEqual(turn.wait, 6000);
    turn = reduceTurn(turn, event('text', { text: 'Back.' }));
    strictEqual(turn.wait, null);
  });

  it('closes the turn with the done reason when no batch follows', () => {
    const turn = reduceTurn(fresh(), event('done', { reason: 'end' }));
    strictEqual(turn.status, 'closed');
    strictEqual(turn.reason, 'end');
  });

  it('fails the turn with the error code', () => {
    const turn = reduceTurn(fresh(), event('error', { code: 'timeout' }));
    strictEqual(turn.status, 'error');
    strictEqual(turn.reason, 'timeout');
  });

  it('leaves the turn as it was on an unknown event or a malformed payload', () => {
    const turn = fresh();
    strictEqual(reduceTurn(turn, event('ping', {})), turn);
    strictEqual(reduceTurn(turn, { event: 'text', data: '{not json', id: '' }), turn);
    strictEqual(reduceTurn(turn, event('batch', { id: 'b1', kind: 'wild', proposals: [] })), turn);
    strictEqual(reduceTurn(turn, event('text', { text: 42 })), turn);
  });

  it('never mutates the turn it was given', () => {
    const turn = fresh();
    reduceTurn(turn, event('text', { text: 'Hello' }));
    strictEqual(turn.steps[0].text, '');
  });
});

describe('turn store', () => {
  it('opens a turn, applies its events, settles the batch, and opens the next step', () => {
    clearTurns();
    openTurn('translate every epic item to German', 'translate-items');
    applyTurnEvent(event('turn', { id: 'turn-2' }));
    applyTurnEvent(event('batch', { id: 'b2', kind: 'write', proposals: PROPOSALS }));
    applyTurnEvent(event('done', { reason: 'batch' }));
    deepStrictEqual(pendingBatch()?.id, 'b2');
    markTurn('sending');
    strictEqual(pendingBatch(), undefined);
    settleBatch([{ status: 200 }]);
    nextStep();
    const turn = currentTurn();
    strictEqual(turn?.status, 'streaming');
    strictEqual(turn?.skill, 'translate-items');
    strictEqual(turn?.steps.length, 2);
    deepStrictEqual(turn?.steps[0].batch?.results, [{ status: 200 }]);
    strictEqual(turn?.steps[1].text, '');
  });

  it('keeps earlier turns and only touches the last one', () => {
    clearTurns();
    openTurn('first');
    applyTurnEvent(event('done', { reason: 'end' }));
    openTurn('second');
    applyTurnEvent(event('text', { text: 'Hi' }));
    strictEqual(turns.value.length, 2);
    strictEqual(turns.value[0].status, 'closed');
    strictEqual(turns.value[1].steps[0].text, 'Hi');
  });

  it('does nothing before the first question', () => {
    clearTurns();
    applyTurnEvent(event('text', { text: 'lost' }));
    markTurn('error', 'network');
    strictEqual(turns.value.length, 0);
    strictEqual(currentTurn(), undefined);
  });
});
