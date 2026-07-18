import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { evaluateCondition, parseCondition } from '../../../../src/utils/index.ts';

useCollections().register('PARRows', {
  name: 'PARRows',
  collection: {
    fields: {
      title: field('text', { nullable: true }),
      views: field('integer', { nullable: true }),
      flag: field('boolean', { nullable: true }),
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

const seeds: [string, string | null, number | null, boolean | null][] = [
  ['p1', 'alpha', 10, true],
  ['p2', 'Beta', 0, false],
  ['p3', null, null, null],
  ['p4', 'ÄPFEL', -5, true],
  ['p5', '%wild_', 100, null],
];
for (const [uuid, title, views, flag] of seeds) {
  await db.run(
    'INSERT INTO "PARRows" ("UUID","_updatedAt","title","views","flag") VALUES (?,?,?,?,?)',
    [uuid, 0, title, views, flag === null ? null : flag ? 1 : 0],
  );
}

// One truth table for both halves of the grammar: the `where` compiler and the `when` evaluator.
// Non-ASCII stays same-case.
const CORPUS: Record<string, unknown>[] = [
  { title: 'alpha' },
  { title: { not: { equalsTo: 'alpha' } } },
  { views: { greaterThan: 5 } },
  { views: { not: { greaterThan: 5 } } },
  { views: { atLeast: 0 } },
  { views: { not: { atMost: 0 } } },
  { views: { lessThan: 0 } },
  { views: { in: [0, 100] } },
  { views: { not: { in: [0, 100] } } },
  { title: { contains: 'a' } },
  { title: { not: { contains: 'a' } } },
  { title: { startsWith: 'be' } },
  { title: { not: { startsWith: 'be' } } },
  { title: { endsWith: 'A' } },
  { title: { contains: 'ÄPF' } },
  { title: { like: 'alp%' } },
  { title: { not: { like: '%a' } } },
  { title: { like: '%wild%' } },
  { title: { isNull: true } },
  { title: { not: { isNull: true } } },
  { flag: true },
  { flag: { not: { equalsTo: true } } },
  { and: [{ views: { atLeast: 0 } }, { title: { contains: 'a' } }] },
  { or: [{ views: { atLeast: 100 } }, { title: { isNull: true } }] },
  { not: { or: [{ title: 'alpha' }, { views: { lessThan: 0 } }] } },
  { views: { atLeast: 100, or: [{ equalsTo: 0 }] } },
];

describe('condition grammar parity', () => {
  it('the SQL compiler and the evaluator agree on every corpus condition', async () => {
    const rows = await queryUntyped('PARRows').findMany();
    for (const condition of CORPUS) {
      const sql = (await queryUntyped('PARRows').where(condition).findMany())
        .map((row) => row.UUID as string)
        .sort();
      const parsed = parseCondition(condition);
      ok(parsed.ok, JSON.stringify(condition));
      const js = rows
        .filter((row) => evaluateCondition(parsed.node, ([first]) => row[first]))
        .map((row) => row.UUID as string)
        .sort();
      deepStrictEqual(js, sql, JSON.stringify(condition));
    }
  });
});
