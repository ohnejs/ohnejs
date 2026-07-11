import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Migration } from '../../../../src/ohne/database/migrations/define-migration.ts';
import type { ResolveState } from '../../../../src/ohne/database/migrations/resolve-address.ts';
import type { MigrationMeta } from '../../../../src/ohne/database/migrations/use-migrations.ts';
import type { TableSchema } from '../../../../src/ohne/database/schema/table-schema.ts';

import {
  consumedByMigration,
  lowerMigration,
  touchedByMigration,
} from '../../../../src/ohne/database/migrations/resolve-address.ts';

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

function meta(migration: Migration): MigrationMeta {
  return { name: 'app/001-test', migration, file: '/app/migrations/001-test.ts' };
}

function state(live: TableSchema[], overrides: Partial<ResolveState> = {}): ResolveState {
  const byName = new Map(live.map((schema) => [schema.name, schema]));
  return {
    names: new Set(byName.keys()),
    claimed: Object.fromEntries(
      live.map((schema) => [
        schema.name,
        {
          columns: Object.fromEntries(schema.columns.map((column) => [column.name, column.type])),
          ...(schema.derived ? { derived: schema.derived } : {}),
        },
      ]),
    ),
    desired: [],
    ownership: true,
    describe: (name) => {
      const schema = byName.get(name);
      if (!schema) throw new Error(`no live table ${name}`);
      return Promise.resolve(schema);
    },
    ...overrides,
  };
}

describe('consumedByMigration', () => {
  it('passes physical addresses through', () => {
    deepStrictEqual(
      consumedByMigration(
        meta({
          from: { table: 'Posts', column: 'title', type: 'text' },
          to: { table: 'Posts', column: 'heading', type: 'text' },
        }),
      ),
      [{ table: 'Posts', column: 'title' }],
    );
    deepStrictEqual(
      consumedByMigration(meta({ from: { table: 'Posts' }, to: { table: 'Articles' } })),
      [{ table: 'Posts' }],
    );
  });

  it('lists both readings of a logical field, and only the main table of a collection', () => {
    deepStrictEqual(
      consumedByMigration(meta({ from: { collection: 'Posts', field: 'title' }, to: null })),
      [
        { table: 'Posts', column: 'title' },
        { table: 'Posts_title', subtree: { collection: 'Posts', path: ['title'] } },
      ],
    );
    deepStrictEqual(consumedByMigration(meta({ from: { collection: 'Posts' }, to: null })), [
      { table: 'Posts', subtree: { collection: 'Posts', path: [] } },
    ]);
  });

  it('reads a dot path: the prefix names the derived table, the last segment the column', () => {
    deepStrictEqual(
      consumedByMigration(
        meta({ from: { collection: 'Posts', field: 'sections.title' }, to: null }),
      ),
      [
        { table: 'Posts_sections', column: 'title' },
        {
          table: 'Posts_sections_title',
          subtree: { collection: 'Posts', path: ['sections', 'title'] },
        },
      ],
    );
  });
});

describe('touchedByMigration', () => {
  it('collects both sides, every reading included', () => {
    deepStrictEqual(
      touchedByMigration(
        meta({
          from: { collection: 'Posts', field: 'isDraft' },
          to: { collection: 'Posts', field: 'draft' },
        }),
      ),
      ['Posts', 'Posts_isDraft', 'Posts', 'Posts_draft'],
    );
    deepStrictEqual(
      touchedByMigration(meta({ from: { collection: 'Posts' }, to: { collection: 'Articles' } })),
      ['Posts', 'Articles'],
    );
  });

  it('refuses a malformed field path before anything runs', () => {
    ok(
      (() => {
        try {
          touchedByMigration(meta({ from: { collection: 'Posts', field: 'a..b' }, to: null }));
          return false;
        } catch (error) {
          return error instanceof Error && /malformed field path/.test(error.message);
        }
      })(),
    );
  });
});

describe('lowerMigration', () => {
  it('passes a physical pair through and still refuses a mixed one', async () => {
    const lowered = await lowerMigration(
      state([]),
      meta({ from: { table: 'Posts' }, to: { table: 'Articles' } }),
    );
    deepStrictEqual(lowered, {
      kind: 'rename',
      from: { table: 'Posts' },
      to: { table: 'Articles' },
    });
    await rejects(
      lowerMigration(
        state([]),
        meta({
          from: { table: 'Posts', column: 'title', type: 'text' },
          to: { table: 'Articles' },
        } as unknown as Migration),
      ),
      /mixes a column and a table address/,
    );
  });

  it('refuses a logical address paired with a physical one', async () => {
    await rejects(
      lowerMigration(
        state([]),
        meta({
          from: { collection: 'Posts', field: 'title' },
          to: { table: 'Posts', column: 'heading', type: 'text' },
        } as unknown as Migration),
      ),
      /mixes a logical and a physical address/,
    );
  });

  it('refuses an address carrying both spellings at once', async () => {
    await rejects(
      lowerMigration(
        state([]),
        meta({
          from: { collection: 'Posts', field: 'title', table: 'Posts' },
          to: null,
        } as unknown as Migration),
      ),
      /mixes address spellings/,
    );
  });

  it('reads a live column as a move, types resolved from the claims', async () => {
    const posts = table('Posts', {
      columns: [UUID, { name: 'isDraft', type: 'boolean', notNull: false }],
    });
    const lowered = await lowerMigration(
      state([posts], {
        desired: [
          table('Posts', { columns: [UUID, { name: 'draft', type: 'boolean', notNull: false }] }),
        ],
      }),
      meta({
        from: { collection: 'Posts', field: 'isDraft' },
        to: { collection: 'Posts', field: 'draft' },
      }),
    );
    deepStrictEqual(lowered, {
      kind: 'move',
      from: { table: 'Posts', column: 'isDraft', type: 'boolean' },
      to: { table: 'Posts', column: 'draft', type: 'boolean' },
      toSubtree: { collection: 'Posts', path: ['draft'] },
      transform: undefined,
    });
  });

  it('falls back to the live column type when the claims are silent', async () => {
    const posts = table('Posts', {
      columns: [UUID, { name: 'count', type: 'integer', notNull: false }],
    });
    const silent = state([posts], {
      claimed: { Posts: { columns: {} } },
      desired: [table('Posts', { columns: [UUID] })],
    });
    const lowered = await lowerMigration(
      silent,
      meta({ from: { collection: 'Posts', field: 'count' }, to: null }),
    );
    deepStrictEqual(lowered, {
      kind: 'discardColumn',
      from: { table: 'Posts', column: 'count', type: 'integer' },
    });
  });

  it('demands a type on a chain-intermediate TO, and takes an explicit one', async () => {
    const posts = table('Posts', {
      columns: [UUID, { name: 'a', type: 'text', notNull: false }],
    });
    await rejects(
      lowerMigration(
        state([posts]),
        meta({
          from: { collection: 'Posts', field: 'a' },
          to: { collection: 'Posts', field: 'b' },
        }),
      ),
      /needs a `type` on its `to`/,
    );
    const lowered = await lowerMigration(
      state([posts]),
      meta({
        from: { collection: 'Posts', field: 'a' },
        to: { collection: 'Posts', field: 'b', type: 'json' },
      }),
    );
    strictEqual(lowered.kind, 'move');
    deepStrictEqual(lowered.to, { table: 'Posts', column: 'b', type: 'json' });
  });

  it('never demands a TO type while the FROM is absent: skips stay type-blind', async () => {
    const lowered = await lowerMigration(
      state([], { desired: [] }),
      meta({
        from: { collection: 'Posts', field: 'a', type: 'text' },
        to: { collection: 'Posts', field: 'b' },
      }),
    );
    deepStrictEqual(lowered, {
      kind: 'move',
      from: { table: 'Posts', column: 'a', type: 'text' },
      to: { table: 'Posts', column: 'b', type: 'text' },
      toSubtree: { collection: 'Posts', path: ['b'] },
      transform: undefined,
    });
  });

  it('reads a live derived table as a rename compound, nested children following', async () => {
    const live = [
      table('Posts'),
      table('Posts_sections', {
        derived: { collection: 'Posts', path: ['sections'], kind: 'childMany' },
      }),
      table('Posts_sections_items', {
        derived: { collection: 'Posts', path: ['sections', 'items'], kind: 'childMany' },
      }),
    ];
    const lowered = await lowerMigration(
      state(live),
      meta({
        from: { collection: 'Posts', field: 'sections' },
        to: { collection: 'Posts', field: 'chapters' },
      }),
    );
    deepStrictEqual(lowered, {
      kind: 'compoundRename',
      members: [
        {
          from: 'Posts_sections',
          to: 'Posts_chapters',
          origin: { collection: 'Posts', path: ['chapters'], kind: 'childMany' },
        },
        {
          from: 'Posts_sections_items',
          to: 'Posts_chapters_items',
          origin: { collection: 'Posts', path: ['chapters', 'items'], kind: 'childMany' },
        },
      ],
      to: { collection: 'Posts', path: ['chapters'] },
    });
  });

  it('lowers a collection rename to its whole family, junctions included', async () => {
    const live = [
      table('Posts'),
      table('Posts_tags', {
        derived: { collection: 'Posts', path: ['tags'], kind: 'junction' },
      }),
      table('Posts_sections', {
        derived: { collection: 'Posts', path: ['sections'], kind: 'childMany' },
      }),
      table('Users'),
    ];
    const lowered = await lowerMigration(
      state(live),
      meta({ from: { collection: 'Posts' }, to: { collection: 'Articles' } }),
    );
    deepStrictEqual(lowered, {
      kind: 'compoundRename',
      members: [
        { from: 'Posts', to: 'Articles', origin: undefined },
        {
          from: 'Posts_sections',
          to: 'Articles_sections',
          origin: { collection: 'Articles', path: ['sections'], kind: 'childMany' },
        },
        {
          from: 'Posts_tags',
          to: 'Articles_tags',
          origin: { collection: 'Articles', path: ['tags'], kind: 'junction' },
        },
      ],
      to: { collection: 'Articles', path: [] },
    });
  });

  it('refuses two live readings without a pin, and a pin selects the column', async () => {
    const live = [
      table('Posts', { columns: [UUID, { name: 'meta', type: 'text', notNull: false }] }),
      table('Posts_meta', {
        derived: { collection: 'Posts', path: ['meta'], kind: 'childOne' },
      }),
    ];
    await rejects(
      lowerMigration(state(live), meta({ from: { collection: 'Posts', field: 'meta' }, to: null })),
      /matches two readings/,
    );
    const pinned = await lowerMigration(
      state(live),
      meta({ from: { collection: 'Posts', field: 'meta', type: 'text' }, to: null }),
    );
    deepStrictEqual(pinned, {
      kind: 'discardColumn',
      from: { table: 'Posts', column: 'meta', type: 'text' },
    });
  });

  it('selects the move reading through `transform` when nothing is live', async () => {
    const lowered = await lowerMigration(
      state([], {
        desired: [
          table('Posts', { columns: [UUID, { name: 'draft', type: 'boolean', notNull: false }] }),
        ],
      }),
      meta({
        from: { collection: 'Posts', field: 'isDraft' },
        to: { collection: 'Posts', field: 'draft' },
        transform: (value) => value === 'yes',
      }),
    );
    strictEqual(lowered.kind, 'move');
    deepStrictEqual(lowered.from, { table: 'Posts', column: 'isDraft', type: 'text' });
  });

  it('lets the desired TO decide the reading when nothing is live', async () => {
    const column = await lowerMigration(
      state([], {
        desired: [
          table('Posts', { columns: [UUID, { name: 'draft', type: 'boolean', notNull: false }] }),
        ],
      }),
      meta({
        from: { collection: 'Posts', field: 'isDraft' },
        to: { collection: 'Posts', field: 'draft' },
      }),
    );
    strictEqual(column.kind, 'move');
    const tableRead = await lowerMigration(
      state([], {
        desired: [
          table('Posts'),
          table('Posts_chapters', {
            derived: { collection: 'Posts', path: ['chapters'], kind: 'childMany' },
          }),
        ],
      }),
      meta({
        from: { collection: 'Posts', field: 'sections' },
        to: { collection: 'Posts', field: 'chapters' },
      }),
    );
    strictEqual(tableRead.kind, 'compoundRename');
  });

  it('refuses the rename shapes the grammar cannot mean', async () => {
    const live = [
      table('Posts'),
      table('Posts_sections', {
        derived: { collection: 'Posts', path: ['sections'], kind: 'childMany' },
      }),
    ];
    await rejects(
      lowerMigration(
        state(live),
        meta({
          from: { collection: 'Posts', field: 'sections' },
          to: { collection: 'Archive', field: 'sections' },
        }),
      ),
      /renames a field across collections/,
    );
    await rejects(
      lowerMigration(
        state([
          table('Posts'),
          table('Posts_sections_items', {
            derived: { collection: 'Posts', path: ['sections', 'items'], kind: 'childMany' },
          }),
        ]),
        meta({
          from: { collection: 'Posts', field: 'sections.items' },
          to: { collection: 'Posts', field: 'chapters.items' },
        }),
      ),
      /renames across the field tree/,
    );
    await rejects(
      lowerMigration(
        state(live),
        meta({
          from: { collection: 'Posts', field: 'sections' },
          to: { collection: 'Posts', field: 'sections' },
        }),
      ),
      /onto itself/,
    );
    await rejects(
      lowerMigration(
        state([]),
        meta({ from: { collection: 'Posts' }, to: { collection: 'Posts' } }),
      ),
      /onto itself/,
    );
    await rejects(
      lowerMigration(
        state([]),
        meta({
          from: { collection: 'Posts' },
          to: { collection: 'Articles', field: 'sections' },
        }),
      ),
      /pairs a collection with a field/,
    );
    await rejects(
      lowerMigration(
        state([]),
        meta({
          from: { collection: 'Posts' },
          to: { collection: 'Articles' },
          transform: (value: unknown) => value,
        } as unknown as Migration),
      ),
      /transforms without a column/,
    );
  });

  it('refuses names outside the grammar, pointing at the physical escape hatch', async () => {
    await rejects(
      lowerMigration(state([]), meta({ from: { collection: 'ohne_locks' }, to: null })),
      /names an invalid collection/,
    );
    await rejects(
      lowerMigration(
        state([]),
        meta({ from: { collection: 'Posts', field: 'legacy_flag' }, to: null }),
      ),
      /malformed field path/,
    );
  });

  it('lowers a collection discard to its family, deepest first, the main table last', async () => {
    const live = [
      table('Posts'),
      table('Posts_sections', {
        derived: { collection: 'Posts', path: ['sections'], kind: 'childMany' },
      }),
      table('Posts_sections_items', {
        derived: { collection: 'Posts', path: ['sections', 'items'], kind: 'childMany' },
      }),
      table('Posts_tags', {
        derived: { collection: 'Posts', path: ['tags'], kind: 'junction' },
      }),
    ];
    const lowered = await lowerMigration(
      state(live),
      meta({ from: { collection: 'Posts' }, to: null }),
    );
    deepStrictEqual(lowered, {
      kind: 'compoundDiscard',
      tables: ['Posts_sections_items', 'Posts_sections', 'Posts_tags', 'Posts'],
    });
  });

  it('refuses a type pin on a collection discard', async () => {
    await rejects(
      lowerMigration(
        state([]),
        meta({ from: { collection: 'Posts', type: 'text' } as never, to: null }),
      ),
      /pins a `type` without a field/,
    );
  });

  it('bootstraps a rename family from the TO tree under a pre-ownership snapshot', async () => {
    const desired = [
      table('Articles'),
      table('Articles_sections', {
        derived: { collection: 'Articles', path: ['sections'], kind: 'childMany' },
      }),
    ];
    const live = [table('Posts'), table('Posts_sections')];
    const lowered = await lowerMigration(
      state(live, { desired, ownership: false }),
      meta({ from: { collection: 'Posts' }, to: { collection: 'Articles' } }),
    );
    deepStrictEqual(lowered, {
      kind: 'compoundRename',
      members: [
        { from: 'Posts', to: 'Articles', origin: undefined },
        {
          from: 'Posts_sections',
          to: 'Articles_sections',
          origin: { collection: 'Articles', path: ['sections'], kind: 'childMany' },
        },
      ],
      to: { collection: 'Articles', path: [] },
    });
  });

  it('refuses the bootstrap when a family member is not live: the tree changed in the same deploy', async () => {
    const desired = [
      table('Articles'),
      table('Articles_chapters', {
        derived: { collection: 'Articles', path: ['chapters'], kind: 'childMany' },
      }),
    ];
    const live = [table('Posts'), table('Posts_sections')];
    await rejects(
      lowerMigration(
        state(live, { desired, ownership: false }),
        meta({ from: { collection: 'Posts' }, to: { collection: 'Articles' } }),
      ),
      /cannot verify the rename family/,
    );
  });

  it('skips the bootstrap refusal when the primary is absent: the already-migrated case', async () => {
    const desired = [
      table('Articles'),
      table('Articles_chapters', {
        derived: { collection: 'Articles', path: ['chapters'], kind: 'childMany' },
      }),
    ];
    const lowered = await lowerMigration(
      state([], { desired, ownership: false }),
      meta({ from: { collection: 'Posts' }, to: { collection: 'Articles' } }),
    );
    deepStrictEqual(lowered, {
      kind: 'compoundRename',
      members: [{ from: 'Posts', to: 'Articles', origin: undefined }],
      to: { collection: 'Articles', path: [] },
    });
  });

  it('refuses a migration missing `from` or `to`, never crashing on the shape', async () => {
    await rejects(
      lowerMigration(state([]), meta({ to: null } as unknown as Migration)),
      /has no `from`/,
    );
    await rejects(
      lowerMigration(
        state([]),
        meta({ from: { collection: 'Posts', field: 'a' } } as unknown as Migration),
      ),
      /has no `to`/,
    );
    ok(
      (() => {
        try {
          touchedByMigration(meta({ from: { collection: 'Posts' } } as unknown as Migration));
          return false;
        } catch (error) {
          return error instanceof Error && /has no `to`/.test(error.message);
        }
      })(),
    );
  });

  it('refuses the physical shapes that would silently mean something else', async () => {
    await rejects(
      lowerMigration(
        state([]),
        meta({ from: { table: 'Posts', field: 'title' }, to: null } as unknown as Migration),
      ),
      /mixes address spellings/,
    );
    await rejects(
      lowerMigration(
        state([]),
        meta({ from: { table: 'Posts', column: 'title' }, to: null } as unknown as Migration),
      ),
      /addresses a column without its `type`/,
    );
    await rejects(
      lowerMigration(
        state([]),
        meta({ from: { table: 'Posts', type: 'text' }, to: null } as unknown as Migration),
      ),
      /pins a `type` without a column/,
    );
    await rejects(
      lowerMigration(
        state([]),
        meta({
          from: { table: 'Posts' },
          to: { table: 'Articles' },
          transform: (value: unknown) => value,
        } as unknown as Migration),
      ),
      /transforms without a column/,
    );
  });

  it('refuses a transform on a discard and a type pin on a collection rename', async () => {
    await rejects(
      lowerMigration(
        state([]),
        meta({
          from: { collection: 'Posts', field: 'legacy' },
          to: null,
          transform: (value: unknown) => value,
        } as unknown as Migration),
      ),
      /pairs a transform with a discard/,
    );
    await rejects(
      lowerMigration(
        state([]),
        meta({
          from: { collection: 'Posts', type: 'text' },
          to: { collection: 'Articles' },
        } as unknown as Migration),
      ),
      /pins a `type` without a field/,
    );
  });

  it('refuses names outside the grammar shape, `$` and digits-first included', async () => {
    await rejects(
      lowerMigration(state([]), meta({ from: { collection: 'Posts$abc12345' }, to: null })),
      /names an invalid collection/,
    );
    await rejects(
      lowerMigration(
        state([]),
        meta({ from: { collection: 'Posts', field: 'steps.2nd' }, to: null }),
      ),
      /malformed field path/,
    );
  });

  it('bootstraps a field rename with the primary origin read from the desired tree', async () => {
    const desired = [
      table('Posts'),
      table('Posts_chapters', {
        derived: { collection: 'Posts', path: ['chapters'], kind: 'childMany' },
      }),
    ];
    const live = [table('Posts'), table('Posts_sections')];
    const lowered = await lowerMigration(
      state(live, { desired, ownership: false }),
      meta({
        from: { collection: 'Posts', field: 'sections' },
        to: { collection: 'Posts', field: 'chapters' },
      }),
    );
    deepStrictEqual(lowered, {
      kind: 'compoundRename',
      members: [
        {
          from: 'Posts_sections',
          to: 'Posts_chapters',
          origin: { collection: 'Posts', path: ['chapters'], kind: 'childMany' },
        },
      ],
      to: { collection: 'Posts', path: ['chapters'] },
    });
  });

  it('refuses a bootstrap field rename whose target the desired tree does not hold', async () => {
    const live = [table('Posts'), table('Posts_sections')];
    await rejects(
      lowerMigration(
        state(live, { desired: [table('Posts')], ownership: false }),
        meta({
          from: { collection: 'Posts', field: 'sections' },
          to: { collection: 'Posts', field: 'chapters' },
        }),
      ),
      /cannot verify the rename family/,
    );
  });

  it('refuses a physical rename onto itself instead of leaking a driver error', async () => {
    await rejects(
      lowerMigration(state([]), meta({ from: { table: 'Posts' }, to: { table: 'Posts' } })),
      /renames `Posts` onto itself/,
    );
  });

  it('refuses any physical address under the `ohne_` namespace', async () => {
    await rejects(
      lowerMigration(state([]), meta({ from: { table: 'ohne_migrations' }, to: null })),
      /targets ohne's internal `ohne_migrations`/,
    );
    await rejects(
      lowerMigration(state([]), meta({ from: { table: 'Posts' }, to: { table: 'ohne_fresh' } })),
      /targets ohne's internal `ohne_fresh`/,
    );
  });

  it('refuses a transform or pin aimed at a live derived table, naming the cause', async () => {
    const live = [
      table('Posts'),
      table('Posts_tags', {
        columns: [
          { name: '_parentUUID', type: 'text', notNull: true },
          { name: '_targetUUID', type: 'text', notNull: true },
        ],
        primaryKey: [],
        derived: { collection: 'Posts', path: ['tags'], kind: 'junction' },
      }),
    ];
    await rejects(
      lowerMigration(
        state(live),
        meta({
          from: { collection: 'Posts', field: 'tags' },
          to: { collection: 'Posts', field: 'labels' },
          transform: (value) => value,
        }),
      ),
      /addresses the table `Posts_tags` as a column/,
    );
  });

  it('refuses the reserved collection names on either side', async () => {
    await rejects(
      lowerMigration(
        state([table('Posts')]),
        meta({ from: { collection: 'Posts' }, to: { collection: 'Ohne' } }),
      ),
      /names the reserved collection `Ohne`/,
    );
    await rejects(
      lowerMigration(state([]), meta({ from: { collection: 'block' }, to: null })),
      /names the reserved collection `block`/,
    );
  });

  it('refuses family discards under a pre-ownership snapshot, naming the fix', async () => {
    const live = [table('Posts'), table('Posts_tags')];
    await rejects(
      lowerMigration(
        state(live, { ownership: false }),
        meta({ from: { collection: 'Posts' }, to: null }),
      ),
      /cannot enumerate `Posts`/,
    );
    await rejects(
      lowerMigration(
        state(live, { ownership: false }),
        meta({ from: { collection: 'Posts', field: 'tags' }, to: null }),
      ),
      /cannot enumerate `Posts.tags`/,
    );
  });
});
