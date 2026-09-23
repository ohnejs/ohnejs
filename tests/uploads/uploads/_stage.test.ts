import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { journalStorage } from '../../../src/uploads/storage/journal.ts';
import {
  claimStaged,
  discardStaged,
  stageUpload,
  sweepStaged,
} from '../../../src/uploads/uploads/_stage.ts';
import { bytes, db, storage, stream, text } from '../_fixture.ts';

const stage = () => stageUpload(stream(bytes('hello')), { type: 'text/plain' });

const staged = () =>
  queryUntyped('UploadsJournal').where({ op: 'stage' }).pluck('from') as Promise<string[]>;

describe('staging', () => {
  it('journals the temp object until its row claims it', async () => {
    const { temp } = await stage();
    deepStrictEqual(await staged(), [temp]);

    await db.transaction(async (tx) => {
      await claimStaged(tx, temp);
      await journalStorage(tx, { op: 'delete', from: temp });
    }, 'immediate');
    deepStrictEqual(await staged(), []);
    await sweepStaged(Date.now() + 1);
  });

  it('keeps a fresh staged object another instance is still committing', async () => {
    const { temp } = await stage();

    await sweepStaged(Date.now() - 60_000);

    strictEqual(text(storage.objects.get(temp)), 'hello');
    await db.transaction((tx) => claimStaged(tx, temp), 'immediate');
    await discardStaged(temp);
  });

  it('fails the commit of a staged object a sweep claimed first', async () => {
    const { temp } = await stage();

    await sweepStaged(Date.now() + 1);

    strictEqual(storage.objects.has(temp), false);
    await rejects(
      db.transaction((tx) => claimStaged(tx, temp), 'immediate'),
      /was swept before its row committed/,
    );
    deepStrictEqual(await queryUntyped('UploadsJournal').findMany(), []);
  });

  it('keeps the entry when the discard cannot delete the object', async () => {
    const { temp } = await stage();
    storage.failNext('delete');

    await discardStaged(temp);

    ok(storage.objects.has(temp));
    deepStrictEqual(await staged(), [temp]);
    await sweepStaged(Date.now() + 1);
    strictEqual(storage.objects.has(temp), false);
    deepStrictEqual(await queryUntyped('UploadsJournal').findMany(), []);
  });
});
