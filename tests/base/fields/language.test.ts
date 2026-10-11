import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import languageField from '../../../src/base/fields/language.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { fieldBaseType, fieldJSONType } from '../../../src/ohne/fields/value-type.ts';
import { useMessages } from '../../../src/ohne/messages/use-messages.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { createTypeImports } from '../../../src/utils/codegen/index.ts';

usePrinter().configure({ stream: { write: () => true } });

useFields().register('language', { name: 'language', fieldType: languageField });
useMessages().register('en', {});
useMessages().register('de', {});
useMessages().register('de-AT', {});

useCollections().register('LanguageAccounts', {
  name: 'LanguageAccounts',
  collection: { fields: { name: field('text'), language: field('language') } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

describe('language field', () => {
  it('stores a registered catalog language', async () => {
    const record = await queryUntyped('LanguageAccounts').createOrThrow({
      name: 'Anduin',
      language: 'de',
    });
    strictEqual(record.language, 'de');
  });

  it('canonicalizes the tag before storing it', async () => {
    const record = await queryUntyped('LanguageAccounts').createOrThrow({
      name: 'Bolvar',
      language: 'de-at',
    });
    strictEqual(record.language, 'de-AT');
  });

  it('rejects a well-formed tag without a catalog, naming its canonical form', async () => {
    const result = await queryUntyped('LanguageAccounts').create({
      name: 'Ghost',
      language: 'xx-yy',
    });
    strictEqual(result.ok, false);
    ok(!result.ok);
    deepStrictEqual(result.errors.language, {
      key: 'auth.unknownLanguage',
      params: { language: 'xx-YY' },
    });
  });

  it('rejects a malformed tag, naming the submitted value', async () => {
    const result = await queryUntyped('LanguageAccounts').create({
      name: 'Junk',
      language: 'garbage!',
    });
    strictEqual(result.ok, false);
    ok(!result.ok);
    deepStrictEqual(result.errors.language, {
      key: 'auth.unknownLanguage',
      params: { language: 'garbage!' },
    });
  });
});

describe('language types', () => {
  const imports = createTypeImports('/app/.ohne/shared');
  const args = { fieldType: languageField, name: 'language', options: {}, imports };

  it('emits the registered languages inline as JSON', () => {
    strictEqual(fieldJSONType({ ...args, mirror: () => undefined }).base, "'de' | 'de-AT' | 'en'");
  });

  it('emits `string` as JSON when no language is registered', () => {
    const catalogs = useMessages().all();
    useMessages().clear();
    try {
      strictEqual(fieldJSONType({ ...args, mirror: () => undefined }).base, 'string');
    } finally {
      for (const [language, catalog] of Object.entries(catalogs)) {
        useMessages().register(language, catalog);
      }
    }
  });

  it('keeps the generated language union on the server', () => {
    strictEqual(fieldBaseType({ ...args, fieldDir: '/app/fields' }).base, 'GeneratedLanguage');
  });
});
