import { deepStrictEqual, match, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldTypeName } from '../../../../src/ohne/fields/known-fields.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { defineField } from '../../../../src/ohne/fields/define-field.ts';
import { field, type FieldInstance } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { queryMetadata } from '../../../../src/ohne/query/metadata.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { compileOrder } from '../../../../src/ohne/query/sql/order.ts';

useLayers().add({
  path: '/order-read',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useFields().register('oSpan', {
  name: 'oSpan' as FieldTypeName,
  fieldType: defineField({
    columnType: false,
    schema: () => ({
      kind: 'child',
      cardinality: 'one',
      subfields: { start: field('text', { nullable: true }) },
      orderBy: 'start',
    }),
  }),
});

const composite = (type: string, options: Record<string, unknown> = {}): FieldInstance =>
  ({ type, options }) as unknown as FieldInstance;

useCollections().register('OEvents', {
  name: 'OEvents',
  collection: {
    fields: {
      title: field('text'),
      span: composite('oSpan'),
      meta: field('object', { fields: { note: field('text') } }),
    },
  },
});
useCollections().register('OLocEvents', {
  name: 'OLocEvents',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      span: composite('oSpan', { translatable: true }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

async function create(collection: string, input: Record<string, unknown>): Promise<string> {
  return (await queryUntyped(collection).createOrThrow(input)).UUID as string;
}

await create('OEvents', { title: 'A', span: { start: '2026-03' } });
await create('OEvents', { title: 'B', span: null });
await create('OEvents', { title: 'C', span: { start: null } });
await create('OEvents', { title: 'D', span: { start: '2026-01' } });

const de = await create('OLocEvents', { title: 'One', span: { start: '2026-05' } });
await create('OLocEvents', { title: 'Two', span: { start: '2026-02' } });
await queryUntyped('OLocEvents')
  .locale('de')
  .where({ UUID: de })
  .updateOrThrow({ title: 'Eins', span: { start: '2025-01' } });

async function titles(
  collection: string,
  direction: 'asc' | 'desc',
  locale?: string,
): Promise<unknown[]> {
  const builder = queryUntyped(collection);
  if (locale !== undefined) builder.locale(locale);
  return builder.orderBy('span', direction).pluck('title');
}

describe('ordering by a composite sort key', () => {
  it('sorts a missing row and a null part as NULL, first ascending and last descending', async () => {
    const ascending = await titles('OEvents', 'asc');
    deepStrictEqual(
      [ascending.slice(0, 2).sort(), ascending.slice(2)],
      [
        ['B', 'C'],
        ['D', 'A'],
      ],
    );
    const descending = await titles('OEvents', 'desc');
    deepStrictEqual(
      [descending.slice(0, 2), descending.slice(2).sort()],
      [
        ['A', 'D'],
        ['B', 'C'],
      ],
    );
  });

  it('binds the locale between the condition and the window', async () => {
    const rows = await queryUntyped('OLocEvents')
      .locale('de')
      .where({ title: { startsWith: 'E' } })
      .orderBy('span', 'desc')
      .limit(5)
      .pluck('title');
    deepStrictEqual(rows, ['Eins']);
  });

  it('sorts a translatable composite by the queried locale, an untranslated record as NULL', async () => {
    deepStrictEqual(await titles('OLocEvents', 'asc'), ['Two', 'One']);
    deepStrictEqual(await titles('OLocEvents', 'asc', 'de'), [null, 'Eins']);
  });

  it('compiles a correlated subquery against the qualified main table', () => {
    const meta = queryMetadata('OLocEvents');
    const ir = { order: [{ field: 'span', direction: 'asc' }] } as never;
    deepStrictEqual(compileOrder(ir, meta, dialect, 'de'), {
      sql: '(SELECT "_o0"."start" FROM "OLocEvents_span" "_o0" WHERE "_o0"."_parentUUID" = "OLocEvents"."UUID" AND "_o0"."_localeCode" = ?) ASC, "UUID" ASC',
      params: ['de'],
    });
  });

  it('refuses a composite without a sort key', () => {
    throws(
      () => queryUntyped('OEvents').orderBy('meta'),
      (error: Error) => {
        match(error.message, /Cannot order by `meta`/);
        return true;
      },
    );
  });
});
