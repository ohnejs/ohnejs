import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Proposal } from '../../../../src/ai/dashboard/components/turn-store.ts';
import type { SSEMessage } from '../../../../src/utils/index.ts';

import {
  applyTurnEvent,
  batchOutcome,
  clearTurns,
  currentTurn,
  eventPayload,
  markTurn,
  nextStep,
  openTurn,
  pendingBatch,
  reduceTurn,
  runsUnasked,
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
  flow: null,
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

  it('starts a step for a flow node, reusing a step nothing streamed into yet', () => {
    let turn = reduceTurn(fresh(), event('node', { flow: 'raid-officer', node: 'triage' }));
    strictEqual(turn.steps.length, 1);
    turn = reduceTurn(turn, event('text', { text: 'Checking.' }));
    turn = reduceTurn(turn, event('node', { flow: 'raid-officer', node: 'roster' }));
    turn = reduceTurn(turn, event('text', { text: 'Nobody.' }));
    deepStrictEqual(
      turn.steps.map((step) => step.text),
      ['Checking.', 'Nobody.'],
    );
  });

  it('keeps the model a batch pins its transforms to', () => {
    const pinned = event('batch', {
      id: 'b1',
      kind: 'write',
      proposals: PROPOSALS,
      pinned: 'fast',
    });
    strictEqual(reduceTurn(fresh(), pinned).steps[0].batch?.pinned, 'fast');
    const plain = event('batch', { id: 'b1', kind: 'write', proposals: PROPOSALS, pinned: 3 });
    strictEqual('pinned' in (reduceTurn(fresh(), plain).steps[0].batch ?? {}), false);
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
    openTurn('translate every epic item to German', { skill: 'translate-items' });
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

describe('eventPayload', () => {
  it('parses an object, and answers an empty one for anything else', () => {
    deepStrictEqual(eventPayload('{"text":"Hello"}'), { text: 'Hello' });
    deepStrictEqual(eventPayload('[1]'), {});
    deepStrictEqual(eventPayload('nope'), {});
  });
});

describe('runsUnasked', () => {
  const read: Proposal = { route: 'POST /collections/items/query', tier: 'read', body: {} };
  const rename: Proposal = {
    route: 'PATCH /collections/items/[uuid]',
    tier: 'write',
    params: { uuid: 'a' },
    body: { name: 'Ashbringer' },
  };
  const of = (...proposals: Proposal[]) => ({
    id: 'b',
    kind: 'write' as const,
    proposals,
    results: null,
  });

  it('runs reads and writes tagged `auto`, and asks for any other write', () => {
    strictEqual(runsUnasked(of(read)), true);
    strictEqual(runsUnasked(of(read, { ...rename, auto: true })), true);
    strictEqual(runsUnasked(of(read, rename)), false);
    strictEqual(runsUnasked(of({ ...rename, auto: true }, rename)), false);
  });
});

describe('batchOutcome', () => {
  const read: Proposal = { route: 'POST /collections/items/query', tier: 'read', body: {} };
  const rename: Proposal = {
    route: 'PATCH /collections/items/[uuid]',
    tier: 'write',
    params: { uuid: 'a' },
    body: { name: 'Ashbringer' },
  };
  const retire: Proposal = {
    route: 'PATCH /collections/characters/[uuid]',
    tier: 'write',
    where: { level: { lessThan: 10 } },
    body: { status: 'retired' },
  };

  it('lists the reads that ran in a batch that also writes, and tallies the writes', () => {
    const outcome = batchOutcome({
      id: 'b',
      kind: 'write',
      proposals: [read, rename, retire, read],
      results: [
        { status: 200, body: { total: 3 } },
        { status: 0 },
        { status: 404, body: { total: 4, failed: 1, unknown: 2 } },
        { status: 403 },
      ],
    });
    deepStrictEqual(outcome.reads, [
      { proposal: read, result: { status: 200, body: { total: 3 } } },
      { proposal: read, result: { status: 403 } },
    ]);
    deepStrictEqual(outcome.writes, { proposals: 2, sent: 4, failed: 1, unknown: 3, declined: 0 });
  });

  it('counts declines, answers no tally without writes, and skips a declined read', () => {
    const declined = batchOutcome({
      id: 'b',
      kind: 'write',
      proposals: [read, rename],
      results: [{ status: 200 }, { declined: true, note: 'not now' }],
    });
    deepStrictEqual(declined.writes, { proposals: 1, sent: 0, failed: 0, unknown: 0, declined: 1 });
    const reads = batchOutcome({
      id: 'b',
      kind: 'read',
      proposals: [read, read],
      results: [{ declined: true }, { status: 200 }],
    });
    deepStrictEqual(reads, { reads: [{ proposal: read, result: { status: 200 } }], writes: null });
  });

  it('counts a transform by the records its folded answer names', () => {
    const shout: Proposal = {
      route: 'PATCH /collections/items/[uuid]',
      tier: 'write',
      where: {},
      transform: { fields: ['name'], instruction: 'Shout it.' },
    };
    const outcome = batchOutcome({
      id: 'b',
      kind: 'write',
      proposals: [shout],
      results: [{ status: 422, body: { transformed: 3, skipped: 4, failed: 1, unknown: 0 } }],
    });
    deepStrictEqual(outcome.writes, { proposals: 1, sent: 3, failed: 1, unknown: 0, declined: 0 });
  });

  it('answers nothing for a batch still waiting', () => {
    deepStrictEqual(batchOutcome({ id: 'b', kind: 'write', proposals: [rename], results: null }), {
      reads: [],
      writes: null,
    });
  });
});
