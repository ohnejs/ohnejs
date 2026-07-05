import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { TableAlter, TableSchema } from '../../../../src/ohne/database/schema/table-schema.ts';

import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { diffSchemas } from '../../../../src/ohne/database/schema/diff.ts';

const dialect = new SQLiteDialect();

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

function alterOf(diffs: unknown[]): TableAlter {
  strictEqual(diffs.length, 1);
  const [diff] = diffs as TableAlter[];
  strictEqual(diff.kind, 'alter');
  return diff;
}

describe('diffSchemas', () => {
  it('produces nothing for identical schemas', () => {
    const schema = [table('Posts'), table('Users')];
    deepStrictEqual(diffSchemas(schema, schema, dialect), []);
  });

  it('drops a live table absent from the desired set', () => {
    const posts = table('Posts');
    deepStrictEqual(diffSchemas([posts], [], dialect), [{ kind: 'drop', table: posts }]);
  });

  it('creates a desired table absent live', () => {
    const posts = table('Posts');
    deepStrictEqual(diffSchemas([], [posts], dialect), [{ kind: 'create', table: posts }]);
  });

  it('orders drops before creates before alters', () => {
    const live = [table('Old'), table('Posts')];
    const desired = [
      table('New'),
      table('Posts', { indexes: [{ name: 'IX__Posts__a', columns: ['a'] }] }),
    ];
    const kinds = diffSchemas(live, desired, dialect).map((diff) => diff.kind);
    deepStrictEqual(kinds, ['drop', 'create', 'alter']);
  });

  it('adds and drops columns by name', () => {
    const live = table('Posts', {
      columns: [
        { name: 'UUID', type: 'text', notNull: true },
        { name: 'legacy', type: 'text', notNull: false },
      ],
    });
    const desired = table('Posts', {
      columns: [
        { name: 'UUID', type: 'text', notNull: true },
        { name: 'title', type: 'text', notNull: true },
      ],
    });
    const alter = alterOf(diffSchemas([live], [desired], dialect));
    deepStrictEqual(alter.addColumns, [{ name: 'title', type: 'text', notNull: true }]);
    deepStrictEqual(alter.dropColumns, [{ name: 'legacy', type: 'text', notNull: false }]);
    deepStrictEqual(alter.changeColumns, []);
  });

  it('reports a retyped column as a change', () => {
    const live = table('Posts', {
      columns: [{ name: 'count', type: 'text', notNull: false }],
      primaryKey: [],
    });
    const desired = table('Posts', {
      columns: [{ name: 'count', type: 'integer', notNull: false }],
      primaryKey: [],
    });
    const alter = alterOf(diffSchemas([live], [desired], dialect));
    deepStrictEqual(alter.changeColumns, [
      {
        live: { name: 'count', type: 'text', notNull: false },
        desired: { name: 'count', type: 'integer', notNull: false },
      },
    ]);
  });

  it('reports a notNull flip as a change', () => {
    const live = table('Posts', {
      columns: [{ name: 'title', type: 'text', notNull: false }],
      primaryKey: [],
    });
    const desired = table('Posts', {
      columns: [{ name: 'title', type: 'text', notNull: true }],
      primaryKey: [],
    });
    const alter = alterOf(diffSchemas([live], [desired], dialect));
    strictEqual(alter.changeColumns.length, 1);
  });

  it('never differs on primitives sharing a native type', () => {
    const live = table('Posts', {
      columns: [
        { name: 'meta', type: 'text', notNull: false },
        { name: 'draft', type: 'integer', notNull: true },
      ],
      primaryKey: [],
    });
    const desired = table('Posts', {
      columns: [
        { name: 'meta', type: 'json', notNull: false },
        { name: 'draft', type: 'boolean', notNull: true },
      ],
      primaryKey: [],
    });
    deepStrictEqual(diffSchemas([live], [desired], dialect), []);
  });

  it('adds and drops uniques and indexes per constraint', () => {
    const live = table('Posts', {
      uniques: [{ name: 'UX__Posts__slug', columns: ['slug'] }],
      indexes: [{ name: 'IX__Posts__author', columns: ['author'] }],
    });
    const desired = table('Posts', {
      uniques: [{ name: 'UX__Posts__email', columns: ['email'] }],
      indexes: [{ name: 'IX__Posts__author', columns: ['author'] }],
    });
    const alter = alterOf(diffSchemas([live], [desired], dialect));
    deepStrictEqual(alter.dropUniques, [{ name: 'UX__Posts__slug', columns: ['slug'] }]);
    deepStrictEqual(alter.addUniques, [{ name: 'UX__Posts__email', columns: ['email'] }]);
    deepStrictEqual(alter.addIndexes, []);
    deepStrictEqual(alter.dropIndexes, []);
  });

  it('rewrites a same-name constraint whose columns changed', () => {
    const live = table('Posts', { uniques: [{ name: 'UX__Posts__slug', columns: ['slug'] }] });
    const desired = table('Posts', {
      uniques: [{ name: 'UX__Posts__slug', columns: ['slug', 'locale'] }],
    });
    const alter = alterOf(diffSchemas([live], [desired], dialect));
    deepStrictEqual(alter.dropUniques, [{ name: 'UX__Posts__slug', columns: ['slug'] }]);
    deepStrictEqual(alter.addUniques, [{ name: 'UX__Posts__slug', columns: ['slug', 'locale'] }]);
  });

  it('correlates foreign keys by column and rewrites on retarget', () => {
    const live = table('Junction', {
      foreignKeys: [
        { column: '_targetUUID', targetTable: 'Posts', targetColumn: 'UUID', onDelete: 'cascade' },
      ],
    });
    const desired = table('Junction', {
      foreignKeys: [
        { column: '_targetUUID', targetTable: 'Pages', targetColumn: 'UUID', onDelete: 'cascade' },
      ],
    });
    const alter = alterOf(diffSchemas([live], [desired], dialect));
    strictEqual(alter.dropForeignKeys[0]?.targetTable, 'Posts');
    strictEqual(alter.addForeignKeys[0]?.targetTable, 'Pages');
  });

  it('rewrites a foreign key whose onDelete changed', () => {
    const live = table('Posts', {
      foreignKeys: [
        { column: 'author', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'setNull' },
      ],
    });
    const desired = table('Posts', {
      foreignKeys: [
        { column: 'author', targetTable: 'Users', targetColumn: 'UUID', onDelete: 'cascade' },
      ],
    });
    const alter = alterOf(diffSchemas([live], [desired], dialect));
    strictEqual(alter.dropForeignKeys.length, 1);
    strictEqual(alter.addForeignKeys.length, 1);
  });

  it('flags a primary-key change', () => {
    const live = table('Posts');
    const desired = table('Posts', { primaryKey: ['UUID', 'locale'] });
    const alter = alterOf(diffSchemas([live], [desired], dialect));
    strictEqual(alter.changePrimaryKey, true);
  });

  it('emits only the changed table', () => {
    const live = [table('Posts'), table('Users')];
    const desired = [
      table('Posts', { indexes: [{ name: 'IX__Posts__author', columns: ['author'] }] }),
      table('Users'),
    ];
    const diffs = diffSchemas(live, desired, dialect);
    strictEqual(diffs.length, 1);
    ok(diffs[0]?.kind === 'alter' && diffs[0].desired.name === 'Posts');
  });
});
