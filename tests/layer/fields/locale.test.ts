import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import localeField from '../../../src/layer/fields/locale.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../src/ohne/layers/use-layers.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';

usePrinter().configure({ stream: { write: () => true } });

useLayers().add({
  path: '/locale-test',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useFields().register('locale', { name: 'locale', fieldType: localeField });

useCollections().register('LocaleAccounts', {
  name: 'LocaleAccounts',
  collection: { fields: { name: field('text'), locale: field('locale') } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

describe('locale field', () => {
  it('stores a configured content locale', async () => {
    const record = await queryUntyped('LocaleAccounts').createOrThrow({
      name: 'Ada',
      locale: 'de',
    });
    strictEqual(record.locale, 'de');
  });

  it('rejects a locale outside `collections.locales`, naming it', async () => {
    const result = await queryUntyped('LocaleAccounts').create({ name: 'Ghost', locale: 'fr' });
    strictEqual(result.ok, false);
    ok(!result.ok);
    deepStrictEqual(result.errors.locale, { key: 'auth.unknownLocale', params: { locale: 'fr' } });
  });
});
