import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { DatabaseAdapter } from '../../../../src/ohne/database/adapter.ts';
import type { ConditionNode } from '../../../../src/utils/index.ts';

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
  path: '/locale-update',
  input: { collections: { locales: ['en', 'de'], defaultLocale: 'en' } },
});

useCollections().register('LPosts', {
  name: 'LPosts',
  collection: {
    fields: {
      title: field('text', { translatable: true }),
      blurb: field('text', { translatable: true, default: 'draft' }),
      summary: field('text', { translatable: true, nullable: true }),
      views: field('integer'),
    },
  },
});
useCollections().register('LTags', {
  name: 'LTags',
  collection: { fields: { label: field('text') } },
});
useCollections().register('LLinked', {
  name: 'LLinked',
  collection: {
    fields: {
      name: field('text'),
      tags: field('records', { collection: 'LTags', translatable: true }),
    },
  },
});
useCollections().register('LDocs', {
  name: 'LDocs',
  collection: {
    fields: {
      sections: field('repeater', {
        translatable: true,
        fields: { heading: field('text') },
      }),
    },
  },
});
useCollections().register('LProfiles', {
  name: 'LProfiles',
  collection: {
    fields: {
      meta: field('object', {
        translatable: true,
        fields: { note: field('text', { nullable: true }) },
      }),
    },
  },
});
useCollections().register('LGated', {
  name: 'LGated',
  collection: {
    fields: {
      status: field('text', { translatable: true, nullable: true }),
      promo: field('integer', { nullable: true, when: { status: 'live' } }),
    },
  },
});
useCollections().register('LGatedCompanion', {
  name: 'LGatedCompanion',
  collection: {
    fields: {
      status: field('text'),
      title: field('text', { translatable: true }),
      caption: field('text', { translatable: true, nullable: true, when: { status: 'live' } }),
    },
  },
});
useCollections().register('LGatedList', {
  name: 'LGatedList',
  collection: {
    fields: {
      status: field('text'),
      title: field('text', { translatable: true }),
      picks: field('multiSelect', { translatable: true, min: 1, when: { status: 'live' } }),
    },
  },
});
useCollections().register('LGatedDefault', {
  name: 'LGatedDefault',
  collection: {
    fields: {
      status: field('text'),
      caption: field('text', {
        translatable: true,
        default: 'Bad',
        validators: [(value: unknown) => (value === 'Bad' ? 'validation.invalidValue' : undefined)],
        when: { status: 'live' },
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
for (const [uuid, label] of [
  ['t1', 'A'],
  ['t2', 'B'],
  ['t3', 'C'],
  ['t4', 'D'],
]) {
  await db.run('INSERT INTO "LTags" ("UUID","_updatedAt","label") VALUES (?,?,?)', [
    uuid,
    1,
    label,
  ]);
}

/**
 * The condition matching one record by `UUID`.
 */
function uuidIs(uuid: string): ConditionNode {
  return {
    kind: 'compare',
    path: ['UUID'],
    op: 'equalsTo',
    value: uuid,
    negated: false,
  };
}

/**
 * The condition matching the listed `UUID`s.
 */
function inUUIDs(uuids: string[]): ConditionNode {
  return {
    kind: 'compare',
    path: ['UUID'],
    op: 'in',
    value: uuids,
    negated: false,
  };
}

/**
 * Seeds one post at `_updatedAt` 100 with a companion row per listed locale.
 */
async function seedPost(
  uuid: string,
  rows: {
    locale: string;
    title: string;
    blurb?: string;
    summary?: string | null;
  }[],
  views = 1,
): Promise<void> {
  await db.run('INSERT INTO "LPosts" ("UUID","_updatedAt","views") VALUES (?,?,?)', [
    uuid,
    100,
    views,
  ]);
  for (const row of rows) {
    await db.run(
      'INSERT INTO "LPosts__translations" ("_parentUUID","_localeCode","title","blurb","summary") ' +
        'VALUES (?,?,?,?,?)',
      [uuid, row.locale, row.title, row.blurb ?? 'seed', row.summary ?? null],
    );
  }
}

/**
 * Reads one post's companion row at a locale, `undefined` when none exists.
 */
async function companionRow(
  uuid: string,
  locale: string,
): Promise<Record<string, unknown> | undefined> {
  return db.queryOne(
    'SELECT * FROM "LPosts__translations" WHERE "_parentUUID" = ? AND "_localeCode" = ?',
    [uuid, locale],
  );
}

/**
 * Reads one record's full main-table row.
 */
async function mainRow(table: string, uuid: string): Promise<Record<string, unknown> | undefined> {
  return db.queryOne(`SELECT * FROM "${table}" WHERE "UUID" = ?`, [uuid]);
}

/**
 * Reads one record's `_updatedAt`.
 */
async function updatedAt(table: string, uuid: string): Promise<number> {
  const row = await db.queryOne<{ _updatedAt: number }>(
    `SELECT "_updatedAt" FROM "${table}" WHERE "UUID" = ?`,
    [uuid],
  );
  ok(row);
  return row._updatedAt;
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

/**
 * The full junction table, optionally one locale's slice, in a stable order.
 */
async function junctionRows(locale?: string): Promise<Record<string, unknown>[]> {
  const filter = locale === undefined ? '' : ' WHERE "_localeCode" = ?';
  return db.query(
    'SELECT * FROM "LLinked_tags"' +
      filter +
      ' ORDER BY "_parentUUID", "_localeCode", "_parentPosition"',
    locale === undefined ? [] : [locale],
  );
}

/**
 * One document's repeater rows at a locale in `_parentPosition` order.
 */
async function sectionRows(parent: string, locale: string): Promise<Record<string, unknown>[]> {
  return db.query(
    'SELECT * FROM "LDocs_sections" WHERE "_parentUUID" = ? AND "_localeCode" = ? ' +
      'ORDER BY "_parentPosition"',
    [parent, locale],
  );
}

/**
 * One profile's object row at a locale, `undefined` when cleared or never set.
 */
async function metaRow(
  parent: string,
  locale: string,
): Promise<Record<string, unknown> | undefined> {
  return db.queryOne(
    'SELECT * FROM "LProfiles_meta" WHERE "_parentUUID" = ? AND "_localeCode" = ?',
    [parent, locale],
  );
}

/**
 * Creates one linked record at the default locale and returns its `UUID`.
 */
async function createLinked(name: string, tags: string[]): Promise<string> {
  const result = await runCreate('LLinked', { name, tags }, null);
  ok(result.ok);
  return (result.record as Record<string, unknown>).UUID as string;
}

/**
 * Seeds one gated record at `_updatedAt` 100 with a companion row per listed locale.
 */
async function seedGated(
  uuid: string,
  rows: { locale: string; status: string | null }[],
): Promise<void> {
  await db.run('INSERT INTO "LGated" ("UUID","_updatedAt","promo") VALUES (?,?,?)', [
    uuid,
    100,
    null,
  ]);
  for (const row of rows) {
    await db.run(
      'INSERT INTO "LGated__translations" ("_parentUUID","_localeCode","status") VALUES (?,?,?)',
      [uuid, row.locale, row.status],
    );
  }
}

/**
 * Finds the record with the given `UUID` in an update's returned set.
 */
function pick(records: readonly unknown[], uuid: string): Record<string, unknown> {
  const found = records.find((record) => (record as Record<string, unknown>).UUID === uuid);
  ok(found);
  return found as Record<string, unknown>;
}

describe('runUpdate companion upsert', () => {
  it('updates the existing locale row in place, the other locale byte-identical', async () => {
    await seedPost('cp1', [
      { locale: 'en', title: 'Hello', blurb: 'b-en', summary: 's-en' },
      { locale: 'de', title: 'Hallo', blurb: 'b-de', summary: 's-de' },
    ]);
    const enBefore = await companionRow('cp1', 'en');
    const inserts = await countWrites(/INSERT INTO "LPosts__translations"/, async () => {
      const result = await runUpdate('LPosts', { title: 'Neu' }, uuidIs('cp1'), 'de');
      ok(result.ok);
      strictEqual(result.records[0].title, 'Neu');
    });
    strictEqual(inserts, 0);
    const de = await companionRow('cp1', 'de');
    strictEqual(de!.title, 'Neu');
    strictEqual(de!.blurb, 'b-de');
    strictEqual(de!.summary, 's-de');
    deepStrictEqual(await companionRow('cp1', 'en'), enBefore);
    ok((await updatedAt('LPosts', 'cp1')) > 100);
  });

  it('materializes a missing locale row, absent translatable fields taking create defaults', async () => {
    await seedPost('cp2', [{ locale: 'en', title: 'Hello', blurb: 'b-en', summary: 's-en' }]);
    const enBefore = await companionRow('cp2', 'en');
    const result = await runUpdate('LPosts', { title: 'Hallo' }, uuidIs('cp2'), 'de');
    ok(result.ok);
    const de = await companionRow('cp2', 'de');
    strictEqual(de!.title, 'Hallo');
    strictEqual(de!.blurb, 'draft');
    strictEqual(de!.summary, null);
    deepStrictEqual(await companionRow('cp2', 'en'), enBefore);
  });

  it('fails the whole call when a required translatable field is absent and a row must materialize', async () => {
    await seedPost('cp3', [{ locale: 'en', title: 'Hello', blurb: 'b-en', summary: 's-en' }]);
    const mainBefore = await mainRow('LPosts', 'cp3');
    const enBefore = await companionRow('cp3', 'en');
    const result = await runUpdate('LPosts', { blurb: 'neu', views: 9 }, uuidIs('cp3'), 'de');
    ok(!result.ok);
    strictEqual(result.errors.title, 'validation.required');
    deepStrictEqual(await mainRow('LPosts', 'cp3'), mainBefore);
    deepStrictEqual(await companionRow('cp3', 'en'), enBefore);
    strictEqual(await companionRow('cp3', 'de'), undefined);
  });

  it('materializes with a provided active gated field, its unused default never failing', async () => {
    const created = await runCreate('LGatedDefault', { status: 'live', caption: 'x' }, null);
    ok(created.ok);
    const uuid = (created.record as { UUID: string }).UUID;
    const result = await runUpdate(
      'LGatedDefault',
      { status: 'live', caption: 'y' },
      uuidIs(uuid),
      'de',
    );
    ok(result.ok);
    strictEqual(result.records[0].caption, 'y');
    const de = await db.queryOne<{ caption: string }>(
      'SELECT "caption" FROM "LGatedDefault__translations" ' +
        'WHERE "_parentUUID" = ? AND "_localeCode" = ?',
      [uuid, 'de'],
    );
    strictEqual(de?.caption, 'y');
  });

  it('requires an omitted gated list that forbids empty when a row must materialize', async () => {
    const created = await runCreate(
      'LGatedList',
      { status: 'live', title: 'en', picks: ['a'] },
      null,
    );
    ok(created.ok);
    const uuid = (created.record as { UUID: string }).UUID;
    const result = await runUpdate('LGatedList', { title: 'de' }, uuidIs(uuid), 'de');
    ok(!result.ok);
    deepStrictEqual({ ...result.errors }, { picks: 'validation.required' });
  });

  it("materializes a provided gated list's inactive fallback past `min`", async () => {
    const created = await runCreate('LGatedList', { status: 'idle', title: 'en' }, null);
    ok(created.ok);
    const uuid = (created.record as { UUID: string }).UUID;
    const result = await runUpdate('LGatedList', { title: 'de', picks: ['a'] }, uuidIs(uuid), 'de');
    ok(result.ok);
    deepStrictEqual(result.records[0].picks, []);
  });

  it('materializes nothing when the update touches only plain fields', async () => {
    await seedPost('cp4', [{ locale: 'en', title: 'A', blurb: 'b' }]);
    await seedPost('cp5', [
      { locale: 'en', title: 'B', blurb: 'b' },
      { locale: 'de', title: 'B-de', blurb: 'b' },
    ]);
    const result = await runUpdate('LPosts', { views: 5 }, inUUIDs(['cp4', 'cp5']), 'de');
    ok(result.ok);
    strictEqual((await mainRow('LPosts', 'cp4'))!.views, 5);
    strictEqual((await mainRow('LPosts', 'cp5'))!.views, 5);
    strictEqual(await companionRow('cp4', 'de'), undefined);
  });

  it('splits a mixed matched set: existing rows update, missing ones insert', async () => {
    await seedPost('cp6', [
      { locale: 'en', title: 'A', blurb: 'b-en' },
      { locale: 'de', title: 'Alt', blurb: 'alt-b', summary: 'alt-s' },
    ]);
    await seedPost('cp7', [{ locale: 'en', title: 'B', blurb: 'b-en' }]);
    const result = await runUpdate('LPosts', { title: 'Neu' }, inUUIDs(['cp6', 'cp7']), 'de');
    ok(result.ok);
    const updated = await companionRow('cp6', 'de');
    strictEqual(updated!.title, 'Neu');
    strictEqual(updated!.blurb, 'alt-b');
    strictEqual(updated!.summary, 'alt-s');
    const inserted = await companionRow('cp7', 'de');
    strictEqual(inserted!.title, 'Neu');
    strictEqual(inserted!.blurb, 'draft');
    strictEqual(inserted!.summary, null);
  });
});

describe('runUpdate junction diff per locale', () => {
  it('reorders, removes, and adds at one locale, the other locale byte-identical', async () => {
    const l1 = await createLinked('j1', ['t1', 't2', 't3', 't4']);
    await createLinked('j2', ['t4']);
    ok((await runUpdate('LLinked', { tags: ['t1', 't2', 't3'] }, uuidIs(l1), 'de')).ok);
    const enBefore = await junctionRows('en');

    const result = await runUpdate('LLinked', { tags: ['t3', 't1', 't4'] }, uuidIs(l1), 'de');
    ok(result.ok);
    deepStrictEqual(result.records[0].tags, ['t3', 't1', 't4']);
    const de = await junctionRows('de');
    deepStrictEqual(
      de.map((row) => [row._targetUUID, row._parentPosition, row._targetPosition]),
      [
        ['t3', 0, 0],
        ['t1', 1, 0],
        ['t4', 2, 0],
      ],
    );
    deepStrictEqual(await junctionRows('en'), enBefore);
  });

  it('issues no junction writes for a no-op update at a locale', async () => {
    const l3 = await createLinked('j3', ['t1', 't2']);
    ok((await runUpdate('LLinked', { tags: ['t1', 't2'] }, uuidIs(l3), 'de')).ok);
    const before = await junctionRows();
    const writes = await countWrites(/"LLinked_tags"/, async () => {
      const result = await runUpdate('LLinked', { tags: ['t1', 't2'] }, uuidIs(l3), 'de');
      ok(result.ok);
    });
    strictEqual(writes, 0);
    deepStrictEqual(await junctionRows(), before);
  });
});

describe('runUpdate repeater correlation per locale', () => {
  it('correlates items at one locale, the other locale byte-identical', async () => {
    const created = await runCreate(
      'LDocs',
      { sections: [{ heading: 'Intro' }, { heading: 'Body' }] },
      null,
    );
    ok(created.ok);
    const doc = (created.record as Record<string, unknown>).UUID as string;
    ok(
      (
        await runUpdate(
          'LDocs',
          { sections: [{ heading: 'Einleitung' }, { heading: 'Haupt' }] },
          uuidIs(doc),
          'de',
        )
      ).ok,
    );
    const deBefore = await sectionRows(doc, 'de');
    const enBefore = await sectionRows(doc, 'en');
    const kept = deBefore[1].UUID as string;

    const result = await runUpdate(
      'LDocs',
      { sections: [{ UUID: kept, heading: 'Haupt 2' }, { heading: 'Frisch' }] },
      uuidIs(doc),
      'de',
    );
    ok(result.ok);
    const deAfter = await sectionRows(doc, 'de');
    strictEqual(deAfter.length, 2);
    strictEqual(deAfter[0].UUID, kept);
    strictEqual(deAfter[0].heading, 'Haupt 2');
    strictEqual(deAfter[0]._parentPosition, 0);
    strictEqual(deAfter[1].heading, 'Frisch');
    strictEqual(deAfter[1]._parentPosition, 1);
    ok(!deAfter.some((row) => row.UUID === deBefore[0].UUID));
    ok(deAfter[1].UUID !== kept);
    deepStrictEqual(await sectionRows(doc, 'en'), enBefore);
  });

  it('refuses adopting another locale item UUID, keyed at the item path', async () => {
    const created = await runCreate('LDocs', { sections: [{ heading: 'Solo' }] }, null);
    ok(created.ok);
    const record = created.record as Record<string, unknown>;
    const doc = record.UUID as string;
    const enUUID = (record.sections as { UUID: string }[])[0].UUID;
    ok((await runUpdate('LDocs', { sections: [{ heading: 'De-Solo' }] }, uuidIs(doc), 'de')).ok);
    const deBefore = await sectionRows(doc, 'de');

    const result = await runUpdate(
      'LDocs',
      { sections: [{ UUID: enUUID, heading: 'x' }] },
      uuidIs(doc),
      'de',
    );
    ok(!result.ok);
    strictEqual(result.errors['sections[0]'], 'validation.invalidReference');
    deepStrictEqual(await sectionRows(doc, 'de'), deBefore);
  });
});

describe('runUpdate object upsert per locale', () => {
  it('sets and clears one locale object, the other locale surviving both', async () => {
    const created = await runCreate('LProfiles', { meta: { note: 'EN' } }, null);
    ok(created.ok);
    const profile = (created.record as Record<string, unknown>).UUID as string;
    const enBefore = await metaRow(profile, 'en');
    ok(enBefore);

    const set = await runUpdate('LProfiles', { meta: { note: 'DE' } }, uuidIs(profile), 'de');
    ok(set.ok);
    strictEqual((await metaRow(profile, 'de'))!.note, 'DE');
    deepStrictEqual(await metaRow(profile, 'en'), enBefore);

    const clear = await runUpdate('LProfiles', { meta: null }, uuidIs(profile), 'de');
    ok(clear.ok);
    strictEqual(clear.records[0].meta, null);
    strictEqual(await metaRow(profile, 'de'), undefined);
    deepStrictEqual(await metaRow(profile, 'en'), enBefore);
  });
});

describe('runUpdate matched set over translatable fields', () => {
  it('matches a value condition against the locale values, not the other locale', async () => {
    await seedPost('ws1', [
      { locale: 'en', title: 'A', blurb: 'b' },
      { locale: 'de', title: 'A-de', blurb: 'b', summary: 'gesucht' },
    ]);
    await seedPost('ws2', [{ locale: 'en', title: 'B', blurb: 'b', summary: 'gesucht' }]);
    const result = await runUpdate(
      'LPosts',
      { views: 7 },
      {
        kind: 'and',
        nodes: [
          inUUIDs(['ws1', 'ws2']),
          {
            kind: 'compare',
            path: ['summary'],
            op: 'equalsTo',
            value: 'gesucht',
            negated: false,
          },
        ],
      },
      'de',
    );
    ok(result.ok);
    strictEqual(result.records.length, 1);
    strictEqual(result.records[0].UUID, 'ws1');
    strictEqual((await mainRow('LPosts', 'ws2'))!.views, 1);
  });

  it('matches `isNull` on a record missing its locale row', async () => {
    const result = await runUpdate(
      'LPosts',
      { views: 8 },
      {
        kind: 'and',
        nodes: [
          inUUIDs(['ws1', 'ws2']),
          { kind: 'compare', path: ['summary'], op: 'isNull', negated: false },
        ],
      },
      'de',
    );
    ok(result.ok);
    strictEqual(result.records.length, 1);
    strictEqual(result.records[0].UUID, 'ws2');
    strictEqual((await mainRow('LPosts', 'ws2'))!.views, 8);
  });
});

describe('when gate reading a translatable field', () => {
  it('activates per the locale stored values, the inactive record untouched', async () => {
    await seedGated('g1', [
      { locale: 'en', status: 'off' },
      { locale: 'de', status: 'live' },
    ]);
    await seedGated('g2', [
      { locale: 'en', status: 'live' },
      { locale: 'de', status: 'off' },
    ]);
    const result = await runUpdate('LGated', { promo: 9 }, inUUIDs(['g1', 'g2']), 'de');
    ok(result.ok);
    strictEqual(result.records.length, 2);
    strictEqual(pick(result.records, 'g1').promo, 9);
    strictEqual(pick(result.records, 'g2').promo, null);
    ok((await updatedAt('LGated', 'g1')) > 100);
    strictEqual(await updatedAt('LGated', 'g2'), 100);
  });

  it('resolves the same gate the other way at the default locale', async () => {
    await seedGated('g3', [
      { locale: 'en', status: 'off' },
      { locale: 'de', status: 'live' },
    ]);
    await seedGated('g4', [
      { locale: 'en', status: 'live' },
      { locale: 'de', status: 'off' },
    ]);
    const result = await runUpdate('LGated', { promo: 9 }, inUUIDs(['g3', 'g4']), null);
    ok(result.ok);
    strictEqual(pick(result.records, 'g3').promo, null);
    strictEqual(pick(result.records, 'g4').promo, 9);
    strictEqual(await updatedAt('LGated', 'g3'), 100);
    ok((await updatedAt('LGated', 'g4')) > 100);
  });

  it('overlays the input, so setting the translatable gate field activates in the same call', async () => {
    await seedGated('g5', [
      { locale: 'en', status: 'off' },
      { locale: 'de', status: 'off' },
    ]);
    const enBefore = await db.queryOne(
      'SELECT * FROM "LGated__translations" WHERE "_parentUUID" = ? AND "_localeCode" = ?',
      ['g5', 'en'],
    );
    const result = await runUpdate('LGated', { status: 'live', promo: 9 }, uuidIs('g5'), 'de');
    ok(result.ok);
    strictEqual(result.records[0].promo, 9);
    const de = await db.queryOne<{ status: string }>(
      'SELECT * FROM "LGated__translations" WHERE "_parentUUID" = ? AND "_localeCode" = ?',
      ['g5', 'de'],
    );
    strictEqual(de!.status, 'live');
    deepStrictEqual(
      await db.queryOne(
        'SELECT * FROM "LGated__translations" WHERE "_parentUUID" = ? AND "_localeCode" = ?',
        ['g5', 'en'],
      ),
      enBefore,
    );
  });
});

describe('gated companion columns and materialization', () => {
  async function seedGatedCompanion(uuid: string, status: string): Promise<void> {
    await db.run('INSERT INTO "LGatedCompanion" ("UUID","_updatedAt","status") VALUES (?,?,?)', [
      uuid,
      100,
      status,
    ]);
    await db.run(
      'INSERT INTO "LGatedCompanion__translations" ("_parentUUID","_localeCode","title") VALUES (?,?,?)',
      [uuid, 'en', 'Title'],
    );
  }

  it('an inactive gated companion write materializes nothing and never demands defaults', async () => {
    await seedGatedCompanion('gc1', 'off');
    const result = await runUpdate('LGatedCompanion', { caption: 'x' }, uuidIs('gc1'), 'de');
    ok(result.ok);
    strictEqual(
      await db.queryOne(
        'SELECT * FROM "LGatedCompanion__translations" WHERE "_parentUUID" = ? AND "_localeCode" = ?',
        ['gc1', 'de'],
      ),
      undefined,
    );
    strictEqual(await updatedAt('LGatedCompanion', 'gc1'), 100);
  });

  it('an active gated companion write still demands the required field to materialize', async () => {
    await seedGatedCompanion('gc2', 'live');
    const result = await runUpdate('LGatedCompanion', { caption: 'x' }, uuidIs('gc2'), 'de');
    ok(!result.ok);
    deepStrictEqual(result.errors, { title: 'validation.required' });
    strictEqual(await updatedAt('LGatedCompanion', 'gc2'), 100);
  });

  it('a mixed matched set fails whole when any active record must materialize', async () => {
    await seedGatedCompanion('gc3', 'off');
    await seedGatedCompanion('gc4', 'live');
    const result = await runUpdate(
      'LGatedCompanion',
      { caption: 'x' },
      inUUIDs(['gc3', 'gc4']),
      'de',
    );
    ok(!result.ok);
    deepStrictEqual(result.errors, { title: 'validation.required' });
    strictEqual(await updatedAt('LGatedCompanion', 'gc3'), 100);
    strictEqual(await updatedAt('LGatedCompanion', 'gc4'), 100);
  });
});
