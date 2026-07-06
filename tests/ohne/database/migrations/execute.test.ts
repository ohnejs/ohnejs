import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { Migration } from '../../../../src/ohne/database/migrations/define-migration.ts';
import type { MigrationMeta } from '../../../../src/ohne/database/migrations/use-migrations.ts';
import type { TableSchema } from '../../../../src/ohne/database/schema/table-schema.ts';

import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import {
  createIndexes,
  createTable,
} from '../../../../src/ohne/database/dialects/sqlite/rebuild.ts';
import { executeMigrations } from '../../../../src/ohne/database/migrations/execute.ts';
import { classifySchema } from '../../../../src/ohne/database/schema/snapshot.ts';

const dialect = new SQLiteDialect();

const UUID = { name: 'UUID', type: 'text', notNull: true } as const;

function open(): Promise<DatabaseAdapter> {
  return dialect.connect(':memory:');
}

function table(name: string, overrides: Partial<TableSchema> = {}): TableSchema {
  return {
    name,
    columns: [UUID],
    primaryKey: ['UUID'],
    uniques: [],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  };
}

function meta(name: string, migration: Migration): MigrationMeta {
  return { name, migration, file: `/app/migrations/${name.split('/')[1]}.ts` };
}

async function materialize(db: DatabaseAdapter, schemas: TableSchema[]): Promise<void> {
  for (const schema of schemas) {
    await createTable(db, dialect, schema);
    await createIndexes(db, dialect, schema);
  }
}

async function columnNames(db: DatabaseAdapter, name: string): Promise<string[]> {
  const schema = await dialect.describeTable(db, name);
  return schema.columns.map((column) => column.name);
}

describe('executeMigrations', () => {
  it('moves a column within a table, transforming values and dropping FROM', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [UUID, { name: 'isDraft', type: 'text', notNull: false }],
    });
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID", "isDraft") VALUES (?, ?), (?, ?)', [
      'a',
      'yes',
      'b',
      'no',
    ]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-draft', {
          from: { table: 'Posts', column: 'isDraft', type: 'text' },
          to: { table: 'Posts', column: 'draft', type: 'boolean' },
          transform: (value) => value === 'yes',
        }),
      ],
      desired: [],
      claimed: classifySchema([posts]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-draft', status: 'applied' }]);
    deepStrictEqual(await columnNames(db, 'Posts'), ['UUID', 'draft']);
    const rows = await db.query<{ UUID: string; draft: number }>(
      'SELECT "UUID", "draft" FROM "Posts" ORDER BY "UUID"',
    );
    deepStrictEqual(
      rows.map((row) => [row.UUID, row.draft]),
      [
        ['a', 1],
        ['b', 0],
      ],
    );
    deepStrictEqual(outcome.claimed['Posts'], { UUID: 'text', draft: 'boolean' });
    await db.close();
  });

  it('retypes a column physically on a same-column move, values carried through', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [UUID, { name: 'flag', type: 'text', notNull: false }],
    });
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID", "flag") VALUES (?, ?), (?, ?)', [
      'a',
      'yes',
      'b',
      'no',
    ]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-flag', {
          from: { table: 'Posts', column: 'flag', type: 'text' },
          to: { table: 'Posts', column: 'flag', type: 'boolean' },
          transform: (value) => value === 'yes',
        }),
      ],
      desired: [],
      claimed: classifySchema([posts]),
      force: false,
    });
    const rows = await db.query<{ flag: number }>('SELECT "flag" FROM "Posts" ORDER BY "UUID"');
    deepStrictEqual(
      rows.map((row) => row.flag),
      [1, 0],
    );
    const live = await dialect.describeTable(db, 'Posts');
    deepStrictEqual(
      live.columns.find((column) => column.name === 'flag'),
      { name: 'flag', type: 'integer', notNull: false },
    );
    strictEqual(outcome.claimed['Posts']?.['flag'], 'boolean');
    await db.close();
  });

  it('moves values across tables onto rows sharing the primary key', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    const archive = table('Archive', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    await materialize(db, [posts, archive]);
    await db.run('INSERT INTO "Posts" ("UUID", "title") VALUES (?, ?)', ['a', 'hello']);
    await db.run('INSERT INTO "Archive" ("UUID") VALUES (?)', ['a']);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-archive', {
          from: { table: 'Posts', column: 'title', type: 'text' },
          to: { table: 'Archive', column: 'title', type: 'text' },
        }),
      ],
      desired: [],
      claimed: classifySchema([posts, archive]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-archive', status: 'applied' }]);
    const rows = await db.query<{ title: string }>('SELECT "title" FROM "Archive"');
    deepStrictEqual(
      rows.map((row) => row.title),
      ['hello'],
    );
    deepStrictEqual(await columnNames(db, 'Posts'), ['UUID']);
    await db.close();
  });

  it('refuses a cross-table move with unmatched rows, then drops them under force', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    const archive = table('Archive', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    await materialize(db, [posts, archive]);
    await db.run('INSERT INTO "Posts" ("UUID", "title") VALUES (?, ?), (?, ?)', [
      'a',
      'kept',
      'b',
      'lost',
    ]);
    await db.run('INSERT INTO "Archive" ("UUID") VALUES (?)', ['a']);
    const migrations = [
      meta('app/001-archive', {
        from: { table: 'Posts', column: 'title', type: 'text' },
        to: { table: 'Archive', column: 'title', type: 'text' },
      }),
    ];
    const claimed = classifySchema([posts, archive]);
    await rejects(
      executeMigrations(db, dialect, { migrations, desired: [], claimed, force: false }),
      /cannot map every row/,
    );
    const outcome = await executeMigrations(db, dialect, {
      migrations,
      desired: [],
      claimed,
      force: true,
    });
    strictEqual(outcome.deletions.length, 1);
    match(outcome.deletions[0] ?? '', /`1` `Posts.title` values/);
    deepStrictEqual(await columnNames(db, 'Posts'), ['UUID']);
    await db.close();
  });

  it('materializes a missing TO table from the desired schema, without its indexes', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    await materialize(db, [posts]);
    const archive = table('Archive', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
      uniques: [{ name: 'UX__Archive__title', columns: ['title'] }],
    });
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-archive', {
          from: { table: 'Posts', column: 'title', type: 'text' },
          to: { table: 'Archive', column: 'title', type: 'text' },
        }),
      ],
      desired: [archive],
      claimed: classifySchema([posts]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-archive', status: 'applied' }]);
    const live = await dialect.describeTable(db, 'Archive');
    deepStrictEqual(live.uniques, []);
    deepStrictEqual(outcome.claimed['Archive'], { UUID: 'text', title: 'text' });
    await db.close();
  });

  it('materializes a missing TO column as nullable from the address itself', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [UUID, { name: 'old', type: 'text', notNull: false }],
    });
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID", "old") VALUES (?, ?)', ['a', 'v']);
    await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-new', {
          from: { table: 'Posts', column: 'old', type: 'text' },
          to: { table: 'Posts', column: 'fresh', type: 'text' },
        }),
      ],
      desired: [],
      claimed: classifySchema([posts]),
      force: false,
    });
    const live = await dialect.describeTable(db, 'Posts');
    deepStrictEqual(
      live.columns.find((column) => column.name === 'fresh'),
      {
        name: 'fresh',
        type: 'text',
        notNull: false,
      },
    );
    await db.close();
  });

  it('refuses a move whose TO table is neither live nor desired', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    await materialize(db, [posts]);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-ghost', {
            from: { table: 'Posts', column: 'title', type: 'text' },
            to: { table: 'Ghost', column: 'title', type: 'text' },
          }),
        ],
        desired: [],
        claimed: classifySchema([posts]),
        force: false,
      }),
      /cannot materialize/,
    );
    await db.close();
  });

  it('exposes read-only queries and the deserialized row to a transform', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [
        UUID,
        { name: 'author', type: 'text', notNull: false },
        { name: 'pinned', type: 'boolean', notNull: true },
      ],
    });
    const authors = table('Authors', {
      columns: [UUID, { name: 'handle', type: 'text', notNull: false }],
    });
    await materialize(db, [posts, authors]);
    await db.run('INSERT INTO "Authors" ("UUID", "handle") VALUES (?, ?)', ['u1', 'ada']);
    await db.run('INSERT INTO "Posts" ("UUID", "author", "pinned") VALUES (?, ?, ?)', [
      'a',
      'u1',
      1,
    ]);
    const seen: unknown[] = [];
    await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-handle', {
          from: { table: 'Posts', column: 'author', type: 'text' },
          to: { table: 'Posts', column: 'authorHandle', type: 'text' },
          transform: async (value, row, ctx) => {
            seen.push(row['pinned']);
            const author = await ctx.queryOne<{ handle: string }>(
              'SELECT "handle" FROM "Authors" WHERE "UUID" = ?',
              [value as string],
            );
            return author?.handle;
          },
        }),
      ],
      desired: [],
      claimed: classifySchema([posts, authors]),
      force: false,
    });
    deepStrictEqual(seen, [true]);
    const rows = await db.query<{ authorHandle: string }>('SELECT "authorHandle" FROM "Posts"');
    deepStrictEqual(
      rows.map((row) => row.authorHandle),
      ['ada'],
    );
    await db.close();
  });

  it('renames a table and follows it in the claim record', async () => {
    const db = await open();
    const posts = table('Posts');
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-articles', { from: { table: 'Posts' }, to: { table: 'Articles' } }),
      ],
      desired: [],
      claimed: classifySchema([posts]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-articles', status: 'applied' }]);
    deepStrictEqual(await dialect.listTables(db), ['Articles']);
    deepStrictEqual(Object.keys(outcome.claimed), ['Articles']);
    await db.close();
  });

  it('allows a case-only rename and refuses renaming onto an occupied name', async () => {
    const db = await open();
    const posts = table('Posts');
    const users = table('Users');
    await materialize(db, [posts, users]);
    const claimed = classifySchema([posts, users]);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [meta('app/001-clash', { from: { table: 'Posts' }, to: { table: 'USERS' } })],
        desired: [],
        claimed,
        force: false,
      }),
      /renames onto an existing table/,
    );
    const outcome = await executeMigrations(db, dialect, {
      migrations: [meta('app/002-case', { from: { table: 'Posts' }, to: { table: 'posts' } })],
      desired: [],
      claimed,
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/002-case', status: 'applied' }]);
    ok((await dialect.listTables(db)).includes('posts'));
    await db.close();
  });

  it('discards a column on purpose, its covering index with it', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [UUID, { name: 'legacy', type: 'text', notNull: false }],
      indexes: [{ name: 'IX__Posts__legacy', columns: ['legacy'] }],
    });
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID", "legacy") VALUES (?, ?)', ['a', 'v']);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-drop', {
          from: { table: 'Posts', column: 'legacy', type: 'text' },
          to: null,
        }),
      ],
      desired: [],
      claimed: classifySchema([posts]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-drop', status: 'applied' }]);
    deepStrictEqual(await columnNames(db, 'Posts'), ['UUID']);
    deepStrictEqual((await dialect.describeTable(db, 'Posts')).indexes, []);
    deepStrictEqual(outcome.claimed['Posts'], { UUID: 'text' });
    await db.close();
  });

  it('discards a whole table on purpose', async () => {
    const db = await open();
    const posts = table('Posts');
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [meta('app/001-gone', { from: { table: 'Posts' }, to: null })],
      desired: [],
      claimed: classifySchema([posts]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-gone', status: 'applied' }]);
    deepStrictEqual(await dialect.listTables(db), []);
    deepStrictEqual(outcome.claimed, {});
    await db.close();
  });

  it('skips and stamps when FROM is absent and TO is satisfied by the desired schema', async () => {
    const db = await open();
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-draft', {
          from: { table: 'Posts', column: 'isDraft', type: 'text' },
          to: { table: 'Posts', column: 'draft', type: 'boolean' },
        }),
      ],
      desired: [
        table('Posts', { columns: [UUID, { name: 'draft', type: 'boolean', notNull: false }] }),
      ],
      claimed: {},
      force: false,
    });
    strictEqual(outcome.stamps[0]?.status, 'skipped');
    match(outcome.stamps[0]?.reason ?? '', /`Posts.isDraft` is absent/);
    await db.close();
  });

  it('skips a whole chain on a fresh database when a later FROM consumes each TO', async () => {
    const db = await open();
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-move', {
          from: { table: 'Posts', column: 'isDraft', type: 'text' },
          to: { table: 'Posts', column: 'draft', type: 'boolean' },
        }),
        meta('app/002-drop', {
          from: { table: 'Posts', column: 'draft', type: 'boolean' },
          to: null,
        }),
      ],
      desired: [],
      claimed: {},
      force: false,
    });
    deepStrictEqual(
      outcome.stamps.map((stamp) => stamp.status),
      ['skipped', 'skipped'],
    );
    await db.close();
  });

  it('refuses a migration whose FROM is absent while TO is nowhere', async () => {
    const db = await open();
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-stale', {
            from: { table: 'Posts', column: 'isDraft', type: 'text' },
            to: { table: 'Posts', column: 'draft', type: 'boolean' },
          }),
        ],
        desired: [],
        claimed: {},
        force: false,
      }),
      /cannot run/,
    );
    await db.close();
  });

  it('refuses a FROM whose live type drifted, never skipping it', async () => {
    const db = await open();
    const posts = table('Posts', {
      columns: [UUID, { name: 'count', type: 'integer', notNull: false }],
    });
    await materialize(db, [posts]);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-drift', {
            from: { table: 'Posts', column: 'count', type: 'text' },
            to: { table: 'Posts', column: 'total', type: 'text' },
          }),
        ],
        desired: [],
        claimed: classifySchema([posts]),
        force: false,
      }),
      /does not match the live schema/,
    );
    await db.close();
  });

  it('refuses a migration addressing a foreign table', async () => {
    const db = await open();
    await db.exec('CREATE TABLE "Theirs" ("id" TEXT PRIMARY KEY)');
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [meta('app/001-theirs', { from: { table: 'Theirs' }, to: null })],
        desired: [],
        claimed: {},
        force: false,
      }),
      /foreign table/,
    );
    await db.close();
  });

  it('refuses a migration mixing a column and a table address', async () => {
    const db = await open();
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-mixed', {
            from: { table: 'Posts', column: 'isDraft', type: 'text' },
            to: { table: 'Articles' },
          } as Migration),
        ],
        desired: [],
        claimed: {},
        force: false,
      }),
      /mixes a column and a table address/,
    );
    await db.close();
  });

  it('refuses to move a primary-key column away', async () => {
    const db = await open();
    const posts = table('Posts');
    await materialize(db, [posts]);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-pk', {
            from: { table: 'Posts', column: 'UUID', type: 'text' },
            to: { table: 'Posts', column: 'id', type: 'text' },
          }),
        ],
        desired: [],
        claimed: classifySchema([posts]),
        force: false,
      }),
      /primary-key column/,
    );
    await db.close();
  });
});
