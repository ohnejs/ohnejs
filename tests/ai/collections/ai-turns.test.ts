import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import AITurnsCollection from '../../../src/ai/collections/AITurns.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import '../_fixture.ts';

/**
 * A stored user to own turns.
 */
async function createUser(email: string): Promise<string> {
  const user = await queryUntyped('Users').createOrThrow({ email, password: 'pw-123456' });
  return user.UUID as string;
}

describe('the AITurns collection', () => {
  it('opens a turn with an empty transcript, no batches, no steps and no spend', async () => {
    const user = await createUser('opens@example.com');
    const turn = await queryUntyped('AITurns').createOrThrow({ user, model: 'smart', page: '/' });
    deepStrictEqual(
      {
        transcript: JSON.parse(turn.transcript as string),
        batches: JSON.parse(turn.batches as string),
        step: turn.step,
        usage: JSON.parse(turn.usage as string),
        closedAt: turn.closedAt,
      },
      {
        transcript: [],
        batches: [],
        step: 0,
        usage: { fresh: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
        closedAt: null,
      },
    );
  });

  it("deletes a person's turns with the person", async () => {
    const user = await createUser('gone@example.com');
    await queryUntyped('AITurns').createOrThrow({ user, model: 'smart', page: '/' });
    await queryUntyped('Users').where({ UUID: user }).delete();
    strictEqual(await queryUntyped('AITurns').where({ user }).count(), 0);
  });

  it('is never exposed over the API', () => {
    strictEqual(AITurnsCollection.api, undefined);
  });
});
