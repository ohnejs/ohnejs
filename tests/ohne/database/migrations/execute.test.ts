import { deepStrictEqual, match, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { Migration } from '../../../../src/ohne/database/migrations/define-migration.ts';
import type { MigrationMeta } from '../../../../src/ohne/database/migrations/use-migrations.ts';
import type { TableSchema } from '../../../../src/ohne/database/schema/table-schema.ts';

import { executeMigrations } from '../../../../src/ohne/database/migrations/execute.ts';
import { classifySchema } from '../../../../src/ohne/database/schema/snapshot.ts';
import { truncateWithHash } from '../../../../src/utils/crypto/index.ts';
import { connectTest, dialect } from '../../../_dialect.ts';

const UUID = { name: 'UUID', type: 'text', notNull: true } as const;

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
    await dialect.applyTableDiff(db, { kind: 'create', table: schema });
  }
}

async function columnNames(db: DatabaseAdapter, name: string): Promise<string[]> {
  const schema = await dialect.describeTable(db, name);
  return schema.columns.map((column) => column.name);
}

describe('executeMigrations', () => {
  it('moves a column within a table, transforming values and dropping FROM', async () => {
    const db = await connectTest();
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
    deepStrictEqual(outcome.claimed['Posts'], { columns: { UUID: 'text', draft: 'boolean' } });
    await db.close();
  });

  it('moves a column onto its case-only rename, values kept', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID", "title") VALUES (?, ?), (?, ?)', [
      'a',
      'A',
      'b',
      'B',
    ]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-case', {
          from: { table: 'Posts', column: 'title', type: 'text' },
          to: { table: 'Posts', column: 'tiTle', type: 'text' },
        }),
      ],
      desired: [],
      claimed: classifySchema([posts]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-case', status: 'applied' }]);
    deepStrictEqual(await columnNames(db, 'Posts'), ['UUID', 'tiTle']);
    const rows = await db.query<{ tiTle: string }>('SELECT "tiTle" FROM "Posts" ORDER BY "UUID"');
    deepStrictEqual(
      rows.map((row) => row.tiTle),
      ['A', 'B'],
    );
    deepStrictEqual(outcome.claimed['Posts'], { columns: { UUID: 'text', tiTle: 'text' } });
    await db.close();
  });

  it('refuses a move onto a live column of another spelling', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [
        UUID,
        { name: 'title', type: 'text', notNull: false },
        { name: 'other', type: 'text', notNull: false },
      ],
    });
    await materialize(db, [posts]);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-clash', {
            from: { table: 'Posts', column: 'other', type: 'text' },
            to: { table: 'Posts', column: 'TITLE', type: 'text' },
          }),
        ],
        desired: [],
        claimed: classifySchema([posts]),
        force: false,
      }),
      /lands on an existing column/,
    );
    await db.close();
  });

  it('refuses a fill onto a live column of another spelling', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    await materialize(db, [posts]);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-clash', {
            from: null,
            to: { table: 'Posts', column: 'TITLE', type: 'text' },
            transform: () => 'x',
          }),
        ],
        desired: [
          table('Posts', { columns: [UUID, { name: 'TITLE', type: 'text', notNull: false }] }),
        ],
        claimed: classifySchema([posts]),
        force: false,
      }),
      /lands on an existing column/,
    );
    await db.close();
  });

  it('retypes a column physically on a same-column move, values carried through', async () => {
    const db = await connectTest();
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
    strictEqual(outcome.claimed['Posts']?.columns['flag'], 'boolean');
    await db.close();
  });

  it('moves values across tables onto rows sharing the primary key', async () => {
    const db = await connectTest();
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
    const db = await connectTest();
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
    match(outcome.deletions[0] ?? '', /`1` `Posts.title` value/);
    deepStrictEqual(await columnNames(db, 'Posts'), ['UUID']);
    await db.close();
  });

  it('materializes a missing TO table from the desired schema, without its indexes', async () => {
    const db = await connectTest();
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
    deepStrictEqual(outcome.claimed['Archive'], { columns: { UUID: 'text', title: 'text' } });
    await db.close();
  });

  it('materializes a missing TO column as nullable from the address itself', async () => {
    const db = await connectTest();
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
    const db = await connectTest();
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
    const db = await connectTest();
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
    await db.run('INSERT INTO "Authors" ("UUID", "handle") VALUES (?, ?)', ['u1', 'anduin']);
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
      ['anduin'],
    );
    await db.close();
  });

  it('renames a table and follows it in the claim record', async () => {
    const db = await connectTest();
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

  it('cascades a rename over the derived tables the claims own', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const junction = table('Posts_authors', {
      primaryKey: [],
      derived: { collection: 'Posts', path: ['authors'], kind: 'junction' },
    });
    const items = table('Posts_sections_items', {
      derived: { collection: 'Posts', path: ['sections', 'items'], kind: 'childMany' },
    });
    const foreign = table('Users_pets', {
      derived: { collection: 'Users', path: ['pets'], kind: 'junction' },
    });
    await materialize(db, [posts, junction, items, foreign]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-articles', { from: { table: 'Posts' }, to: { table: 'Articles' } }),
      ],
      desired: [],
      claimed: classifySchema([posts, junction, items, foreign]),
      force: false,
    });
    deepStrictEqual(await dialect.listTables(db), [
      'Articles',
      'Articles_authors',
      'Articles_sections_items',
      'Users_pets',
    ]);
    deepStrictEqual(outcome.claimed['Articles_authors']?.derived, {
      collection: 'Articles',
      path: ['authors'],
      kind: 'junction',
    });
    deepStrictEqual(outcome.claimed['Articles_sections_items']?.derived, {
      collection: 'Articles',
      path: ['sections', 'items'],
      kind: 'childMany',
    });
    deepStrictEqual(outcome.claimed['Users_pets']?.derived, {
      collection: 'Users',
      path: ['pets'],
      kind: 'junction',
    });
    await db.close();
  });

  it('refuses a cascade onto a truncated name, and allows one without derived tables', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const junction = table('Posts_authors', {
      primaryKey: [],
      derived: { collection: 'Posts', path: ['authors'], kind: 'junction' },
    });
    const users = table('Users');
    await materialize(db, [posts, junction, users]);
    const long = truncateWithHash(`A${'b'.repeat(70)}`);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [meta('app/001-long', { from: { table: 'Posts' }, to: { table: long } })],
        desired: [],
        claimed: classifySchema([posts, junction, users]),
        force: false,
      }),
      /cannot cascade onto a truncated name/,
    );
    const outcome = await executeMigrations(db, dialect, {
      migrations: [meta('app/002-long', { from: { table: 'Users' }, to: { table: long } })],
      desired: [],
      claimed: classifySchema([posts, junction, users]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/002-long', status: 'applied' }]);
    ok((await dialect.listTables(db)).includes(long));
    await db.close();
  });

  it('allows a case-only rename and refuses renaming onto an occupied name', async () => {
    const db = await connectTest();
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
    const db = await connectTest();
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
    deepStrictEqual(outcome.claimed['Posts'], { columns: { UUID: 'text' } });
    await db.close();
  });

  it('discards a whole table on purpose', async () => {
    const db = await connectTest();
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
    const db = await connectTest();
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
    const db = await connectTest();
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
    const db = await connectTest();
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
    const db = await connectTest();
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
    const db = await connectTest();
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
    const db = await connectTest();
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
    const db = await connectTest();
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

describe('executeMigrations with logical addresses', () => {
  it('moves a field logically, the types read from the claims and the desired schema', async () => {
    const db = await connectTest();
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
          from: { collection: 'Posts', field: 'isDraft' },
          to: { collection: 'Posts', field: 'draft' },
          transform: (value) => value === 'yes',
        }),
      ],
      desired: [
        table('Posts', {
          columns: [UUID, { name: 'draft', type: 'boolean', notNull: false }],
        }),
      ],
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
    deepStrictEqual(outcome.claimed['Posts'], { columns: { UUID: 'text', draft: 'boolean' } });
    await db.close();
  });

  it('moves a dot-path column on a child table, correlated through `_parentUUID`', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'summary', type: 'text', notNull: false }],
    });
    const sections = table('Posts_sections', {
      columns: [
        UUID,
        { name: '_parentUUID', type: 'text', notNull: true },
        { name: 'intro', type: 'text', notNull: false },
      ],
      derived: { collection: 'Posts', path: ['sections'], kind: 'childOne' },
    });
    await materialize(db, [posts, sections]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['p1']);
    await db.run('INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "intro") VALUES (?, ?, ?)', [
      's1',
      'p1',
      'hello',
    ]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-promote', {
          from: { collection: 'Posts', field: 'sections.intro' },
          to: { collection: 'Posts', field: 'summary' },
        }),
      ],
      desired: [],
      claimed: classifySchema([posts, sections]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-promote', status: 'applied' }]);
    const rows = await db.query<{ summary: string }>('SELECT "summary" FROM "Posts"');
    deepStrictEqual(
      rows.map((row) => row.summary),
      ['hello'],
    );
    deepStrictEqual(await columnNames(db, 'Posts_sections'), ['UUID', '_parentUUID']);
    await db.close();
  });

  it('renames a collection as a compound, every owned table and claim origin following', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const tags = table('Posts_tags', {
      columns: [
        { name: '_parentUUID', type: 'text', notNull: true },
        { name: '_targetUUID', type: 'text', notNull: true },
      ],
      primaryKey: [],
      derived: { collection: 'Posts', path: ['tags'], kind: 'junction' },
    });
    const sections = table('Posts_sections', {
      columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
      derived: { collection: 'Posts', path: ['sections'], kind: 'childMany' },
    });
    const items = table('Posts_sections_items', {
      columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
      derived: { collection: 'Posts', path: ['sections', 'items'], kind: 'childMany' },
    });
    await materialize(db, [posts, tags, sections, items]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-articles', {
          from: { collection: 'Posts' },
          to: { collection: 'Articles' },
        }),
      ],
      desired: [],
      claimed: classifySchema([posts, tags, sections, items]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-articles', status: 'applied' }]);
    const names = await dialect.listTables(db);
    deepStrictEqual(names.filter((name) => !name.startsWith('ohne_')).sort(), [
      'Articles',
      'Articles_sections',
      'Articles_sections_items',
      'Articles_tags',
    ]);
    deepStrictEqual(outcome.claimed['Articles_sections_items']?.derived, {
      collection: 'Articles',
      path: ['sections', 'items'],
      kind: 'childMany',
    });
    deepStrictEqual(outcome.claimed['Articles_tags']?.derived, {
      collection: 'Articles',
      path: ['tags'],
      kind: 'junction',
    });
    await db.close();
  });

  it('composes a compound rename with a same-sync field migration', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const sections = table('Posts_sections', {
      columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
      derived: { collection: 'Posts', path: ['sections'], kind: 'childMany' },
    });
    await materialize(db, [posts, sections]);
    const desired = [
      table('Articles'),
      table('Articles_chapters', {
        columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
        derived: { collection: 'Articles', path: ['chapters'], kind: 'childMany' },
      }),
    ];
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-chapters', {
          from: { collection: 'Posts', field: 'sections' },
          to: { collection: 'Posts', field: 'chapters' },
        }),
        meta('app/002-articles', {
          from: { collection: 'Posts' },
          to: { collection: 'Articles' },
        }),
      ],
      desired,
      claimed: classifySchema([posts, sections]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [
      { name: 'app/001-chapters', status: 'applied' },
      { name: 'app/002-articles', status: 'applied' },
    ]);
    const names = await dialect.listTables(db);
    deepStrictEqual(names.filter((name) => !name.startsWith('ohne_')).sort(), [
      'Articles',
      'Articles_chapters',
    ]);
    deepStrictEqual(outcome.claimed['Articles_chapters']?.derived, {
      collection: 'Articles',
      path: ['chapters'],
      kind: 'childMany',
    });
    await db.close();
  });

  it('skips an absent family member whose new name is satisfied, applying the rest', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    await materialize(db, [posts]);
    const claimed = classifySchema([
      posts,
      table('Posts_sections', {
        columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
        derived: { collection: 'Posts', path: ['sections'], kind: 'childMany' },
      }),
    ]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-articles', {
          from: { collection: 'Posts' },
          to: { collection: 'Articles' },
        }),
      ],
      desired: [
        table('Articles'),
        table('Articles_sections', {
          columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
          derived: { collection: 'Articles', path: ['sections'], kind: 'childMany' },
        }),
      ],
      claimed,
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-articles', status: 'applied' }]);
    ok((await dialect.listTables(db)).includes('Articles'));
    await db.close();
  });

  it('skips a whole logical chain on a fresh database, reading no FROM type', async () => {
    const db = await connectTest();
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-move', {
          from: { collection: 'Posts', field: 'a' },
          to: { collection: 'Posts', field: 'b', type: 'text' },
        }),
        meta('app/002-discard', {
          from: { collection: 'Posts', field: 'b' },
          to: null,
        }),
        meta('app/003-rename', {
          from: { collection: 'Posts' },
          to: { collection: 'Articles' },
        }),
      ],
      desired: [table('Articles')],
      claimed: {},
      force: false,
    });
    deepStrictEqual(
      outcome.stamps.map((stamp) => stamp.status),
      ['skipped', 'skipped', 'skipped'],
    );
    await db.close();
  });

  it('skips a move onto a derived table a later collection rename consumes, fresh database', async () => {
    const db = await connectTest();
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-fresh', {
          from: { collection: 'Posts', field: 'sections.old' },
          to: { collection: 'Posts', field: 'sections.fresh', type: 'text' },
        }),
        meta('app/002-articles', {
          from: { collection: 'Posts' },
          to: { collection: 'Articles' },
        }),
      ],
      desired: [
        table('Articles'),
        table('Articles_sections', {
          columns: [
            UUID,
            { name: '_parentUUID', type: 'text', notNull: true },
            { name: 'fresh', type: 'text', notNull: false },
          ],
          derived: { collection: 'Articles', path: ['sections'], kind: 'childMany' },
        }),
      ],
      claimed: {},
      force: false,
    });
    deepStrictEqual(
      outcome.stamps.map((stamp) => stamp.status),
      ['skipped', 'skipped'],
    );
    await db.close();
  });

  it('skips a field rename a later collection rename consumes, fresh database', async () => {
    const db = await connectTest();
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-parts', {
          from: { collection: 'Posts', field: 'sections' },
          to: { collection: 'Posts', field: 'parts' },
        }),
        meta('app/002-articles', {
          from: { collection: 'Posts' },
          to: { collection: 'Articles' },
        }),
      ],
      desired: [
        table('Articles'),
        table('Articles_parts', {
          columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
          derived: { collection: 'Articles', path: ['parts'], kind: 'childMany' },
        }),
      ],
      claimed: {},
      force: false,
    });
    deepStrictEqual(
      outcome.stamps.map((stamp) => stamp.status),
      ['skipped', 'skipped'],
    );
    await db.close();
  });

  it('skips an unpinned chain on a fresh database: no intermediate demands a type', async () => {
    const db = await connectTest();
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-chapters', {
          from: { collection: 'Posts', field: 'sections' },
          to: { collection: 'Posts', field: 'chapters' },
        }),
        meta('app/002-parts', {
          from: { collection: 'Posts', field: 'chapters' },
          to: { collection: 'Posts', field: 'parts' },
        }),
        meta('app/003-title', {
          from: { collection: 'Posts', field: 'heading' },
          to: { collection: 'Posts', field: 'caption' },
        }),
        meta('app/004-label', {
          from: { collection: 'Posts', field: 'caption' },
          to: { collection: 'Posts', field: 'label' },
        }),
      ],
      desired: [
        table('Posts', { columns: [UUID, { name: 'label', type: 'text', notNull: false }] }),
        table('Posts_parts', {
          columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
          derived: { collection: 'Posts', path: ['parts'], kind: 'childMany' },
        }),
      ],
      claimed: {},
      force: false,
    });
    deepStrictEqual(
      outcome.stamps.map((stamp) => stamp.status),
      ['skipped', 'skipped', 'skipped', 'skipped'],
    );
    await db.close();
  });

  it('discards a composite field as a compound, nested children first', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const sections = table('Posts_sections', {
      columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
      derived: { collection: 'Posts', path: ['sections'], kind: 'childMany' },
    });
    const items = table('Posts_sections_items', {
      columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
      derived: { collection: 'Posts', path: ['sections', 'items'], kind: 'childMany' },
    });
    await materialize(db, [posts, sections, items]);
    await db.run('INSERT INTO "Posts_sections" ("UUID", "_parentUUID") VALUES (?, ?)', [
      's1',
      'p1',
    ]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-drop', { from: { collection: 'Posts', field: 'sections' }, to: null }),
      ],
      desired: [],
      claimed: classifySchema([posts, sections, items]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-drop', status: 'applied' }]);
    const names = await dialect.listTables(db);
    deepStrictEqual(names.filter((name) => !name.startsWith('ohne_')).sort(), ['Posts']);
    strictEqual(outcome.claimed['Posts_sections'], undefined);
    strictEqual(outcome.claimed['Posts_sections_items'], undefined);
    await db.close();
  });

  it('renames through the TO-tree bootstrap when the snapshot predates ownership', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const sections = table('Posts_sections', {
      columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
    });
    await materialize(db, [posts, sections]);
    const desired = [
      table('Articles'),
      table('Articles_sections', {
        columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
        derived: { collection: 'Articles', path: ['sections'], kind: 'childMany' },
      }),
    ];
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-articles', {
          from: { collection: 'Posts' },
          to: { collection: 'Articles' },
        }),
      ],
      desired,
      claimed: classifySchema([posts, sections]),
      force: false,
      ownership: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-articles', status: 'applied' }]);
    const names = await dialect.listTables(db);
    deepStrictEqual(names.filter((name) => !name.startsWith('ohne_')).sort(), [
      'Articles',
      'Articles_sections',
    ]);
    deepStrictEqual(outcome.claimed['Articles_sections']?.derived, {
      collection: 'Articles',
      path: ['sections'],
      kind: 'childMany',
    });
    await db.close();
  });

  it('refuses a move onto a junction with the many-rows wording, not a key mismatch', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'note', type: 'text', notNull: false }],
    });
    const tags = table('Posts_tags', {
      columns: [
        { name: '_parentUUID', type: 'text', notNull: true },
        { name: 'label', type: 'text', notNull: false },
      ],
      primaryKey: [],
      derived: { collection: 'Posts', path: ['tags'], kind: 'junction' },
    });
    await materialize(db, [posts, tags]);
    await db.run('INSERT INTO "Posts" ("UUID", "note") VALUES (?, ?)', ['a', 'x']);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-junction', {
            from: { collection: 'Posts', field: 'note' },
            to: { collection: 'Posts', field: 'tags.label' },
          }),
        ],
        desired: [],
        claimed: classifySchema([posts, tags]),
        force: false,
      }),
      (error: Error & { body?: string[] }) =>
        /cannot correlate rows/.test(error.message) &&
        /holds many rows per `Posts` row/.test(String(error.body)),
    );
    await db.close();
  });

  it('names the migration when its transform throws', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'flag', type: 'text', notNull: false }],
    });
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID", "flag") VALUES (?, ?)', ['a', 'zzz']);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-flag', {
            from: { collection: 'Posts', field: 'flag' },
            to: { collection: 'Posts', field: 'draft', type: 'boolean' },
            transform: () => {
              throw new Error('cannot parse legacy flag');
            },
          }),
        ],
        desired: [],
        claimed: classifySchema([posts]),
        force: false,
      }),
      (error: Error & { body?: string[] }) =>
        /Migration `app\/001-flag` fails in its transform/.test(error.message) &&
        /cannot parse legacy flag/.test(String(error.body)),
    );
    await db.close();
  });

  it('refuses to move `NULL` into a `NOT NULL` column instead of leaking the constraint', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'opt', type: 'text', notNull: false }],
    });
    const archive = table('Archive', {
      columns: [UUID, { name: 'req', type: 'text', notNull: true }],
    });
    await materialize(db, [posts, archive]);
    await db.run('INSERT INTO "Posts" ("UUID", "opt") VALUES (?, ?)', ['a', null]);
    await db.run('INSERT INTO "Archive" ("UUID", "req") VALUES (?, ?)', ['a', 'seed']);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-tighten', {
            from: { collection: 'Posts', field: 'opt' },
            to: { collection: 'Archive', field: 'req' },
          }),
        ],
        desired: [],
        claimed: classifySchema([posts, archive]),
        force: false,
      }),
      /moves `NULL` into a `NOT NULL` column/,
    );
    await db.close();
  });

  it('refuses a bootstrap rename when the same deploy edited the field tree', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const sections = table('Posts_sections', {
      columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
    });
    await materialize(db, [posts, sections]);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-articles', {
            from: { collection: 'Posts' },
            to: { collection: 'Articles' },
          }),
        ],
        desired: [
          table('Articles'),
          table('Articles_chapters', {
            columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
            derived: { collection: 'Articles', path: ['chapters'], kind: 'childMany' },
          }),
        ],
        claimed: classifySchema([posts, sections]),
        force: false,
        ownership: false,
      }),
      /cannot verify the rename family/,
    );
    await db.close();
  });
});

describe('executeMigrations over the translations companion', () => {
  function companionSchema(collection: string): TableSchema {
    return table(`${collection}__translations`, {
      columns: [
        { name: '_parentUUID', type: 'text', notNull: true },
        { name: '_localeCode', type: 'text', notNull: true },
        { name: 'title', type: 'text', notNull: true },
      ],
      primaryKey: ['_parentUUID', '_localeCode'],
      companion: collection,
    });
  }

  it('cascades a physical collection rename over the claimed companion', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const companion = companionSchema('Posts');
    await materialize(db, [posts, companion]);
    await db.run(
      'INSERT INTO "Posts__translations" ("_parentUUID", "_localeCode", "title") VALUES (?, ?, ?)',
      ['p1', 'en', 'Hello'],
    );
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-articles', { from: { table: 'Posts' }, to: { table: 'Articles' } }),
      ],
      desired: [],
      claimed: classifySchema([posts, companion]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-articles', status: 'applied' }]);
    deepStrictEqual(await columnNames(db, 'Articles__translations'), [
      '_parentUUID',
      '_localeCode',
      'title',
    ]);
    deepStrictEqual(outcome.claimed['Articles__translations'], {
      columns: { _parentUUID: 'text', _localeCode: 'text', title: 'text' },
      companion: 'Articles',
    });
    strictEqual(outcome.claimed['Posts__translations'], undefined);
    await db.close();
  });

  it('installs the companion claim through a logical rename compound', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const companion = companionSchema('Posts');
    await materialize(db, [posts, companion]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-articles', { from: { collection: 'Posts' }, to: { collection: 'Articles' } }),
      ],
      desired: [],
      claimed: classifySchema([posts, companion]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-articles', status: 'applied' }]);
    deepStrictEqual(outcome.claimed['Articles__translations']?.companion, 'Articles');
    await db.close();
  });
});

describe('executeMigrations with block addresses', () => {
  const wrapperColumns = [
    UUID,
    { name: '_parentUUID', type: 'text', notNull: true },
    { name: '_parentPosition', type: 'integer', notNull: true },
    { name: '_blockType', type: 'text', notNull: true },
    { name: '_blockUUID', type: 'text', notNull: true },
  ] as const;

  it('renames a block as a compound, wrapper rows and claims rewritten', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const wrapper = table('Posts_content', {
      columns: [...wrapperColumns],
      derived: {
        collection: 'Posts',
        path: ['content'],
        kind: 'blocksWrapper',
        allow: ['Hero', 'Quote'],
      },
    });
    const hero = table('block_Hero', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
      block: 'Hero',
    });
    const links = table('block_Hero_links', {
      columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
      derived: { block: 'Hero', path: ['links'], kind: 'childMany' },
    });
    const quote = table('block_Quote', { columns: [UUID], block: 'Quote' });
    await materialize(db, [posts, wrapper, hero, links, quote]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['p1']);
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'hello']);
    await db.run('INSERT INTO "block_Quote" ("UUID") VALUES (?)', ['q1']);
    await db.run('INSERT INTO "block_Hero_links" ("UUID", "_parentUUID") VALUES (?, ?)', [
      'l1',
      'h1',
    ]);
    await db.run(
      'INSERT INTO "Posts_content" ' +
        '("UUID", "_parentUUID", "_parentPosition", "_blockType", "_blockUUID") ' +
        'VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
      ['w1', 'p1', 0, 'Hero', 'h1', 'w2', 'p1', 1, 'Quote', 'q1'],
    );
    const outcome = await executeMigrations(db, dialect, {
      migrations: [meta('app/001-banner', { from: { block: 'Hero' }, to: { block: 'Banner' } })],
      desired: [],
      claimed: classifySchema([posts, wrapper, hero, links, quote]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-banner', status: 'applied' }]);
    deepStrictEqual(await columnNames(db, 'block_Banner'), ['UUID', 'title']);
    deepStrictEqual(await columnNames(db, 'block_Banner_links'), ['UUID', '_parentUUID']);
    const rows = await db.query<{ UUID: string; _blockType: string }>(
      'SELECT "UUID", "_blockType" FROM "Posts_content" ORDER BY "UUID"',
    );
    deepStrictEqual(
      rows.map((row) => [row.UUID, row._blockType]),
      [
        ['w1', 'Banner'],
        ['w2', 'Quote'],
      ],
    );
    const titles = await db.query<{ title: string }>('SELECT "title" FROM "block_Banner"');
    deepStrictEqual(
      titles.map((row) => row.title),
      ['hello'],
    );
    strictEqual(outcome.claimed['block_Banner']?.block, 'Banner');
    deepStrictEqual(outcome.claimed['block_Banner_links']?.derived, {
      block: 'Banner',
      path: ['links'],
      kind: 'childMany',
    });
    strictEqual(outcome.claimed['block_Hero'], undefined);
    await db.close();
  });

  it('skips a block chain end to end on a fresh database', async () => {
    const db = await connectTest();
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-heading', {
          from: { block: 'Hero', field: 'title' },
          to: { block: 'Hero', field: 'heading' },
        }),
        meta('app/002-banner', { from: { block: 'Hero' }, to: { block: 'Banner' } }),
      ],
      desired: [
        table('block_Banner', {
          columns: [UUID, { name: 'heading', type: 'text', notNull: false }],
          block: 'Banner',
        }),
      ],
      claimed: {},
      force: false,
    });
    deepStrictEqual(outcome.stamps, [
      {
        name: 'app/001-heading',
        status: 'skipped',
        reason: '`block_Hero.title` is absent and `block_Hero.heading` is satisfied',
      },
      {
        name: 'app/002-banner',
        status: 'skipped',
        reason: '`block_Hero` is absent and the new names are satisfied',
      },
    ]);
    await db.close();
  });

  it('moves a block column in place, retyping through the transform', async () => {
    const db = await connectTest();
    const hero = table('block_Hero', {
      columns: [UUID, { name: 'size', type: 'text', notNull: false }],
      block: 'Hero',
    });
    await materialize(db, [hero]);
    await db.run('INSERT INTO "block_Hero" ("UUID", "size") VALUES (?, ?), (?, ?)', [
      'h1',
      '10',
      'h2',
      '20',
    ]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-size', {
          from: { block: 'Hero', field: 'size', type: 'text' },
          to: { block: 'Hero', field: 'size', type: 'integer' },
          transform: (value) => Number(value),
        }),
      ],
      desired: [],
      claimed: classifySchema([hero]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-size', status: 'applied' }]);
    const rows = await db.query<{ UUID: string; size: number }>(
      'SELECT "UUID", "size" FROM "block_Hero" ORDER BY "UUID"',
    );
    deepStrictEqual(
      rows.map((row) => [row.UUID, row.size]),
      [
        ['h1', 10],
        ['h2', 20],
      ],
    );
    await db.close();
  });

  it('discards a composite inside a block as a compound', async () => {
    const db = await connectTest();
    const hero = table('block_Hero', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
      block: 'Hero',
    });
    const links = table('block_Hero_links', {
      columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
      derived: { block: 'Hero', path: ['links'], kind: 'childMany' },
    });
    await materialize(db, [hero, links]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-drop-links', { from: { block: 'Hero', field: 'links' }, to: null }),
      ],
      desired: [],
      claimed: classifySchema([hero, links]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-drop-links', status: 'applied' }]);
    const tables = await dialect.listTables(db);
    ok(!tables.includes('block_Hero_links'));
    ok(tables.includes('block_Hero'));
    await db.close();
  });

  it('deletes wrapper links when a block-field switch deletes instances', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const wrapper = table('Posts_content', {
      columns: [...wrapperColumns],
      derived: { collection: 'Posts', path: ['content'], kind: 'blocksWrapper', allow: ['Hero'] },
    });
    const hero = table('block_Hero', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
      block: 'Hero',
    });
    await materialize(db, [posts, wrapper, hero]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['p1']);
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?), (?, ?)', [
      'h1',
      'keep',
      'h2',
      null,
    ]);
    await db.run(
      'INSERT INTO "Posts_content" ' +
        '("UUID", "_parentUUID", "_parentPosition", "_blockType", "_blockUUID") ' +
        'VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
      ['w1', 'p1', 0, 'Hero', 'h1', 'w2', 'p1', 1, 'Hero', 'h2'],
    );
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-title-required', {
          from: { block: 'Hero', field: 'title', nullable: true },
          transform: (value, _row, ctx) => (value === null ? ctx.deleteRecord() : undefined),
        }),
      ],
      desired: [
        table('block_Hero', {
          columns: [UUID, { name: 'title', type: 'text', notNull: true }],
          block: 'Hero',
        }),
      ],
      claimed: classifySchema([posts, wrapper, hero]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-title-required', status: 'applied' }]);
    const instances = await db.query<{ UUID: string }>('SELECT "UUID" FROM "block_Hero"');
    deepStrictEqual(
      instances.map((row) => row.UUID),
      ['h1'],
    );
    const wrappers = await db.query<{ UUID: string }>('SELECT "UUID" FROM "Posts_content"');
    deepStrictEqual(
      wrappers.map((row) => row.UUID),
      ['w1'],
    );
    ok(
      outcome.deletions.some((line) =>
        /row of `Posts_content` deleted, referencing deleted `block_Hero` rows/.test(line),
      ),
    );
    await db.close();
  });

  it('composes a block rename with a same-run field discard inside it', async () => {
    const db = await connectTest();
    const hero = table('block_Hero', {
      columns: [
        UUID,
        { name: 'title', type: 'text', notNull: false },
        { name: 'legacy', type: 'text', notNull: false },
      ],
      block: 'Hero',
    });
    await materialize(db, [hero]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-banner', { from: { block: 'Hero' }, to: { block: 'Banner' } }),
        meta('app/002-drop-legacy', { from: { block: 'Banner', field: 'legacy' }, to: null }),
      ],
      desired: [],
      claimed: classifySchema([hero]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [
      { name: 'app/001-banner', status: 'applied' },
      { name: 'app/002-drop-legacy', status: 'applied' },
    ]);
    deepStrictEqual(await columnNames(db, 'block_Banner'), ['UUID', 'title']);
    await db.close();
  });
});

describe('executeMigrations cascade over junctions', () => {
  it('cascades a `deleteRecord` through a plain junction with no locale column', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
    });
    const users = table('Users');
    const junction = table('Posts_authors', {
      columns: [
        { name: '_parentUUID', type: 'text', notNull: true },
        { name: '_targetUUID', type: 'text', notNull: true },
        { name: '_parentPosition', type: 'integer', notNull: true },
      ],
      primaryKey: [],
      derived: { collection: 'Posts', path: ['authors'], kind: 'junction' },
    });
    await materialize(db, [posts, users, junction]);
    await db.run('INSERT INTO "Posts" ("UUID", "title") VALUES (?, ?), (?, ?)', [
      'p1',
      'keep',
      'p2',
      null,
    ]);
    await db.run('INSERT INTO "Users" ("UUID") VALUES (?)', ['a1']);
    await db.run(
      'INSERT INTO "Posts_authors" ("_parentUUID", "_targetUUID", "_parentPosition") ' +
        'VALUES (?, ?, ?), (?, ?, ?)',
      ['p1', 'a1', 0, 'p2', 'a1', 0],
    );
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-title-required', {
          from: { collection: 'Posts', field: 'title', nullable: true },
          transform: (value, _row, ctx) => (value === null ? ctx.deleteRecord() : undefined),
        }),
      ],
      desired: [
        table('Posts', { columns: [UUID, { name: 'title', type: 'text', notNull: true }] }),
      ],
      claimed: classifySchema([posts, users, junction]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-title-required', status: 'applied' }]);
    const kept = await db.query<{ UUID: string }>('SELECT "UUID" FROM "Posts"');
    deepStrictEqual(
      kept.map((row) => row.UUID),
      ['p1'],
    );
    const links = await db.query<{ _parentUUID: string }>(
      'SELECT "_parentUUID" FROM "Posts_authors"',
    );
    deepStrictEqual(
      links.map((row) => row._parentUUID),
      ['p1'],
    );
    ok(
      outcome.deletions.some((line) =>
        /row of `Posts_authors` deleted, following its deleted parent/.test(line),
      ),
    );
    await db.close();
  });
});

describe('executeMigrations references onto a deleted row', () => {
  const authors = table('Authors', {
    columns: [UUID, { name: 'name', type: 'text', notNull: false }],
  });
  const posts = table('Posts', {
    columns: [UUID, { name: 'author', type: 'text', notNull: false }],
    foreignKeys: [
      { column: 'author', targetTable: 'Authors', targetColumn: 'UUID', onDelete: 'setNull' },
    ],
  });
  const reviewers = table('Posts_reviewers', {
    columns: [
      { name: '_parentUUID', type: 'text', notNull: true },
      { name: '_targetUUID', type: 'text', notNull: true },
      { name: '_parentPosition', type: 'integer', notNull: true },
    ],
    primaryKey: [],
    foreignKeys: [
      { column: '_parentUUID', targetTable: 'Posts', targetColumn: 'UUID', onDelete: 'cascade' },
      { column: '_targetUUID', targetTable: 'Authors', targetColumn: 'UUID', onDelete: 'cascade' },
    ],
    derived: { collection: 'Posts', path: ['reviewers'], kind: 'junction' },
  });
  const fans = table('Fans', {
    columns: [UUID, { name: 'favorite', type: 'text', notNull: false }],
    foreignKeys: [
      { column: 'favorite', targetTable: 'Authors', targetColumn: 'UUID', onDelete: 'restrict' },
    ],
  });
  const nameRequired = meta('app/001-name-required', {
    from: { collection: 'Authors', field: 'name', nullable: true },
    transform: (value, _row, ctx) => (value === null ? ctx.deleteRecord() : undefined),
  });
  const desired = table('Authors', {
    columns: [UUID, { name: 'name', type: 'text', notNull: true }],
  });

  /**
   * Seeds two authors, `a2` nameless, and a post that names `a2` as its author and both as reviewers.
   */
  async function seed(db: DatabaseAdapter, schemas: TableSchema[]): Promise<void> {
    await materialize(db, schemas);
    await db.run('INSERT INTO "Authors" ("UUID", "name") VALUES (?, ?), (?, ?)', [
      'a1',
      'Thrall',
      'a2',
      null,
    ]);
    await db.run('INSERT INTO "Posts" ("UUID", "author") VALUES (?, ?)', ['p1', 'a2']);
    await db.run(
      'INSERT INTO "Posts_reviewers" ("_parentUUID", "_targetUUID", "_parentPosition") ' +
        'VALUES (?, ?, ?), (?, ?, ?)',
      ['p1', 'a1', 0, 'p1', 'a2', 1],
    );
  }

  it('follows each reference by its `onDelete`, foreign keys off as the sync runs', async () => {
    const db = await connectTest();
    await seed(db, [authors, posts, reviewers]);
    const outcome = await dialect.schemaTransaction(db, (tx) =>
      executeMigrations(tx, dialect, {
        migrations: [nameRequired],
        desired: [desired],
        claimed: classifySchema([authors, posts, reviewers]),
        force: false,
      }),
    );
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-name-required', status: 'applied' }]);
    deepStrictEqual(
      (await db.query<{ UUID: string }>('SELECT "UUID" FROM "Authors"')).map((row) => row.UUID),
      ['a1'],
    );
    deepStrictEqual(
      (await db.query<{ author: string | null }>('SELECT "author" FROM "Posts"')).map(
        (row) => row.author,
      ),
      [null],
    );
    deepStrictEqual(
      (await db.query<{ _targetUUID: string }>('SELECT "_targetUUID" FROM "Posts_reviewers"')).map(
        (row) => row._targetUUID,
      ),
      ['a1'],
    );
    ok(
      outcome.deletions.some((line) =>
        /`1` row of `Posts_reviewers` deleted, referencing deleted `Authors` rows/.test(line),
      ),
      outcome.deletions.join('\n'),
    );
    await db.close();
  });

  it('refuses to delete a row a restricting reference still holds', async () => {
    const db = await connectTest();
    await seed(db, [authors, posts, reviewers, fans]);
    await db.run('INSERT INTO "Fans" ("UUID", "favorite") VALUES (?, ?)', ['f1', 'a2']);
    await rejects(
      dialect.schemaTransaction(db, (tx) =>
        executeMigrations(tx, dialect, {
          migrations: [nameRequired],
          desired: [desired],
          claimed: classifySchema([authors, posts, reviewers, fans]),
          force: false,
        }),
      ),
      { message: 'Migration `app/001-name-required` deletes rows `Fans` still references' },
    );
    deepStrictEqual(
      (await db.query<{ UUID: string }>('SELECT "UUID" FROM "Authors" ORDER BY "UUID"')).map(
        (row) => row.UUID,
      ),
      ['a1', 'a2'],
    );
    await db.close();
  });
});

describe('executeMigrations materializes translatable child rows', () => {
  it('stamps a fresh locale-scoped child-one row at the default locale', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'subtitle', type: 'text', notNull: false }],
    });
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID", "subtitle") VALUES (?, ?)', ['p1', 'hello']);
    const postsMeta = table('Posts_meta', {
      columns: [
        UUID,
        { name: '_parentUUID', type: 'text', notNull: true },
        { name: '_localeCode', type: 'text', notNull: true },
        { name: 'subtitle', type: 'text', notNull: false },
      ],
      derived: { collection: 'Posts', path: ['meta'], kind: 'childOne' },
    });
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-nest-subtitle', {
          from: { collection: 'Posts', field: 'subtitle' },
          to: { collection: 'Posts', field: 'meta.subtitle' },
        }),
      ],
      desired: [table('Posts'), postsMeta],
      claimed: classifySchema([posts]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-nest-subtitle', status: 'applied' }]);
    const rows = await db.query<{ _parentUUID: string; _localeCode: string; subtitle: string }>(
      'SELECT "_parentUUID", "_localeCode", "subtitle" FROM "Posts_meta"',
    );
    deepStrictEqual(
      rows.map((row) => [row._parentUUID, row._localeCode, row.subtitle]),
      [['p1', 'en', 'hello']],
    );
    deepStrictEqual(await columnNames(db, 'Posts'), ['UUID']);
    await db.close();
  });
});

describe('executeMigrations with fills', () => {
  const flagged = table('Posts', {
    columns: [UUID, { name: 'flag', type: 'boolean', notNull: true }],
  });

  it('adds a missing column nullable and fills every row', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?), (?)', ['a', 'b']);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-flag', {
          from: null,
          to: { collection: 'Posts', field: 'flag' },
          transform: () => true,
        }),
      ],
      desired: [flagged],
      claimed: classifySchema([posts]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-flag', status: 'applied' }]);
    const live = await dialect.describeTable(db, 'Posts');
    deepStrictEqual(
      live.columns.find((column) => column.name === 'flag'),
      { name: 'flag', type: 'integer', notNull: false },
    );
    const rows = await db.query<{ UUID: string; flag: number }>(
      'SELECT "UUID", "flag" FROM "Posts" ORDER BY "UUID"',
    );
    deepStrictEqual(
      rows.map((row) => [row.UUID, row.flag]),
      [
        ['a', 1],
        ['b', 1],
      ],
    );
    strictEqual(outcome.claimed['Posts']?.columns['flag'], 'boolean');
    await db.close();
  });

  it('fills only the NULL cells of a live nullable column, set values untouched', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'note', type: 'text', notNull: false }],
    });
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID", "note") VALUES (?, ?), (?, ?)', [
      'a',
      null,
      'b',
      'kept',
    ]);
    let calls = 0;
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-note', {
          from: null,
          to: { collection: 'Posts', field: 'note' },
          transform: () => {
            calls++;
            return 'filled';
          },
        }),
      ],
      desired: [table('Posts', { columns: [UUID, { name: 'note', type: 'text', notNull: true }] })],
      claimed: classifySchema([posts]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-note', status: 'applied' }]);
    strictEqual(calls, 1);
    const rows = await db.query<{ UUID: string; note: string }>(
      'SELECT "UUID", "note" FROM "Posts" ORDER BY "UUID"',
    );
    deepStrictEqual(
      rows.map((row) => [row.UUID, row.note]),
      [
        ['a', 'filled'],
        ['b', 'kept'],
      ],
    );
    await db.close();
  });

  it('hands the transform `null`, the deserialized row, and a queryable `ctx`', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'draft', type: 'boolean', notNull: true }],
    });
    const authors = table('Authors', {
      columns: [UUID, { name: 'name', type: 'text', notNull: true }],
    });
    await materialize(db, [posts, authors]);
    await db.run('INSERT INTO "Authors" ("UUID", "name") VALUES (?, ?)', ['u1', 'Ada']);
    await db.run('INSERT INTO "Posts" ("UUID", "draft") VALUES (?, ?)', ['p1', 1]);
    const seen: unknown[] = [];
    await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-author', {
          from: null,
          to: { collection: 'Posts', field: 'authorName' },
          transform: async (value, row, ctx) => {
            seen.push(value, row);
            const author = await ctx.queryOne<{ name: string }>(
              'SELECT "name" FROM "Authors" WHERE "UUID" = ?',
              ['u1'],
            );
            return `${author?.name} on ${row.draft === true ? 'a draft' : 'a post'}`;
          },
        }),
      ],
      desired: [
        table('Posts', {
          columns: [
            UUID,
            { name: 'draft', type: 'boolean', notNull: true },
            { name: 'authorName', type: 'text', notNull: true },
          ],
        }),
        authors,
      ],
      claimed: classifySchema([posts, authors]),
      force: false,
    });
    deepStrictEqual(seen, [null, { UUID: 'p1', draft: true, authorName: null }]);
    const rows = await db.query<{ authorName: string }>('SELECT "authorName" FROM "Posts"');
    deepStrictEqual(
      rows.map((row) => row.authorName),
      ['Ada on a draft'],
    );
    await db.close();
  });

  it('leaves a row NULL when the transform returns nothing', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?), (?)', ['a', 'b']);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-flag', {
          from: null,
          to: { collection: 'Posts', field: 'flag' },
          transform: (_value, row) => (row.UUID === 'a' ? false : undefined),
        }),
      ],
      desired: [flagged],
      claimed: classifySchema([posts]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-flag', status: 'applied' }]);
    const rows = await db.query<{ UUID: string; flag: number | null }>(
      'SELECT "UUID", "flag" FROM "Posts" ORDER BY "UUID"',
    );
    deepStrictEqual(
      rows.map((row) => [row.UUID, row.flag]),
      [
        ['a', 0],
        ['b', null],
      ],
    );
    await db.close();
  });

  it('deletes a row through the owned-row cascade on `deleteRecord`', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const sections = table('Posts_sections', {
      columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }],
      derived: { collection: 'Posts', path: ['sections'], kind: 'childMany' },
    });
    await materialize(db, [posts, sections]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?), (?)', ['a', 'b']);
    await db.run('INSERT INTO "Posts_sections" ("UUID", "_parentUUID") VALUES (?, ?), (?, ?)', [
      's1',
      'a',
      's2',
      'b',
    ]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-flag', {
          from: null,
          to: { collection: 'Posts', field: 'flag' },
          transform: (_value, row, ctx) => (row.UUID === 'b' ? ctx.deleteRecord() : true),
        }),
      ],
      desired: [flagged, sections],
      claimed: classifySchema([posts, sections]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-flag', status: 'applied' }]);
    deepStrictEqual(
      (await db.query<{ UUID: string }>('SELECT "UUID" FROM "Posts"')).map((row) => row.UUID),
      ['a'],
    );
    deepStrictEqual(
      (await db.query<{ UUID: string }>('SELECT "UUID" FROM "Posts_sections"')).map(
        (row) => row.UUID,
      ),
      ['s1'],
    );
    ok(outcome.deletions.some((line) => /row of `Posts_sections` deleted/.test(line)));
    await db.close();
  });

  it('skips with a reason when the table is absent', async () => {
    const db = await connectTest();
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-flag', {
          from: null,
          to: { collection: 'Posts', field: 'flag' },
          transform: () => true,
        }),
      ],
      desired: [flagged],
      claimed: {},
      force: false,
    });
    deepStrictEqual(outcome.stamps, [
      { name: 'app/001-flag', status: 'skipped', reason: '`Posts` holds no rows to fill' },
    ]);
    await db.close();
  });

  it('refuses a foreign table', async () => {
    const db = await connectTest();
    await materialize(db, [table('Posts')]);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-flag', {
            from: null,
            to: { collection: 'Posts', field: 'flag' },
            transform: () => true,
          }),
        ],
        desired: [flagged],
        claimed: {},
        force: false,
      }),
      /targets a foreign table/,
    );
    await db.close();
  });

  it('refuses a column the schema does not hold and no later migration carries on', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    await materialize(db, [posts]);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-flag', {
            from: null,
            to: { collection: 'Posts', field: 'flag' },
            transform: () => true,
          }),
        ],
        desired: [posts],
        claimed: classifySchema([posts]),
        force: false,
      }),
      /needs a `type` on its `to`/,
    );
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-flag', {
            from: null,
            to: { collection: 'Posts', field: 'flag', type: 'boolean' },
            transform: () => true,
          }),
        ],
        desired: [posts],
        claimed: classifySchema([posts]),
        force: false,
      }),
      /fills a column the schema does not hold/,
    );
    deepStrictEqual(await columnNames(db, 'Posts'), ['UUID']);
    await db.close();
  });

  it('fills a column a later move carries on', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-legacy', {
          from: null,
          to: { collection: 'Posts', field: 'legacy', type: 'text' },
          transform: () => 'seeded',
        }),
        meta('app/002-note', {
          from: { collection: 'Posts', field: 'legacy' },
          to: { collection: 'Posts', field: 'note' },
        }),
      ],
      desired: [table('Posts', { columns: [UUID, { name: 'note', type: 'text', notNull: true }] })],
      claimed: classifySchema([posts]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [
      { name: 'app/001-legacy', status: 'applied' },
      { name: 'app/002-note', status: 'applied' },
    ]);
    deepStrictEqual(await columnNames(db, 'Posts'), ['UUID', 'note']);
    deepStrictEqual(
      (await db.query<{ note: string }>('SELECT "note" FROM "Posts"')).map((row) => row.note),
      ['seeded'],
    );
    await db.close();
  });

  it('fills each companion row per locale, `ctx.locale` set', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const translations = (users: TableSchema['columns']) =>
      table('Posts__translations', {
        columns: [
          { name: '_parentUUID', type: 'text', notNull: true },
          { name: '_localeCode', type: 'text', notNull: true },
          ...users,
        ],
        primaryKey: ['_parentUUID', '_localeCode'],
        companion: 'Posts',
      });
    const companion = translations([{ name: 'title', type: 'text', notNull: true }]);
    await materialize(db, [posts, companion]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?), (?)', ['p1', 'p2']);
    await db.run(
      'INSERT INTO "Posts__translations" ("_parentUUID", "_localeCode", "title") ' +
        'VALUES (?, ?, ?), (?, ?, ?)',
      ['p1', 'en', 'Hello', 'p1', 'de', 'Hallo'],
    );
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-subtitle', {
          from: null,
          to: { collection: 'Posts', field: 'subtitle' },
          transform: (_value, row, ctx) => `${ctx.locale}: ${String(row.title)}`,
        }),
      ],
      desired: [
        posts,
        translations([
          { name: 'title', type: 'text', notNull: true },
          { name: 'subtitle', type: 'text', notNull: true },
        ]),
      ],
      claimed: classifySchema([posts, companion]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-subtitle', status: 'applied' }]);
    const rows = await db.query<{ _localeCode: string; subtitle: string }>(
      'SELECT "_localeCode", "subtitle" FROM "Posts__translations" ORDER BY "_localeCode"',
    );
    deepStrictEqual(
      rows.map((row) => [row._localeCode, row.subtitle]),
      [
        ['de', 'de: Hallo'],
        ['en', 'en: Hello'],
      ],
    );
    deepStrictEqual(await columnNames(db, 'Posts'), ['UUID']);
    await db.close();
  });

  it('fills a dot path on a child-one table, a parent without a child row getting none', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const sections = (users: TableSchema['columns']) =>
      table('Posts_sections', {
        columns: [UUID, { name: '_parentUUID', type: 'text', notNull: true }, ...users],
        derived: { collection: 'Posts', path: ['sections'], kind: 'childOne' },
      });
    const live = sections([{ name: 'intro', type: 'text', notNull: false }]);
    await materialize(db, [posts, live]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?), (?)', ['p1', 'p2']);
    await db.run('INSERT INTO "Posts_sections" ("UUID", "_parentUUID", "intro") VALUES (?, ?, ?)', [
      's1',
      'p1',
      'hello',
    ]);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-kicker', {
          from: null,
          to: { collection: 'Posts', field: 'sections.kicker' },
          transform: (_value, row) => `${String(row.intro)}!`,
        }),
      ],
      desired: [
        posts,
        sections([
          { name: 'intro', type: 'text', notNull: false },
          { name: 'kicker', type: 'text', notNull: true },
        ]),
      ],
      claimed: classifySchema([posts, live]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-kicker', status: 'applied' }]);
    const rows = await db.query<{ _parentUUID: string; kicker: string }>(
      'SELECT "_parentUUID", "kicker" FROM "Posts_sections"',
    );
    deepStrictEqual(
      rows.map((row) => [row._parentUUID, row.kicker]),
      [['p1', 'hello!']],
    );
    await db.close();
  });

  it('gives each record a required child row on a fill, creating the child table', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?), (?)', ['p1', 'p2']);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-city', {
          from: null,
          to: { collection: 'Posts', field: 'address.city' },
          transform: (_value, row) => `City of ${String(row._parentUUID)}`,
        }),
      ],
      desired: [
        posts,
        table('Posts_address', {
          columns: [
            UUID,
            { name: '_parentUUID', type: 'text', notNull: true },
            { name: 'city', type: 'text', notNull: true },
          ],
          foreignKeys: [
            {
              column: '_parentUUID',
              targetTable: 'Posts',
              targetColumn: 'UUID',
              onDelete: 'cascade',
            },
          ],
          derived: { collection: 'Posts', path: ['address'], kind: 'childOne', required: true },
        }),
      ],
      claimed: classifySchema([posts]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-city', status: 'applied' }]);
    const rows = await db.query<{ _parentUUID: string; city: string }>(
      'SELECT "_parentUUID", "city" FROM "Posts_address" ORDER BY "_parentUUID"',
    );
    deepStrictEqual(
      rows.map((row) => [row._parentUUID, row.city]),
      [
        ['p1', 'City of p1'],
        ['p2', 'City of p2'],
      ],
    );
    await db.close();
  });

  it('refuses to create required child rows another column would leave `NULL`', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const address = table('Posts_address', {
      columns: [
        UUID,
        { name: '_parentUUID', type: 'text', notNull: true },
        { name: 'street', type: 'text', notNull: true },
        { name: 'city', type: 'text', notNull: true },
      ],
      foreignKeys: [
        { column: '_parentUUID', targetTable: 'Posts', targetColumn: 'UUID', onDelete: 'cascade' },
      ],
      derived: { collection: 'Posts', path: ['address'], kind: 'childOne', required: true },
    });
    await materialize(db, [posts, address]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['p1']);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-city', {
            from: null,
            to: { collection: 'Posts', field: 'address.city' },
            transform: () => 'Dalaran',
          }),
        ],
        desired: [posts, address],
        claimed: classifySchema([posts, address]),
        force: false,
      }),
      (error: { title?: string; body?: string[] }) => {
        match(error.title ?? '', /cannot create `Posts_address` rows/);
        match(
          (error.body ?? []).join('\n'),
          /`Posts` holds `1` row without a `Posts_address` row, and `street` refuses `NULL`/,
        );
        return true;
      },
    );
    await db.close();
  });

  it('fills a block field on the per-type table', async () => {
    const db = await connectTest();
    const hero = table('block_Hero', {
      columns: [UUID, { name: 'title', type: 'text', notNull: false }],
      block: 'Hero',
    });
    await materialize(db, [hero]);
    await db.run('INSERT INTO "block_Hero" ("UUID", "title") VALUES (?, ?)', ['h1', 'Hi']);
    const outcome = await executeMigrations(db, dialect, {
      migrations: [
        meta('app/001-align', {
          from: null,
          to: { block: 'Hero', field: 'align' },
          transform: () => 'left',
        }),
      ],
      desired: [
        table('block_Hero', {
          columns: [
            UUID,
            { name: 'title', type: 'text', notNull: false },
            { name: 'align', type: 'text', notNull: true },
          ],
          block: 'Hero',
        }),
      ],
      claimed: classifySchema([hero]),
      force: false,
    });
    deepStrictEqual(outcome.stamps, [{ name: 'app/001-align', status: 'applied' }]);
    deepStrictEqual(
      (await db.query<{ align: string }>('SELECT "align" FROM "block_Hero"')).map(
        (row) => row.align,
      ),
      ['left'],
    );
    strictEqual(outcome.claimed['block_Hero']?.columns['align'], 'text');
    await db.close();
  });

  it('refuses a live column whose native type differs from the desired one', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'flag', type: 'text', notNull: false }],
    });
    await materialize(db, [posts]);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-flag', {
            from: null,
            to: { collection: 'Posts', field: 'flag' },
            transform: () => true,
          }),
        ],
        desired: [flagged],
        claimed: classifySchema([posts]),
        force: false,
      }),
      /does not match the live schema/,
    );
    await db.close();
  });
});

describe('executeMigrations refuses a value the target cannot hold', () => {
  const refused = /Migration `app\/001-x` writes a value `Posts\.n` cannot hold/;

  async function cells(db: DatabaseAdapter, sql: string): Promise<unknown[]> {
    const rows = await db.query<Record<string, unknown>>(sql);
    return rows.map((row) => Object.values(row)[0]);
  }

  it('refuses a fill returning text into an integer column', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'n', type: 'integer', notNull: false }],
    });
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-x', {
            from: null,
            to: { collection: 'Posts', field: 'n' },
            transform: () => 'abc',
          }),
        ],
        desired: [
          table('Posts', { columns: [UUID, { name: 'n', type: 'integer', notNull: true }] }),
        ],
        claimed: classifySchema([posts]),
        force: false,
      }),
      refused,
    );
    deepStrictEqual(await cells(db, 'SELECT "n" FROM "Posts"'), [null]);
    await db.close();
  });

  it('refuses an untransformed move from integer to text', async () => {
    const db = await connectTest();
    const posts = table('Posts', {
      columns: [UUID, { name: 'count', type: 'integer', notNull: false }],
    });
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID", "count") VALUES (?, ?)', ['a', 42]);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-x', {
            from: { table: 'Posts', column: 'count', type: 'integer' },
            to: { table: 'Posts', column: 'n', type: 'text' },
          }),
        ],
        desired: [],
        claimed: classifySchema([posts]),
        force: false,
      }),
      refused,
    );
    deepStrictEqual(await cells(db, 'SELECT "count" FROM "Posts"'), [42]);
    await db.close();
  });

  it('refuses a switch returning an object into a text column', async () => {
    const db = await connectTest();
    const posts = table('Posts', { columns: [UUID, { name: 'n', type: 'text', notNull: false }] });
    await materialize(db, [posts]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-x', {
            from: { collection: 'Posts', field: 'n', nullable: true },
            transform: () => ({ title: 'x' }),
          }),
        ],
        desired: [table('Posts', { columns: [UUID, { name: 'n', type: 'text', notNull: true }] })],
        claimed: classifySchema([posts]),
        force: false,
      }),
      refused,
    );
    deepStrictEqual(await cells(db, 'SELECT "n" FROM "Posts"'), [null]);
    await db.close();
  });

  it('refuses a fill returning a value JSON cannot store', async () => {
    for (const value of [() => 1, Symbol('x'), 1n]) {
      const db = await connectTest();
      const posts = table('Posts', {
        columns: [UUID, { name: 'n', type: 'json', notNull: false }],
      });
      await materialize(db, [posts]);
      await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['a']);
      await rejects(
        executeMigrations(db, dialect, {
          migrations: [
            meta('app/001-x', {
              from: null,
              to: { collection: 'Posts', field: 'n' },
              transform: () => value,
            }),
          ],
          desired: [posts],
          claimed: classifySchema([posts]),
          force: false,
        }),
        refused,
      );
      deepStrictEqual(await cells(db, 'SELECT "n" FROM "Posts"'), [null]);
      await db.close();
    }
  });

  it('refuses a fan-in promoting a number into a text column', async () => {
    const db = await connectTest();
    const posts = table('Posts');
    const companion = table('Posts__translations', {
      columns: [
        { name: '_parentUUID', type: 'text', notNull: true },
        { name: '_localeCode', type: 'text', notNull: true },
        { name: 'n', type: 'text', notNull: true },
      ],
      primaryKey: ['_parentUUID', '_localeCode'],
      companion: 'Posts',
    });
    await materialize(db, [posts, companion]);
    await db.run('INSERT INTO "Posts" ("UUID") VALUES (?)', ['p1']);
    await db.run(
      'INSERT INTO "Posts__translations" ("_parentUUID", "_localeCode", "n") VALUES (?, ?, ?)',
      ['p1', 'en', 'Hello'],
    );
    await rejects(
      executeMigrations(db, dialect, {
        migrations: [
          meta('app/001-x', {
            from: { collection: 'Posts', field: 'n', translatable: true },
            transform: () => 42,
          }),
        ],
        desired: [table('Posts', { columns: [UUID, { name: 'n', type: 'text', notNull: true }] })],
        claimed: classifySchema([posts, companion]),
        force: false,
      }),
      refused,
    );
    deepStrictEqual(await cells(db, 'SELECT "n" FROM "Posts__translations"'), ['Hello']);
    await db.close();
  });
});
