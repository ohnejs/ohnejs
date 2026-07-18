import { deepStrictEqual, notStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { useBlocks } from '../../../../src/ohne/blocks/use-blocks.ts';
import { useCollections } from '../../../../src/ohne/collections/use-collections.ts';
import { SQLiteDialect } from '../../../../src/ohne/database/dialects/sqlite/dialect.ts';
import { buildDesiredSchema } from '../../../../src/ohne/database/schema/desired.ts';
import { syncDatabase } from '../../../../src/ohne/database/schema/sync.ts';
import { registerDatabase, registerDialect } from '../../../../src/ohne/database/use-database.ts';
import { field } from '../../../../src/ohne/fields/field.ts';
import { useFields } from '../../../../src/ohne/fields/use-fields.ts';
import { useLayers } from '../../../../src/ohne/layers/use-layers.ts';
import { runCreate } from '../../../../src/ohne/query/write/create.ts';
import { runUpdate } from '../../../../src/ohne/query/write/update.ts';

useLayers().add({
  path: '/blocks-update',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useBlocks().register('BUHero', { name: 'BUHero', block: { fields: { title: field('text') } } });
useBlocks().register('BUSlug', {
  name: 'BUSlug',
  block: { fields: { slug: field('text', { unique: true }) } },
});
useBlocks().register('BUPanel', {
  name: 'BUPanel',
  block: {
    fields: {
      heading: field('text'),
      rows: field('repeater', {
        fields: { label: field('text'), inner: field('blocks', { allow: ['BUHero'] }) },
      }),
    },
  },
});
useBlocks().register('BUGatedB', {
  name: 'BUGatedB',
  block: {
    fields: {
      mode: field('text'),
      extra: field('text', { nullable: true, when: { mode: 'full' } }),
    },
  },
});

useCollections().register('BUPosts', {
  name: 'BUPosts',
  collection: {
    fields: {
      title: field('text'),
      content: field('blocks', { allow: ['BUHero', 'BUSlug', 'BUPanel', 'BUGatedB'] }),
    },
  },
});
useCollections().register('BUArticles', {
  name: 'BUArticles',
  collection: { fields: { body: field('blocks', { translatable: true, allow: ['BUHero'] }) } },
});
useCollections().register('BUDecks', {
  name: 'BUDecks',
  collection: {
    fields: {
      name: field('text'),
      intro: field('object', {
        fields: { note: field('text'), banner: field('blocks', { allow: ['BUHero'] }) },
      }),
      sections: field('repeater', {
        fields: { label: field('text'), widgets: field('blocks', { allow: ['BUHero'] }) },
      }),
    },
  },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never, useBlocks()),
});

interface Envelope {
  block: string;
  UUID: string;
  fields: Record<string, unknown>;
}

let counter = 0;

/**
 * Creates a fresh post carrying `content` and returns its `UUID` with the hydrated envelopes.
 */
async function seedPost(content: unknown[]): Promise<{ uuid: string; content: Envelope[] }> {
  const result = await runCreate('BUPosts', { title: `P${counter++}`, content }, null);
  ok(result.ok);
  return { uuid: result.record.UUID as string, content: result.record.content as Envelope[] };
}

/**
 * Counts the rows in `table` whose `column` equals `value`.
 */
async function countWhere(table: string, column: string, value: string): Promise<number> {
  const rows = await db.query(`SELECT 1 FROM "${table}" WHERE "${column}" = ?`, [value]);
  return rows.length;
}

/**
 * The post's wrapper rows as `[position, instance]` pairs, in position order.
 */
async function wrapperOrder(post: string): Promise<[number, string][]> {
  const rows = await db.query<{ pos: number; instance: string }>(
    'SELECT "_parentPosition" AS "pos", "_blockUUID" AS "instance" FROM "BUPosts_content" ' +
      'WHERE "_parentUUID" = ? ORDER BY "_parentPosition"',
    [post],
  );
  return rows.map((row) => [row.pos, row.instance]);
}

/**
 * Reads one post's `_updatedAt`.
 */
async function updatedAt(uuid: string): Promise<number> {
  const rows = await db.query<{ at: number }>(
    'SELECT "_updatedAt" AS "at" FROM "BUPosts" WHERE "UUID" = ?',
    [uuid],
  );
  return rows[0].at;
}

/**
 * The condition matching one record by `UUID`.
 */
function uuidIs(uuid: string) {
  return { kind: 'compare', path: ['UUID'], op: 'equalsTo', value: uuid, negated: false } as const;
}

describe('runUpdate with blocks', () => {
  it('keeps instance UUIDs across a reorder and renumbers wrapper positions', async () => {
    const post = await seedPost([
      { block: 'BUHero', fields: { title: 'A' } },
      { block: 'BUHero', fields: { title: 'B' } },
    ]);
    const [a, b] = post.content;
    const result = await runUpdate(
      'BUPosts',
      {
        content: [
          { block: 'BUHero', UUID: b.UUID, fields: { title: 'B' } },
          { block: 'BUHero', UUID: a.UUID, fields: { title: 'A' } },
        ],
      },
      uuidIs(post.uuid),
      null,
    );
    ok(result.ok);
    const content = result.records[0].content as Envelope[];
    deepStrictEqual(
      content.map((item) => [item.UUID, item.fields.title]),
      [
        [b.UUID, 'B'],
        [a.UUID, 'A'],
      ],
    );
    deepStrictEqual(await wrapperOrder(post.uuid), [
      [0, b.UUID],
      [1, a.UUID],
    ]);
  });

  it('writes a matched item update to the per-type row', async () => {
    const post = await seedPost([{ block: 'BUHero', fields: { title: 'Old' } }]);
    const [item] = post.content;
    const result = await runUpdate(
      'BUPosts',
      { content: [{ block: 'BUHero', UUID: item.UUID, fields: { title: 'New' } }] },
      uuidIs(post.uuid),
      null,
    );
    ok(result.ok);
    const content = result.records[0].content as Envelope[];
    strictEqual(content[0].UUID, item.UUID);
    const row = await db.queryOne<{ title: string }>(
      'SELECT "title" FROM "block_BUHero" WHERE "UUID" = ?',
      [item.UUID],
    );
    strictEqual(row?.title, 'New');
  });

  it('rejects a matched UUID under a different block at the item UUID', async () => {
    const post = await seedPost([{ block: 'BUHero', fields: { title: 'H' } }]);
    const result = await runUpdate(
      'BUPosts',
      { content: [{ block: 'BUSlug', UUID: post.content[0].UUID, fields: { slug: 'turn' } }] },
      uuidIs(post.uuid),
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors['content[0].UUID'], 'validation.invalidReference');
  });

  it('rejects a duplicate instance UUID instead of collapsing items', async () => {
    const post = await seedPost([{ block: 'BUHero', fields: { title: 'One' } }]);
    const [item] = post.content;
    const result = await runUpdate(
      'BUPosts',
      {
        content: [
          { block: 'BUHero', UUID: item.UUID, fields: { title: 'first' } },
          { block: 'BUHero', UUID: item.UUID, fields: { title: 'second' } },
        ],
      },
      uuidIs(post.uuid),
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors['content[1].UUID'], 'validation.notUnique');
  });

  it('rejects a foreign or cross-parent UUID at the item', async () => {
    const mine = await seedPost([{ block: 'BUHero', fields: { title: 'Mine' } }]);
    const other = await seedPost([{ block: 'BUHero', fields: { title: 'Other' } }]);
    const adopted = await runUpdate(
      'BUPosts',
      { content: [{ block: 'BUHero', UUID: other.content[0].UUID, fields: { title: 'x' } }] },
      uuidIs(mine.uuid),
      null,
    );
    ok(!adopted.ok);
    strictEqual(adopted.errors['content[0]'], 'validation.invalidReference');
    const ghost = await runUpdate(
      'BUPosts',
      { content: [{ block: 'BUHero', UUID: 'ghost', fields: { title: 'x' } }] },
      uuidIs(mine.uuid),
      null,
    );
    ok(!ghost.ok);
    strictEqual(ghost.errors['content[0]'], 'validation.invalidReference');
  });

  it('rejects a cross-locale UUID on a translatable blocks field', async () => {
    const created = await runCreate(
      'BUArticles',
      { body: [{ block: 'BUHero', fields: { title: 'EN' } }] },
      null,
    );
    ok(created.ok);
    const enItem = (created.record.body as Envelope[])[0];
    const result = await runUpdate(
      'BUArticles',
      { body: [{ block: 'BUHero', UUID: enItem.UUID, fields: { title: 'DE' } }] },
      uuidIs(created.record.UUID as string),
      'de',
    );
    ok(!result.ok);
    strictEqual(result.errors['body[0]'], 'validation.invalidReference');
  });

  it('deletes unmatched items with their wrapper, instance, and nested subtree', async () => {
    const post = await seedPost([
      {
        block: 'BUPanel',
        fields: {
          heading: 'P',
          rows: [{ label: 'L', inner: [{ block: 'BUHero', fields: { title: 'Inner' } }] }],
        },
      },
      { block: 'BUHero', fields: { title: 'Keep' } },
    ]);
    const [panel, keep] = post.content;
    const rows = panel.fields.rows as { inner: Envelope[] }[];
    const inner = rows[0].inner[0];
    const result = await runUpdate(
      'BUPosts',
      { content: [{ block: 'BUHero', UUID: keep.UUID, fields: { title: 'Keep' } }] },
      uuidIs(post.uuid),
      null,
    );
    ok(result.ok);
    strictEqual(await countWhere('block_BUPanel', 'UUID', panel.UUID), 0);
    strictEqual(await countWhere('block_BUPanel_rows', '_parentUUID', panel.UUID), 0);
    strictEqual(await countWhere('block_BUPanel_rows_inner', '_blockUUID', inner.UUID), 0);
    strictEqual(await countWhere('block_BUHero', 'UUID', inner.UUID), 0);
    strictEqual(await countWhere('block_BUHero', 'UUID', keep.UUID), 1);
    strictEqual(await countWhere('BUPosts_content', '_parentUUID', post.uuid), 1);
  });

  it('clears every wrapper row and instance on []', async () => {
    const post = await seedPost([
      { block: 'BUHero', fields: { title: 'Gone' } },
      { block: 'BUSlug', fields: { slug: 'clear-me' } },
    ]);
    const [hero, slug] = post.content;
    const result = await runUpdate('BUPosts', { content: [] }, uuidIs(post.uuid), null);
    ok(result.ok);
    deepStrictEqual(result.records[0].content, []);
    strictEqual(await countWhere('BUPosts_content', '_parentUUID', post.uuid), 0);
    strictEqual(await countWhere('block_BUHero', 'UUID', hero.UUID), 0);
    strictEqual(await countWhere('block_BUSlug', 'UUID', slug.UUID), 0);
  });

  it('inserts fresh items with new instances', async () => {
    const post = await seedPost([]);
    const result = await runUpdate(
      'BUPosts',
      { content: [{ block: 'BUHero', fields: { title: 'Fresh' } }] },
      uuidIs(post.uuid),
      null,
    );
    ok(result.ok);
    const [item] = result.records[0].content as Envelope[];
    strictEqual(item.block, 'BUHero');
    deepStrictEqual(item.fields, { title: 'Fresh' });
    strictEqual(await countWhere('block_BUHero', 'UUID', item.UUID), 1);
    deepStrictEqual(await wrapperOrder(post.uuid), [[0, item.UUID]]);
  });

  it('handles matched, fresh, and removed items in one update', async () => {
    const post = await seedPost([
      { block: 'BUHero', fields: { title: 'A' } },
      { block: 'BUSlug', fields: { slug: 'mixed-old' } },
    ]);
    const [a, removed] = post.content;
    const result = await runUpdate(
      'BUPosts',
      {
        content: [
          { block: 'BUSlug', fields: { slug: 'mixed-new' } },
          { block: 'BUHero', UUID: a.UUID, fields: { title: 'A2' } },
        ],
      },
      uuidIs(post.uuid),
      null,
    );
    ok(result.ok);
    const content = result.records[0].content as Envelope[];
    strictEqual(content.length, 2);
    strictEqual(content[0].block, 'BUSlug');
    deepStrictEqual(content[0].fields, { slug: 'mixed-new' });
    notStrictEqual(content[0].UUID, removed.UUID);
    strictEqual(content[1].UUID, a.UUID);
    deepStrictEqual(content[1].fields, { title: 'A2' });
    strictEqual(await countWhere('block_BUSlug', 'UUID', removed.UUID), 0);
    deepStrictEqual(await wrapperOrder(post.uuid), [
      [0, content[0].UUID],
      [1, a.UUID],
    ]);
  });

  it('bumps _updatedAt on a blocks-only update through the cheap path', async () => {
    const post = await seedPost([{ block: 'BUHero', fields: { title: 'T' } }]);
    await db.run('UPDATE "BUPosts" SET "_updatedAt" = 0 WHERE "UUID" = ?', [post.uuid]);
    const result = await runUpdate(
      'BUPosts',
      { content: [{ block: 'BUHero', UUID: post.content[0].UUID, fields: { title: 'T2' } }] },
      uuidIs(post.uuid),
      null,
    );
    ok(result.ok);
    ok((await updatedAt(post.uuid)) > 0);
  });

  it('bumps _updatedAt and gates block subfields through the gated path', async () => {
    const post = await seedPost([{ block: 'BUGatedB', fields: { mode: 'full', extra: 'x' } }]);
    const [item] = post.content;
    await db.run('UPDATE "BUPosts" SET "_updatedAt" = 0 WHERE "UUID" = ?', [post.uuid]);
    const inactive = await runUpdate(
      'BUPosts',
      { content: [{ block: 'BUGatedB', UUID: item.UUID, fields: { mode: 'lite', extra: 'y' } }] },
      uuidIs(post.uuid),
      null,
    );
    ok(inactive.ok);
    const gated = await db.queryOne<{ mode: string; extra: string | null }>(
      'SELECT "mode","extra" FROM "block_BUGatedB" WHERE "UUID" = ?',
      [item.UUID],
    );
    strictEqual(gated?.mode, 'lite');
    strictEqual(gated?.extra, null);
    ok((await updatedAt(post.uuid)) > 0);

    const active = await runUpdate(
      'BUPosts',
      { content: [{ block: 'BUGatedB', UUID: item.UUID, fields: { mode: 'full', extra: 'z' } }] },
      uuidIs(post.uuid),
      null,
    );
    ok(active.ok);
    const kept = await db.queryOne<{ extra: string | null }>(
      'SELECT "extra" FROM "block_BUGatedB" WHERE "UUID" = ?',
      [item.UUID],
    );
    strictEqual(kept?.extra, 'z');
  });

  it('excludes the rewritten instance from its own unique probe', async () => {
    const post = await seedPost([{ block: 'BUSlug', fields: { slug: 'self-keep' } }]);
    const [item] = post.content;
    const matched = await runUpdate(
      'BUPosts',
      { content: [{ block: 'BUSlug', UUID: item.UUID, fields: { slug: 'self-keep' } }] },
      uuidIs(post.uuid),
      null,
    );
    ok(matched.ok);
    const replaced = await runUpdate(
      'BUPosts',
      { content: [{ block: 'BUSlug', fields: { slug: 'self-keep' } }] },
      uuidIs(post.uuid),
      null,
    );
    ok(replaced.ok);
    notStrictEqual((replaced.records[0].content as Envelope[])[0].UUID, item.UUID);
  });

  it('rejects a unique block subfield colliding with another instance', async () => {
    const post = await seedPost([{ block: 'BUSlug', fields: { slug: 'clash-mine' } }]);
    await seedPost([{ block: 'BUSlug', fields: { slug: 'clash-other' } }]);
    const result = await runUpdate(
      'BUPosts',
      {
        content: [{ block: 'BUSlug', UUID: post.content[0].UUID, fields: { slug: 'clash-other' } }],
      },
      uuidIs(post.uuid),
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors['content[0].fields.slug'], 'validation.notUnique');
  });

  it('swaps unique subfield values between kept instances', async () => {
    const post = await seedPost([
      { block: 'BUSlug', fields: { slug: 'swap-a' } },
      { block: 'BUSlug', fields: { slug: 'swap-b' } },
    ]);
    const [first, second] = post.content;
    const result = await runUpdate(
      'BUPosts',
      {
        content: [
          { block: 'BUSlug', UUID: first.UUID, fields: { slug: 'swap-b' } },
          { block: 'BUSlug', UUID: second.UUID, fields: { slug: 'swap-a' } },
        ],
      },
      uuidIs(post.uuid),
      null,
    );
    ok(result.ok);
    const content = result.records[0].content as Envelope[];
    strictEqual((content[0].fields as { slug: string }).slug, 'swap-b');
    strictEqual((content[1].fields as { slug: string }).slug, 'swap-a');
  });
});

describe('runUpdate sweeps instances under doomed composite rows', () => {
  it('deletes the instances a removed repeater item placed', async () => {
    const created = await runCreate(
      'BUDecks',
      {
        name: 'D1',
        sections: [{ label: 'a', widgets: [{ block: 'BUHero', fields: { title: 'W' } }] }],
      },
      null,
    );
    ok(created.ok);
    const sections = created.record.sections as { widgets: Envelope[] }[];
    const instance = sections[0].widgets[0].UUID;
    strictEqual(await countWhere('block_BUHero', 'UUID', instance), 1);

    const result = await runUpdate(
      'BUDecks',
      { sections: [] },
      uuidIs(created.record.UUID as string),
      null,
    );
    ok(result.ok);
    strictEqual(await countWhere('block_BUHero', 'UUID', instance), 0);
    strictEqual(
      await countWhere('BUDecks_sections', '_parentUUID', created.record.UUID as string),
      0,
    );
  });

  it('deletes the instances a cleared object child placed', async () => {
    const created = await runCreate(
      'BUDecks',
      {
        name: 'D2',
        intro: { note: 'n', banner: [{ block: 'BUHero', fields: { title: 'B' } }] },
      },
      null,
    );
    ok(created.ok);
    const intro = created.record.intro as { banner: Envelope[] };
    const instance = intro.banner[0].UUID;

    const result = await runUpdate(
      'BUDecks',
      { intro: null },
      uuidIs(created.record.UUID as string),
      null,
    );
    ok(result.ok);
    strictEqual(await countWhere('block_BUHero', 'UUID', instance), 0);
  });
});
