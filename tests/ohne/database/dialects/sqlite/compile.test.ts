import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldInstance } from '../../../../../src/ohne/fields/field.ts';
import type { FieldTypeName } from '../../../../../src/ohne/fields/known-fields.ts';
import type { SQLFragment } from '../../../../../src/ohne/query/sql/fragment.ts';

import { useCollections } from '../../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../../src/ohne/database/schema/sync.ts';
import { defineField } from '../../../../../src/ohne/fields/define-field.ts';
import { field } from '../../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../../src/ohne/fields/use-fields.ts';
import { queryMetadata } from '../../../../../src/ohne/query/metadata.ts';
import { compileWhere } from '../../../../../src/ohne/query/sql/where.ts';
import { parseCondition } from '../../../../../src/utils/index.ts';

useCollections().register('SCTags', {
  name: 'SCTags',
  collection: {
    fields: {
      label: field('text'),
      posts: field('records', { collection: 'SCPosts', inverse: 'tags' }),
    },
  },
});
useCollections().register('SCPosts', {
  name: 'SCPosts',
  collection: {
    fields: { title: field('text'), tags: field('records', { collection: 'SCTags' }) },
  },
});
useFields().register('SCList', {
  name: 'SCList' as FieldTypeName,
  fieldType: defineField({ columnType: 'json', jsonList: true, forceNullable: true }),
});
useCollections().register('SCLists', {
  name: 'SCLists',
  collection: {
    fields: { labels: { type: 'SCList', options: {} } as unknown as FieldInstance },
  },
});

const dialect = new SQLiteDialect();

/**
 * Compiles `condition` against `collection` the way a read does.
 */
function compileOn(collection: string, condition: Record<string, unknown>): SQLFragment {
  const parsed = parseCondition(condition);
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.code}`);
  return compileWhere(parsed.node, queryMetadata(collection), dialect, 'en');
}

describe('SQLite text match compilation', () => {
  it('reads a non-ASCII row through `ohne_fold`', () => {
    deepStrictEqual(compileOn('SCPosts', { title: { contains: 'OH' } }), {
      sql:
        `(CASE WHEN length("title") = octet_length("title") THEN "title" ELSE ohne_fold("title") END) ` +
        `LIKE ? ESCAPE '\\'`,
      params: ['%oh%'],
    });
  });

  it('compiles `like` to a bare `LIKE`', () => {
    deepStrictEqual(compileOn('SCPosts', { title: { like: '%oh_' } }), {
      sql: '"title" LIKE ?',
      params: ['%oh_'],
    });
  });
});

describe('SQLite list membership compilation', () => {
  it('`includes` probes `json_each`', () => {
    deepStrictEqual(compileOn('SCLists', { labels: { includes: 'a' } }), {
      sql: '("labels" IS NOT NULL AND EXISTS (SELECT 1 FROM json_each("labels") WHERE json_each.value IN (SELECT value FROM json_each(?))))',
      params: ['["a"]'],
    });
  });

  it('a boolean element probes as `1`', () => {
    deepStrictEqual(compileOn('SCLists', { labels: { includes: true } }), {
      sql: '("labels" IS NOT NULL AND EXISTS (SELECT 1 FROM json_each("labels") WHERE json_each.value IN (SELECT value FROM json_each(?))))',
      params: ['[1]'],
    });
  });

  it('`includesAll` counts distinct matches against the list length', () => {
    deepStrictEqual(compileOn('SCLists', { labels: { includesAll: ['a', 'b'] } }), {
      sql: '("labels" IS NOT NULL AND (SELECT COUNT(DISTINCT json_each.value) FROM json_each("labels") WHERE json_each.value IN (SELECT value FROM json_each(?))) = 2)',
      params: ['["a","b"]'],
    });
  });

  it('`includesAny` exist-checks the bound list', () => {
    deepStrictEqual(compileOn('SCLists', { labels: { includesAny: ['a', 'b'] } }), {
      sql: '("labels" IS NOT NULL AND EXISTS (SELECT 1 FROM json_each("labels") WHERE json_each.value IN (SELECT value FROM json_each(?))))',
      params: ['["a","b"]'],
    });
  });

  it('negation wraps the `json_each` probe', () => {
    deepStrictEqual(compileOn('SCLists', { labels: { not: { includes: 'a' } } }), {
      sql: '("labels" IS NOT NULL AND NOT (EXISTS (SELECT 1 FROM json_each("labels") WHERE json_each.value IN (SELECT value FROM json_each(?)))))',
      params: ['["a"]'],
    });
  });
});

const db = await dialect.connect(':memory:');
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

/**
 * Returns SQLite's query plan for reading `SCPosts` titles under `condition`.
 */
async function plan(condition: Record<string, unknown>): Promise<string> {
  const fragment = compileOn('SCPosts', condition);
  const steps = await db.query<{ detail: string }>(
    `EXPLAIN QUERY PLAN SELECT "title" FROM "SCPosts" WHERE ${fragment.sql} ORDER BY "title"`,
    fragment.params,
  );
  return steps.map((step) => step.detail).join('\n');
}

describe('SQLite records membership plan', () => {
  it('a reverse lookup searches the parent table by key instead of scanning it', async () => {
    for (const condition of [{ tags: { includes: 't2' } }, { tags: { has: { UUID: 't2' } } }]) {
      const steps = await plan(condition);
      ok(/SEARCH SCPosts USING/.test(steps), steps);
      ok(!/SCAN SCPosts\b/.test(steps), steps);
    }
    const steps = await plan({ tags: { has: { label: 'green' } } });
    ok(/SCAN SCPosts\b/.test(steps), steps);
  });
});
