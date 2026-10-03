import { deepStrictEqual, ok } from 'node:assert';
import { describe, it } from 'node:test';

import type { FieldInstance } from '../../../../src/ohne/fields/field.ts';
import type { FieldTypeName } from '../../../../src/ohne/fields/known-fields.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { defineField } from '../../../../src/ohne/fields/define-field.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { evaluateCondition, parseCondition } from '../../../../src/utils/index.ts';

useFields().register('PARList', {
  name: 'PARList' as FieldTypeName,
  fieldType: defineField({ columnType: 'json', jsonList: true, forceNullable: true }),
});
useCollections().register('PARTargets', {
  name: 'PARTargets',
  collection: {
    fields: {
      name: field('text'),
      rows: field('records', { collection: 'PARRows', inverse: 'links' }),
    },
  },
});
useCollections().register('PARRows', {
  name: 'PARRows',
  collection: {
    fields: {
      title: field('text', { nullable: true }),
      views: field('integer', { nullable: true }),
      flag: field('boolean', { nullable: true }),
      labels: { type: 'PARList', options: {} } as unknown as FieldInstance,
      links: field('records', { collection: 'PARTargets' }),
      items: field('repeater', {
        fields: { code: field('text'), target: field('record', { collection: 'PARTargets' }) },
      }),
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

const seeds: [string, string | null, number | null, boolean | null, unknown[] | null][] = [
  ['p1', 'alpha', 10, true, ['red', 'green']],
  ['p2', 'Beta', 0, false, ['red', 10, true]],
  ['p3', null, null, null, null],
  ['p4', 'ÄPFEL Émile ΣΟΦΙΑ', -5, true, []],
  ['p5', '%wild_', 100, null, ['blue', false, -5]],
  ['p6', 'ΣΟΦΙΑΣΜΟΣ \u212A', 1, false, null],
  ['p7', 'Café Straße Søren', 2, null, null],
  ['p8', 'Apfel cafe\u0301 １００％', 3, null, null],
];
for (const [uuid, title, views, flag, labels] of seeds) {
  await db.run(
    'INSERT INTO "PARRows" ("UUID","_updatedAt","title","views","flag","labels") VALUES (?,?,?,?,?,?)',
    [
      uuid,
      0,
      title,
      views,
      flag === null ? null : flag ? 1 : 0,
      labels === null ? null : JSON.stringify(labels),
    ],
  );
}

for (const [uuid, name] of [
  ['t1', 'one'],
  ['t2', 'two'],
  ['t3', 'three'],
]) {
  await db.run('INSERT INTO "PARTargets" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
    uuid,
    0,
    name,
  ]);
}
const links: [string, string][] = [
  ['p1', 't1'],
  ['p1', 't2'],
  ['p2', 't2'],
  ['p4', 't3'],
];
for (const [index, [parent, target]] of links.entries()) {
  await db.run(
    'INSERT INTO "PARRows_links" ("_parentUUID","_targetUUID","_parentPosition","_targetPosition") VALUES (?,?,?,?)',
    [parent, target, index, index],
  );
}
const items: [string, string, string, string | null][] = [
  ['i1', 'p1', 'x', 't3'],
  ['i2', 'p2', 'y', null],
  ['i3', 'p5', 'x', 't1'],
];
for (const [index, [uuid, parent, code, target]] of items.entries()) {
  await db.run(
    'INSERT INTO "PARRows_items" ("UUID","_parentUUID","_parentPosition","code","target") VALUES (?,?,?,?,?)',
    [uuid, parent, index, code, target],
  );
}

// One truth table for both halves of the grammar: the `where` compiler and the `when` evaluator.
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
  { title: { contains: 'äpf' } },
  { title: { contains: 'émile' } },
  { title: { not: { contains: 'émile' } } },
  { title: { startsWith: 'äpfel' } },
  { title: { endsWith: 'σοφια' } },
  { title: { contains: 'ΣΟΦΙΑΣ' } },
  { title: { contains: 'k' } },
  { title: { contains: 'cafe' } },
  { title: { not: { contains: 'cafe' } } },
  { title: { contains: 'CAFÉ' } },
  { title: { startsWith: 'apfel' } },
  { title: { not: { startsWith: 'apfel' } } },
  { title: { endsWith: 'soren' } },
  { title: { not: { endsWith: 'soren' } } },
  { title: { contains: 'strasse' } },
  { title: { contains: '100%' } },
  { title: { contains: 'が' } },
  { title: { not: { contains: 'が' } } },
  { title: { like: 'alp%' } },
  { title: { like: '%äpfel%' } },
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
  { labels: { includes: 'red' } },
  { labels: { includes: true } },
  { labels: { not: { includes: 'red' } } },
  { labels: { includesAll: ['red', 'green'] } },
  { labels: { includesAll: ['red', 'red'] } },
  { labels: { includesAll: [] } },
  { labels: { not: { includesAll: [] } } },
  { labels: { includesAny: ['green', 10] } },
  { labels: { includesAny: [] } },
  { labels: { not: { includesAny: ['red', 'blue'] } } },
  { links: { includes: 't2' } },
  { links: { not: { includes: 't2' } } },
  { links: { includesAny: ['t1', 't3'] } },
  { links: { includesAny: [] } },
  { links: { not: { includesAny: ['t2', 't9'] } } },
  { items: { has: { UUID: 'i1' } } },
  { items: { has: { UUID: { in: ['i2', 'i3'] } } } },
  { items: { has: { target: 't1' } } },
  { items: { has: { or: [{ UUID: 'i2' }, { target: { in: ['t3'] } }] } } },
  { items: { not: { has: { UUID: 'i1' } } } },
  { items: { has: { UUID: 'i3', code: 'x' } } },
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

  it('both sides ignore accents in the text trio', async () => {
    const found = async (condition: Record<string, unknown>) =>
      (await queryUntyped('PARRows').where(condition).findMany()).map((row) => row.UUID).sort();
    deepStrictEqual(await found({ title: { contains: 'cafe' } }), ['p7', 'p8']);
    deepStrictEqual(await found({ title: { startsWith: 'apfel' } }), ['p4', 'p8']);
    deepStrictEqual(await found({ title: { endsWith: 'soren' } }), ['p7']);
    deepStrictEqual(await found({ title: { contains: '100%' } }), ['p8']);
  });
});
