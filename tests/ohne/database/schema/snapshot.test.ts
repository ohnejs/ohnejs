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
    history: [],
    classification: { Posts: { UUID: 'text' } },
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
    const written = snapshot({ history: [{ generation: 1, hash: 'h0' }], generation: 2 });
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
});

describe('advanceSnapshot', () => {
  it('starts a fresh database at generation 1 with no history', () => {
    deepStrictEqual(advanceSnapshot(undefined, 'h1', {}), {
      generation: 1,
      hash: 'h1',
      history: [],
      classification: {},
    });
  });

  it('keeps the generation and history when the hash is unchanged', () => {
    const previous = snapshot({ generation: 3, history: [{ generation: 2, hash: 'h0' }] });
    const next = advanceSnapshot(previous, 'h1', { Posts: { UUID: 'text', meta: 'json' } });
    strictEqual(next.generation, 3);
    deepStrictEqual(next.history, previous.history);
    deepStrictEqual(next.classification, { Posts: { UUID: 'text', meta: 'json' } });
  });

  it('bumps the generation and appends the previous one on a hash change', () => {
    const previous = snapshot({ generation: 3, hash: 'h3' });
    const next = advanceSnapshot(previous, 'h4', {});
    strictEqual(next.generation, 4);
    strictEqual(next.hash, 'h4');
    deepStrictEqual(next.history, [{ generation: 3, hash: 'h3' }]);
  });

  it('bounds the history at 20 entries, dropping the oldest', () => {
    let current = advanceSnapshot(undefined, 'h1', {});
    for (let i = 2; i <= 25; i++) {
      current = advanceSnapshot(current, `h${i}`, {});
    }
    strictEqual(current.history.length, 20);
    strictEqual(current.history[0]?.hash, 'h5');
    strictEqual(current.history[19]?.hash, 'h24');
    strictEqual(current.generation, 25);
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
    deepStrictEqual(classifySchema([posts]), { Posts: { UUID: 'text', meta: 'json' } });
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
    const restored = applyClassification([live], { T: { meta: 'json' } }, dialect);
    strictEqual(restored[0]?.columns[0]?.type, 'integer');
  });

  it('leaves unclassified tables and columns untouched', () => {
    const foreign = table('Foreign');
    const [untouched] = applyClassification([foreign], { Other: { UUID: 'text' } }, dialect);
    deepStrictEqual(untouched, foreign);
    ok(untouched);
  });
});
