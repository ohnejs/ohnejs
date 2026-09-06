import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import timezoneField from '../../../src/layer/fields/timezone.ts';
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

useFields().register('timezone', { name: 'timezone', fieldType: timezoneField });

useCollections().register('TimezoneAccounts', {
  name: 'TimezoneAccounts',
  collection: { fields: { name: field('text'), timezone: field('timezone') } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

describe('timezone field', () => {
  it('stores an IANA name, `UTC`, and an alias as sent', async () => {
    for (const timezone of ['Europe/Berlin', 'UTC', 'US/Pacific']) {
      const record = await queryUntyped('TimezoneAccounts').createOrThrow({
        name: timezone,
        timezone,
      });
      strictEqual(record.timezone, timezone);
    }
  });

  it('rejects a name `Intl` does not resolve, naming it', async () => {
    for (const timezone of ['local', 'Mars/Olympus']) {
      const result = await queryUntyped('TimezoneAccounts').create({ name: timezone, timezone });
      strictEqual(result.ok, false);
      ok(!result.ok);
      deepStrictEqual(result.errors.timezone, {
        key: 'auth.invalidTimezone',
        params: { timezone },
      });
    }
  });
});
