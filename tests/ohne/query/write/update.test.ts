import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import { afterEach, before, describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { ConditionNode } from '../../../../src/utils/index.ts';

import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { hook } from '../../../../src/ohne/hooks/hook.ts';
import { useHooks } from '../../../../src/ohne/hooks/use-hooks.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { queryUntyped } from '../../../../src/ohne/query/query.ts';
import { runCreate } from '../../../../src/ohne/query/write/create.ts';
import { runUpdate } from '../../../../src/ohne/query/write/update.ts';
import { linksField } from './_links-field.ts';

useLayers().add({
  path: '/update',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useCollections().register('UNote', {
  name: 'UNote',
  collection: { fields: { title: field('text', { translatable: true }), views: field('integer') } },
});
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
useCollections().register('URealSwap', {
  name: 'URealSwap',
  collection: {
    fields: {
      items: field('repeater', {
        fields: { score: field('number', { unique: true, uniquePerParent: true }) },
      }),
    },
  },
});
useCollections().register('UNest', {
  name: 'UNest',
  collection: {
    fields: {
      box: field('object', {
        fields: { items: field('repeater', { fields: { label: field('text') } }) },
      }),
    },
  },
});
useCollections().register('UVault', {
  name: 'UVault',
  collection: {
    fields: {
      name: field('text'),
      secret: field('text', { readable: false }),
      bonus: field('text', { nullable: true, when: { secret: 'go' } }),
    },
  },
});
useCollections().register('ULinks', {
  name: 'ULinks',
  collection: {
    fields: {
      mode: field('text', { nullable: true }),
      note: field('text', { nullable: true, when: { mode: 'on' } }),
      author: field('record', { collection: 'UUser' }),
      editors: field('records', { collection: 'UUser' }),
      rows: field('repeater', { fields: { who: field('record', { collection: 'UUser' }) } }),
    },
  },
});
useCollections().register('ULinked', {
  name: 'ULinked',
  collection: {
    fields: {
      mode: field('text', { nullable: true }),
      note: field('text', { nullable: true, when: { mode: 'on' } }),
      body: linksField(),
      aside: linksField(),
      rows: field('repeater', { fields: { body: linksField() } }),
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
await db.run('INSERT INTO "UUser" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
  'u1',
  1,
  'Anduin',
]);
await db.run('INSERT INTO "UUser" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
  'u2',
  1,
  'Liadrin',
]);
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

  it('correlates nested lists under two kept sibling items independently', async () => {
    const created = await runCreate(
      'UDeep',
      { sections: [{ notes: [{ tag: 'sib-a' }] }, { notes: [{ tag: 'sib-b' }] }] },
      null,
    );
    ok(created.ok);
    const record = created.record as {
      UUID: string;
      sections: { UUID: string; notes: { UUID: string; tag: string }[] }[];
    };
    const result = await runUpdate(
      'UDeep',
      {
        sections: record.sections.map((section, index) => ({
          UUID: section.UUID,
          notes: [{ UUID: section.notes[0].UUID, tag: `sib-${index}` }],
        })),
      },
      uuidIs(record.UUID),
      null,
    );
    ok(result.ok);
    const sections = result.records[0].sections as { notes: { tag: string }[] }[];
    deepStrictEqual(
      sections.map((section) => section.notes[0].tag),
      ['sib-0', 'sib-1'],
    );
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

  it('swaps unique reals whose maximum rounds `+ 1` away', async () => {
    const created = await runCreate(
      'URealSwap',
      { items: [{ score: 1e300 }, { score: 2e300 }] },
      null,
    );
    ok(created.ok);
    const record = created.record as { UUID: string; items: { UUID: string }[] };
    const result = await runUpdate(
      'URealSwap',
      {
        items: [
          { UUID: record.items[0].UUID, score: 2e300 },
          { UUID: record.items[1].UUID, score: 1e300 },
        ],
      },
      uuidIs(record.UUID),
      null,
    );
    ok(result.ok);
    const items = result.records[0].items as { score: number }[];
    deepStrictEqual(
      items.map((item) => item.score),
      [2e300, 1e300],
    );
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

describe('runUpdate across matched records', () => {
  it('diffs junctions on every matched record', async () => {
    const a = await seedPost({ tags: ['t1'] });
    const b = await seedPost({ tags: ['t2', 't3'] });
    const result = await runUpdate(
      'UPost',
      { tags: ['t3', 't1'] },
      inUUIDs([a.UUID as string, b.UUID as string]),
      null,
    );
    ok(result.ok);
    strictEqual(result.records.length, 2);
    for (const record of result.records) deepStrictEqual(record.tags, ['t3', 't1']);
  });

  it('upserts the object on every matched record, each row in place', async () => {
    const a = await seedPost({ meta: { note: 'a' } });
    const b = await seedPost({ meta: { note: 'b' } });
    const beforeA = await objectUUID(a.UUID as string);
    const beforeB = await objectUUID(b.UUID as string);
    const result = await runUpdate(
      'UPost',
      { meta: { note: 'both' } },
      inUUIDs([a.UUID as string, b.UUID as string]),
      null,
    );
    ok(result.ok);
    for (const record of result.records) {
      strictEqual((record.meta as { note: string }).note, 'both');
    }
    strictEqual(await objectUUID(a.UUID as string), beforeA);
    strictEqual(await objectUUID(b.UUID as string), beforeB);
  });

  it('writes fresh repeater items to every matched record', async () => {
    const a = await seedPost();
    const b = await seedPost();
    const result = await runUpdate(
      'UPost',
      { sections: [{ heading: 'fanned' }] },
      inUUIDs([a.UUID as string, b.UUID as string]),
      null,
    );
    ok(result.ok);
    for (const record of result.records) {
      const sections = record.sections as { heading: string }[];
      strictEqual(sections.length, 1);
      strictEqual(sections[0].heading, 'fanned');
    }
  });

  it('rejects a kept item over several matched records', async () => {
    const a = await seedPost({ sections: [{ heading: 'keep' }] });
    const b = await seedPost();
    const itemUUID = (a.sections as { UUID: string }[])[0].UUID;
    const result = await runUpdate(
      'UPost',
      { sections: [{ UUID: itemUUID, heading: 'edited' }] },
      inUUIDs([a.UUID as string, b.UUID as string]),
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors.sections, 'validation.singleRecord');
    const kept = await db.query('SELECT "heading" FROM "UPost_sections" WHERE "_parentUUID" = ?', [
      a.UUID as string,
    ]);
    deepStrictEqual(
      kept.map((row) => (row as { heading: string }).heading),
      ['keep'],
    );
  });

  it('rejects a kept item nested inside an object over several matched records', async () => {
    const one = await runCreate('UNest', { box: { items: [{ label: 'n1' }] } }, null);
    const two = await runCreate('UNest', { box: { items: [] } }, null);
    ok(one.ok);
    ok(two.ok);
    const itemUUID = (one.record.box as { items: { UUID: string }[] }).items[0].UUID;
    const result = await runUpdate(
      'UNest',
      { box: { items: [{ UUID: itemUUID, label: 'n2' }] } },
      inUUIDs([one.record.UUID as string, two.record.UUID as string]),
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors.box, 'validation.singleRecord');
  });
});

describe('runUpdate guards', () => {
  it('throws without a filter through the untyped builder', () => {
    throws(() => queryUntyped('UPost').update({ views: 1 }), /without a filter/);
  });
});

describe('runUpdate hooks', () => {
  afterEach(() => useHooks().clear());

  it('fires `record:after-update` once per matched record', async () => {
    const a = await seedPost({ summary: 'au-group' });
    const b = await seedPost({ summary: 'au-group' });
    const seen: string[] = [];
    hook('record:after-update', (record) => {
      seen.push(record.UUID as string);
    });
    const result = await runUpdate(
      'UPost',
      { views: 3 },
      { kind: 'compare', path: ['summary'], op: 'equalsTo', value: 'au-group', negated: false },
      null,
    );
    ok(result.ok);
    strictEqual(seen.length, 2);
    ok(seen.includes(a.UUID as string));
    ok(seen.includes(b.UUID as string));
  });

  it('narrows the matched set through `record:condition`', async () => {
    const a = await seedPost({ summary: 'cond-group', views: 10 });
    const b = await seedPost({ summary: 'cond-group', views: 10 });
    hook('record:condition', () => uuidIs(a.UUID as string));
    const result = await runUpdate(
      'UPost',
      { views: 555 },
      { kind: 'compare', path: ['summary'], op: 'equalsTo', value: 'cond-group', negated: false },
      null,
    );
    ok(result.ok);
    strictEqual(await views(a.UUID as string), 555);
    strictEqual(await views(b.UUID as string), 10);
  });

  it('skips `record:condition` and the read-back scope on an unscoped chain', async () => {
    const a = await seedPost({ summary: 'unscoped-group', views: 1 });
    const b = await seedPost({ summary: 'unscoped-group', views: 1 });
    hook('record:condition', () => uuidIs('none'));
    hook('query:filter', (ir) => (ir.collection === 'UPost' ? { ...ir, limit: 0 } : ir));
    const scoped = await runUpdate('UPost', { views: 2 }, uuidIs(a.UUID as string), null);
    ok(scoped.ok);
    strictEqual(scoped.records.length, 0);

    const updated = await queryUntyped('UPost')
      .unscoped()
      .where({ summary: 'unscoped-group' })
      .updateOrThrow({ views: 3 });
    strictEqual(updated.length, 2);
    const deleted = await queryUntyped('UPost').unscoped().where({ UUID: b.UUID }).delete();
    strictEqual(deleted.deleted, 1);
    const created = await queryUntyped('UPost')
      .unscoped()
      .createOrThrow({ title: 'born hidden', summary: 'unscoped-group', views: 4 });
    strictEqual(created.views, 4);
    useHooks().clear();
    strictEqual(await views(a.UUID as string), 3);
    strictEqual(await queryUntyped('UPost').where({ UUID: b.UUID }).exists(), false);
  });
});

describe('runUpdate hidden fields', () => {
  it('omits a `readable: false` field from the outcome records', async () => {
    const created = await runCreate('UVault', { name: 'v1', secret: 'stash' }, null);
    ok(created.ok);
    const uuid = created.record.UUID as string;
    ok(!('secret' in created.record));
    const result = await runUpdate('UVault', { name: 'v1b' }, uuidIs(uuid), null);
    ok(result.ok);
    strictEqual(result.records[0].name, 'v1b');
    ok(!('secret' in result.records[0]));
    strictEqual(await secretOf(uuid), 'stash');
  });

  it('activates a gate over a hidden sibling from its stored value', async () => {
    const created = await runCreate('UVault', { name: 'v2', secret: 'go' }, null);
    ok(created.ok);
    const uuid = created.record.UUID as string;
    const result = await runUpdate('UVault', { bonus: 'granted' }, uuidIs(uuid), null);
    ok(result.ok);
    strictEqual(result.records[0].bonus, 'granted');
    ok(!('secret' in result.records[0]));
  });

  it('drops a gated write when the hidden sibling holds an inactive value', async () => {
    const created = await runCreate('UVault', { name: 'v3', secret: 'stop' }, null);
    ok(created.ok);
    const uuid = created.record.UUID as string;
    const result = await runUpdate('UVault', { bonus: 'granted' }, uuidIs(uuid), null);
    ok(result.ok);
    strictEqual(result.records[0].bonus, null);
    strictEqual(await secretOf(uuid), 'stop');
  });

  it('omits a `readable: false` field from `createOrThrow`', async () => {
    const record = await queryUntyped('UVault').createOrThrow({ name: 'v4', secret: 'go' });
    ok(!('secret' in record));
    strictEqual(record.name, 'v4');
    strictEqual(await secretOf(record.UUID as string), 'go');
  });
});

describe('runUpdate link reach', () => {
  const onlyAnduin = async () => ({ where: { name: 'Anduin' } });

  async function seedLinks(input: Record<string, unknown>): Promise<string> {
    const result = await runCreate('ULinks', input, null);
    ok(result.ok);
    return result.record.UUID as string;
  }

  function linkUpdate(input: Record<string, unknown>, condition: ConditionNode) {
    return runUpdate('ULinks', input, condition, null, undefined, false, onlyAnduin);
  }

  it('passes a hidden link the record already holds under the same field', async () => {
    const uuid = await seedLinks({ author: 'u2', editors: ['u2'], rows: [{ who: 'u2' }] });
    const result = await linkUpdate(
      { author: 'u2', editors: ['u1', 'u2'], rows: [{ who: 'u2' }] },
      uuidIs(uuid),
    );
    ok(result.ok);
    deepStrictEqual(result.records[0].editors, ['u1', 'u2']);
  });

  it('refuses a held hidden link moved to another top-level field', async () => {
    const uuid = await seedLinks({ author: 'u2' });
    const result = await linkUpdate({ editors: ['u2'] }, uuidIs(uuid));
    ok(!result.ok);
    deepStrictEqual(result.errors, { 'editors[0]': 'validation.invalidReference' });
  });

  it('refuses a hidden link another record holds', async () => {
    await seedLinks({ author: 'u2' });
    const uuid = await seedLinks({ author: 'u1' });
    const result = await linkUpdate({ author: 'u2' }, uuidIs(uuid));
    ok(!result.ok);
    deepStrictEqual(result.errors, { author: 'validation.invalidReference' });
  });

  it('refuses a hidden link only some matched records hold', async () => {
    const a = await seedLinks({ author: 'u2' });
    const b = await seedLinks({ author: 'u1' });
    const result = await linkUpdate({ author: 'u2' }, inUUIDs([a, b]));
    ok(!result.ok);
    deepStrictEqual(result.errors, { author: 'validation.invalidReference' });
  });

  it('holds a stored link aside on the gated path too', async () => {
    const held = await seedLinks({ mode: 'on', author: 'u2' });
    ok((await linkUpdate({ author: 'u2', note: 'kept' }, uuidIs(held))).ok);
    const other = await seedLinks({ mode: 'on', author: 'u1' });
    const result = await linkUpdate({ author: 'u2', note: 'moved' }, uuidIs(other));
    ok(!result.ok);
    deepStrictEqual(result.errors, { author: 'validation.invalidReference' });
  });

  it('checks existence alone on a chain without `linkReach`', async () => {
    const uuid = await seedLinks({ author: 'u1' });
    const [record] = await queryUntyped('ULinks').where({ UUID: uuid }).updateOrThrow({
      author: 'u2',
    });
    strictEqual(record.author, 'u2');
  });
});

describe('runUpdate weak links', () => {
  const anduin = '01900000-0000-7000-8000-00000000000a';
  const liadrin = '01900000-0000-7000-8000-00000000000b';
  const ghost = '01900000-0000-7000-8000-00000000000c';
  const dead = '01900000-0000-7000-8000-00000000000d';
  const onlyAnduin = async () => ({ where: { name: 'Anduin' } });
  const to = (record: string) => ({ collection: 'UUser', record });

  before(async () => {
    for (const [uuid, name] of [
      [anduin, 'Anduin'],
      [liadrin, 'Liadrin'],
    ]) {
      await db.run('INSERT INTO "UUser" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
        uuid,
        1,
        name,
      ]);
    }
  });

  /**
   * Creates a record while `dead` exists, then deletes `dead`, so every link to it is held and dead.
   */
  async function seedLinked(input: Record<string, unknown>): Promise<string> {
    await db.run('INSERT INTO "UUser" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
      dead,
      1,
      'Gone',
    ]);
    const result = await runCreate('ULinked', input, null);
    await db.run('DELETE FROM "UUser" WHERE "UUID" = ?', [dead]);
    ok(result.ok);
    return result.record.UUID as string;
  }

  function linkUpdate(input: Record<string, unknown>, condition: ConditionNode, reach = false) {
    return runUpdate(
      'ULinked',
      input,
      condition,
      null,
      undefined,
      false,
      reach ? onlyAnduin : null,
    );
  }

  it('rejects a new dead link at its path', async () => {
    const uuid = await seedLinked({ body: [] });
    const result = await linkUpdate({ body: [to(anduin), to(dead)] }, uuidIs(uuid));
    ok(!result.ok);
    deepStrictEqual(result.errors, { 'body[1]': 'validation.invalidReference' });
  });

  it('passes a held dead link, both with a reach and without one', async () => {
    const uuid = await seedLinked({ body: [to(dead)] });
    const plain = await linkUpdate({ body: [to(dead), { url: '/a' }] }, uuidIs(uuid));
    ok(plain.ok);
    deepStrictEqual(plain.records[0].body, [to(dead), { url: '/a' }]);
    ok((await linkUpdate({ body: [to(dead)] }, uuidIs(uuid), true)).ok);
  });

  it('passes a held dead link on the gated path too', async () => {
    const uuid = await seedLinked({ mode: 'on', body: [to(dead)] });
    ok((await linkUpdate({ body: [to(dead)], note: 'kept' }, uuidIs(uuid))).ok);
    ok((await linkUpdate({ body: [to(dead)], note: 'kept' }, uuidIs(uuid), true)).ok);
  });

  it('passes a held dead link inside a repeater item', async () => {
    const uuid = await seedLinked({ rows: [{ body: [to(dead)] }] });
    ok((await linkUpdate({ rows: [{ body: [{ url: '/a' }, to(dead)] }] }, uuidIs(uuid))).ok);
  });

  it('checks a dead link only some matched records hold', async () => {
    const a = await seedLinked({ body: [to(dead)] });
    const b = await seedLinked({ body: [] });
    const result = await linkUpdate({ body: [to(dead)] }, inUUIDs([a, b]));
    ok(!result.ok);
    deepStrictEqual(result.errors, { 'body[0]': 'validation.invalidReference' });
  });

  it('checks a held dead link moved to another field', async () => {
    const uuid = await seedLinked({ body: [to(dead)] });
    const result = await linkUpdate({ aside: [to(dead)] }, uuidIs(uuid));
    ok(!result.ok);
    deepStrictEqual(result.errors, { 'aside[0]': 'validation.invalidReference' });
  });

  it('answers a hidden target exactly as a missing one', async () => {
    const uuid = await seedLinked({ body: [] });
    const hidden = await linkUpdate({ body: [to(liadrin)] }, uuidIs(uuid), true);
    ok(!hidden.ok);
    deepStrictEqual(hidden.errors, { 'body[0]': 'validation.invalidReference' });
    deepStrictEqual(hidden, await linkUpdate({ body: [to(ghost)] }, uuidIs(uuid), true));
  });
});

describe('runUpdate access', () => {
  const open = {
    kind: 'compare',
    path: ['title'],
    op: 'equalsTo',
    value: 'Open',
    negated: false,
  } as const;

  it('narrows each answered `_translations` to the locales `access` admits the record at', async () => {
    const uuid = (await queryUntyped('UNote').createOrThrow({ title: 'Open', views: 0 }))
      .UUID as string;
    await queryUntyped('UNote').locale('de').where({ UUID: uuid }).updateOrThrow({ title: 'Zu' });
    const all = await runUpdate('UNote', { views: 1 }, uuidIs(uuid), null);
    ok(all.ok);
    deepStrictEqual(all.records[0]._translations, ['en', 'de']);
    const scoped = await runUpdate(
      'UNote',
      { views: 2 },
      uuidIs(uuid),
      null,
      undefined,
      false,
      null,
      open,
    );
    ok(scoped.ok);
    deepStrictEqual(scoped.records[0]._translations, ['en']);
  });
});

/**
 * The condition matching one record by `UUID`.
 */
function uuidIs(uuid: string) {
  return { kind: 'compare', path: ['UUID'], op: 'equalsTo', value: uuid, negated: false } as const;
}
/**
 * The condition matching every record whose `UUID` is in `uuids`.
 */
function inUUIDs(uuids: string[]): ConditionNode {
  return { kind: 'compare', path: ['UUID'], op: 'in', value: uuids, negated: false };
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
 * Reads one vault's stored `secret` straight from the table.
 */
async function secretOf(uuid: string): Promise<string> {
  const row = await db.queryOne<{ secret: string }>(
    'SELECT "secret" FROM "UVault" WHERE "UUID" = ?',
    [uuid],
  );
  return row!.secret;
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
