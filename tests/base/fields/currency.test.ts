import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldSearchContext } from '../../../src/ohne/fields/define-field.ts';

import currencyField from '../../../src/base/fields/currency.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../src/ohne/database/use-database.ts';
import { searchHook } from '../../../src/ohne/fields/field-search.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFields } from '../../../src/ohne/fields/use-fields.ts';
import { usePrinter } from '../../../src/ohne/printer/use-printer.ts';
import { queryUntyped } from '../../../src/ohne/query/query.ts';
import { connectTest, dialect } from '../../_dialect.ts';

usePrinter().configure({ stream: { write: () => true } });

useFields().register('currency', { name: 'currency', fieldType: currencyField });

useCollections().register('Vaults', {
  name: 'Vaults',
  collection: { fields: { name: field('text'), coin: field('currency') } },
});

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

describe('currency field', () => {
  it('stores a circulating code in upper case', async () => {
    const vault = await queryUntyped('Vaults').createOrThrow({ name: 'Stormwind', coin: 'eur' });
    strictEqual(vault.coin, 'EUR');
  });

  it('rejects a fund, a metal and a withdrawn code', async () => {
    for (const coin of ['CLF', 'XAU', 'HRK']) {
      const result = await queryUntyped('Vaults').create({ name: coin, coin });
      ok(!result.ok);
      strictEqual(result.errors.coin, 'validation.invalidCurrency');
    }
  });

  it('matches the code, or a word start of its name', () => {
    const search = (token: string) =>
      searchHook(currencyField)!({
        name: 'coin',
        options: {},
        token,
      } as unknown as FieldSearchContext);
    deepStrictEqual(search('eur'), { in: ['EUR'] });
    deepStrictEqual(search('yen'), { in: ['JPY'] });
  });
});
