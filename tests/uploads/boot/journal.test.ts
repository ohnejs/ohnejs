import { deepStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import '../../../src/uploads/boot/journal.ts';
import { applyHook } from '../../../src/ohne/hooks/apply-hook.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { journalStorage } from '../../../src/uploads/storage/journal.ts';
import { TEMP_PREFIX } from '../../../src/uploads/uploads/path.ts';
import { bytes, db, storage, text } from '../_fixture.ts';

describe('the schema:synced hook', () => {
  it('drains the pending journal, then clears whatever is still staged', async () => {
    storage.objects.set(`${TEMP_PREFIX}/staged`, bytes('staged'));
    storage.objects.set(`${TEMP_PREFIX}/abandoned`, bytes('abandoned'));
    storage.objects.set('photos/keep.jpg', bytes('keep'));
    await db.transaction(
      (tx) =>
        journalStorage(tx, { op: 'move', from: `${TEMP_PREFIX}/staged`, to: 'photos/staged.jpg' }),
      'immediate',
    );

    await applyHook('schema:synced', { deletions: [], warnings: [] });

    deepStrictEqual(await queryUntyped('UploadsJournal').findMany(), []);
    deepStrictEqual([...storage.objects.keys()].sort(), ['photos/keep.jpg', 'photos/staged.jpg']);
    strictEqual(text(storage.objects.get('photos/staged.jpg')), 'staged');
  });
});
