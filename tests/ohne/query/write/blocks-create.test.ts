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

useLayers().add({
  path: '/blocks-create',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useBlocks().register('BCHero', { name: 'BCHero', block: { fields: { title: field('text') } } });
useBlocks().register('BCCite', {
  name: 'BCCite',
  block: {
    fields: { quote: field('text'), author: field('record', { collection: 'BCAuthors' }) },
  },
});
useBlocks().register('BCLinked', {
  name: 'BCLinked',
  block: { fields: { title: field('text'), tags: field('records', { collection: 'BCTags' }) } },
});
useBlocks().register('BCPanel', {
  name: 'BCPanel',
  block: {
    fields: {
      heading: field('text'),
      rows: field('repeater', {
        fields: { label: field('text'), inner: field('blocks', { allow: ['BCHero'] }) },
      }),
    },
  },
});
useBlocks().register('BCSlug', {
  name: 'BCSlug',
  block: { fields: { slug: field('text', { unique: true }) } },
});
useBlocks().register('BCLoose', { name: 'BCLoose', block: { fields: { note: field('text') } } });

useCollections().register('BCAuthors', {
  name: 'BCAuthors',
  collection: { fields: { name: field('text') } },
});
useCollections().register('BCTags', {
  name: 'BCTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('BCPosts', {
  name: 'BCPosts',
  collection: {
    fields: {
      title: field('text'),
      content: field('blocks', { allow: ['BCHero', 'BCCite', 'BCLinked', 'BCPanel', 'BCSlug'] }),
    },
  },
});
useCollections().register('BCArticles', {
  name: 'BCArticles',
  collection: { fields: { body: field('blocks', { translatable: true, allow: ['BCHero'] }) } },
});
useCollections().register('BCStrict', {
  name: 'BCStrict',
  collection: {
    fields: {
      tags: field('records', { collection: 'BCTags', allowEmpty: false }),
      sections: field('repeater', { fields: { heading: field('text') }, allowEmpty: false }),
      content: field('blocks', { allow: ['BCHero'], allowEmpty: false }),
    },
  },
});
useCollections().register('BCGated', {
  name: 'BCGated',
  collection: {
    fields: {
      kind: field('text'),
      items: field('repeater', {
        fields: { label: field('text') },
        allowEmpty: false,
        when: { kind: 'full' },
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
await db.run('INSERT INTO "BCAuthors" ("UUID","_updatedAt","name") VALUES (?,?,?)', [
  'a1',
  1,
  'Ada',
]);
await db.run('INSERT INTO "BCTags" ("UUID","_updatedAt","label") VALUES (?,?,?)', ['t1', 1, 'A']);
await db.run('INSERT INTO "BCTags" ("UUID","_updatedAt","label") VALUES (?,?,?)', ['t2', 1, 'B']);

interface Envelope {
  block: string;
  UUID: string;
  fields: Record<string, unknown>;
}

describe('runCreate with blocks', () => {
  it('creates blocks and returns hydrated envelopes in input order', async () => {
    const result = await runCreate(
      'BCPosts',
      {
        title: 'One',
        content: [
          { block: 'BCHero', fields: { title: 'H' } },
          { block: 'BCSlug', fields: { slug: 'one' } },
        ],
      },
      null,
    );
    ok(result.ok);
    const content = result.record.content as Envelope[];
    strictEqual(content.length, 2);
    strictEqual(content[0].block, 'BCHero');
    deepStrictEqual(content[0].fields, { title: 'H' });
    strictEqual(content[1].block, 'BCSlug');
    deepStrictEqual(content[1].fields, { slug: 'one' });
    ok(typeof content[0].UUID === 'string' && content[0].UUID.length > 0);
    notStrictEqual(content[0].UUID, content[1].UUID);
  });

  it('lands wrapper and per-type rows with the pinned columns', async () => {
    const result = await runCreate(
      'BCPosts',
      {
        title: 'Rows',
        content: [
          { block: 'BCHero', fields: { title: 'W1' } },
          { block: 'BCSlug', fields: { slug: 'rows' } },
        ],
      },
      null,
    );
    ok(result.ok);
    const uuid = result.record.UUID as string;
    const content = result.record.content as Envelope[];
    const wrappers = await db.query<{
      UUID: string;
      _parentUUID: string;
      _parentPosition: number;
      _blockType: string;
      _blockUUID: string;
    }>(
      'SELECT "UUID","_parentUUID","_parentPosition","_blockType","_blockUUID" ' +
        'FROM "BCPosts_content" WHERE "_parentUUID" = ? ORDER BY "_parentPosition"',
      [uuid],
    );
    strictEqual(wrappers.length, 2);
    deepStrictEqual(
      wrappers.map((row) => [row._parentPosition, row._blockType, row._blockUUID]),
      [
        [0, 'BCHero', content[0].UUID],
        [1, 'BCSlug', content[1].UUID],
      ],
    );
    notStrictEqual(wrappers[0].UUID, wrappers[0]._blockUUID);
    const hero = await db.queryOne<{ title: string }>(
      'SELECT "title" FROM "block_BCHero" WHERE "UUID" = ?',
      [content[0].UUID],
    );
    strictEqual(hero?.title, 'W1');
  });

  it('creates a nested tower depth-first with fresh UUIDs at every level', async () => {
    const result = await runCreate(
      'BCPosts',
      {
        title: 'Tower',
        content: [
          {
            block: 'BCPanel',
            fields: {
              heading: 'H',
              rows: [{ label: 'L', inner: [{ block: 'BCHero', fields: { title: 'Deep' } }] }],
            },
          },
        ],
      },
      null,
    );
    ok(result.ok);
    const [panel] = result.record.content as Envelope[];
    strictEqual(panel.block, 'BCPanel');
    strictEqual(panel.fields.heading, 'H');
    const rows = panel.fields.rows as { UUID: string; label: string; inner: Envelope[] }[];
    strictEqual(rows[0].label, 'L');
    const [hero] = rows[0].inner;
    strictEqual(hero.block, 'BCHero');
    deepStrictEqual(hero.fields, { title: 'Deep' });
    notStrictEqual(panel.UUID, hero.UUID);
    notStrictEqual(panel.UUID, rows[0].UUID);

    const rowRow = await db.queryOne<{ UUID: string; _parentUUID: string }>(
      'SELECT "UUID","_parentUUID" FROM "block_BCPanel_rows" WHERE "_parentUUID" = ?',
      [panel.UUID],
    );
    strictEqual(rowRow?.UUID, rows[0].UUID);
    const innerWrapper = await db.queryOne<{ _parentUUID: string; _blockUUID: string }>(
      'SELECT "_parentUUID","_blockUUID" FROM "block_BCPanel_rows_inner" WHERE "_parentUUID" = ?',
      [rows[0].UUID],
    );
    strictEqual(innerWrapper?._blockUUID, hero.UUID);
    const deep = await db.queryOne<{ title: string }>(
      'SELECT "title" FROM "block_BCHero" WHERE "UUID" = ?',
      [hero.UUID],
    );
    strictEqual(deep?.title, 'Deep');
  });

  it('writes both junction positions for a records field inside a block', async () => {
    const result = await runCreate(
      'BCPosts',
      {
        title: 'Linked',
        content: [{ block: 'BCLinked', fields: { title: 'x', tags: ['t2', 't1'] } }],
      },
      null,
    );
    ok(result.ok);
    const [linked] = result.record.content as Envelope[];
    deepStrictEqual(linked.fields.tags, ['t2', 't1']);
    const links = await db.query<{
      _targetUUID: string;
      _parentPosition: number;
      _targetPosition: number;
    }>(
      'SELECT "_targetUUID","_parentPosition","_targetPosition" FROM "block_BCLinked_tags" ' +
        'WHERE "_parentUUID" = ? ORDER BY "_parentPosition"',
      [linked.UUID],
    );
    deepStrictEqual(
      links.map((link) => [link._targetUUID, link._parentPosition, link._targetPosition]),
      [
        ['t2', 0, 0],
        ['t1', 1, 0],
      ],
    );
  });

  it('rejects a missing relation target inside a block at its fields dot-path', async () => {
    const result = await runCreate(
      'BCPosts',
      { title: 'Ref', content: [{ block: 'BCCite', fields: { quote: 'q', author: 'ghost' } }] },
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors['content[0].fields.author'], 'validation.invalidReference');
  });

  it('rejects an unregistered block type at the item discriminator', async () => {
    const result = await runCreate(
      'BCPosts',
      { title: 'Nope', content: [{ block: 'BCNope', fields: {} }] },
      null,
    );
    ok(!result.ok);
    deepStrictEqual(result.errors['content[0].block'], {
      key: 'validation.unknownBlock',
      params: { block: 'BCNope' },
    });
  });

  it('rejects a registered but disallowed block type the same way', async () => {
    const result = await runCreate(
      'BCPosts',
      { title: 'Loose', content: [{ block: 'BCLoose', fields: { note: 'n' } }] },
      null,
    );
    ok(!result.ok);
    deepStrictEqual(result.errors['content[0].block'], {
      key: 'validation.unknownBlock',
      params: { block: 'BCLoose' },
    });
  });

  it('requires the block and fields envelope keys, each at its path', async () => {
    const noBlock = await runCreate('BCPosts', { title: 'E1', content: [{ fields: {} }] }, null);
    ok(!noBlock.ok);
    strictEqual(noBlock.errors['content[0].block'], 'validation.required');
    const noFields = await runCreate(
      'BCPosts',
      { title: 'E2', content: [{ block: 'BCHero' }] },
      null,
    );
    ok(!noFields.ok);
    strictEqual(noFields.errors['content[0].fields'], 'validation.required');
  });

  it('rejects a stray envelope key, UUID on create included', async () => {
    const stray = await runCreate(
      'BCPosts',
      { title: 'E3', content: [{ block: 'BCHero', fields: { title: 'x' }, extra: 1 }] },
      null,
    );
    ok(!stray.ok);
    strictEqual(stray.errors['content[0].extra'], 'validation.unknownField');
    const withUUID = await runCreate(
      'BCPosts',
      { title: 'E4', content: [{ block: 'BCHero', fields: { title: 'x' }, UUID: 'u1' }] },
      null,
    );
    ok(!withUUID.ok);
    strictEqual(withUUID.errors['content[0].UUID'], 'validation.unknownField');
  });

  it('accepts an empty blocks list by default and reads it back as []', async () => {
    const result = await runCreate('BCPosts', { title: 'Empty', content: [] }, null);
    ok(result.ok);
    deepStrictEqual(result.record.content, []);
  });

  it('rejects a provided empty list under allowEmpty: false, per list kind', async () => {
    const result = await runCreate('BCStrict', { tags: [], sections: [], content: [] }, null);
    ok(!result.ok);
    strictEqual(result.errors.tags, 'validation.emptyValue');
    strictEqual(result.errors.sections, 'validation.emptyValue');
    strictEqual(result.errors.content, 'validation.emptyValue');
  });

  it('lands [] for an inactive when-gated allowEmpty: false list', async () => {
    const result = await runCreate('BCGated', { kind: 'lite' }, null);
    ok(result.ok);
    deepStrictEqual(result.record.items, []);
    const rows = await db.query('SELECT "UUID" FROM "BCGated_items" WHERE "_parentUUID" = ?', [
      result.record.UUID as string,
    ]);
    strictEqual(rows.length, 0);
  });

  it('stamps _localeCode on a translatable blocks field from the effective locale', async () => {
    const result = await runCreate(
      'BCArticles',
      { body: [{ block: 'BCHero', fields: { title: 'DE' } }] },
      'de',
    );
    ok(result.ok);
    const body = result.record.body as Envelope[];
    deepStrictEqual(body[0].fields, { title: 'DE' });
    const wrappers = await db.query<{ _localeCode: string }>(
      'SELECT "_localeCode" FROM "BCArticles_body" WHERE "_parentUUID" = ?',
      [result.record.UUID as string],
    );
    deepStrictEqual(
      wrappers.map((row) => row._localeCode),
      ['de'],
    );
  });

  it('rejects a unique block subfield colliding with another create, at its dot-path', async () => {
    const first = await runCreate(
      'BCPosts',
      { title: 'U1', content: [{ block: 'BCSlug', fields: { slug: 'dup' } }] },
      null,
    );
    ok(first.ok);
    const second = await runCreate(
      'BCPosts',
      { title: 'U2', content: [{ block: 'BCSlug', fields: { slug: 'dup' } }] },
      null,
    );
    ok(!second.ok);
    strictEqual(second.errors['content[0].fields.slug'], 'validation.notUnique');
  });

  it('rejects a unique block subfield repeated within one create, at the later path', async () => {
    const result = await runCreate(
      'BCPosts',
      {
        title: 'U3',
        content: [
          { block: 'BCSlug', fields: { slug: 'twice' } },
          { block: 'BCSlug', fields: { slug: 'twice' } },
        ],
      },
      null,
    );
    ok(!result.ok);
    strictEqual(result.errors['content[1].fields.slug'], 'validation.notUnique');
  });
});
