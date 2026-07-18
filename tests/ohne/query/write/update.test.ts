import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { runCreate } from '../../../../src/ohne/query/write/create.ts';
import { runUpdate } from '../../../../src/ohne/query/write/update.ts';

useCollections().register('UUser', {
  name: 'UUser',
  collection: { fields: { name: field('text') } },
});
useCollections().register('UTag', {
  name: 'UTag',
  collection: {
    fields: {
      label: field('text'),
      posts: field('records', { collection: 'UPost', inverse: 'tags' }),
    },
  },
});
useCollections().register('UPost', {
  name: 'UPost',
  collection: {
    fields: {
      title: field('text', { unique: true }),
      views: field('integer'),
      summary: field('text', { nullable: true }),
      author: field('record', { collection: 'UUser' }),
      tags: field('records', { collection: 'UTag' }),
      meta: field('object', { fields: { note: field('text', { nullable: true }) } }),
      sections: field('repeater', {
        fields: { heading: field('text'), slug: field('text', { nullable: true }) },
      }),
    },
  },
});
useCollections().register('UDeep', {
  name: 'UDeep',
  collection: {
    fields: {
      sections: field('repeater', {
        fields: {
          notes: field('repeater', { fields: { tag: field('text', { unique: true }) } }),
        },
      }),
    },
  },
});
useCollections().register('USwap', {
  name: 'USwap',
  collection: {
    fields: {
      items: field('repeater', {
        fields: { slug: field('text', { unique: true, uniquePerParent: true }) },
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
await db.run('INSERT INTO "UUser" ("UUID","_updatedAt","name") VALUES (?,?,?)', ['u1', 1, 'Ada']);
await db.run('INSERT INTO "UUser" ("UUID","_updatedAt","name") VALUES (?,?,?)', ['u2', 1, 'Lin']);
for (const [uuid, label] of [
  ['t1', 'A'],
  ['t2', 'B'],
  ['t3', 'C'],
]) {
  await db.run('INSERT INTO "UTag" ("UUID","_updatedAt","label") VALUES (?,?,?)', [uuid, 1, label]);
}

let counter = 0;
const base = {
  views: 10,
  author: 'u1',
  tags: ['t1', 't2'],
  meta: { note: 'n' },
  sections: [{ heading: 'a' }, { heading: 'b' }],
};

/**
 * Creates a fresh post with a unique title and returns its re-read record.
 */
async function seedPost(over: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await runCreate('UPost', { ...base, title: `P${counter++}`, ...over }, null);
  ok(result.ok);
  return result.record as Record<string, unknown>;
}

/**
 * Counts the write statements matching `pattern` while `fn` runs, restoring the adapter after.
 */
async function countWrites(pattern: RegExp, fn: () => Promise<void>): Promise<number> {
  const adapter = db as DatabaseAdapter;
  const original = adapter.run.bind(adapter);
  let count = 0;
  adapter.run = (sql, params) => {
    if (pattern.test(sql)) count++;
    return original(sql, params);
  };
  try {
    await fn();
  } finally {
    adapter.run = original;
  }
  return count;
}

describe('runUpdate columns', () => {
  it('updates only provided fields and leaves the rest byte-identical', async () => {
    const post = await seedPost({ summary: 'keep', views: 7 });
    const before = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM "UPost" WHERE "UUID" = ?',
      [post.UUID as string],
    );
    const result = await runUpdate('UPost', { views: 99 }, uuidIs(post.UUID as string), null);
    ok(result.ok);
    strictEqual(result.records.length, 1);
    strictEqual(result.records[0].views, 99);
    const after = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM "UPost" WHERE "UUID" = ?',
      [post.UUID as string],
    );
    strictEqual(after!.title, before!.title);
    strictEqual(after!.summary, before!.summary);
    strictEqual(after!.author, before!.author);
    ok((after!._updatedAt as number) >= (before!._updatedAt as number));
  });

  it('returns every matched row, untouched rows included', async () => {
    const a = await seedPost({ summary: 'group-x' });
    const b = await seedPost({ summary: 'group-x' });
    const result = await runUpdate(
      'UPost',
      { views: 1 },
      { kind: 'compare', path: ['summary'], op: 'equalsTo', value: 'group-x', negated: false },
      null,
    );
    ok(result.ok);
    const returned = new Set(result.records.map((row) => row.UUID));
    ok(returned.has(a.UUID));
    ok(returned.has(b.UUID));
  });

  it('returns no records when nothing matches', async () => {
    const result = await runUpdate('UPost', { views: 1 }, uuidIs('ghost'), null);
    ok(result.ok);
    deepStrictEqual(result.records, []);
  });

  it('keeps a unique value when the row keeps its own', async () => {
    const post = await seedPost();
    const result = await runUpdate(
      'UPost',
      { title: post.title, views: 3 },
      uuidIs(post.UUID as string),
      null,
    );
    ok(result.ok);
    strictEqual(result.records[0].views, 3);
  });

  it('rejects a unique value another row already holds', async () => {
    const first = await seedPost();
    const second = await seedPost();
    const result = await runUpdate(
      'UPost',
      { title: first.title },
      uuidIs(second.UUID as string),
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors.title, 'validation.notUnique');
  });

  it('bumps `_updatedAt` on a derived-only write', async () => {
    const post = await seedPost();
    const before = await updatedAt(post.UUID as string);
    await sleep();
    const result = await runUpdate('UPost', { tags: ['t3'] }, uuidIs(post.UUID as string), null);
    ok(result.ok);
    ok((await updatedAt(post.UUID as string)) > before);
  });
});

describe('runUpdate matched set', () => {
  it('respects a has-condition over a relation', async () => {
    await db.run('INSERT INTO "UTag" ("UUID","_updatedAt","label") VALUES (?,?,?)', [
      'thas',
      1,
      'HAS',
    ]);
    const linked = await seedPost({ tags: ['thas'] });
    const unlinked = await seedPost({ tags: ['t2'] });
    const result = await runUpdate(
      'UPost',
      { views: 42 },
      {
        kind: 'has',
        path: ['tags'],
        condition: {
          kind: 'compare',
          path: ['label'],
          op: 'equalsTo',
          value: 'HAS',
          negated: false,
        },
        negated: false,
      },
      null,
    );
    ok(result.ok);
    strictEqual(result.records.length, 1);
    strictEqual(result.records[0].UUID, linked.UUID);
    strictEqual(await views(unlinked.UUID as string), 10);
  });
});

describe('runUpdate junction diff', () => {
  it('adds, removes, and reorders links to match the input', async () => {
    const post = await seedPost({ tags: ['t1', 't2'] });
    const result = await runUpdate(
      'UPost',
      { tags: ['t3', 't1'] },
      uuidIs(post.UUID as string),
      null,
    );
    ok(result.ok);
    deepStrictEqual(result.records[0].tags, ['t3', 't1']);
  });

  it('issues zero junction writes for a no-op update', async () => {
    const post = await seedPost({ tags: ['t1', 't2'] });
    const writes = await countWrites(/"UPost_tags"/, async () => {
      const result = await runUpdate(
        'UPost',
        { tags: ['t1', 't2'] },
        uuidIs(post.UUID as string),
        null,
      );
      ok(result.ok);
    });
    strictEqual(writes, 0);
  });

  it('preserves the inverse side ordering across an owner-side reorder', async () => {
    await db.run('INSERT INTO "UTag" ("UUID","_updatedAt","label") VALUES (?,?,?)', [
      'tinv',
      1,
      'INV',
    ]);
    const p1 = await seedPost({ tags: ['tinv', 't2'] });
    const p2 = await seedPost({ tags: ['tinv'] });
    deepStrictEqual(await inversePosts('tinv'), [p1.UUID, p2.UUID]);

    const result = await runUpdate(
      'UPost',
      { tags: ['t2', 'tinv'] },
      uuidIs(p1.UUID as string),
      null,
    );
    ok(result.ok);
    deepStrictEqual(await inversePosts('tinv'), [p1.UUID, p2.UUID]);
  });
});

describe('runUpdate repeater correlation', () => {
  it('keeps matched item UUIDs, deletes unmatched, inserts fresh, renumbers', async () => {
    const post = await seedPost({ sections: [{ heading: 'a' }, { heading: 'b' }] });
    const created = (post.sections as { UUID: string; heading: string }[]).map((s) => s.UUID);

    const result = await runUpdate(
      'UPost',
      {
        sections: [{ heading: 'fresh' }, { UUID: created[0], heading: 'a2' }],
      },
      uuidIs(post.UUID as string),
      null,
    );
    ok(result.ok);
    const sections = result.records[0].sections as { UUID: string; heading: string }[];
    strictEqual(sections.length, 2);
    strictEqual(sections[1].UUID, created[0]);
    strictEqual(sections[1].heading, 'a2');
    ok(!sections.some((s) => s.UUID === created[1]));
    const inserted = sections.find((s) => s.heading === 'fresh');
    ok(inserted && inserted.UUID !== created[0]);
  });

  it('errors when a repeater item UUID matches nothing on the parent', async () => {
    const post = await seedPost();
    const result = await runUpdate(
      'UPost',
      { sections: [{ UUID: 'ghost', heading: 'x' }] },
      uuidIs(post.UUID as string),
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors['sections[0]'], 'validation.invalidReference');
    const rows = await db.query('SELECT "UUID" FROM "UPost_sections" WHERE "_parentUUID" = ?', [
      post.UUID as string,
    ]);
    strictEqual(rows.length, 2);
  });

  it('rejects a duplicate item UUID instead of collapsing items', async () => {
    const post = await seedPost({ sections: [{ heading: 'a' }, { heading: 'b' }] });
    const kept = (post.sections as { UUID: string }[])[0].UUID;
    const result = await runUpdate(
      'UPost',
      {
        sections: [
          { UUID: kept, heading: 'first' },
          { UUID: kept, heading: 'second' },
        ],
      },
      uuidIs(post.UUID as string),
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors['sections[1].UUID'], 'validation.notUnique');
  });
});

describe('runUpdate object upsert', () => {
  it('updates the existing child row in place', async () => {
    const post = await seedPost({ meta: { note: 'first' } });
    const before = await objectUUID(post.UUID as string);
    const result = await runUpdate(
      'UPost',
      { meta: { note: 'second' } },
      uuidIs(post.UUID as string),
      null,
    );
    ok(result.ok);
    strictEqual((result.records[0].meta as { note: string }).note, 'second');
    strictEqual(await objectUUID(post.UUID as string), before);
  });

  it('clears the child row on null', async () => {
    const post = await seedPost({ meta: { note: 'gone' } });
    const result = await runUpdate('UPost', { meta: null }, uuidIs(post.UUID as string), null);
    ok(result.ok);
    strictEqual(result.records[0].meta, null);
    strictEqual(await objectUUID(post.UUID as string), undefined);
  });
});

describe('runUpdate nested child uniqueness', () => {
  it('keeps a deeply nested table-wide unique value across an update', async () => {
    const created = await runCreate('UDeep', { sections: [{ notes: [{ tag: 'deep-x' }] }] }, null);
    ok(created.ok);
    const record = created.record as {
      UUID: string;
      sections: { UUID: string; notes: { UUID: string; tag: string }[] }[];
    };
    const section = record.sections[0];
    const note = section.notes[0];

    const result = await runUpdate(
      'UDeep',
      { sections: [{ UUID: section.UUID, notes: [{ UUID: note.UUID, tag: 'deep-x' }] }] },
      uuidIs(record.UUID),
      null,
    );
    ok(result.ok);
    const notes = (result.records[0].sections as { notes: { tag: string }[] }[])[0].notes;
    strictEqual(notes[0].tag, 'deep-x');
  });

  it('still rejects a nested unique value another record holds', async () => {
    await runCreate('UDeep', { sections: [{ notes: [{ tag: 'taken' }] }] }, null);
    const other = await runCreate('UDeep', { sections: [{ notes: [{ tag: 'free' }] }] }, null);
    ok(other.ok);
    const record = other.record as {
      UUID: string;
      sections: { UUID: string; notes: { UUID: string }[] }[];
    };
    const section = record.sections[0];
    const note = section.notes[0];
    const result = await runUpdate(
      'UDeep',
      { sections: [{ UUID: section.UUID, notes: [{ UUID: note.UUID, tag: 'taken' }] }] },
      uuidIs(record.UUID),
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors['sections[0].notes[0].tag'], 'validation.notUnique');
  });

  it('swaps unique values between kept items, per-parent index included', async () => {
    const created = await runCreate('USwap', { items: [{ slug: 'sw-a' }, { slug: 'sw-b' }] }, null);
    ok(created.ok);
    const record = created.record as { UUID: string; items: { UUID: string }[] };
    const result = await runUpdate(
      'USwap',
      {
        items: [
          { UUID: record.items[0].UUID, slug: 'sw-b' },
          { UUID: record.items[1].UUID, slug: 'sw-a' },
        ],
      },
      uuidIs(record.UUID),
      null,
    );
    ok(result.ok);
    const items = result.records[0].items as { UUID: string; slug: string }[];
    deepStrictEqual(
      items.map((item) => item.slug),
      ['sw-b', 'sw-a'],
    );
    strictEqual(items[0].UUID, record.items[0].UUID);
  });

  it('shifts unique values along kept items and frees one for a fresh item', async () => {
    const created = await runCreate('USwap', { items: [{ slug: 'p1' }, { slug: 'p2' }] }, null);
    ok(created.ok);
    const record = created.record as { UUID: string; items: { UUID: string }[] };
    const result = await runUpdate(
      'USwap',
      {
        items: [
          { UUID: record.items[0].UUID, slug: 'p2' },
          { UUID: record.items[1].UUID, slug: 'p3' },
          { slug: 'p1' },
        ],
      },
      uuidIs(record.UUID),
      null,
    );
    ok(result.ok);
    const items = result.records[0].items as { slug: string }[];
    deepStrictEqual(
      items.map((item) => item.slug),
      ['p2', 'p3', 'p1'],
    );
  });

  it('rejects fanning one table-wide unique child value across matched records', async () => {
    const one = await runCreate('UDeep', { sections: [{ notes: [{ tag: 'fan-a' }] }] }, null);
    const two = await runCreate('UDeep', { sections: [{ notes: [{ tag: 'fan-b' }] }] }, null);
    ok(one.ok);
    ok(two.ok);
    const result = await runUpdate(
      'UDeep',
      { sections: [{ notes: [{ tag: 'fan-shared' }] }] },
      {
        kind: 'compare',
        path: ['UUID'],
        op: 'in',
        value: [(one.record as { UUID: string }).UUID, (two.record as { UUID: string }).UUID],
        negated: false,
      },
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors['sections[0].notes[0].tag'], 'validation.notUnique');
    const tags = await db.query(
      'SELECT "tag" FROM "UDeep_sections_notes" WHERE "tag" LIKE ? ORDER BY "tag"',
      ['fan-%'],
    );
    deepStrictEqual(
      tags.map((row) => (row as { tag: string }).tag),
      ['fan-a', 'fan-b'],
    );
  });
});

describe('runUpdate guards', () => {
  it('throws without a filter through the untyped builder', () => {
    throws(() => queryUntyped('UPost').update({ views: 1 }), /without a filter/);
  });
});

/**
 * The condition matching one record by `UUID`.
 */
function uuidIs(uuid: string) {
  return { kind: 'compare', path: ['UUID'], op: 'equalsTo', value: uuid, negated: false } as const;
}

/**
 * Reads one post's `views`.
 */
async function views(uuid: string): Promise<number> {
  const row = await db.queryOne<{ views: number }>('SELECT "views" FROM "UPost" WHERE "UUID" = ?', [
    uuid,
  ]);
  return row!.views;
}

/**
 * Reads one post's `_updatedAt`.
 */
async function updatedAt(uuid: string): Promise<number> {
  const row = await db.queryOne<{ _updatedAt: number }>(
    'SELECT "_updatedAt" FROM "UPost" WHERE "UUID" = ?',
    [uuid],
  );
  return row!._updatedAt;
}

/**
 * Reads the `UUID` of one post's single object child row, or `undefined` when cleared.
 */
async function objectUUID(parent: string): Promise<string | undefined> {
  const row = await db.queryOne<{ UUID: string }>(
    'SELECT "UUID" FROM "UPost_meta" WHERE "_parentUUID" = ?',
    [parent],
  );
  return row?.UUID;
}

/**
 * Reads a tag's owning posts in `_targetPosition` order, the inverse side's own ordering.
 */
async function inversePosts(tag: string): Promise<string[]> {
  const rows = await db.query<{ _parentUUID: string }>(
    'SELECT "_parentUUID" FROM "UPost_tags" WHERE "_targetUUID" = ? ORDER BY "_targetPosition"',
    [tag],
  );
  return rows.map((row) => row._parentUUID);
}

/**
 * Waits a couple milliseconds so a later `_updatedAt` reads strictly greater.
 */
function sleep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2));
}
