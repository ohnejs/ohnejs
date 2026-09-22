import { strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { CollectionDefinition } from '../../../src/ohne/collections/define-collection.ts';

import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { DEFAULTS } from '../../../src/ohne/layers/config.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import UploadsJournal from '../../../src/uploads/collections/UploadsJournal.ts';

usePrinter().configure({ stream: { write: () => true } });
useLayers().add({ path: '/journal-collection', defaults: DEFAULTS, input: {} });

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);

/**
 * Registers `UploadsJournal` without `drop` and syncs.
 */
async function syncJournal(...drop: string[]): Promise<void> {
  const fields = { ...UploadsJournal.fields } as Record<string, unknown>;
  for (const name of drop) delete fields[name];
  const collection = { ...UploadsJournal, fields } as CollectionDefinition;
  useCollections().register('UploadsJournal', { name: 'UploadsJournal', collection });
  await syncDatabase(db, dialect, {
    desired: buildDesiredSchema(useCollections(), useFields() as never),
  });
}

describe('UploadsJournal', () => {
  it('lands sequence on entries still pending from before it', async () => {
    await syncJournal('sequence');
    await queryUntyped('UploadsJournal').createOrThrow({ op: 'delete', from: 'old.txt', to: null });
    await syncJournal();
    const old = await db.queryOne<{ sequence: unknown }>(
      'SELECT "sequence" FROM "UploadsJournal" WHERE "from" = ?',
      ['old.txt'],
    );
    strictEqual(old?.sequence, null);
  });
});
