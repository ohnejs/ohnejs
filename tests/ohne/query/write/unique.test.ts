import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { UniqueProbe } from '../../../../src/ohne/query/pipeline/run-record.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import {
  checkChildUnique,
  checkCompositeUnique,
  checkUnique,
  uniqueRaceErrors,
} from '../../../../src/ohne/query/write/unique.ts';

useCollections().register('URUnique', {
  name: 'URUnique',
  collection: { fields: { slug: field('text', { unique: true }) } },
});
useCollections().register('URPlain', {
  name: 'URPlain',
  collection: { fields: { title: field('text') } },
});
useCollections().register('URComposite', {
  name: 'URComposite',
  collection: {
    fields: { email: field('text'), tenantId: field('text') },
    compositeIndexes: [{ fields: ['email', 'tenantId'], unique: true }],
  },
});
useCollections().register('URChild', {
  name: 'URChild',
  collection: {
    fields: { items: field('repeater', { fields: { slug: field('text', { unique: true }) } }) },
  },
});

describe('uniqueRaceErrors', () => {
  it('names every top-level unique field', () => {
    deepStrictEqual(uniqueRaceErrors(queryMetadata('URUnique'), null), {
      slug: 'validation.notUnique',
    });
  });

  it('names every field a unique composite covers', () => {
    deepStrictEqual(uniqueRaceErrors(queryMetadata('URComposite'), null), {
      email: 'validation.notUnique',
      tenantId: 'validation.notUnique',
    });
  });

  it('falls back to a root error when no field is unique', () => {
    deepStrictEqual(uniqueRaceErrors(queryMetadata('URPlain'), null), {
      '': 'validation.notUnique',
    });
  });

  it('keys a parsed main-table target at its exact field', () => {
    deepStrictEqual(
      uniqueRaceErrors(queryMetadata('URComposite'), { table: 'URComposite', columns: ['email'] }),
      { email: 'validation.notUnique' },
    );
  });

  it('falls back when a target column maps to no field', () => {
    deepStrictEqual(
      uniqueRaceErrors(queryMetadata('URUnique'), { table: 'URUnique', columns: ['ghost'] }),
      { slug: 'validation.notUnique' },
    );
  });

  it('keys a child-table target at the subfield dot path, system columns skipped', () => {
    deepStrictEqual(
      uniqueRaceErrors(queryMetadata('URChild'), {
        table: 'URChild_items',
        columns: ['_parentUUID', 'slug'],
      }),
      { 'items.slug': 'validation.notUnique' },
    );
  });
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});
await db.run('INSERT INTO "URUnique" ("UUID","_updatedAt","slug") VALUES (?,?,?)', [
  'u1',
  1,
  'taken',
]);
await db.run(
  'INSERT INTO "URComposite" ("UUID","_updatedAt","email","tenantId") VALUES (?,?,?,?)',
  ['c1', 1, 'a@x', 't1'],
);
await db.run('INSERT INTO "URChild" ("UUID","_updatedAt") VALUES (?,?)', ['p1', 1]);
await db.run(
  'INSERT INTO "URChild_items" ("UUID","_parentUUID","_parentPosition","slug") VALUES (?,?,?,?)',
  ['i1', 'p1', 0, 'dup'],
);

const bulk = Array.from({ length: 33_000 }, (_, index) => `bulk-${index}`);

describe('unique prechecks under a bulk exclusion', () => {
  it('probes with a 33k-row exclusion without overrunning the parameter cap', async () => {
    deepStrictEqual(
      await checkUnique(db, dialect, queryMetadata('URUnique'), { slug: 'taken' }, 'en', bulk),
      { slug: 'validation.notUnique' },
    );
    deepStrictEqual(
      await checkUnique(db, dialect, queryMetadata('URUnique'), { slug: 'taken' }, 'en', [
        ...bulk,
        'u1',
      ]),
      {},
    );
  });

  it('filters owned composite rows in memory', async () => {
    const columns = { email: 'a@x', tenantId: 't1' };
    deepStrictEqual(
      await checkCompositeUnique(db, dialect, queryMetadata('URComposite'), columns, 'en', bulk),
      { email: 'validation.notUnique', tenantId: 'validation.notUnique' },
    );
    deepStrictEqual(
      await checkCompositeUnique(db, dialect, queryMetadata('URComposite'), columns, 'en', [
        ...bulk,
        'c1',
      ]),
      {},
    );
  });

  it('filters owned child rows in memory', async () => {
    const probe: UniqueProbe = {
      table: 'URChild_items',
      column: 'slug',
      logicalType: 'text',
      value: 'dup',
      path: 'items.slug',
    };
    deepStrictEqual(await checkChildUnique(db, dialect, [probe], bulk), {
      'items.slug': 'validation.notUnique',
    });
    deepStrictEqual(await checkChildUnique(db, dialect, [probe], [...bulk, 'i1']), {});
  });
});
