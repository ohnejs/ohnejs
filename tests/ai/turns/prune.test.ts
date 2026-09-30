import { deepStrictEqual, strictEqual } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { pruneTurns } from '../../../src/ai/turns/prune.ts';
import { loadTurn, openTurn } from '../../../src/ai/turns/state.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { isNull } from '../../../src/utils/is/is-null.ts';
import { isUndefined } from '../../../src/utils/is/is-undefined.ts';
import { signIn, withAI } from '../_fixture.ts';

const owner = await signIn('prune@example.com', ['asker']);

const DAY = 86_400_000;

/**
 * Opens a turn, closed `daysAgo` days before `now` unless `daysAgo` is `null`, and returns its id.
 */
async function turnClosed(daysAgo: number | null, now: number): Promise<string> {
  const { UUID } = await openTurn({
    user: owner.uuid,
    model: 'smart',
    page: '/',
    input: 'Hi',
    transcript: [],
  });
  if (!isNull(daysAgo)) {
    await queryUntyped('AITurns')
      .where({ UUID })
      .updateOrThrow({ closedAt: now - daysAgo * DAY, reason: 'end' });
  }
  return UUID;
}

/**
 * Which of `ids` still have a row.
 */
async function kept(ids: string[]): Promise<string[]> {
  const found = await Promise.all(ids.map(loadTurn));
  return ids.filter((_, index) => !isUndefined(found[index]));
}

describe('pruneTurns', () => {
  beforeEach(() =>
    queryUntyped('AITurns')
      .unscoped()
      .where({ step: { atLeast: 0 } })
      .delete(),
  );

  it('deletes closed turns older than `ai.audit.retain`, keeping open and recent ones', async () => {
    const now = Date.now();
    await withAI({ audit: { retain: '30d' } }, async () => {
      const old = await turnClosed(31, now);
      const recent = await turnClosed(29, now);
      const open = await turnClosed(null, now);
      strictEqual(await pruneTurns(now), 1);
      deepStrictEqual(await kept([old, recent, open]), [recent, open]);
    });
  });

  it('prunes at most once a minute', async () => {
    const now = Date.now();
    await withAI({ audit: { retain: '1d' } }, async () => {
      strictEqual(await pruneTurns(now), 0);
      const old = await turnClosed(2, now);
      strictEqual(await pruneTurns(now + 59_000), 0);
      deepStrictEqual(await kept([old]), [old]);
      strictEqual(await pruneTurns(now + 60_000), 1);
      deepStrictEqual(await kept([old]), []);
    });
  });

  it('deletes an open turn left quiet once it would have closed longer than `retain` ago', async () => {
    const now = Date.now();
    await withAI(
      { audit: { retain: '1d' }, limits: { turnTimeout: '1h', step: '1m' } },
      async () => {
        const abandoned = await turnClosed(null, now);
        strictEqual(await pruneTurns(now + DAY + 3_599_000), 0);
        deepStrictEqual(await kept([abandoned]), [abandoned]);
        strictEqual(await pruneTurns(now + DAY + 3_661_000), 1);
        deepStrictEqual(await kept([abandoned]), []);
      },
    );
  });

  it('keeps every turn under `retain: false`', async () => {
    const now = Date.now();
    await withAI({ audit: { retain: false } }, async () => {
      const ancient = await turnClosed(10_000, now);
      strictEqual(await pruneTurns(now), 0);
      deepStrictEqual(await kept([ancient]), [ancient]);
    });
  });
});
