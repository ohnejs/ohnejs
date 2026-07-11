import { deepStrictEqual, notStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { SchemaSnapshot } from '../../../../src/ohne/database/schema/snapshot.ts';
import type { TableSchema } from '../../../../src/ohne/database/schema/table-schema.ts';

import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { createTable } from '../../../../src/ohne/database/dialects/sqlite/rebuild.ts';
import {
  advanceSnapshot,
  applyClassification,
  classifySchema,
  ensureSchemaTable,
  readSnapshot,
  schemaHash,
  writeSnapshot,
} from '../../../../src/ohne/database/schema/snapshot.ts';

const dialect = new SQLiteDialect();

function open(): Promise<DatabaseAdapter> {
  return dialect.connect(':memory:');
}

function snapshot(overrides: Partial<SchemaSnapshot> = {}): SchemaSnapshot {
  return {
    generation: 1,
    hash: 'h1',
    classification: { Posts: { columns: { UUID: 'text' } } },
    ownership: true,
    ...overrides,
  };
}

function table(name: string, overrides: Partial<TableSchema> = {}): TableSchema {
  return {
    name,
    columns: [{ name: 'UUID', type: 'text', notNull: true }],
    primaryKey: ['UUID'],
    uniques: [],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  };
}

describe('ensureSchemaTable', () => {
  it('creates the table once, tolerating repeat calls', async () => {
    const db = await open();
    await ensureSchemaTable(db, dialect);
    await ensureSchemaTable(db, dialect);
    deepStrictEqual(await dialect.listTables(db), ['ohne_schema']);
    await db.close();
  });
});

describe('readSnapshot and writeSnapshot', () => {
  it('reads undefined before any write', async () => {
    const db = await open();
    await ensureSchemaTable(db, dialect);
    strictEqual(await readSnapshot(db, dialect), undefined);
    await db.close();
  });

  it('round-trips a snapshot', async () => {
    const db = await open();
    await ensureSchemaTable(db, dialect);
    const written = snapshot({ generation: 2 });
    await writeSnapshot(db, dialect, written);
    deepStrictEqual(await readSnapshot(db, dialect), written);
    await db.close();
  });

  it('upserts: a second write replaces the one row', async () => {
    const db = await open();
    await ensureSchemaTable(db, dialect);
    await writeSnapshot(db, dialect, snapshot());
    await writeSnapshot(db, dialect, snapshot({ generation: 2, hash: 'h2' }));
    deepStrictEqual(await readSnapshot(db, dialect), snapshot({ generation: 2, hash: 'h2' }));
    const rows = await db.query('SELECT * FROM "ohne_schema"');
    strictEqual(rows.length, 1);
    await db.close();
  });

  it('lifts the bare column maps of a version-1 snapshot into claims', async () => {
    const db = await open();
    await ensureSchemaTable(db, dialect);
    const v1 = {
      version: 1,
      generation: 2,
      hash: 'h2',
      history: [{ generation: 1, hash: 'h1' }],
      classification: { Posts: { UUID: 'text', meta: 'json' } },
    };
    await db.run('INSERT INTO "ohne_schema" ("key", "data") VALUES (?, ?)', [
      'schema',
      JSON.stringify(v1),
    ]);
    deepStrictEqual(await readSnapshot(db, dialect), {
      generation: 2,
      hash: 'h2',
      classification: { Posts: { columns: { UUID: 'text', meta: 'json' } } },
      ownership: false,
    });
    await db.close();
  });
});

describe('advanceSnapshot', () => {
  it('starts a fresh database at generation 1', () => {
    deepStrictEqual(advanceSnapshot(undefined, 'h1', {}), {
      generation: 1,
      hash: 'h1',
      classification: {},
      ownership: true,
    });
  });

  it('keeps the generation when the hash is unchanged, refreshing the classification', () => {
    const previous = snapshot({ generation: 3 });
    const next = advanceSnapshot(previous, 'h1', {
      Posts: { columns: { UUID: 'text', meta: 'json' } },
    });
    strictEqual(next.generation, 3);
    deepStrictEqual(next.classification, { Posts: { columns: { UUID: 'text', meta: 'json' } } });
  });

  it('bumps the generation on a hash change', () => {
    const previous = snapshot({ generation: 3, hash: 'h3' });
    const next = advanceSnapshot(previous, 'h4', {});
    strictEqual(next.generation, 4);
    strictEqual(next.hash, 'h4');
  });
});

describe('schemaHash', () => {
  it('is deterministic and insensitive to table order', () => {
    const posts = table('Posts');
    const users = table('Users');
    strictEqual(schemaHash([posts, users]), schemaHash([users, posts]));
  });

  it('changes when a column changes', () => {
    const before = table('Posts');
    const after = table('Posts', {
      columns: [
        { name: 'UUID', type: 'text', notNull: true },
        { name: 'x', type: 'text', notNull: false },
      ],
    });
    notStrictEqual(schemaHash([before]), schemaHash([after]));
  });
});

describe('classifySchema', () => {
  it('maps every table to its logical column types', () => {
    const posts = table('Posts', {
      columns: [
        { name: 'UUID', type: 'text', notNull: true },
        { name: 'meta', type: 'json', notNull: false },
      ],
    });
    deepStrictEqual(classifySchema([posts]), {
      Posts: { columns: { UUID: 'text', meta: 'json' } },
    });
  });

  it('carries a derived origin into the claim', () => {
    const junction = table('Posts_authors', {
      derived: { collection: 'Posts', path: ['authors'], kind: 'junction' },
    });
    deepStrictEqual(classifySchema([junction]), {
      Posts_authors: {
        columns: { UUID: 'text' },
        derived: { collection: 'Posts', path: ['authors'], kind: 'junction' },
      },
    });
  });
});

describe('applyClassification', () => {
  it('restores boolean and json over introspected storage types', async () => {
    const db = await open();
    const desired = table('T', {
      columns: [
        { name: 'UUID', type: 'text', notNull: true },
        { name: 'meta', type: 'json', notNull: false },
        { name: 'draft', type: 'boolean', notNull: true },
      ],
    });
    await createTable(db, dialect, desired);
    const live = await dialect.describeTable(db, 'T');
    strictEqual(live.columns[1]?.type, 'text');
    strictEqual(live.columns[2]?.type, 'integer');
    const restored = applyClassification([live], classifySchema([desired]), dialect);
    deepStrictEqual(
      restored[0]?.columns.map((column) => column.type),
      ['text', 'json', 'boolean'],
    );
    await db.close();
  });

  it('keeps the live type for a column drifted since the snapshot', () => {
    const live = table('T', { columns: [{ name: 'meta', type: 'integer', notNull: false }] });
    const restored = applyClassification([live], { T: { columns: { meta: 'json' } } }, dialect);
    strictEqual(restored[0]?.columns[0]?.type, 'integer');
  });

  it('leaves unclassified tables and columns untouched', () => {
    const foreign = table('Foreign');
    const [untouched] = applyClassification(
      [foreign],
      { Other: { columns: { UUID: 'text' } } },
      dialect,
    );
    deepStrictEqual(untouched, foreign);
    ok(untouched);
  });
});
