import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import type { RecordCommitted } from '../../../../src/ohne/query/write/committed.ts';

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

useLayers().add({
  path: '/locale-delete',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useCollections().register('LDTags', {
  name: 'LDTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('LDPosts', {
  name: 'LDPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      views: field('integer'),
      tags: field('records', { collection: 'LDTags', translatable: true }),
      notes: field('repeater', { fields: { text: field('text') } }),
      sections: field('repeater', {
        translatable: true,
        fields: {
          heading: field('text'),
          items: field('repeater', { fields: { label: field('text') } }),
        },
      }),
    },
  },
});
useCollections().register('LDPlain', {
  name: 'LDPlain',
  collection: { fields: { name: field('text') } },
});

const dialect = new SQLiteDialect();
const db = await dialect.connect(':memory:');
registerDialect(dialect);
registerDatabase(db);
await syncDatabase(db, dialect, {
  desired: buildDesiredSchema(useCollections(), useFields() as never),
});

const tag = await queryUntyped('LDTags').create({ label: 'one' });
ok(tag.ok);
const tagUUID = tag.record.UUID as string;

/**
 * Creates a post at the default locale and returns its `UUID`.
 */
async function seed(input: Record<string, unknown>): Promise<string> {
  const result = await queryUntyped('LDPosts').create(input);
  ok(result.ok);
  return result.record.UUID as string;
}

/**
 * Writes the post's `de` translation.
 */
async function updateDE(uuid: string, input: Record<string, unknown>): Promise<void> {
  const outcome = await queryUntyped('LDPosts').locale('de').where({ UUID: uuid }).update(input);
  ok(outcome.ok);
}

/**
 * Counts `table` rows under the post at one locale.
 */
async function localeRows(table: string, parent: string, locale: string): Promise<number> {
  const rows = await db.query(
    `SELECT 1 FROM "${table}" WHERE "_parentUUID" = ? AND "_localeCode" = ?`,
    [parent, locale],
  );
  return rows.length;
}

/**
 * Counts `table` rows under the post across every locale.
 */
async function parentRows(table: string, parent: string): Promise<number> {
  const rows = await db.query(`SELECT 1 FROM "${table}" WHERE "_parentUUID" = ?`, [parent]);
  return rows.length;
}

/**
 * Counts the post's main-table rows.
 */
async function mainRows(uuid: string): Promise<number> {
  const rows = await db.query('SELECT 1 FROM "LDPosts" WHERE "UUID" = ?', [uuid]);
  return rows.length;
}

/**
 * The nested item labels under the post's sections, every locale, sorted.
 */
async function itemLabels(post: string): Promise<string[]> {
  const rows = await db.query<{ label: string }>(
    'SELECT i."label" AS "label" FROM "LDPosts_sections_items" i ' +
      'JOIN "LDPosts_sections" s ON s."UUID" = i."_parentUUID" ' +
      'WHERE s."_parentUUID" = ? ORDER BY i."label"',
    [post],
  );
  return rows.map((row) => row.label);
}

/**
 * Reads the post's `_updatedAt`.
 */
async function updatedAt(uuid: string): Promise<number> {
  const rows = await db.query<{ at: number }>(
    'SELECT "_updatedAt" AS "at" FROM "LDPosts" WHERE "UUID" = ?',
    [uuid],
  );
  return rows[0].at;
}

describe('deleteTranslation', () => {
  it('removes the companion and locale-scoped rows at the chain locale only', async () => {
    const post = await seed({
      title: 'Hello',
      views: 11,
      tags: [tagUUID],
      notes: [{ text: 'plain' }],
      sections: [{ heading: 'Intro', items: [{ label: 'a' }, { label: 'b' }] }],
    });
    await updateDE(post, {
      title: 'Hallo',
      tags: [tagUUID],
      sections: [{ heading: 'Einleitung', items: [{ label: 'x' }] }],
    });
    deepStrictEqual(await itemLabels(post), ['a', 'b', 'x']);

    const result = await queryUntyped('LDPosts')
      .locale('de')
      .where({ UUID: post })
      .deleteTranslation();
    deepStrictEqual(result, { deleted: 1 });

    strictEqual(await localeRows('LDPosts__translations', post, 'de'), 0);
    strictEqual(await localeRows('LDPosts__translations', post, 'en'), 1);
    strictEqual(await localeRows('LDPosts_tags', post, 'de'), 0);
    strictEqual(await localeRows('LDPosts_tags', post, 'en'), 1);
    strictEqual(await localeRows('LDPosts_sections', post, 'de'), 0);
    strictEqual(await localeRows('LDPosts_sections', post, 'en'), 1);
    deepStrictEqual(await itemLabels(post), ['a', 'b']);
    strictEqual(await parentRows('LDPosts_notes', post), 1);
    strictEqual(await mainRows(post), 1);
  });

  it('counts only the records that held rows and bumps only their _updatedAt', async () => {
    const held = await seed({ title: 'Held', views: 21 });
    const bare = await seed({ title: 'Bare', views: 22 });
    await updateDE(held, { title: 'Gehalten' });
    await db.run('UPDATE "LDPosts" SET "_updatedAt" = 0 WHERE "UUID" IN (?, ?)', [held, bare]);

    const result = await queryUntyped('LDPosts')
      .locale('de')
      .where({ views: { in: [21, 22] } })
      .deleteTranslation();
    deepStrictEqual(result, { deleted: 1 });

    ok((await updatedAt(held)) > 0);
    strictEqual(await updatedAt(bare), 0);
  });

  it('deletes the default locale, reads then seeing nulls', async () => {
    const post = await seed({
      title: 'Only EN',
      views: 31,
      sections: [{ heading: 'One', items: [] }],
    });
    const result = await queryUntyped('LDPosts')
      .locale('en')
      .where({ UUID: post })
      .deleteTranslation();
    deepStrictEqual(result, { deleted: 1 });

    const row = await queryUntyped('LDPosts').where({ UUID: post }).findFirst();
    strictEqual(row?.title, null);
    deepStrictEqual(row?.sections, []);
    strictEqual(row?.views, 31);
    strictEqual(await mainRows(post), 1);
  });
});

describe('deleteTranslation hooks', () => {
  afterEach(() => useHooks().clear());

  it('fires `record:committed` as an update of the records that lost the locale', async () => {
    const held = await seed({ title: 'Committed', views: 51 });
    await seed({ title: 'Untouched', views: 52 });
    await updateDE(held, { title: 'Festgeschrieben' });
    const events: RecordCommitted[] = [];
    hook('record:committed', (event) => {
      events.push(event);
    });

    await queryUntyped('LDPosts')
      .locale('de')
      .where({ views: { in: [51, 52] } })
      .deleteTranslation();

    deepStrictEqual(events, [{ collection: 'LDPosts', operation: 'update', uuids: [held] }]);
  });

  it('skips `record:committed` for a joined translation delete', async () => {
    const post = await seed({ title: 'Joined', views: 53 });
    await updateDE(post, { title: 'Verbunden' });
    const events: RecordCommitted[] = [];
    hook('record:committed', (event) => {
      events.push(event);
    });

    await db.transaction(async (tx) => {
      await queryUntyped('LDPosts').use(tx).locale('de').where({ UUID: post }).deleteTranslation();
    });

    strictEqual(events.length, 0);
  });

  it('leaves `record:before-delete` silent, since every record survives', async () => {
    const post = await seed({ title: 'Survivor', views: 54 });
    await updateDE(post, { title: 'Überlebender' });
    let fired = 0;
    hook('record:before-delete', () => {
      fired++;
    });

    const result = await queryUntyped('LDPosts')
      .locale('de')
      .where({ UUID: post })
      .deleteTranslation();

    deepStrictEqual(result, { deleted: 1 });
    strictEqual(fired, 0);
  });
});

describe('delete on a translatable collection', () => {
  it('evaluates a translatable condition at the default locale, companion rows cascading', async () => {
    const doomed = await seed({ title: 'Doomed', views: 41 });
    const safe = await seed({ title: 'Safe', views: 42 });
    await updateDE(safe, { title: 'Doomed' });

    const result = await queryUntyped('LDPosts').where({ title: 'Doomed' }).delete();
    deepStrictEqual(result, { deleted: 1 });

    strictEqual(await mainRows(doomed), 0);
    strictEqual(await parentRows('LDPosts__translations', doomed), 0);
    strictEqual(await mainRows(safe), 1);
    strictEqual(await localeRows('LDPosts__translations', safe, 'de'), 1);
  });
});

describe('locale guards', () => {
  it('refuses a second locale on the chain', () => {
    throws(() => queryUntyped('LDPosts').locale('en').locale('de'), /Locale already set/);
  });

  it('refuses delete on a locale-scoped chain', () => {
    throws(
      () => queryUntyped('LDPosts').locale('de').where({ views: 1 }).delete(),
      /Cannot `delete` a locale-scoped query/,
    );
  });

  it('refuses deleteTranslation without a locale', () => {
    throws(
      () => queryUntyped('LDPosts').where({ views: 1 }).deleteTranslation(),
      /Cannot `deleteTranslation` without a locale/,
    );
  });

  it('refuses a locale outside the configured set', () => {
    throws(() => queryUntyped('LDPosts').locale('fr'), /Unknown locale `fr`/);
  });

  it('refuses a locale on a non-translatable collection', () => {
    throws(() => queryUntyped('LDPlain').locale('de'), /Cannot set a locale on `LDPlain`/);
  });
});
