import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import datePatternField from '../../../src/base/fields/date-pattern.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';

usePrinter().configure({ stream: { write: () => true } });

useFields().register('datePattern', { name: 'datePattern', fieldType: datePatternField });

useCollections().register('PatternAccounts', {
  name: 'PatternAccounts',
  collection: { fields: { name: field('text'), pattern: field('datePattern') } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

describe('datePattern field', () => {
  it('stores a pattern as sent', async () => {
    const record = await queryUntyped('PatternAccounts').createOrThrow({
      name: 'Anduin',
      pattern: 'LL',
    });
    strictEqual(record.pattern, 'LL');
  });

  it('rejects a blank pattern', async () => {
    const result = await queryUntyped('PatternAccounts').create({ name: 'Blank', pattern: '   ' });
    strictEqual(result.ok, false);
    ok(!result.ok);
    strictEqual(result.errors.pattern, 'validation.emptyValue');
  });

  it('accepts 64 characters and rejects 65, naming the limit', async () => {
    const record = await queryUntyped('PatternAccounts').createOrThrow({
      name: 'Edge',
      pattern: 'Y'.repeat(64),
    });
    strictEqual(record.pattern, 'Y'.repeat(64));

    const result = await queryUntyped('PatternAccounts').create({
      name: 'Over',
      pattern: 'Y'.repeat(65),
    });
    strictEqual(result.ok, false);
    ok(!result.ok);
    deepStrictEqual(result.errors.pattern, {
      key: 'validation.maxLength',
      params: { max: 64 },
    });
  });
});
