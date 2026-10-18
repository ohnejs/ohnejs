import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { isValidationError } from '../../../../src/ohne/query/write/errors.ts';
import { connectTest, dialect } from '../../../_dialect.ts';

useCollections().register('Heralds', {
  name: 'Heralds',
  collection: {
    fields: {
      inbox: field('email', { unique: true }),
      backup: field('email', { nullable: true }),
    },
  },
});

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const failsWith = (key: string) => (error: unknown) =>
  isValidationError(error) && error.errors.inbox === key;

describe('email writes', () => {
  it('stores the address trimmed and lowercased', async () => {
    const herald = await queryUntyped('Heralds').createOrThrow({
      inbox: ' Thrall@Orgrimmar.Example ',
      backup: null,
    });
    deepStrictEqual([herald.inbox, herald.backup], ['thrall@orgrimmar.example', null]);
  });

  it('refuses a case variant as taken', async () => {
    await queryUntyped('Heralds').createOrThrow({ inbox: 'jaina@dalaran.example' });
    await rejects(
      queryUntyped('Heralds').createOrThrow({ inbox: 'JAINA@Dalaran.example' }),
      failsWith('validation.notUnique'),
    );
  });

  it('refuses a final-sigma variant of a Greek domain as taken', async () => {
    await queryUntyped('Heralds').createOrThrow({ inbox: 'z@example.οδοσ' });
    await rejects(
      queryUntyped('Heralds').createOrThrow({ inbox: 'Z@EXAMPLE.ΟΔΟΣ' }),
      failsWith('validation.notUnique'),
    );
  });

  it('refuses a look-alike with a fullwidth or invisible character', async () => {
    for (const inbox of ['jaina@ｄａｌａｒａｎ.example', 'jaina@dal\u034faran.example']) {
      await rejects(
        queryUntyped('Heralds').createOrThrow({ inbox }),
        failsWith('validation.invalidEmail'),
      );
    }
  });

  it('refuses the empty string and an address with a query', async () => {
    await rejects(
      queryUntyped('Heralds').createOrThrow({ inbox: '' }),
      failsWith('validation.invalidEmail'),
    );
    await rejects(
      queryUntyped('Heralds').createOrThrow({ inbox: 'a@x.example?subject=hi' }),
      failsWith('validation.invalidEmail'),
    );
  });

  it('stores an IDN domain without punycode', async () => {
    const herald = await queryUntyped('Heralds').createOrThrow({ inbox: 'Jürgen@München.de' });
    strictEqual(herald.inbox, 'jürgen@münchen.de');
  });
});
