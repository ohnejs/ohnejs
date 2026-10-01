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
import Uploads from '../../../src/uploads/collections/Uploads.ts';
import directoryNameField from '../../../src/uploads/fields/directory-name.ts';
import fileNameField from '../../../src/uploads/fields/file-name.ts';

usePrinter().configure({ stream: { write: () => true } });
useLayers().add({ path: '/uploads-collection', defaults: DEFAULTS, input: {} });
useFields().register('fileName', { name: 'fileName', fieldType: fileNameField });
useFields().register('directoryName', { name: 'directoryName', fieldType: directoryNameField });

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);

/**
 * Registers `Uploads` without `drop` and syncs; `author` always goes, since this database has no `Users`.
 */
async function syncUploads(...drop: string[]): Promise<void> {
  const fields = { ...Uploads.fields } as Record<string, unknown>;
  for (const name of ['author', ...drop]) delete fields[name];
  const collection = { ...Uploads, fields } as CollectionDefinition;
  useCollections().register('Uploads', { name: 'Uploads', collection });
  await syncDatabase(db, dialect, {
    desired: buildDesiredSchema(useCollections(), useFields() as never),
  });
}

describe('Uploads', () => {
  it('lands private on rows from before it, as public', async () => {
    await syncUploads('private');
    await queryUntyped('Uploads').createOrThrow({ kind: 'folder', directory: '', name: 'old' });
    await syncUploads();
    const old = await db.queryOne<{ private: unknown }>(
      'SELECT "private" FROM "Uploads" WHERE "name" = ?',
      ['old'],
    );
    strictEqual(old?.private, null);
  });
});
