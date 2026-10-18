import { rejects, strictEqual } from 'node:assert';
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

useCollections().register('Keeps', {
  name: 'Keeps',
  collection: {
    fields: {
      name: field('text'),
      address: field('object', { fields: { city: field('text') } }),
      notes: field('object', { nullable: true, fields: { body: field('text') } }),
    },
  },
});

const db = await connectTest();
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const failsWith = (field: string, key: string) => (error: unknown) =>
  isValidationError(error) && error.errors[field] === key;

describe('object writes', () => {
  it('requires an object that is not nullable', async () => {
    await rejects(
      queryUntyped('Keeps').createOrThrow({ name: 'Karazhan' }),
      failsWith('address', 'validation.required'),
    );
    await rejects(
      queryUntyped('Keeps').createOrThrow({ name: 'Karazhan', address: null }),
      failsWith('address', 'validation.notNullable'),
    );
  });

  it('lets a nullable object stay empty, and clears it with `null`', async () => {
    const keep = await queryUntyped('Keeps').createOrThrow({
      name: 'Grim Batol',
      address: { city: 'Twilight Highlands' },
    });
    strictEqual(keep.notes, null);
    const update = (input: Record<string, unknown>) =>
      queryUntyped('Keeps').where({ UUID: keep.UUID }).updateOrThrow(input);
    const [noted] = await update({ notes: { body: 'Dragonmaw' } });
    strictEqual((noted!.notes as { body: string }).body, 'Dragonmaw');
    const [cleared] = await update({ notes: null });
    strictEqual(cleared!.notes, null);
  });

  it('refuses to clear a required object on update', async () => {
    const keep = await queryUntyped('Keeps').createOrThrow({
      name: 'Lordaeron',
      address: { city: 'Undercity' },
    });
    await rejects(
      queryUntyped('Keeps').where({ UUID: keep.UUID }).updateOrThrow({ address: null }),
      failsWith('address', 'validation.notNullable'),
    );
  });
});
